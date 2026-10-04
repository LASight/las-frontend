import { pixelToValue, rowToDepth } from "../../controllers/calibration-controller";
import { identityIssue } from "../../controllers/curve-queue-controller";
import { useCurveReview } from "../../hooks/use-curve-review";
import type { CollectionSummary, JobSummary } from "../../models/digitization-models";
import styles from "../../workspaces/curve-workspace.module.css";

const COLORS = ["var(--track-colors-1)", "var(--track-colors-2)", "var(--track-colors-3)", "var(--track-colors-4)"];

/** Display only: independent traces in physical coordinates. Never resample,
 * interpolate, choose overlap winners or generate LAS in the browser. */
export function CombinedCurvePlot({ collection }: { collection: CollectionSummary }) {
  const jobs = collection.segments.filter(({ job }) => job.quality && job.crop && job.calibration);
  if (!jobs.length || identityIssue(collection)) return <p className={styles.muted}>The track is available once segments are processed with compatible units.</p>;
  const calibrations = jobs.map(({ job }) => job.calibration!);
  const top = Math.min(...calibrations.map((c) => c.depth_top));
  const bottom = Math.max(...calibrations.map((c) => c.depth_bottom));
  const min = Math.min(...calibrations.flatMap((c) => [c.value_min, c.value_max]));
  const max = Math.max(...calibrations.flatMap((c) => [c.value_min, c.value_max]));
  return <>
    <div className={styles.legend} aria-label="Segment trace legend">{jobs.map((segment, index) => <span key={`legend:${segment.job_id}`}><i className={styles.swatch} style={{ background: COLORS[index % COLORS.length] }} />{segment.label}</span>)}</div>
    <svg viewBox="0 0 380 640" className={styles.plot} role="img" aria-label="Segment curves against depth, without interpolating NULL intervals">
      <text x="210" y="18" textAnchor="middle" fontSize="13" fill="var(--ink)" fontFamily="var(--font-data)">{calibrations[0].mnemonic} · {calibrations[0].value_unit}</text>
      {[0, .25, .5, .75, 1].map((fraction) => <g key={`grid:${fraction}`}>
        <line x1="68" x2="355" y1={48 + fraction * 554} y2={48 + fraction * 554} stroke="var(--track-grid)" />
        <line y1="48" y2="602" x1={68 + fraction * 287} x2={68 + fraction * 287} stroke="var(--track-grid)" />
        <text x="58" y={52 + fraction * 554} textAnchor="end" fontSize="11" fill="var(--track-ink)" fontFamily="var(--font-data)">{(top + fraction * (bottom - top)).toFixed(1)}</text>
        <text x={68 + fraction * 287} y="37" textAnchor="middle" fontSize="10" fill="var(--track-ink)" fontFamily="var(--font-data)">{(min + fraction * (max - min)).toFixed(1)}</text>
      </g>)}
      {jobs.map(({ job }, index) => <Trace key={`plot:${job.job_id}`} job={job} color={COLORS[index % COLORS.length]} top={top} bottom={bottom} min={min} max={max} />)}
      <text x="210" y="626" textAnchor="middle" fontSize="11" fill="var(--track-ink)">Depth {calibrations[0].depth_unit} ↓ · linear value axis</text>
    </svg>
    <p className={styles.muted}>Corrected segments; both traces are shown in overlaps. LAS output applies your choices and preserves NULL. Display only, not resampled LAS.</p>
  </>;
}

function Trace({ job, color, top, bottom, min, max }: { job: JobSummary; color: string; top: number; bottom: number; min: number; max: number }) {
  const review = useCurveReview(job);
  if (review.error) return <text x="68" y="620" fontSize="11" fill="var(--danger)">A segment could not be loaded: {review.error}</text>;
  const crop = job.crop!;
  const cal = job.calibration!;
  let d = "";
  let connected = false;
  for (let row = 0; row < review.x.length; row++) {
    if (review.x[row] === null || !Number.isFinite(review.x[row])) { connected = false; continue; }
    const value = pixelToValue(review.x[row], cal, crop.x_right - crop.x_left, job.settings?.wrap_policy !== "unwrap");
    if (value === null) { connected = false; continue; }
    const x = 68 + (value - min) / (max - min || 1) * 287;
    const y = 48 + (rowToDepth(row, cal, crop.y_bottom - crop.y_top) - top) / (bottom - top || 1) * 554;
    d += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    connected = true;
  }
  return <path d={d} stroke={color} fill="none" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />;
}
