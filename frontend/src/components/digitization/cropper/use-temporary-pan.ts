import { useEffect, useRef, useState, type RefObject } from "react";

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [role="slider"], [contenteditable]:not([contenteditable="false"])');
}

/** Space temporarily pans only this canvas, never a text/number/range input.
 * Hover may arm the shortcut, but only canvas focus suppresses page scrolling. */
export function useTemporaryPan(target: RefObject<HTMLElement | null>) {
  const pressed = useRef(false);
  const hovered = useRef(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const clear = () => { pressed.current = false; setActive(false); };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
      const focused = !!target.current?.contains(document.activeElement);
      if (!focused && !hovered.current) return;
      pressed.current = true; setActive(true);
      if (focused) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space" || event.key === " ") clear(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); pressed.current = false; };
  }, [target]);
  return { active, pressed, onPointerEnter: () => { hovered.current = true; }, onPointerLeave: () => { hovered.current = false; } };
}
