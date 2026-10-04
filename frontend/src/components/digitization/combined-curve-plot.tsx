import { pixelToValue, rowToDepth } from "../../controllers/calibration-controller";
import { identityIssue } from "../../controllers/curve-queue-controller";
import { useCurveReview } from "../../hooks/use-curve-review";
import type { CollectionSummary, JobSummary } from "../../models/digitization-models";
import styles from "../../workspaces/curve-workspace.module.css";

const COLORS = ["#008fa6", "#c56b26", "#7461b7", "#327b48"];

/** Display only: independent traces in physical coordinates. Never resample,
 * interpolate, choose overlap winners or generate LAS in the browser. */
export function CombinedCurvePlot({ collection }: { collection: CollectionSummary }) {
  const jobs = collection.segments.filter(({ job }) => job.quality && job.crop && job.calibration);
  if (!jobs.length || identityIssue(collection)) return <p className={styles.muted}>El gráfico estará disponible cuando los tramos estén procesados con unidades compatibles.</p>;
  const calibrations = jobs.map(({ job }) => job.calibration!);
  const top = Math.min(...calibrations.map((c) => c.depth_top));
  const bottom = Math.max(...calibrations.map((c) => c.depth_bottom));
  const min = Math.min(...calibrations.flatMap((c) => [c.value_min, c.value_max]));
  const max = Math.max(...calibrations.flatMap((c) => [c.value_min, c.value_max]));
  return <>
    <svg viewBox="0 0 600 430" className={styles.plot} role="img" aria-label="Curvas por profundidad, sin interpolar huecos">
      {[0, .25, .5, .75, 1].map((fraction) => <g key={`grid:${fraction}`}>
        <line x1="62" x2="575" y1={35 + fraction * 355} y2={35 + fraction * 355} stroke="#dce5ea" />
        <text x="55" y={39 + fraction * 355} textAnchor="end" fontSize="11" fill="#677987">{(top + fraction * (bottom - top)).toFixed(1)}</text>
        <text x={62 + fraction * 513} y="22" textAnchor="middle" fontSize="11" fill="#677987">{(min + fraction * (max - min)).toFixed(1)}</text>
      </g>)}
      {jobs.map(({ job }, index) => <Trace key={`plot:${job.job_id}`} job={job} color={COLORS[index % COLORS.length]} top={top} bottom={bottom} min={min} max={max} />)}
      <text x="300" y="416" textAnchor="middle" fontSize="12" fill="#677987">{calibrations[0].mnemonic} ({calibrations[0].value_unit}) · profundidad {calibrations[0].depth_unit} ↓</text>
    </svg>
    <div className={styles.actions}>{jobs.map((segment, index) => <span key={`legend:${segment.job_id}`} style={{ color: COLORS[index % COLORS.length], fontSize: ".8rem" }}>● {segment.label}</span>)}</div>
    <p className={styles.muted}>Vista de los tramos corregidos; en solapes se muestran ambos. La salida LAS aplica tus elecciones y conserva los NULL.</p>
  </>;
}

function Trace({ job, color, top, bottom, min, max }: { job: JobSummary; color: string; top: number; bottom: number; min: number; max: number }) {
  const review = useCurveReview(job);
  if (review.error) return <text x="65" y="405" fontSize="11" fill="#b42336">No se pudo cargar un tramo: {review.error}</text>;
  const crop = job.crop!;
  const cal = job.calibration!;
  const stride = Math.max(1, Math.ceil(review.x.length / 3000));
  let d = "";
  let connected = false;
  for (let row = 0; row < review.x.length; row++) {
    if (review.x[row] === null) { connected = false; continue; }
    if (connected && row % stride !== 0 && row !== review.x.length - 1) continue;
    const value = pixelToValue(review.x[row], cal, crop.x_right - crop.x_left, job.settings?.wrap_policy !== "unwrap");
    if (value === null) { connected = false; continue; }
    const x = 62 + (value - min) / (max - min || 1) * 513;
    const y = 35 + (rowToDepth(row, cal, crop.y_bottom - crop.y_top) - top) / (bottom - top || 1) * 355;
    d += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    connected = true;
  }
  return <path d={d} stroke={color} fill="none" strokeWidth="1.4" />;
}
