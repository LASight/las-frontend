import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { searchMetadata, type MetadataChoice } from "../../controllers/curve-metadata-controller";
import styles from "./metadata-combobox.module.css";

/** Search suggestions or type an exact source code. Blur/close never commits a
 * suggestion, and a unit recommendation never changes scale or depth. */
export function MetadataCombobox({ id, label, value, onChange, choices, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  choices: MetadataChoice[]; disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const matches = searchMetadata(choices, showAll ? "" : value);
  const custom = !matches.some((choice) => choice.value === value) && !!value.trim();
  const count = matches.length + Number(custom);
  const index = Math.min(active, Math.max(0, count - 1));
  const choose = (next: string) => { onChange(next); setOpen(false); input.current?.focus(); };
  return <div ref={root} className={styles.wrapper} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget)) setOpen(false); }}>
    <div className={styles.inputRow}>
      <input ref={input} id={id} role="combobox" aria-label={label} autoComplete="off" disabled={disabled} value={value}
        aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={`${id}-options`}
        aria-activedescendant={open && count ? `${id}-option-${index}` : undefined}
        onFocus={() => { setShowAll(true); setOpen(true); setActive(0); }}
        onChange={(event) => { onChange(event.target.value); setShowAll(false); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive((previous) => !open ? 0 : Math.max(0, Math.min(count - 1, previous + (event.key === "ArrowDown" ? 1 : -1))));
          }
          if (event.key === "Enter" && open && count) { event.preventDefault(); choose(matches[index]?.value ?? value); }
        }} />
      <button type="button" className={styles.toggle} tabIndex={-1} disabled={disabled} aria-label={`Show ${label.toLowerCase()} options`} title={`Search ${label.toLowerCase()} or enter a custom value`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setShowAll(true); setActive(0); setOpen(!open); input.current?.focus(); }}><ChevronDown size={13} /></button>
    </div>
    {open && !disabled && <div id={`${id}-options`} role="listbox" aria-label={`${label} options`} className={styles.popup}>
      {matches.map((choice, optionIndex) => <button type="button" tabIndex={-1} id={`${id}-option-${optionIndex}`} key={`metadata:${choice.value}`} role="option" aria-selected={optionIndex === index} className={styles.option}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice.value)}><span>{choice.label}</span><code>{choice.value}</code></button>)}
      {custom && <button type="button" tabIndex={-1} id={`${id}-option-${matches.length}`} role="option" aria-selected={index === matches.length} className={`${styles.option} ${styles.custom}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(value)}>Use “{value}” · Other / custom</button>}
      <div className={styles.hint}>Other / custom: type the exact source value. Suggestions are not identification or unit conversion.</div>
    </div>}
  </div>;
}
