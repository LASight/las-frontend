import { useState } from "react";
import type { FileValidationReport, FileValidationIssue, ValidationDecision } from "../models/analyze-models";
import styles from "./file-validation-modal.module.css";

interface Props {
  reports: FileValidationReport[];
  onConfirm: (decisions: ValidationDecision[]) => void;
  onCancel: () => void;
}

function issueSeverityIcon(severity: FileValidationIssue["severity"]): string {
  if (severity === "error") return "✕";
  if (severity === "warn") return "⚠";
  return "ℹ";
}

function issueClass(severity: FileValidationIssue["severity"]): string {
  if (severity === "error") return styles.issueError;
  if (severity === "warn") return styles.issueWarn;
  return styles.issueInfo;
}

function buildDefault(report: FileValidationReport): ValidationDecision {
  return {
    file_name: report.file_name,
    proceed: report.can_proceed,
    depth_curve_override: undefined,
    null_value_override: undefined,
    sort_depth: false,
  };
}

interface FileCardProps {
  report: FileValidationReport;
  decision: ValidationDecision;
  onChange: (d: ValidationDecision) => void;
}

function FileCard({ report, decision, onChange }: FileCardProps) {
  const [open, setOpen] = useState(true);
  const [showWarnings, setShowWarnings] = useState(false);

  const errorCount = report.issues.filter((i) => i.severity === "error").length;
  const warnCount = report.issues.filter((i) => i.severity === "warn").length;
  const hasNonMonotonic = report.issues.some((i) => i.code === "non_monotonic_depth");

  function badgeClass() {
    if (errorCount > 0) return styles.badgeError;
    if (warnCount > 0) return styles.badgeWarn;
    return styles.badgeOk;
  }

  function badgeLabel() {
    if (errorCount > 0) return `${errorCount} error${errorCount > 1 ? "s" : ""}`;
    if (warnCount > 0) return `${warnCount} warning${warnCount > 1 ? "s" : ""}`;
    return "OK";
  }

  const depthRangeStr = report.depth_range
    ? `${report.depth_range[0].toFixed(1)} – ${report.depth_range[1].toFixed(1)} ${report.depth_unit || ""}`.trim()
    : "N/A";

  return (
    <div className={styles.fileCard}>
      <div className={styles.fileCardHeader} onClick={() => setOpen((v) => !v)}>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>▶</span>
        <span className={styles.fileCardName}>{report.file_name}</span>
        <span className={`${styles.badge} ${badgeClass()}`}>{badgeLabel()}</span>
        <span className={styles.fileCardMeta}>
          {report.curve_count} curves · {report.row_count.toLocaleString()} rows
        </span>
      </div>

      {open && (
        <div className={styles.fileCardBody}>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>LAS Version</span>
              <span className={styles.summaryValue}>{report.las_version || "—"}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Well Name</span>
              <span className={styles.summaryValue}>{report.well_name || "—"}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Depth Range</span>
              <span className={styles.summaryValue}>{depthRangeStr}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Depth Curve</span>
              <span className={styles.summaryValue}>{report.depth_curve || "—"}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>NULL Value</span>
              <span className={styles.summaryValue}>
                {report.null_value !== null && report.null_value !== undefined
                  ? String(report.null_value)
                  : "—"}
              </span>
            </div>
          </div>

          {report.issues.length > 0 && (
            <ul className={styles.issueList}>
              {report.issues.map((issue, i) => (
                <li key={i} className={`${styles.issue} ${issueClass(issue.severity)}`}>
                  <span className={styles.issueIcon}>{issueSeverityIcon(issue.severity)}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}

          {report.can_proceed && (
            <div className={styles.controls}>
              <div className={styles.controlGroup}>
                <label className={styles.controlLabel}>Depth Curve</label>
                <select
                  className={styles.controlSelect}
                  value={decision.depth_curve_override ?? report.depth_curve}
                  onChange={(e) =>
                    onChange({
                      ...decision,
                      depth_curve_override: e.target.value === report.depth_curve ? undefined : e.target.value,
                    })
                  }
                >
                  {(report.available_curves ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label className={styles.controlLabel}>Override NULL</label>
                <input
                  className={styles.controlInput}
                  type="number"
                  step="any"
                  placeholder={report.null_value !== null ? String(report.null_value) : "e.g. -9999.25"}
                  value={decision.null_value_override !== undefined ? decision.null_value_override : ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Number(e.target.value);
                    onChange({ ...decision, null_value_override: val });
                  }}
                />
              </div>

              {hasNonMonotonic && (
                <div className={styles.controlGroup}>
                  <label className={styles.controlLabel}>Depth Fix</label>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={decision.sort_depth ?? false}
                      onChange={(e) => onChange({ ...decision, sort_depth: e.target.checked })}
                    />
                    Sort rows by depth
                  </label>
                </div>
              )}
            </div>
          )}

          {report.parsing_warnings.length > 0 && (
            <div>
              <button className={styles.warningsToggle} onClick={() => setShowWarnings((v) => !v)}>
                {showWarnings ? "▾" : "▸"} {report.parsing_warnings.length} parser warning
                {report.parsing_warnings.length > 1 ? "s" : ""}
              </button>
              {showWarnings && (
                <ul className={styles.warningsList}>
                  {report.parsing_warnings.map((w, i) => (
                    <li key={i} className={styles.warningsListItem}>
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileValidationModal({ reports, onConfirm, onCancel }: Props) {
  const [decisions, setDecisions] = useState<ValidationDecision[]>(() =>
    reports.map(buildDefault)
  );

  function updateDecision(updated: ValidationDecision) {
    setDecisions((prev) => prev.map((d) => (d.file_name === updated.file_name ? updated : d)));
  }

  const allBlocked = decisions.every((d) => !d.proceed);
  const proceedCount = decisions.filter((d) => d.proceed).length;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <div>
            <h2 className={styles.dialogTitle}>File Validation</h2>
            <p className={styles.dialogSubtitle}>
              Review issues before running analysis. Files with errors cannot be processed.
            </p>
          </div>
        </div>

        <div className={styles.dialogBody}>
          {reports.map((report, i) => (
            <FileCard
              key={report.file_name}
              report={report}
              decision={decisions[i]}
              onChange={updateDecision}
            />
          ))}
        </div>

        <div className={styles.dialogFooter}>
          <button className={styles.btnCancel} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={styles.btnProceed}
            disabled={allBlocked}
            onClick={() => onConfirm(decisions)}
          >
            {allBlocked
              ? "No files can proceed"
              : `Analyze ${proceedCount} file${proceedCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
