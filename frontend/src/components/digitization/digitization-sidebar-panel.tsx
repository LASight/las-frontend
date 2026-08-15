import { useNavigate } from "react-router-dom";
import { CircleAlert, Plus, ScanLine } from "lucide-react";

import type { JobSummary } from "../../models/digitization-models";
import { IS_MOCK_GATEWAY } from "../../services/digitization-service";
import { SbButton, SbDivider, SbSection } from "../sidebar-controls";
import styles from "./digitization-sidebar-panel.module.css";

/**
 * The digitization workspace's sidebar controls.
 *
 * Deliberately thin. The wizard already carries the workflow forward step by
 * step, so duplicating those actions here would give two competing routes
 * through the same process. What belongs in the sidebar is what the wizard
 * cannot show: which scan is loaded, how it turned out, and how to start over.
 */

type Props = {
  collapsed: boolean;
  job: JobSummary | null;
};

export function DigitizationSidebarPanel({ collapsed, job }: Props) {
  const navigate = useNavigate();

  return (
    <>
      <SbSection icon={<ScanLine size={16} />} label="RASTER" collapsed={collapsed}>
        {!collapsed && (
          <div className={styles.meta}>
            {job ? (
              <>
                <p className={styles.fileName} title={job.file_name}>
                  {job.file_name}
                </p>
                <p className={styles.dim}>
                  {job.raster.width.toLocaleString()} ×{" "}
                  {job.raster.height.toLocaleString()} px
                  {job.raster.mode === "1" ? " · bilevel" : ` · ${job.raster.mode}`}
                </p>
                {job.crop && (
                  <p className={styles.dim}>
                    Track: {job.crop.x_left}–{job.crop.x_right} px
                  </p>
                )}
                {job.quality && (
                  <p className={styles.dim}>
                    Coverage {(job.quality.coverage * 100).toFixed(1)}% ·{" "}
                    {job.quality.n_unrecovered.toLocaleString()} rows NULL
                  </p>
                )}
              </>
            ) : (
              <p className={styles.dim}>No raster loaded.</p>
            )}
          </div>
        )}

        <SbButton
          icon={<Plus size={16} />}
          label="New digitization"
          collapsed={collapsed}
          onClick={() => navigate("/digitize/new")}
          variant="primary"
        />
      </SbSection>

      {IS_MOCK_GATEWAY && (
        <>
          <SbDivider />
          <SbSection icon={<CircleAlert size={16} />} label="MOCK MODE" collapsed={collapsed}>
            {!collapsed && (
              <p className={styles.warning}>
                VITE_DIGITIZATION_MOCK is on. Curves are generated in the browser and
                are not digitization results.
              </p>
            )}
          </SbSection>
        </>
      )}
    </>
  );
}
