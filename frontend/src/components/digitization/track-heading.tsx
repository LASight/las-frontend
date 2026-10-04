import { curveMetadata } from "../../controllers/curve-metadata-controller";
import type { TrackCalibration } from "../../models/digitization-models";
import styles from "../../workspaces/curve-workspace.module.css";

export function TrackHeading({ calibration }: { calibration: TrackCalibration | null }) {
  return <div className={styles.trackHeader} role="group" aria-label="Saved track calibration">
    <div className={styles.depthHeading}><span>Depth</span><strong>{calibration?.depth_unit ?? "—"}</strong></div>
    <div className={styles.curveHeading}>
      <div className={styles.curveIdentity}><strong>{calibration?.mnemonic ?? "Uncalibrated"}</strong><span>{calibration ? curveMetadata(calibration.mnemonic)?.label ?? "Custom curve" : "No saved scale"}</span><span>{calibration?.value_unit ?? "—"}</span></div>
      <div className={styles.scaleReadout}><span>{calibration?.value_min ?? "—"}</span><small>{calibration?.scale ?? "Manual calibration required"}</small><span>{calibration?.value_max ?? "—"}</span></div>
    </div>
  </div>;
}
