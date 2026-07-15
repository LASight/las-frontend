import { fmt } from "../../controllers/format-controller";
import type { WellReport } from "../../models/analyze-models";
import styles from "./well-card.module.css";

type Props = {
  well: WellReport;
};

export function WellHeader({ well }: Props) {
  const som = well.ml?.som || {};
  const somGrid = som.grid?.rows && som.grid?.cols ? `${som.grid.rows}x${som.grid.cols}` : "N/A";

  return (
    <div className={styles.wellHeader}>
      <div>
        <h3 className={styles.wellTitle}>{well.well_name}</h3>
        <p className={styles.wellSubTitle}>
          API {well.api || "N/A"} | {well.file_name} | LAS {well.las_version || "N/A"}
        </p>
      </div>
      <div className={styles.tagWrap}>
        <span className={styles.tag}>QC {fmt(well.qc?.data_score, 1)}</span>
        <span className={styles.tag}>Rows {well.n_rows ?? "N/A"}</span>
        <span className={styles.tag}>{well.company || "Unknown company"}</span>
        <span className={styles.tag}>SOM {somGrid}</span>
      </div>
    </div>
  );
}
