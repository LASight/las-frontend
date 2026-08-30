/**
 * Detected tracks: colour, hit-testing, and which one a fresh page should
 * preselect. Pure functions, like `crop-rect.ts` and `viewport-transform.ts`
 * beside it — this is arithmetic and a couple of comparisons, and arithmetic
 * that lives inside a pointer handler or a `useEffect` cannot be tested.
 */

import type {
  DetectedTrack,
  TrackCrop,
} from "../../../models/digitization-models";
import { normalizeCrop } from "./crop-rect";
import type { Point, Size, ViewTransform } from "./viewport-transform";
import { imageToScreen } from "./viewport-transform";

/**
 * Six accent colours pulled from `tokens.css`, enough for the corpus maximum
 * of five tracks on one page with a spare. `--danger` is deliberately absent
 * — it stays reserved for actual errors, not for "track 4."
 */
export const TRACK_COLORS: readonly string[] = [
  "var(--accent-teal)",
  "var(--accent-orange)",
  "var(--accent-green)",
  "var(--accent-teal-2)",
  "var(--accent-orange-2)",
  "var(--accent-green-2)",
];

export function colorForTrack(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

/**
 * A detected track's crop, ready for `POST /crop`.
 *
 * Uses `seed_bounds`, not `bounds` — `bounds` is the honest wobble-inclusive
 * union extent (what gets drawn), and on a narrow track can include a slice of
 * the neighbouring track at the wobble extremes. `seed_bounds` is the robust
 * interior box the backend already computed for exactly this purpose.
 *
 * Goes through `normalizeCrop` rather than being used as-is: it is the same
 * clamp the numeric crop inputs use, and it is what keeps a degenerate
 * detection (a sliver a few pixels wide) from producing a crop the API then
 * rejects with a 422 for falling under `MIN_CROP_WIDTH_PX`/`MIN_CROP_HEIGHT_PX`.
 */
export function trackToCrop(track: DetectedTrack, image: Size): TrackCrop {
  return normalizeCrop(track.seed_bounds, image);
}

/** A detected track's union box, in screen coordinates. */
export interface DetectedTrackScreenBox {
  index: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function tracksToScreen(
  tracks: readonly DetectedTrack[],
  view: ViewTransform
): DetectedTrackScreenBox[] {
  return tracks.map((track) => {
    const topLeft = imageToScreen(
      { x: track.bounds.x_left, y: track.bounds.y_top },
      view
    );
    const bottomRight = imageToScreen(
      { x: track.bounds.x_right, y: track.bounds.y_bottom },
      view
    );
    return {
      index: track.index,
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
  });
}

/**
 * Which detected track, if any, contains an image-space point.
 *
 * The **narrowest** containing box wins when more than one does, not the
 * first in the list: a page with several vertically-stacked runs of the same
 * column can produce boxes that nest, and the narrowest is the one a click in
 * the middle of the pile almost always means.
 */
export function trackAtPoint(
  tracks: readonly DetectedTrack[],
  imagePoint: Point
): DetectedTrack | null {
  let best: DetectedTrack | null = null;
  for (const track of tracks) {
    const { x_left, x_right, y_top, y_bottom } = track.bounds;
    if (imagePoint.x < x_left || imagePoint.x > x_right) continue;
    if (imagePoint.y < y_top || imagePoint.y > y_bottom) continue;
    if (!best || x_right - x_left < best.bounds.x_right - best.bounds.x_left) {
      best = track;
    }
  }
  return best;
}

function trackCenterX(track: DetectedTrack): number {
  return (track.bounds.x_left + track.bounds.x_right) / 2;
}

/**
 * The track a fresh page should preselect: the one immediately **left of the
 * depth column**. On this corpus that is Track 1, the GR/SP track -
 * `[margin][Track 1: GR/SP][DEPTHS][Track 2+3: resistivity]` - and the MVP
 * digitizes GR, so this is the track the user almost always wants.
 *
 * **Not the widest track.** The widest is usually resistivity, to the right of
 * the depth column - falling back to "widest" would preselect the wrong one on
 * most real pages.
 *
 * Compares track **centres**, not edges, against the depth column's centre:
 * wobble can make a track's union box genuinely overlap the depth column near
 * the page edges (measured on a real detection run), so an edge-adjacency
 * test would sometimes exclude the very track this function exists to find.
 *
 * Falls back to the leftmost track when there is no depth column, or nothing
 * sits left of it, so a page still gets a sensible default.
 */
export function preferredTrack(
  tracks: readonly DetectedTrack[],
  depthColumn: TrackCrop | null
): DetectedTrack | null {
  if (tracks.length === 0) return null;
  const sorted = [...tracks].sort((a, b) => trackCenterX(a) - trackCenterX(b));

  if (depthColumn) {
    const depthCenter = (depthColumn.x_left + depthColumn.x_right) / 2;
    const leftOfDepth = sorted.filter((track) => trackCenterX(track) < depthCenter);
    if (leftOfDepth.length > 0) {
      return leftOfDepth[leftOfDepth.length - 1]; // closest to the depth column
    }
  }
  return sorted[0];
}
