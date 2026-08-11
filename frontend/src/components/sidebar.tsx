import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../auth-context";
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
 *
 * "My Files" is the proof of that: it is one entry in {@link WORKSPACES} and a
 * route, and nothing else in this file changed for it. The account block at the
 * foot is not a workspace — it is chrome, present on every page, which is why
 * it sits beside the status line rather than in the switcher.
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
  { to: "/history", icon: "🗂", label: "My Files" },
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await logout();
    // An explicit navigation rather than relying on the guard: the guard would
    // send them to /login with a `from` pointing at wherever they signed out,
    // and signing back in would silently reopen it.
    navigate("/login", { replace: true });
  }

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

      {user && (
        <div className={styles.account}>
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `${styles.accountLink} ${isActive ? styles.accountLinkActive : ""}`
            }
            title={collapsed ? user.email : "Account settings"}
          >
            {/* The initial is the only thing that still reads when the sidebar
                is 52px wide, which is why it is not just an icon. */}
            <span className={styles.avatar} aria-hidden="true">
              {(user.full_name || user.email).charAt(0).toUpperCase()}
            </span>
            <span className={styles.accountText}>
              <span className={styles.accountName}>
                {user.full_name || user.email}
              </span>
              <span className={styles.accountEmail}>{user.email}</span>
            </span>
          </NavLink>

          <button
            type="button"
            className={styles.signOutBtn}
            onClick={handleSignOut}
            title="Sign out"
          >
            <span className={styles.sbBtnIcon}>⏻</span>
            <span className={styles.sbBtnLabel}>Sign out</span>
          </button>
        </div>
      )}

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
