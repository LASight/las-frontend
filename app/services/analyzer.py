from __future__ import annotations

import itertools
import math
import statistics
from typing import Iterable

import numpy as np
import pandas as pd

from .ai import generate_ai_interpretation
from .las_parser import parse_las_bytes
from .ml import FEATURE_ORDER, run_ml
from .petrophysics import run_petrophysics
from .qc import run_qc
from .sequence import build_sequence_correlation, run_sequence_stratigraphy
from .types import WellData


def _series_to_json(series: pd.Series) -> list[float | None]:
    rounded = series.round(4)
    return rounded.where(pd.notna(rounded), None).tolist()


def _build_raw_curves_payload(well: WellData) -> dict:
    df = well.data
    payload: dict[str, list[float | None]] = {}
    for canonical in FEATURE_ORDER:
        col = well.curve_map.get(canonical)
        if col and col in df.columns:
            payload[canonical] = _series_to_json(df[col])
    return payload


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        f = float(value)
        if math.isnan(f):
            return default
        return f
    except Exception:
        return default


def _curve_quantiles(curve: pd.Series, log10: bool = False) -> list[float]:
    valid = curve.dropna()
    if valid.empty:
        return [np.nan, np.nan, np.nan]

    if log10:
        valid = valid[valid > 0]
        if valid.empty:
            return [np.nan, np.nan, np.nan]
        valid = np.log10(valid)

    q = valid.quantile([0.1, 0.5, 0.9]).tolist()
    return [float(v) for v in q]


def _build_facies_fingerprint(well: WellData, petrophysics: dict) -> list[float]:
    df = well.data
    vector: list[float] = []

    for curve_name in ["GR", "DT", "RESD", "SP"]:
        col = well.curve_map.get(curve_name)
        if not col or col not in df.columns:
            vector.extend([np.nan, np.nan, np.nan])
            continue

        series = df[col]
        vector.extend(_curve_quantiles(series, log10=(curve_name == "RESD")))

    summary = petrophysics.get("summary", {})
    vector.extend(
        [
            _safe_float(summary.get("avg_vsh"), np.nan),
            _safe_float(summary.get("avg_phi"), np.nan),
            _safe_float(summary.get("avg_sw"), np.nan),
        ]
    )

    return vector


def _dt_to_velocity_ft_s(dt: pd.Series) -> pd.Series:
    return (1_000_000.0 / dt.where(dt > 0)).replace([np.inf, -np.inf], np.nan)


def _build_density_transform(wells: list[WellData]) -> dict:
    v_all: list[np.ndarray] = []
    rho_all: list[np.ndarray] = []
    source_wells = 0

    for well in wells:
        dt_col = well.curve_map.get("DT")
        rhob_col = well.curve_map.get("RHOB")
        if not dt_col or not rhob_col:
            continue
        if dt_col not in well.data.columns or rhob_col not in well.data.columns:
            continue

        dt = pd.to_numeric(well.data[dt_col], errors="coerce")
        velocity = _dt_to_velocity_ft_s(dt)
        density = pd.to_numeric(well.data[rhob_col], errors="coerce")
        density = density.where((density > 1.4) & (density < 3.2))

        valid = velocity.notna() & density.notna() & (velocity > 1000.0)
        if not valid.any():
            continue

        v = velocity[valid].to_numpy(dtype=float)
        rho = density[valid].to_numpy(dtype=float)
        if len(v) < 20:
            continue

        source_wells += 1
        v_all.append(v)
        rho_all.append(rho)

    # Gardner fallback (rho[g/cc] = a * Vp(ft/s)^b).
    gardner = {
        "method": "gardner",
        "a": 0.23,
        "b": 0.25,
        "support_points": int(sum(len(v) for v in v_all)),
        "source_wells": source_wells,
    }

    if not v_all:
        return {
            **gardner,
            "reason": "No DT+RHOB overlap available; using Gardner fallback.",
        }

    velocity_all = np.concatenate(v_all)
    density_all = np.concatenate(rho_all)
    if velocity_all.size < 120:
        return {
            **gardner,
            "reason": "Insufficient overlap samples for robust local transform; using Gardner fallback.",
        }

    log_v = np.log(np.clip(velocity_all, 1.0, None))
    log_rho = np.log(np.clip(density_all, 0.1, None))

    if np.nanstd(log_v) < 1e-8:
        return {
            **gardner,
            "reason": "Velocity variance too low for local transform; using Gardner fallback.",
        }

    slope, intercept = np.polyfit(log_v, log_rho, deg=1)
    slope = float(slope)
    intercept = float(intercept)

    # Guardrail: reject unstable fits and keep physically meaningful range.
    if not np.isfinite(slope) or not np.isfinite(intercept) or slope < 0.05 or slope > 0.8:
        return {
            **gardner,
            "reason": "Local transform fit unstable; using Gardner fallback.",
        }

    return {
        "method": "local_transform",
        "slope": round(slope, 6),
        "intercept": round(intercept, 6),
        "support_points": int(velocity_all.size),
        "source_wells": source_wells,
        "equation": "rho = exp(intercept + slope * ln(Vp_ft_s))",
    }


