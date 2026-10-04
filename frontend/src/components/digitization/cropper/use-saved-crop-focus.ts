import { useEffect, useRef } from "react";
import type { FocusRegion, Size } from "./viewport-transform";

/** Run after usePanZoom's initialization effect. A server snapshot may be a
 * new object on every poll: coordinate signature, not object identity, gates
 * autofocus. Draft changes and user panning/zooming are deliberately absent. */
export function useSavedCropFocus({ enabled, jobId, savedCrop, viewport, focus }: {
  enabled: boolean; jobId: string; savedCrop: FocusRegion | null; viewport: Size;
  focus: (region: FocusRegion) => void;
}) {
  const focused = useRef<string | null>(null);
  const signature = savedCrop ? JSON.stringify([jobId, savedCrop.x_left, savedCrop.x_right, savedCrop.y_top, savedCrop.y_bottom]) : null;
  useEffect(() => {
    if (!enabled || !signature) { focused.current = null; return; }
    // A width-only/zero-height intermediate measurement is not ready yet.
    if (viewport.width <= 0 || viewport.height <= 0 || focused.current === signature) return;
    focused.current = signature;
    focus(savedCrop!);
  }, [enabled, signature, viewport.width, viewport.height, focus, savedCrop]);
}
