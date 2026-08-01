import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppShell } from "./app-shell";
import { RequireJobPhase } from "./components/digitization/require-job-phase";
import { CalibrationStep } from "./components/digitization/steps/calibration-step";
import { CropStep } from "./components/digitization/steps/crop-step";
import { ExportStep } from "./components/digitization/steps/export-step";
import { IntakeStep } from "./components/digitization/steps/intake-step";
import { ReviewStep } from "./components/digitization/steps/review-step";
import { SegmentationStep } from "./components/digitization/steps/segmentation-step";
import { AnalysisWorkspace } from "./workspaces/analysis-workspace";
import { DigitizationWorkspace } from "./workspaces/digitization-workspace";

/**
 * Route table.
 *
 * The digitization wizard's steps are real URLs, not wizard state, which buys
 * three things worth the dependency: a refresh mid-workflow returns to the same
 * step instead of the beginning, browser back/forward walks the wizard, and a
 * job is linkable — useful when a segmentation run takes minutes and the
 * reviewer wants to come back to it.
 *
 * That only works because the job itself lives on the server: the route carries
 * a `jobId`, and {@link DigitizationWorkspace} rehydrates everything else from
 * `GET /jobs/{id}`.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/analysis" replace /> },

      { path: "analysis", element: <AnalysisWorkspace /> },
      { path: "analysis/sequence", element: <AnalysisWorkspace /> },

      { path: "digitize", element: <Navigate to="/digitize/new" replace /> },
      { path: "digitize/new", element: <IntakeStep /> },
      {
        path: "digitize/:jobId",
        element: <DigitizationWorkspace />,
        children: [
          { index: true, element: <Navigate to="crop" replace /> },
          { path: "crop", element: <CropStep /> },
          { path: "calibrate", element: <CalibrationStep /> },
          {
            path: "segment",
            element: (
              // Guards, not hidden buttons: a deep link to a step the job has
              // not reached should land on the step it actually is on, rather
              // than render a page with nothing behind it.
              <RequireJobPhase reached="calibrating">
                <SegmentationStep />
              </RequireJobPhase>
            ),
          },
          {
            path: "review",
            element: (
              <RequireJobPhase reached="reviewing">
                <ReviewStep />
              </RequireJobPhase>
            ),
          },
          {
            path: "export",
            element: (
              <RequireJobPhase reached="reviewing">
                <ExportStep />
              </RequireJobPhase>
            ),
          },
        ],
      },

      { path: "*", element: <Navigate to="/analysis" replace /> },
    ],
  },
]);