def _predict_density_from_velocity(velocity: pd.Series, model: dict | None) -> pd.Series:
    model = model or {}
    method = model.get("method")

    if method == "local_transform":
        slope = float(model.get("slope", 0.25))
        intercept = float(model.get("intercept", np.log(0.23)))
        rho = np.exp(intercept + slope * np.log(np.clip(velocity, 1.0, None)))
        return pd.Series(rho, index=velocity.index, dtype=float).clip(lower=1.4, upper=3.2)

    a = float(model.get("a", 0.23))
    b = float(model.get("b", 0.25))
    rho = a * np.power(np.clip(velocity, 1.0, None), b)
    return pd.Series(rho, index=velocity.index, dtype=float).clip(lower=1.4, upper=3.2)


def _compute_geophysics_metrics(well: WellData, density_model: dict | None = None) -> dict:
    df = well.data
    dt_col = well.curve_map.get("DT")
    rhob_col = well.curve_map.get("RHOB")
    depth_col = well.depth_column

    if not dt_col or dt_col not in df.columns:
        return {
            "status": "insufficient_data",
            "reason": "DT curve is required for acoustic metrics.",
            "summary": {},
            "tracks": {
                "velocity_ft_s": [],
                "ai_proxy": [],
                "reflectivity": [],
            },
        }

    dt = pd.to_numeric(df[dt_col], errors="coerce")
    velocity = _dt_to_velocity_ft_s(dt)
    predicted_density = _predict_density_from_velocity(velocity, density_model)
    density_method = (density_model or {}).get("method", "gardner")

    if rhob_col and rhob_col in df.columns:
        density = pd.to_numeric(df[rhob_col], errors="coerce")
        density = density.where((density > 1.4) & (density < 3.2))
        if density.notna().any():
            missing_before = int(density.isna().sum())
            density = density.fillna(predicted_density)
            missing_after = int(density.isna().sum())
            density_assumption = (
                f"RHOB used where present; filled {missing_before - missing_after} gaps with "
                f"{density_method} velocity-density transform."
            )
            status = "ok"
        else:
            density = predicted_density
            density_assumption = (
                f"RHOB invalid; dynamic density estimated from {density_method} velocity-density transform."
            )
            status = "dynamic_density_mode"
    else:
        density = predicted_density
        density_assumption = (
            f"RHOB missing; dynamic density estimated from {density_method} velocity-density transform."
        )
        status = "dynamic_density_mode"

    ai_proxy = velocity * density
    rc = ai_proxy.diff() / (ai_proxy + ai_proxy.shift(1))
    reflectivity = rc.replace([np.inf, -np.inf], np.nan)
    reflectivity_abs = reflectivity.abs()

    high_ref_threshold = float(reflectivity_abs.quantile(0.90)) if reflectivity_abs.notna().any() else np.nan
    if np.isnan(high_ref_threshold):
        high_ref_fraction = 0.0
    else:
        high_ref_fraction = float((reflectivity_abs > high_ref_threshold).mean())

    summary = {
        "avg_velocity_ft_s": round(float(velocity.mean(skipna=True)), 2) if velocity.notna().any() else None,
        "avg_density_g_cc": round(float(density.mean(skipna=True)), 4) if density.notna().any() else None,
        "avg_ai_proxy": round(float(ai_proxy.mean(skipna=True)), 2) if ai_proxy.notna().any() else None,
        "reflectivity_energy": round(float(reflectivity_abs.mean(skipna=True)), 5)
        if reflectivity_abs.notna().any()
        else None,
        "high_reflectivity_fraction": round(high_ref_fraction, 4),
        "density_method": density_method,
        "assumption": density_assumption,
    }

    return {
        "status": status,
        "summary": summary,
        "tracks": {
            "depth": _series_to_json(df[depth_col]) if depth_col in df.columns else [],
            "velocity_ft_s": _series_to_json(velocity),
            "density_g_cc": _series_to_json(density),
            "ai_proxy": _series_to_json(ai_proxy),
            "reflectivity": _series_to_json(reflectivity),
        },
    }


