import { createContext, useContext, type ReactNode } from "react";

import type { useDigitizationJob } from "../../hooks/use-digitization-job";

/**
 * The active digitization job, shared with the wizard's steps.
 *
 * The workspace loads the job once and the steps consume it. Without this every
 * step would call `useDigitizationJob` itself, which means each one owning its
 * own polling and its own idea of what phase the job is in — five sources of
 * truth for something the server already decides.
 */

type JobController = ReturnType<typeof useDigitizationJob>;

const JobContext = createContext<JobController | null>(null);

export function DigitizationJobProvider({
  value,
  children,
}: {
  value: JobController;
  children: ReactNode;
}) {
  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

/**
 * Access the active job from a wizard step.
 *
 * Throws outside the workspace rather than returning null: a step rendered
 * without a job is a routing mistake, and failing loudly beats rendering an
 * empty page that looks like a data problem.
 */
export function useJobController(): JobController {
  const value = useContext(JobContext);
  if (!value) {
    throw new Error(
      "useJobController must be called inside <DigitizationWorkspace>"
    );
  }
  return value;
}
