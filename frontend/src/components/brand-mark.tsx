import styles from "./brand-mark.module.css";

/** Shared Argentinosaurus vector from joa/ui-throwaway; color comes from CSS. */
type Props = {
  className?: string;
  /** Hide duplicate imagery when the visible WellSight wordmark names the brand. */
  decorative?: boolean;
};

export function BrandMark({ className = "", decorative = false }: Props) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "WellSight"}
      aria-hidden={decorative ? true : undefined}
      className={`${styles.mark} ${className}`.trim()}
    />
  );
}