def analyze_well(well: WellData, density_model: dict | None = None) -> dict:
    qc = run_qc(well)
    petrophysics = run_petrophysics(well)
    ml = run_ml(well)
    geophysics = _compute_geophysics_metrics(well, density_model=density_model)
    sequence = run_sequence_stratigraphy(well)

    depth_col = well.depth_column
    depth = well.data[depth_col] if depth_col in well.data.columns else pd.Series(dtype=float)

    return {
        "file_name": well.filename,
        "well_name": well.well_name,
        "api": well.api,
        "company": well.company,
        "state": well.state,
        "country": well.country,
        "las_version": well.las_version,
        "curve_map": well.curve_map,
        "curve_units": well.curve_units,
        "well_params": well.well_params,
        "n_rows": int(len(well.data)),
        "depth_range": {
            "start": round(float(depth.min()), 3) if not depth.empty else None,
            "stop": round(float(depth.max()), 3) if not depth.empty else None,
        },
        "qc": qc,
        "petrophysics": petrophysics,
        "ml": ml,
        "geophysics": geophysics["summary"],
        "sequence_stratigraphy": sequence,
        "signals": {
            "facies_fingerprint": _build_facies_fingerprint(well, petrophysics),
        },
        "tracks": {
            "depth": _series_to_json(depth),
            "raw": _build_raw_curves_payload(well),
            "derived": petrophysics["derived"],
            "geophysics": geophysics["tracks"],
            "anomaly_flags": ((ml.get("anomalies") or {}).get("flags") if ml.get("status") == "ok" else []),
            "electrofacies": ((ml.get("electrofacies") or {}).get("labels") if ml.get("status") == "ok" else []),
            "som_bmu": (((ml.get("som") or {}).get("bmu") or {}).get("index") if ml.get("status") == "ok" else []),
        },
    }


def _portfolio_summary(reports: Iterable[dict]) -> dict:
    reports = list(reports)
    if not reports:
        return {
            "well_count": 0,
            "avg_qc_score": None,
            "total_depth_points": 0,
            "wells_with_pay": 0,
            "avg_anomaly_pct": None,
        }

    qc_scores = [r.get("qc", {}).get("data_score", 0.0) for r in reports]
    anomaly_pcts = [
        (r.get("ml", {}).get("anomalies", {}) or {}).get("pct", 0.0)
        for r in reports
        if r.get("ml", {}).get("status") == "ok"
    ]
    total_depth_points = sum(int(r.get("n_rows", 0)) for r in reports)
    wells_with_pay = sum(
        1
        for r in reports
        if (r.get("petrophysics", {}).get("summary", {}).get("net_reservoir_points", 0) or 0) > 0
    )

    return {
        "well_count": len(reports),
        "avg_qc_score": round(float(statistics.fmean(qc_scores)), 2) if qc_scores else None,
        "total_depth_points": total_depth_points,
        "wells_with_pay": wells_with_pay,
        "avg_anomaly_pct": round(float(statistics.fmean(anomaly_pcts)), 2) if anomaly_pcts else None,
    }


