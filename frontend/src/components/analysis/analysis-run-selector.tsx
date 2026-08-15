import { ChevronDown, History } from "lucide-react";

import styles from "./analysis-run-selector.module.css";

type Option = {
  value: string;
  label: string;
};

type Props = {
  currentAnalysisId: string;
  currentWellName?: string;
  currentFileName?: string;
  options: Option[];
  loading: boolean;
  onSelect: (analysisId: string) => void;
};

export function AnalysisRunSelector({
  currentAnalysisId,
  currentWellName,
  currentFileName,
  options,
  loading,
  onSelect,
}: Props) {
  const currentAnalysisIsListed = options.some(
    (option) => option.value === currentAnalysisId
  );

  return (
    <section className={styles.contextHeader} aria-labelledby="current-well-heading">
      <div className={styles.identity}>
        <p className={styles.eyebrow}>SINGLE-WELL ANALYSIS</p>
        <h1 className={styles.wellName} id="current-well-heading">
          {currentWellName || "No well selected"}
        </h1>
        <p className={styles.fileName}>{currentFileName || "No active LAS analysis"}</p>
      </div>

      <label className={styles.selector}>
        <span className={styles.label}>Well / analysis run</span>
        <span className={styles.selectWrap}>
          <History className={styles.selectIcon} size={16} />
          <select
            className={styles.select}
            value={currentAnalysisId}
            disabled={loading || (options.length === 0 && !currentAnalysisId)}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">
              {loading ? "Loading analyses..." : "Select a previous analysis..."}
            </option>
            {currentAnalysisId && !currentAnalysisIsListed ? (
              <option value={currentAnalysisId}>
                {currentWellName || currentFileName || "Current analysis"}
              </option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className={styles.chevron} size={16} />
        </span>
      </label>
    </section>
  );
}
