import type { DetectedTrack } from "../../../models/digitization-models";
import { colorForTrack } from "../cropper/detected-tracks";
import styles from "./track-picker.module.css";

/**
 * The sidebar-adjacent list of detected tracks — the keyboard-accessible
 * counterpart to clicking a box on the canvas.
 *
 * `DetectedTrackLayer`'s outlines are `pointer-events: none` (the stage owns
 * every canvas interaction, per `track-cropper.tsx`'s own convention), which
 * makes them mouse-only by construction. Real `<button>`s here are what keeps
 * track selection reachable without a pointer, matching the precedent
 * `CropHandleButton` already set for the crop handles themselves.
 */
type Props = {
  tracks: DetectedTrack[];
  selectedIndex: number | null;
  onSelect: (track: DetectedTrack) => void;
};

export function TrackPicker({ tracks, selectedIndex, onSelect }: Props) {
  if (tracks.length === 0) return null;

  return (
    <div className={styles.row} role="group" aria-label="Detected tracks">
      {tracks.map((track) => (
        <button
          key={track.index}
          type="button"
          className={styles.chip}
          aria-pressed={track.index === selectedIndex}
          onClick={() => onSelect(track)}
        >
          <span
            className={styles.swatch}
            style={{ background: colorForTrack(track.index) }}
            aria-hidden="true"
          />
          Track {track.index + 1} of {tracks.length} · {Math.round(track.confidence * 100)}%
        </button>
      ))}
    </div>
  );
}