def _compute_pay_risk_scores(report: dict) -> dict:
    n_rows = max(1, int(report.get("n_rows", 0) or 0))
    qc_score = _safe_float(report.get("qc", {}).get("data_score"), 0.0)

    anomaly_pct = _safe_float((report.get("ml", {}).get("anomalies", {}) or {}).get("pct"), 0.0)
    summary = report.get("petrophysics", {}).get("summary", {})
    avg_vsh = _safe_float(summary.get("avg_vsh"), 1.0)
    avg_phi = _safe_float(summary.get("avg_phi"), 0.0)
    avg_sw = _safe_float(summary.get("avg_sw"), 1.0)
    net_points = _safe_float(summary.get("net_reservoir_points"), 0.0)

    curve_stats = report.get("qc", {}).get("curve_stats", {})
    missing_curve_pcts = [
        _safe_float(v.get("missing_pct"), 100.0)
        for _, v in curve_stats.items()
    ]
    missing_proxy = (statistics.fmean(missing_curve_pcts) / 100.0) if missing_curve_pcts else 1.0

    net_fraction = net_points / n_rows
    pay_index = 100.0 * np.clip(
        0.35 * net_fraction + 0.35 * avg_phi + 0.2 * (1.0 - avg_sw) + 0.1 * (1.0 - avg_vsh),
        0.0,
        1.0,
    )
    risk_index = 100.0 * np.clip(
        0.45 * (1.0 - (qc_score / 100.0)) + 0.35 * (anomaly_pct / 100.0) + 0.2 * missing_proxy,
        0.0,
        1.0,
    )

    if pay_index >= 60 and risk_index < 40:
        quadrant = "Prime Target"
    elif pay_index >= 45 and risk_index < 55:
        quadrant = "Balanced Opportunity"
    elif pay_index < 45 and risk_index < 40:
        quadrant = "Low Upside / Low Risk"
    else:
        quadrant = "High-Risk / Needs Review"

    geophysics = report.get("geophysics", {})
    avg_velocity_ft_s = _safe_float(geophysics.get("avg_velocity_ft_s"), np.nan)
    reflectivity_energy = _safe_float(geophysics.get("reflectivity_energy"), np.nan)

    return {
        "well_name": report.get("well_name", "Unknown"),
        "api": report.get("api", ""),
        "company": report.get("company", ""),
        "qc_score": round(qc_score, 2),
        "anomaly_pct": round(anomaly_pct, 2),
        "net_reservoir_fraction": round(float(net_fraction), 4),
        "pay_index": round(float(pay_index), 2),
        "risk_index": round(float(risk_index), 2),
        "quadrant": quadrant,
        "avg_velocity_ft_s": round(float(avg_velocity_ft_s), 2) if not np.isnan(avg_velocity_ft_s) else None,
        "reflectivity_energy": round(float(reflectivity_energy), 5) if not np.isnan(reflectivity_energy) else None,
    }


def _facies_similarity(reports: list[dict]) -> dict:
    meta = {
        "method": "cosine_similarity_on_zscored_facies_fingerprints",
        "value_range": [-1.0, 1.0],
        "value_interpretation": "Positive = similar multi-attribute signature, negative = dissimilar/opposite signature.",
    }
    labels = [r.get("well_name", f"Well {i + 1}") for i, r in enumerate(reports)]
    fingerprints = [r.get("signals", {}).get("facies_fingerprint", []) for r in reports]

    if not fingerprints:
        return {
            "labels": [],
            "matrix": [],
            "top_pairs": [],
            **meta,
        }

    max_len = max((len(fp) for fp in fingerprints), default=0)
    matrix = np.array(
        [fp + [np.nan] * (max_len - len(fp)) for fp in fingerprints],
        dtype=float,
    )

    if matrix.size == 0:
        return {
            "labels": labels,
            "matrix": [[1.0 if i == j else 0.0 for j in range(len(labels))] for i in range(len(labels))],
            "top_pairs": [],
            **meta,
        }
    if np.isnan(matrix).all():
        n = len(labels)
        return {
            "labels": labels,
            "matrix": [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)],
            "top_pairs": [],
            **meta,
        }

    col_means = np.nanmean(matrix, axis=0)
    col_means = np.where(np.isnan(col_means), 0.0, col_means)
    inds = np.where(np.isnan(matrix))
    matrix[inds] = np.take(col_means, inds[1])

    col_stds = matrix.std(axis=0)
    col_stds[col_stds == 0] = 1.0
    scaled = (matrix - matrix.mean(axis=0)) / col_stds

    norms = np.linalg.norm(scaled, axis=1)
    norms[norms == 0] = 1.0
    sim = (scaled @ scaled.T) / np.outer(norms, norms)
    sim = np.clip(sim, -1.0, 1.0)

    serial_matrix = [[round(float(v), 4) for v in row] for row in sim.tolist()]

    pairs = []
    for i, j in itertools.combinations(range(len(labels)), 2):
        pairs.append(
            {
                "well_a": labels[i],
                "well_b": labels[j],
                "similarity": round(float(sim[i, j]), 4),
            }
        )
    top_pairs = sorted(pairs, key=lambda x: x["similarity"], reverse=True)[:8]

    return {
        "labels": labels,
        "matrix": serial_matrix,
        "top_pairs": top_pairs,
        **meta,
    }


