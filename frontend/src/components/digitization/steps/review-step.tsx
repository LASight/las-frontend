import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useCurveReview } from "../../../hooks/use-curve-review";
import { SectionPanel } from "../../section-panel";
import { SkeletonText } from "../../skeleton-text";
import { CurveReviewPanel } from "../curve-review-panel";
import { useJobController } from "../job-context";
import { RasterViewport } from "../raster-viewport";
import reviewStyles from "./review-step.module.css";
import styles from "./step-layout.module.css";

/**
 * Step 5 — review and correct the digitized curve over the original scan.
 *
 * Thesis objective 4, and the step the product's central claim depends on: the
 * model does not have to be perfect, because a specialist corrects it. Whether
 * that holds is decided here — if correcting is slower than digitizing by hand,
 * the whole approach fails regardless of how good the segmentation is.
 *
 * The layout is deliberately canvas-first. The panel beside it carries the
 * tools and the honest numbers; everything else is the scan with the recovered
 * trace on top of it, because that comparison is the actual work.
 */
export function ReviewStep() {
  const navigate = useNavigate();
  const { job } = useJobController();
  const review = useCurveReview(job);

  // The viewport owns its own scroll position; this lets the side panel move it
  // when the reviewer clicks a gap or an edit.
  const jumpRef = useRef<((row: number) => void) | null>(null);
  const handleJump = useCallback((row: number) => jumpRef.current?.(row), []);

  if (!job) return null;

  if (review.isLoading) {
    return (
      <SectionPanel title="Review">
        <SkeletonText />
      </SectionPanel>
    );
  }

  if (review.error) {
    return (
      <SectionPanel title="Review">
        <p className={styles.error}>{review.error}</p>
      </SectionPanel>
    );
  }

  return (
    <>
      <SectionPanel
        title="Review and correct"
        right={
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => navigate(`/digitize/${job.job_id}/export`)}
          >
            Continue to export
          </button>
        }
      >
        <p className={styles.intro}>
          The recovered trace is drawn over the original scan. Check it against the ink,
          redraw where the model wandered, and discard anything you cannot verify —
          discarded depths export as NULL rather than as a guess.
        </p>

        <div className={reviewStyles.layout}>
          <div className={reviewStyles.canvasColumn}>
            <RasterViewport
              job={job}
              x={review.x}
              gaps={review.gaps}
              tool={review.tool}
              showMask={review.showMask}
              onStroke={review.applyStroke}
              onDiscardRange={review.discardRange}
              registerJump={(fn) => {
                jumpRef.current = fn;
              }}
            />
          </div>

          <aside className={reviewStyles.sideColumn}>
            <CurveReviewPanel
              job={job}
              tool={review.tool}
              onToolChange={review.setTool}
              showMask={review.showMask}
              onShowMaskChange={review.setShowMask}
              edits={review.edits}
              stats={review.stats}
              gaps={review.gaps}
              canUndo={review.canUndo}
              onUndo={review.undo}
              onReset={review.reset}
              onJumpToRow={handleJump}
              status={review.status}
            />
          </aside>
        </div>
      </SectionPanel>
    </>
  );
}
