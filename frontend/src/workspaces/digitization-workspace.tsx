import { Outlet, useLocation, useParams } from "react-router-dom";

import styles from "../app.module.css";
import { SidebarPanel, useAppShell, useShellStatus } from "../app-shell-context";
import { DigitizationSidebarPanel } from "../components/digitization/digitization-sidebar-panel";
import { WizardStepper } from "../components/digitization/wizard-stepper";
import { SectionPanel } from "../components/section-panel";
import {
  describeJobStatus,
  describeSteps,
  isRunning,
  type StepId,
} from "../controllers/digitization-job-controller";
import { useDigitizationJob } from "../hooks/use-digitization-job";
import { DigitizationJobProvider } from "../components/digitization/job-context";

/**
 * Shell for the digitization wizard: loads the job named in the URL and renders
 * the current step inside a progress bar.
 *
 * The job is fetched here rather than in each step, and handed down through
 * context, so the six steps stay presentational and a refresh on any of them
 * rehydrates identically.
 */
export function DigitizationWorkspace() {
  const { jobId } = useParams<{ jobId: string }>();
  const { collapsed } = useAppShell();
  const location = useLocation();

  const controller = useDigitizationJob(jobId);
  const { job } = controller;

  const currentStep = (location.pathname.split("/").pop() ?? "crop") as StepId;
  const steps = describeSteps(job, currentStep);

  useShellStatus(describeJobStatus(job), isRunning(job) || controller.isLoading);

  return (
    <DigitizationJobProvider value={controller}>
      <SidebarPanel>
        <DigitizationSidebarPanel collapsed={collapsed} job={job} />
      </SidebarPanel>

      <main className={styles.mainBody}>
        <SectionPanel>
          <WizardStepper steps={steps} />
        </SectionPanel>

        {controller.error ? (
          <SectionPanel title="Job unavailable">
            <p className={styles.errorText}>{controller.error}</p>
          </SectionPanel>
        ) : (
          <Outlet />
        )}
      </main>
    </DigitizationJobProvider>
  );
}
