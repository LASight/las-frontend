import { NavLink } from "react-router-dom";

import styles from "./tab-bar.module.css";

export type TabId = "overview" | "sequence";

type Tab = {
  to: string;
  label: string;
  /** `end` so /analysis does not stay highlighted while /analysis/sequence is open. */
  end?: boolean;
};

const TABS: Tab[] = [
  { to: "/analysis", label: "Overview", end: true },
  { to: "/analysis/sequence", label: "Sequence Stratigraphy" },
];

/**
 * Tabs within the analysis workspace.
 *
 * Routes rather than local state, so a tab is linkable and survives a refresh —
 * the same reason the digitization wizard's steps are routes.
 */
export function TabBar() {
  return (
    <div className={styles.tabs}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `${styles.tab} ${isActive ? styles.active : ""}`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
