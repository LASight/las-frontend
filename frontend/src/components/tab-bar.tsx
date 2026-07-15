import styles from "./tab-bar.module.css";

export type TabId = "overview" | "sequence";

type Props = {
  active: TabId;
  onChange: (tab: TabId) => void;
};

export function TabBar({ active, onChange }: Props) {
  return (
    <div className={styles.tabs}>
      <button
        type="button"
        className={`${styles.tab} ${active === "overview" ? styles.active : ""}`}
        onClick={() => onChange("overview")}
      >
        Overview
      </button>
      <button
        type="button"
        className={`${styles.tab} ${active === "sequence" ? styles.active : ""}`}
        onClick={() => onChange("sequence")}
      >
        Sequence Stratigraphy
      </button>
    </div>
  );
}
