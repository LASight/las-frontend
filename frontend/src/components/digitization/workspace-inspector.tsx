import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "../../workspaces/curve-workspace.module.css";

export function WorkspaceInspector({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className={`${styles.inspector} ${collapsed ? styles.inspectorCollapsed : ""}`} aria-label="Segment inspector">
    <div className={styles.inspectorTop}>{!collapsed && <span>Inspector</span>}
      <button type="button" className={styles.secondary} aria-label={collapsed ? "Expand inspector" : "Collapse inspector"} title={collapsed ? "Expand inspector" : "Collapse inspector"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}</button>
    </div>
    <div className={styles.inspectorBody} hidden={collapsed}>{children}</div>
  </aside>;
}
