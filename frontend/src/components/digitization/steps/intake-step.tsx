import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ScanLine } from "lucide-react";
import { useNavigate } from "react-router-dom";

import styles from "./step-layout.module.css";
import { SidebarPanel, useAppShell, useShellStatus } from "../../../app-shell-context";
import appStyles from "../../../app.module.css";
import { SectionPanel } from "../../section-panel";
import { DigitizationSidebarPanel } from "../digitization-sidebar-panel";
import {
  IS_MOCK_GATEWAY,
  digitizationGateway,
} from "../../../services/digitization-service";
import intakeStyles from "./intake-step.module.css";

/**
 * Step 1 — upload a scanned raster log.
 *
 * Lives outside the `/digitize/:jobId` routes because there is no job yet; it
 * creates one and navigates into the wizard. That is also why it renders its
 * own sidebar panel and `<main>` instead of inheriting the workspace's.
 *
 * The pre-flight summary is modelled on the LAS `FileValidationModal`: state
 * what was detected and let the user confirm, rather than silently accepting a
 * 200 MB colour photo and failing three steps later.
 */

const ACCEPTED = ".tif,.tiff,.png,.jpg,.jpeg,.bmp";
const LARGE_FILE_BYTES = 120 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} kB`;
}

export function IntakeStep() {
  const navigate = useNavigate();
  const { collapsed } = useAppShell();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: (selected: File) => digitizationGateway.createJob(selected),
    onSuccess: (job) => navigate(`/digitize/${job.job_id}/crop`),
  });

  useShellStatus(
    upload.isPending
      ? "Uploading raster…"
      : file
        ? `${file.name} ready to upload.`
        : "Select a scanned log to digitize.",
    upload.isPending
  );

  function handleFiles(files: FileList | null) {
    const selected = files?.[0];
    if (selected) setFile(selected);
  }

  const errorMessage = upload.error instanceof Error ? upload.error.message : null;

  return (
    <>
      <SidebarPanel>
        <DigitizationSidebarPanel collapsed={collapsed} job={null} />
      </SidebarPanel>

      <main className={appStyles.mainBody}>
        <SectionPanel title="Digitize a raster well log">
          <p className={styles.intro}>
            Upload a scanned log as TIFF, PNG or JPEG. You will crop a single track,
            enter its scale and depth range, run the segmentation model, correct the
            recovered curve over the original scan, and export a CWLS 2.0 LAS file.
          </p>

          <label
            className={`${intakeStyles.dropZone} ${dragging ? intakeStyles.dragging : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <ScanLine className={intakeStyles.dropIcon} size={28} />
            <span className={intakeStyles.dropTitle}>
              {file ? file.name : "Drop a scan here, or click to choose"}
            </span>
            <span className={intakeStyles.dropHint}>
              TIFF, PNG, JPEG or BMP — TIFF is typical for historical archives
            </span>
            <input
              type="file"
              accept={ACCEPTED}
              className={intakeStyles.fileInput}
              onChange={(event) => handleFiles(event.target.files)}
            />
          </label>

          {file && (
            <>
              <dl className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>File</span>
                  <span className={styles.summaryValue}>{file.name}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Size</span>
                  <span className={styles.summaryValue}>{formatBytes(file.size)}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Type</span>
                  <span className={styles.summaryValue}>{file.type || "unknown"}</span>
                </div>
              </dl>

              {file.size > LARGE_FILE_BYTES && (
                <p className={styles.notice}>
                  This is a large scan. Upload and preprocessing will take a while, and
                  segmentation runs on CPU — expect several minutes for a full-length
                  log.
                </p>
              )}
            </>
          )}

          {IS_MOCK_GATEWAY && (
            <p className={styles.notice}>
              Mock mode is on (<code>VITE_DIGITIZATION_MOCK</code>). The workflow is
              fully clickable, but the curve is generated in the browser — no model
              runs, and nothing here is a digitization result.
            </p>
          )}

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <div className={styles.actions}>
            <div className={styles.spacer} />
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!file || upload.isPending}
              onClick={() => file && upload.mutate(file)}
            >
              {upload.isPending ? "Uploading…" : "Upload and continue"}
            </button>
          </div>
        </SectionPanel>
      </main>
    </>
  );
}