def _portfolio_analytics(reports: list[dict]) -> dict:
    pay_risk_rows = [_compute_pay_risk_scores(r) for r in reports]

    for row in pay_risk_rows:
        score = (row["pay_index"] * 0.62) + ((100.0 - row["risk_index"]) * 0.38)
        row["composite_score"] = round(float(score), 2)

    ranking = sorted(pay_risk_rows, key=lambda x: x["composite_score"], reverse=True)

    for rank, row in enumerate(ranking, start=1):
        row["rank"] = rank

    som_quality: list[dict] = []
    for r in reports:
        ml_block = r.get("ml", {}) or {}
        som_block = ml_block.get("som", {}) or {}
        if som_block.get("status") != "ok":
            continue
        som_training = som_block.get("training", {}) or {}
        som_quality.append(
            {
                "well_name": r.get("well_name", "Unknown"),
                "grid": som_block.get("grid") or {},
                "quantization_error": som_training.get("quantization_error"),
                "topological_error": som_training.get("topological_error"),
            }
        )

    return {
        "well_ranking": ranking,
        "pay_risk_matrix": pay_risk_rows,
        "facies_similarity": _facies_similarity(reports),
        "sequence_correlation": build_sequence_correlation(reports),
        "geophysics_crossplot": [
            {
                "well_name": row["well_name"],
                "avg_velocity_ft_s": row.get("avg_velocity_ft_s"),
                "reflectivity_energy": row.get("reflectivity_energy"),
                "pay_index": row.get("pay_index"),
                "risk_index": row.get("risk_index"),
            }
            for row in pay_risk_rows
        ],
        "som_quality": som_quality,
    }


def analyze_las_payloads(
    files: list[tuple[str, bytes]],
    with_ai: bool,
) -> dict:
    reports: list[dict] = []
    errors: list[dict] = []
    parsed_wells: list[WellData] = []

    for file_name, payload in files:
        try:
            parsed_wells.append(parse_las_bytes(file_name, payload))
        except Exception as exc:
            errors.append({"file_name": file_name, "error": str(exc)})

    density_model = _build_density_transform(parsed_wells)
    for well in parsed_wells:
        reports.append(analyze_well(well, density_model=density_model))

    portfolio = _portfolio_summary(reports)
    analytics = _portfolio_analytics(reports)
    ai_text, ai_meta = generate_ai_interpretation(reports, portfolio, with_ai=with_ai)

    return {
        "portfolio_summary": portfolio,
        "portfolio_analytics": analytics,
        "wells": reports,
        "density_transform": density_model,
        "ai_interpretation": ai_text,
        "ai_meta": ai_meta,
        "errors": errors,
    }


def analyze_sample_directory(sample_dir: str, with_ai: bool) -> dict:
    from pathlib import Path

    root = Path(sample_dir)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() == ".las")
    files = []
    for path in paths:
        try:
            relative_name = str(path.relative_to(root))
        except ValueError:
            relative_name = path.name
        files.append((relative_name, path.read_bytes()))
    return analyze_las_payloads(files=files, with_ai=with_ai)
