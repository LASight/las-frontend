import { useCallback, useEffect, useRef, useState } from "react";

import type { Point, Size, ViewTransform } from "./viewport-transform";
import {
  centerOnRow as centerViewOnRow,
  clampView,
  fitHeightScale,
  fitWidthScale,
  initialView,
  panBy,
  zoomAt,
  zoomToAt,
} from "./viewport-transform";

/**
 * Pointer, wheel and gesture handling for the crop editor's viewport.
 *
 * All the arithmetic lives in `viewport-transform`; this only decides *when* to
 * apply it. That split is what makes the precision claims testable.
 *
 * **Why the transform is React state and not a ref.** A ref plus a manual
 * `requestAnimationFrame` draw loop would avoid re-rendering during a drag, but
 * the tile fetcher and the coordinate readout both need the current view, so
 * they would need their own synchronisation and could drift out of step with
 * what is on screen. Instead every update is coalesced into a single frame
 * (`schedule` below), so a pointermove burst produces at most one state change
 * per frame and everything downstream sees one consistent view. The raster is
 * never re-fetched or re-decoded while dragging — only re-composited from
 * already-decoded tiles, which is what the frame budget actually cares about.
 */

/** Wheel notches are coarse; this is the multiplier per notch. */
const WHEEL_ZOOM_RATE = 0.0015;

/** Trackpad pinch arrives as ctrl+wheel with much finer deltas. */
const PINCH_ZOOM_RATE = 0.01;

/** Button and double-click zoom step. */
export const ZOOM_STEP = 1.6;

interface Options {
  image: Size;
  viewport: Size;
  /** The element that receives wheel and gesture events. */
  targetRef: React.RefObject<HTMLElement | null>;
  /**
   * What a plain, unmodified wheel does.
   *
   * `"zoom"` for the crop editor, where dragging already pans and the wheel has
   * nothing else to do. `"pan"` for the review canvas, where dragging is the
   * *edit* gesture — redrawing a stretch of curve — so the wheel is the only
   * way to travel and taking it for zoom would strand the reviewer.
   *
   * Ctrl/Cmd + wheel zooms at the cursor under either mode, matching how every
   * document viewer behaves, and a trackpad pinch arrives as exactly that.
   */
  wheel?: "zoom" | "pan";
}

export function usePanZoom({
  image,
  viewport,
  targetRef,
  wheel = "zoom",
}: Options) {
  const [view, setViewState] = useState<ViewTransform>(() =>
    initialView(image, viewport)
  );
  const [isPanning, setIsPanning] = useState(false);

  const viewRef = useRef(view);
  const frameRef = useRef<number | null>(null);
  const panOriginRef = useRef<Point | null>(null);
  const initializedRef = useRef(false);

  /**
   * Commit a new view: clamp it, record it synchronously, publish it next frame.
   *
   * The ref is written immediately so several pointermove events inside one
   * frame compose against each other instead of all reading the same stale
   * value — dropping that is how a fast drag ends up moving less than the
   * pointer did.
   */
  const apply = useCallback(
    (next: ViewTransform) => {
      viewRef.current = clampView(next, image, viewport);
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setViewState(viewRef.current);
      });
    },
    [image, viewport]
  );

  const set = useCallback((next: ViewTransform) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // The container is measured after the first paint, so the very first view is
  // computed against a zero-sized viewport and has to be redone once the real
  // size arrives. After that, a resize only re-clamps — recomputing the fit
  // would throw away the user's zoom every time the window changed.
  useEffect(() => {
    if (image.width <= 0 || viewport.width <= 0) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      set(initialView(image, viewport));
      return;
    }
    set(clampView(viewRef.current, image, viewport));
  }, [image, viewport, set]);

  const reset = useCallback(() => {
    set(initialView(image, viewport));
  }, [set, image, viewport]);

  const center = useCallback(
    (): Point => ({ x: viewport.width / 2, y: viewport.height / 2 }),
    [viewport]
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: Point) =>
      apply(zoomAt(viewRef.current, anchor ?? center(), factor)),
    [apply, center]
  );

  const zoomTo = useCallback(
    (scale: number, anchor?: Point) =>
      apply(zoomToAt(viewRef.current, anchor ?? center(), scale)),
    [apply, center]
  );

  const fitWidth = useCallback(
    () => zoomTo(fitWidthScale(image, viewport)),
    [zoomTo, image, viewport]
  );

  const fitHeight = useCallback(
    () => zoomTo(fitHeightScale(image, viewport)),
    [zoomTo, image, viewport]
  );

  /** Bring an image row to the vertical centre, keeping the current zoom. */
  const centerOnRow = useCallback(
    (row: number) => apply(centerViewOnRow(viewRef.current, row, image, viewport)),
    [apply, image, viewport]
  );

  // ---- Panning ----------------------------------------------------------
  const beginPan = useCallback((point: Point) => {
    panOriginRef.current = point;
    setIsPanning(true);
  }, []);

  const panTo = useCallback(
    (point: Point) => {
      const origin = panOriginRef.current;
      if (!origin) return;
      panOriginRef.current = point;
      apply(
        panBy(
          viewRef.current,
          { x: point.x - origin.x, y: point.y - origin.y },
          image,
          viewport
        )
      );
    },
    [apply, image, viewport]
  );

  const endPan = useCallback(() => {
    panOriginRef.current = null;
    setIsPanning(false);
  }, []);

  // ---- Wheel ------------------------------------------------------------
  // A native non-passive listener, not React's `onWheel`: React attaches wheel
  // handlers passively at the root, so `preventDefault` there is ignored and the
  // page scrolls behind the cropper while the user is zooming.
  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      // Browsers report a trackpad pinch as a wheel event with ctrlKey set —
      // there is no separate pinch event on desktop — so a deliberate ctrl+wheel
      // and a pinch are indistinguishable here, and both should zoom.
      const zooming = wheel === "zoom" || event.ctrlKey || event.metaKey;
      if (zooming) {
        const rate = event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
        apply(zoomAt(viewRef.current, anchor, Math.exp(-event.deltaY * rate)));
        return;
      }

      // Scroll in *screen* pixels, so a notch travels the same visible distance
      // at every zoom level. Shift swaps the axis, the usual convention.
      const delta = event.shiftKey
        ? { x: -event.deltaY - event.deltaX, y: 0 }
        : { x: -event.deltaX, y: -event.deltaY };
      apply(panBy(viewRef.current, delta, image, viewport));
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [targetRef, apply, wheel, image, viewport]);

  return {
    view,
    isPanning,
    beginPan,
    panTo,
    endPan,
    zoomBy,
    zoomTo,
    fitWidth,
    fitHeight,
    centerOnRow,
    reset,
  };
}
