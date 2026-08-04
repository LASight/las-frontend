import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { AppShellProvider } from "./app-shell-context";
import styles from "./app.module.css";
import { Sidebar } from "./components/sidebar";

/**
 * Application frame: sidebar, workspace switcher, and the routed workspace.
 *
 * This is what `App.tsx` used to be, minus everything specific to LAS analysis.
 * That all moved to `workspaces/analysis-workspace.tsx`, which is why a second
 * workflow could be added without this file growing: the shell now knows about
 * chrome and routing, and nothing about either workflow.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const [sidebarSlot, setSidebarSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!document?.documentElement) return;
    if (!document.documentElement.style.getPropertyValue("--assistant-width")) {
      document.documentElement.style.setProperty("--assistant-width", "420px");
    }
  }, []);

  // Stable identities: these land in context, and a new function every render
  // would re-fire every workspace's status effect on every parent render.
  const stableSetStatus = useCallback((next: string) => setStatus(next), []);
  const stableSetBusy = useCallback((next: boolean) => setBusy(next), []);

  return (
    <AppShellProvider
      value={{
        sidebarSlot,
        collapsed,
        setStatus: stableSetStatus,
        setBusy: stableSetBusy,
      }}
    >
      <div className={styles.appLayout}>
        <Sidebar
          collapsed={collapsed}
          onCollapseToggle={() => setCollapsed((previous) => !previous)}
          status={status}
          isBusy={busy}
        >
          {/* Callback ref, not useRef: attaching has to trigger a render so the
              portal in SidebarPanel can find the node on the next pass. */}
          <div ref={setSidebarSlot} />
        </Sidebar>

        <Outlet />
      </div>
    </AppShellProvider>
  );
}
