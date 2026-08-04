import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCurveReview } from "../../../hooks/use-curve-review";
import {
  EMPTY_LAS_HEADER,
  type ExportRequest,
  type LasHeaderFields,
} from "../../../models/digitization-models";
import {
  IS_MOCK_GATEWAY,
  digitizationGateway,
} from "../../../services/digitization-service";
import { SectionPanel } from "../../section-panel";
import { useJobController } from "../job-context";
import exportStyles from "./export-step.module.css";
import styles from "./step-layout.module.css";

/**
 * Step 6 — write the LAS file.
 *
 * Two ways out, and the second is the point of keeping both workflows in one
 * product: download the file, or hand it straight to the LAS analysis
 * workspace. A recovered curve should flow into QC and petrophysics without a
 * download-and-re-upload round trip.
 *
 * The header fields are optional and default to empty rather than to
 * placeholders — an empty `COMP` is honest, whereas "UNKNOWN" scattered through
 * a header is noise a reader has to learn to ignore.
 */

const HEADER_FIELDS: Array<{ key: keyof LasHeaderFields; label: string }> = [
  { key: "well", label: "Well name" },
  { key: "api", label: "API number" },
  { key: "company", label: "Company" },
  { key: "field_name", label: "Field" },
  { key: "county", label: "County" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "uwi", label: "Unique well ID" },
];

function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function ExportStep() {
  const navigate = useNavigate();
  const { job } = useJobController();
  const review = useCurveReview(job);

  const [header, setHeader] = useState<LasHeaderFields>(EMPTY_LAS_HEADER);
  const [step, setStep] = useState(0.5);
  const [preview, setPreview] = useState<string | null>(null);

  const request: ExportRequest = useMemo(
    () => ({ edits: review.edits, header, step }),
    [review.edits, header, step]
  );

  const exportLas = useMutation({
    mutationFn: () => digitizationGateway.exportLas(job!.job_id, request),
    onSuccess: ({ text, fileName }) => {
      setPreview(text);
      downloadText(fileName, text);
    },
  });

  const sendToAnalysis = useMutation({
    mutationFn: () => digitizationGateway.sendToAnalysis(job!.job_id, request),
    onSuccess: (result) => navigate(`/analysis?analysis=${result.analysis_id}`),
  });

  if (!job) return null;

  const calibration = job.calibration;
  const quality = job.quality;
  const interval = calibration ? calibration.depth_bottom - calibration.depth_top : 0;
  const estimatedRows = step > 0 ? Math.floor(interval / step) : 0;

  const exportError = exportLas.error instanceof Error ? exportLas.error.message : null;
  const analysisError =
    sendToAnalysis.error instanceof Error ? sendToAnalysis.error.message : null;

  return (
    <>
      <SectionPanel title="Well header">
        <p className={styles.intro}>
          Optional, but worth filling in — an unlabelled LAS is hard to place six months
          later. Leave a field blank rather than guessing; the file records which scan
          it came from and how much of it you corrected either way.
        </p>

        <div className={styles.fieldGrid}>
          {HEADER_FIELDS.map((field) => (
            <div className={styles.field} key={field.key}>
              <label className={styles.label} htmlFor={`hdr-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`hdr-${field.key}`}
                className={styles.input}
                value={header[field.key]}
                onChange={(event) =>
                  setHeader({ ...header, [field.key]: event.target.value })
                }
              />
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel title="Output">
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="export-step">
              Depth step ({calibration?.depth_unit ?? "FT"})
            </label>
            <input
              id="export-step"
              className={styles.input}
              type="number"
              min={0.01}
              step={0.1}
              value={step}
              onChange={(event) => setStep(Number(event.target.value))}
            />
          </div>
        </div>

        <dl className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Curve</span>
            <span className={styles.summaryValue}>
              {calibration?.mnemonic} ({calibration?.value_unit})
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Interval</span>
            <span className={styles.summaryValue}>
              {calibration?.depth_top.toFixed(1)} – {calibration?.depth_bottom.toFixed(1)}{" "}
              {calibration?.depth_unit}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Rows</span>
            <span className={styles.summaryValue}>
              ~{estimatedRows.toLocaleString()}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Corrections</span>
            <span className={styles.summaryValue}>
              {review.stats.total} ({review.stats.touchedRows.toLocaleString()} rows)
            </span>
          </div>
        </dl>

        {quality && quality.n_unrecovered > 0 && (
          <p className={styles.notice}>
            {quality.n_unrecovered.toLocaleString()} depths have no recovered value and
            will be written as <code>-999.25</code>. They are never interpolated across —
            that is the file telling a downstream reader where the trace could not be
            read.
          </p>
        )}

        {IS_MOCK_GATEWAY && (
          <p className={styles.notice}>
            Mock mode: this LAS is generated in the browser from a synthetic curve. It is
            structurally valid but is not a digitization result and must not be reported
            as one.
          </p>
        )}

        {exportError && <p className={styles.error}>{exportError}</p>}
        {analysisError && <p className={styles.error}>{analysisError}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => navigate(`/digitize/${job.job_id}/review`)}
          >
            Back to review
          </button>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={sendToAnalysis.isPending}
            onClick={() => sendToAnalysis.mutate()}
            title="Run the LAS analysis workflow on this curve without downloading it first"
          >
            {sendToAnalysis.isPending ? "Analyzing…" : "Analyze in LASight"}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={exportLas.isPending}
            onClick={() => exportLas.mutate()}
          >
            {exportLas.isPending ? "Building…" : "Download LAS"}
          </button>
        </div>
      </SectionPanel>

      {preview && (
        <SectionPanel title="LAS preview">
          <p className={styles.hint}>
            First 40 lines of the downloaded file.
          </p>
          <pre className={exportStyles.preview}>
            {preview.split("\n").slice(0, 40).join("\n")}
          </pre>
        </SectionPanel>
      )}
    </>
  );
}
