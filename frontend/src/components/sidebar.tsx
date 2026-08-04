import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import styles from "./sidebar.module.css";

/**
 * Application chrome: brand, workspace switcher, the active workspace's own
 * controls, and the status line.
 *
 * It used to take seventeen props, every one of them an analysis action
 * (`onAnalyzeSample`, `onExportPdf`, ...). Adding a second workflow that way
 * would have pushed it past thirty and made `Sidebar` a place every feature has
 * to edit. Now it owns layout and navigation only, and each workspace passes
 * its controls as `children` — so a third workspace adds a panel and a route
 * and changes nothing here.
 */

/** One entry in the workspace switcher. */
type Workspace = {
  to: string;
  icon: string;
  label: string;
};

const WORKSPACES: Workspace[] = [
  { to: "/analysis", icon: "📊", label: "LAS Analysis" },
  { to: "/digitize", icon: "🖼", label: "Digitize Raster" },
];

type SidebarProps = {
  collapsed: boolean;
  onCollapseToggle: () => void;
  /** Short status line shown at the bottom; the busy spinner replaces it when collapsed. */
  status: string;
  isBusy: boolean;
  /** The active workspace's control panel. */
  children?: ReactNode;
};

export function Sidebar({
  collapsed,
  onCollapseToggle,
  status,
  isBusy,
  children,
}: SidebarProps) {
  return (
    <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.sbTop}>
        <div className={styles.logoArea}>
          <div className={styles.logoMark}>W</div>
          <span className={styles.appName}>WellSight</span>
        </div>
        <button
          className={styles.collapseBtn}
          onClick={onCollapseToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <div className={styles.workspaceNav}>
        {WORKSPACES.map((workspace) => (
          <NavLink
            key={workspace.to}
            to={workspace.to}
            className={({ isActive }) =>
              `${styles.workspaceLink} ${isActive ? styles.workspaceLinkActive : ""}`
            }
            title={collapsed ? workspace.label : undefined}
          >
            <span className={styles.sbBtnIcon}>{workspace.icon}</span>
            <span className={styles.sbBtnLabel}>{workspace.label}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.sbBody}>{children}</div>

      <div className={styles.sbStatus}>
        {!collapsed && status && <p className={styles.statusText}>{status}</p>}
        {collapsed && (
          <span className={styles.sbBtnIcon} title={status || "Ready"}>
            {isBusy ? "⟳" : "●"}
          </span>
        )}
      </div>
    </nav>
  );
}
