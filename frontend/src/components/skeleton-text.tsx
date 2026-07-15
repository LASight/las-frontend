import styles from "./skeleton-text.module.css";

export function SkeletonText() {
  return (
    <div className={styles.skeletonBox}>
      <div className={styles.line} />
      <div className={`${styles.line} ${styles.lineShort}`} />
      <div className={styles.line} />
    </div>
  );
}
