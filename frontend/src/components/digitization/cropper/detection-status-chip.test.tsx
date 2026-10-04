import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { segmentJob } from "../../../test-fixtures/collection-fixtures";
import { DetectionStatusChip } from "./detection-status-chip";

it("offers explicit detection for a continuation with no proposals, without claiming continuity", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host); const retry = vi.fn();
  try {
    await act(async () => root.render(<DetectionStatusChip job={{ ...segmentJob("second"), detection: null }} onRetry={retry} />));
    expect(host.textContent).toContain("Regions do not identify curve continuations");
    expect(host.querySelector("button")?.textContent).toBe("Detect track regions");
    await act(async () => host.querySelector("button")?.click());
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<DetectionStatusChip job={{ ...segmentJob("legacy"), collection_id: null, detection: null }} onRetry={retry} />));
    expect(host.querySelector("button")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
