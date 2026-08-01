import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * How a workspace talks to the application chrome.
 *
 * The shell owns the sidebar and the status line; the active workspace owns
 * what goes in them. Rather than lifting every workspace's actions into the
 * shell as props — the thing that had already grown `Sidebar` to seventeen
 * props — the shell exposes a DOM slot and workspaces portal into it.
 *
 * A portal rather than a `sidebarContent` state value because the sidebar must
 * not remount when the route changes: remounting replays its width transition
 * and drops the collapsed state. The slot element is stable for the lifetime of
 * the shell, so switching workspaces swaps only the panel inside it.
 */

type AppShellValue = {
  /** Stable DOM node inside the sidebar that workspaces portal their panel into. */
  sidebarSlot: HTMLElement | null;
  /** Whether the sidebar is collapsed — panels need it to hide their labels. */
  collapsed: boolean;
  /** Set the status line at the foot of the sidebar. */
  setStatus: (status: string) => void;
  /** Drive the busy indicator shown when the sidebar is collapsed. */
  setBusy: (busy: boolean) => void;
};

const AppShellContext = createContext<AppShellValue | null>(null);

export function AppShellProvider({
  value,
  children,
}: {
  value: AppShellValue;
  children: ReactNode;
}) {
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

/**
 * Access the shell from inside a workspace.
 *
 * Throws outside a provider rather than returning a null-object default: a
 * workspace that silently renders no sidebar controls is a bug that is very
 * easy to miss and very confusing to diagnose.
 */
export function useAppShell(): AppShellValue {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error("useAppShell must be called inside <AppShellProvider>");
  }
  return value;
}

/**
 * Render this workspace's controls into the sidebar.
 *
 * Renders nothing until the slot exists, which is only true on the shell's very
 * first paint.
 */
export function SidebarPanel({ children }: { children: ReactNode }) {
  const { sidebarSlot } = useAppShell();
  return sidebarSlot ? createPortal(children, sidebarSlot) : null;
}

/**
 * Publish a workspace's status line to the shell.
 *
 * A hook rather than a direct `setStatus` call so the write always happens in
 * an effect. `status` is a string, so the dependency compares by value and this
 * cannot loop.
 */
export function useShellStatus(status: string, busy = false): void {
  const { setStatus, setBusy } = useAppShell();

  useEffect(() => {
    setStatus(status);
  }, [status, setStatus]);

  useEffect(() => {
    setBusy(busy);
  }, [busy, setBusy]);
}
