import type { DetectedTrack } from "../../../models/digitization-models";
import styles from "./detected-track-layer.module.css";
import { colorForTrack, tracksToScreen } from "./detected-tracks";
import type { ViewTransform } from "./viewport-transform";

/**
 * Coloured outlines for the tracks the layout model found, drawn over the
 * canvas exactly the way `track-cropper.tsx`'s own shade/selection/guide
 * layer already does — absolutely-positioned `<div>`s, `pointer-events: none`
 * throughout.
 *
 * That last part is not a detail: the stage owns every pointer interaction
 * (`TrackCropper.handlePointerDown`), so this component is purely visual and
 * has no click handler of its own. Giving each box its own listener would
 * mean routing a click through as many separate capture targets as there are
 * tracks, duplicating the reasoning `CropHandleButton` already spells out for
 * why the eight drag handles do not do that either.
 *
 * A separate component, not inlined into `track-cropper.tsx`: that file is
 * already substantial, and this piece has a single, self-contained job.
 */

type Props = {
  tracks: DetectedTrack[];
  /** The track currently selected as the crop, if any — its outline is
   * suppressed here, since the `.selection` rectangle already marks it and
   * drawing both would stack two outlines on the same pixels. */
  selectedIndex: number | null;
  view: ViewTransform;
};

export function DetectedTrackLayer({ tracks, selectedIndex, view }: Props) {
  const boxes = tracksToScreen(tracks, view);

  return (
    <>
      {boxes
        .filter((box) => box.index !== selectedIndex)
        .map((box) => (
          <div
            key={box.index}
            className={styles.outline}
            style={{
              left: box.left,
              top: Math.max(box.top, 0),
              width: Math.max(0, box.right - box.left),
              height: Math.max(0, box.bottom - box.top),
              borderColor: colorForTrack(box.index),
            }}
          >
            <span
              className={styles.badge}
              style={{ background: colorForTrack(box.index) }}
            >
              {box.index + 1}
            </span>
          </div>
        ))}
    </>
  );
}
