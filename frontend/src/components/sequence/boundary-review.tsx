import { fmt } from "../../controllers/format-controller";
import type { BoundaryStatus, SequenceBoundaryRow } from "../../models/analyze-models";
import { Button } from "../button";
import layout from "../layout.module.css";
import { SectionPanel } from "../section-panel";
import styles from "./boundary-review.module.css";

type Props = {
  boundaries: SequenceBoundaryRow[];
  onSetStatus: (id: string, action: BoundaryStatus | "delete-manual") => void;
  manualDepth: string;
  onManualDepthChange: (value: string) => void;
  onAddManual: () => void;
};

export function BoundaryReview({ boundaries, onSetStatus, manualDepth, onManualDepthChange, onAddManual }: Props) {
  return (
    <SectionPanel title="Boundary Review">
      <div className={layout.gridTwo}>
        <ul className={styles.boundaryList}>
          {boundaries.map((boundary) => (
            <li key={boundary.id} className={styles.boundaryItem}>
              <div className={styles.boundaryTop}>
                <strong>
                  {boundary.id} | Depth {fmt(boundary.depth, 2)}
                </strong>
                <div className={`${layout.row} ${layout.tight}`}>
                  <button onClick={() => onSetStatus(boundary.id, "accepted")}>Accept</button>
                  <button onClick={() => onSetStatus(boundary.id, "rejected")}>Reject</button>
                  <button onClick={() => onSetStatus(boundary.id, "pending")}>Pending</button>
                  {boundary.source === "manual" ? (
                    <button onClick={() => onSetStatus(boundary.id, "delete-manual")}>Delete</button>
                  ) : null}
                </div>
              </div>
              <p className={layout.meta}>
                {boundary.from_tract} -&gt; {boundary.to_tract} | confidence {fmt(boundary.confidence, 3)} | status{" "}
                {boundary.status}
              </p>
            </li>
          ))}
        </ul>

        <div className={styles.boundaryManual}>
          <label className={layout.field}>
            <span>Manual boundary depth</span>
            <input
              type="number"
              step="0.1"
              value={manualDepth}
              onChange={(event) => onManualDepthChange(event.target.value)}
              placeholder="e.g. 2045.2"
            />
          </label>
          <Button variant="secondary" onClick={onAddManual}>
            Add Manual Boundary
          </Button>
        </div>
      </div>
    </SectionPanel>
  );
}
