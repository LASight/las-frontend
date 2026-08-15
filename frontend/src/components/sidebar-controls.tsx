import type { ReactNode } from "react";

import styles from "./sidebar.module.css";

/**
 * The sidebar's building blocks, extracted from `sidebar.tsx` so each workspace
 * can assemble its own panel of controls.
 *
 * They were always well-factored; they were just private, which forced every
 * new action to be threaded through `Sidebar` as another prop. `Sidebar` had
 * reached seventeen, all of them specific to the LAS analysis workflow, and
 * adding the digitization workflow would have pushed it past thirty. Exporting
 * these instead means a new workspace contributes a panel and never touches
 * `Sidebar` at all.
 *
 * They share `sidebar.module.css` deliberately: these are sidebar chrome, not
 * general-purpose controls, and splitting the stylesheet would only make the
 * collapsed-state rules harder to keep consistent.
 */

type SbSectionProps = {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  children: ReactNode;
};

export function SbSection({ icon, label, collapsed, children }: SbSectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>{icon}</span>
        {!collapsed && <span>{label}</span>}
      </div>
      {children}
    </div>
  );
}

type SbButtonProps = {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: "primary" | "strong" | "default";
};

export function SbButton({
  icon,
  label,
  collapsed,
  disabled,
  onClick,
  variant = "default",
}: SbButtonProps) {
  const variantClass =
    variant === "primary" ? styles.sbBtnPrimary : variant === "strong" ? styles.sbBtnStrong : "";
  return (
    <button
      className={`${styles.sbBtn} ${variantClass}`}
      disabled={disabled}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className={styles.sbBtnIcon}>{icon}</span>
      <span className={styles.sbBtnLabel}>{label}</span>
    </button>
  );
}

type SbToggleProps = {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  checked: boolean;
  onChange: (value: boolean) => void;
};

export function SbToggle({ icon, label, collapsed, checked, onChange }: SbToggleProps) {
  return (
    <label className={styles.sbToggle} title={collapsed ? label : undefined}>
      <span className={styles.sbBtnIcon}>{icon}</span>
      <span className={styles.sbBtnLabel}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={styles.toggleInput}
      />
      <span className={`${styles.toggleTrack} ${checked ? styles.toggleOn : ""}`} />
    </label>
  );
}

type SbFilePickerProps = {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  /** `accept` attribute — `.las` for analysis, image types for digitization. */
  accept: string;
  multiple?: boolean;
  onChange: (files: FileList | null) => void;
};

export function SbFilePicker({
  icon,
  label,
  collapsed,
  accept,
  multiple = false,
  onChange,
}: SbFilePickerProps) {
  return (
    <label className={styles.fileRow} title={collapsed ? label : undefined}>
      <span className={styles.sbBtnIcon}>{icon}</span>
      <span className={styles.sbBtnLabel}>{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className={styles.fileInput}
        onChange={(event) => onChange(event.target.files)}
      />
    </label>
  );
}

export function SbDivider() {
  return <div className={styles.divider} />;
}
