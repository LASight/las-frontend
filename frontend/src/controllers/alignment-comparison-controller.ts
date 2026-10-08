import type { SavedGridAlignment } from "../models/digitization-models";
import { projectAlignedPoint } from "./grid-alignment-controller";
import type { Size, ViewTransform } from "../components/digitization/cropper/viewport-transform";

/** Match depth center and apparent track width, not distorted source pixels.
 * A uniform source camera cannot also undo shear or local vertical stretching. */
export function comparisonSourceView(alignment: SavedGridAlignment, view: ViewTransform, size: Size): ViewTransform {
  const row = Math.max(0, Math.min(alignment.height, (size.height / 2 - view.ty) / view.scale));
  const col = Math.max(0, Math.min(alignment.width, (size.width / 2 - view.tx) / view.scale));
  const point = projectAlignedPoint(alignment, col, row)!;
  const left = projectAlignedPoint(alignment, 0, row)!, right = projectAlignedPoint(alignment, alignment.width, row)!;
  const scale = view.scale * alignment.width / Math.max(1, Math.hypot(right.x-left.x, right.y-left.y));
  return { scale, tx: size.width / 2 - point.x * scale, ty: size.height / 2 - point.y * scale };
}
