import { Link } from "react-router-dom";

import type { StepDescriptor } from "../../controllers/digitization-job-controller";
import styles from "./wizard-stepper.module.css";

/**
 * Progress bar for the digitization wizard.
 *
 * Completed and available steps are links, so a reviewer can go back and adjust
 * a calibration without restarting. Steps the job has not reached render as
 * inert text rather than links that would bounce off the route guard — showing
 * someone where they are in a workflow is more useful than letting them click
 * and get redirected.
 */

type Props = {
  steps: StepDescriptor[];
};

const STATUS_CLASS = {
  done: styles.done,
  current: styles.current,
  available: styles.available,
  locked: styles.locked,
} as const;

export function WizardStepper({ steps }: Props) {
  return (
    <ol className={styles.stepper}>
      {steps.map((step, index) => {
        const className = `${styles.step} ${STATUS_CLASS[step.status]}`;
        const marker = step.status === "done" ? "✓" : String(index + 1);

        return (
          <li key={step.id} className={className}>
            {step.status === "locked" || step.status === "current" ? (
              <span className={styles.stepBody} aria-current={step.status === "current"}>
                <span className={styles.marker}>{marker}</span>
                <span className={styles.label}>{step.label}</span>
              </span>
            ) : (
              <Link to={step.path} className={styles.stepBody}>
                <span className={styles.marker}>{marker}</span>
                <span className={styles.label}>{step.label}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
