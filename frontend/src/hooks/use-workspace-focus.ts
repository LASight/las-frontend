import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "../components/digitization/cropper/use-temporary-pan";

/** Local CSS focus view, not browser Fullscreen API or a second editor tree. */
export function useWorkspaceFocus() {
  const [focused, setFocused] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focused) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    toggleRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && !isTypingTarget(event.target)) {
        event.preventDefault(); setFocused(false); return;
      }
      if (event.key !== "Tab") return;
      const root = workspaceRef.current;
      if (!root) return;
      const elements = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter((element) => {
        for (let parent: HTMLElement | null = element; parent && parent !== root; parent = parent.parentElement) {
          if (parent.hidden || getComputedStyle(parent).display === "none" || getComputedStyle(parent).visibility === "hidden") return false;
          if (parent.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open && !parent.querySelector("summary")?.contains(element)) return false;
        }
        return true;
      });
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); toggleRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !workspaceRef.current?.contains(event.target)) toggleRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown); document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", focusin);
      if (document.body.style.overflow === "hidden") document.body.style.overflow = previousOverflow;
      toggleRef.current?.focus({ preventScroll: true });
    };
  }, [focused]);
  return { focused, setFocused, workspaceRef, toggleRef };
}
