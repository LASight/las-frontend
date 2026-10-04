import styles from "./brand-mark.module.css";

/**
 * The Argentinosaurus silhouette, masked from one shared SVG so its color
 * always comes from CSS (`background` / `--brand-mark-fill`) rather than a
 * baked-in fill. That is what lets the same asset sit on the dark sidebar,
 * the dark hero, and the light form panel without three colored copies.
 */

type Props = {
  className?: string;
};

export function BrandMark({ className = "" }: Props) {
  return (
    <span
      role="img"
      aria-label="WellSight"
      className={`${styles.mark} ${className}`.trim()}
    />
  );
}
