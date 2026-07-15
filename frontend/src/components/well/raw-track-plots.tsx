import { useMemo } from "react";

import {
  axisRangeFromSeries,
  GRID_COLOR,
  hasNumericData,
  PLOT_LAYOUT_BASE,
  RAW_CURVE_COLOR,
  RAW_CURVE_ORDER,
} from "../../controllers/plot-controller";
import type { WellReport } from "../../models/analyze-models";
import { EmptyPlot } from "../empty-plot";
import { PlotCard } from "../plot-card";
import { PlotFigure } from "../plot-figure";
import styles from "./raw-track-plots.module.css";

type Props = {
  well: WellReport;
};

export function RawTrackPlots({ well }: Props) {
  const depth = well.tracks?.depth || [];
  const raw = well.tracks?.raw || {};
  const anomalyFlags = well.tracks?.anomaly_flags || [];

  const curveKeys = useMemo(
    () => RAW_CURVE_ORDER.filter((key) => hasNumericData((raw[key] || []) as Array<number | null | undefined>)),
    [raw]
  );

  if (!curveKeys.length) {
    return <EmptyPlot message="No raw log curves available." />;
  }

  return (
    <div className={styles.rawGrid}>
      {curveKeys.map((key) => {
        const curve = raw[key] || [];
        const mappedCurve = (well.curve_map?.[key] || key).toUpperCase();
        const unit = well.curve_units?.[mappedCurve] || "";
        const title = unit ? `${key} (${unit})` : key;
        const range = axisRangeFromSeries(curve);
        const anomalyX: Array<number | null> = [];
        const anomalyDepth: Array<number | null> = [];

        for (let idx = 0; idx < anomalyFlags.length; idx += 1) {
          if (anomalyFlags[idx] === 1) {
            anomalyX.push((curve[idx] as number | null | undefined) ?? null);
            anomalyDepth.push((depth[idx] as number | null | undefined) ?? null);
          }
        }

        const traces: Array<Record<string, unknown>> = [
          {
            x: curve,
            y: depth,
            type: "scatter",
            mode: "lines",
            line: { width: 1.8, color: RAW_CURVE_COLOR[key] || "#5c6e82" },
            hovertemplate: `Depth %{y}<br>${title}: %{x:.3f}<extra></extra>`,
            showlegend: false,
            name: key,
          },
        ];

        if (anomalyDepth.length) {
          traces.push({
            x: anomalyX,
            y: anomalyDepth,
            type: "scatter",
            mode: "markers",
            marker: { size: 7, color: "#c0392b", symbol: "diamond" },
            hovertemplate: `Depth %{y}<br>${title}: %{x:.3f}<br>ML anomaly<extra></extra>`,
            showlegend: false,
            name: "Anomaly",
          });
        }

        return (
          <PlotCard key={`${well.well_name}-${key}`} title={title}>
            <PlotFigure
              data={traces}
              height={520}
              layout={{
                ...PLOT_LAYOUT_BASE,
                margin: { l: 62, r: 16, t: 30, b: 42 },
                xaxis: {
                  title,
                  gridcolor: GRID_COLOR,
                  ...(range ? { range } : {}),
                },
                yaxis: { title: "Depth", autorange: "reversed", gridcolor: GRID_COLOR },
                showlegend: false,
              }}
            />
          </PlotCard>
        );
      })}
    </div>
  );
}
