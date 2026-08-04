import {
  formatDepth,
  rowToDepth,
} from "../../controllers/calibration-controller";
import type { EditStats } from "../../controllers/curve-edit-controller";
import type { CurveEdit, JobSummary } from "../../models/digitization-models";
import type { ReviewTool } from "../../hooks/use-curve-review";
import styles from "./curve-review-panel.module.css";

/**
 * Tools, corrections and quality figures for the review step.
 *
 * The same shape as `boundary-review.tsx` on the sequence tab — a list of what
 * the machine proposed, what the human did about it, and a way to undo — because
 * that is already the app's idiom for this kind of work and a reviewer should
 * not have to learn a second one.
 *
 * The quality figures are shown without softening. Low coverage means the
 * segmentation did not find the trace, and no post-processing recovers that; a
 * reviewer who sees a plausible-looking curve and no coverage number has no way
 * to know how much of it was invented.
 */

type Props = {
  job: JobSummary;
  tool: ReviewTool;
  onToolChange: (tool: ReviewTool) => void;
  showMask: boolean;
  onShowMaskChange: (show: boolean) => void;
  edits: CurveEdit[];
  stats: EditStats;
  gaps: Array<{ y0: number; y1: number }>;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
  onJumpToRow: (row: number) => void;
  status: string;
};

const TOOLS: Array<{ id: ReviewTool; label: string; hint: string }> = [
  { id: "inspect", label: "Inspect", hint: "Read depth and value under the pointer" },
  { id: "redraw", label: "Redraw", hint: "Drag along the true trace to replace it" },
  { id: "discard", label: "Discard", hint: "Drag a depth range to mark it unrecovered" },
];

export function CurveReviewPanel({
  job,
  tool,
  onToolChange,
  showMask,
  onShowMaskChange,
  edits,
  stats,
  gaps,
  canUndo,
  onUndo,
  onReset,
  onJumpToRow,
  status,
}: Props) {
  const calibration = job.calibration;
  const cropHeight = job.crop ? job.crop.y_bottom - job.crop.y_top : 0;
  const quality = job.quality;

  function depthLabel(row: number): string {
    if (!calibration) return `row ${row.toLocaleString()}`;
    return formatDepth(rowToDepth(row, calibration, cropHeight), calibration.depth_unit);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.group}>
        <span className={styles.groupTitle}>Tool</span>
        <div className={styles.toolRow}>
          {TOOLS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.hint}
              className={`${styles.toolBtn} ${tool === entry.id ? styles.toolActive : ""}`}
              onClick={() => onToolChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className={styles.hint}>{TOOLS.find((t) => t.id === tool)?.hint}</p>
      </div>

      <div className={styles.group}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={showMask}
            onChange={(event) => onShowMaskChange(event.target.checked)}
          />
          Show the predicted mask
        </label>
        <p className={styles.hint}>
          Overlaying the raw mask is how grid latching becomes visible — it is obvious
          to the eye and invisible in any accuracy score.
        </p>
      </div>

      {quality && (
        <div className={styles.group}>
          <span className={styles.groupTitle}>Model output</span>
          <dl className={styles.stats}>
            <div>
              <dt>Coverage</dt>
              <dd
                className={quality.coverage < 0.8 ? styles.bad : styles.good}
              >
                {(quality.coverage * 100).toFixed(1)}%
              </dd>
            </div>
            <div>
              <dt>Rows</dt>
              <dd>{quality.n_rows.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Unrecovered</dt>
              <dd>{quality.n_unrecovered.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Suspected wraps</dt>
              <dd>{quality.n_wraps}</dd>
            </div>
          </dl>
          {quality.coverage < 0.8 && (
            <p className={styles.warning}>
              The trace was found on under 80% of rows. That is a segmentation miss, not
              something correction can fully repair — consider re-running with a lower
              threshold before spending time here.
            </p>
          )}
        </div>
      )}

      <div className={styles.group}>
        <span className={styles.groupTitle}>
          Your corrections {stats.total > 0 && `(${stats.total})`}
        </span>

        {stats.total === 0 ? (
          <p className={styles.hint}>
            Nothing changed yet — the curve shown is the model's raw output.
          </p>
        ) : (
          <>
            <dl className={styles.stats}>
              <div>
                <dt>Rows corrected</dt>
                <dd>
                  {stats.touchedRows.toLocaleString()}
                  {quality
                    ? ` (${((stats.touchedRows / quality.n_rows) * 100).toFixed(1)}%)`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Redrawn</dt>
                <dd>{stats.redrawnRows.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Discarded</dt>
                <dd>{stats.discardedRows.toLocaleString()}</dd>
              </div>
            </dl>

            <ul className={styles.editList}>
              {edits
                .slice()
                .reverse()
                .slice(0, 12)
                .map((edit, index) => (
                  <li key={`${edit.kind}-${edit.y0}-${index}`} className={styles.editRow}>
                    <span className={`${styles.badge} ${styles[edit.kind]}`}>
                      {edit.kind}
                    </span>
                    <button
                      type="button"
                      className={styles.jumpBtn}
                      onClick={() => onJumpToRow(edit.y0)}
                    >
                      {depthLabel(edit.y0)}
                    </button>
                    <span className={styles.editRows}>{edit.y1 - edit.y0} rows</span>
                  </li>
                ))}
            </ul>
          </>
        )}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={!canUndo}
            onClick={onUndo}
          >
            Undo last
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={stats.total === 0}
            onClick={onReset}
          >
            Reset to model output
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupTitle}>
          Unrecovered intervals ({gaps.length})
        </span>
        {gaps.length === 0 ? (
          <p className={styles.hint}>
            Every depth has a value — nothing will export as NULL.
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              These export as <code>-999.25</code>. They are never interpolated across.
            </p>
            <ul className={styles.editList}>
              {gaps.slice(0, 12).map((gap) => (
                <li key={gap.y0} className={styles.editRow}>
                  <button
                    type="button"
                    className={styles.jumpBtn}
                    onClick={() => onJumpToRow(gap.y0)}
                  >
                    {depthLabel(gap.y0)}
                  </button>
                  <span className={styles.editRows}>{gap.y1 - gap.y0} rows</span>
                </li>
              ))}
            </ul>
            {gaps.length > 12 && (
              <p className={styles.hint}>…and {gaps.length - 12} more.</p>
            )}
          </>
        )}
      </div>

      {status && <p className={styles.status}>{status}</p>}
    </div>
  );
}
