import styles from "./sidebar.module.css";

type SidebarProps = {
  collapsed: boolean;
  onCollapseToggle: () => void;
  isBusy: boolean;
  status: string;
  aiEnabled: boolean;
  demoMode: boolean;
  hasPayload: boolean;
  exportingPdf: boolean;
  onFileChange: (files: FileList | null) => void;
  onAnalyzeSample: () => void;
  onAnalyzeUploads: () => void;
  onRunDemo: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
  onAiEnabledChange: (v: boolean) => void;
  onDemoModeChange: (v: boolean) => void;
};

type SbSectionProps = {
  icon: string;
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
};

function SbSection({ icon, label, collapsed, children }: SbSectionProps) {
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
  icon: string;
  label: string;
  collapsed: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: "primary" | "strong" | "default";
};

function SbButton({ icon, label, collapsed, disabled, onClick, variant = "default" }: SbButtonProps) {
  const variantClass =
    variant === "primary" ? styles.sbBtnPrimary :
    variant === "strong" ? styles.sbBtnStrong : "";
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
  icon: string;
  label: string;
  collapsed: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
};

function SbToggle({ icon, label, collapsed, checked, onChange }: SbToggleProps) {
  return (
    <label className={styles.sbToggle} title={collapsed ? label : undefined}>
      <span className={styles.sbBtnIcon}>{icon}</span>
      <span className={styles.sbBtnLabel}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.toggleInput}
      />
      <span className={`${styles.toggleTrack} ${checked ? styles.toggleOn : ""}`} />
    </label>
  );
}

export function Sidebar({
  collapsed,
  onCollapseToggle,
  isBusy,
  status,
  aiEnabled,
  demoMode,
  hasPayload,
  exportingPdf,
  onFileChange,
  onAnalyzeSample,
  onAnalyzeUploads,
  onRunDemo,
  onExportCsv,
  onExportPdf,
  onAiEnabledChange,
  onDemoModeChange,
}: SidebarProps) {
  return (
    <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      {/* Top bar */}
      <div className={styles.sbTop}>
        <div className={styles.logoArea}>
          <div className={styles.logoMark}>L</div>
          <span className={styles.appName}>LASight</span>
        </div>
        <button
          className={styles.collapseBtn}
          onClick={onCollapseToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Scrollable body */}
      <div className={styles.sbBody}>
        <SbSection icon="▤" label="FILE & ANALYSIS" collapsed={collapsed}>
          <label className={styles.fileRow} title={collapsed ? "Select LAS files" : undefined}>
            <span className={styles.sbBtnIcon}>📂</span>
            <span className={styles.sbBtnLabel}>Select LAS files…</span>
            <input
              type="file"
              accept=".las,.LAS"
              multiple
              className={styles.fileInput}
              onChange={(e) => onFileChange(e.target.files)}
            />
          </label>
          <SbButton
            icon="⚙"
            label="Analyze Sample Folder"
            collapsed={collapsed}
            disabled={isBusy}
            onClick={onAnalyzeSample}
          />
          <SbButton
            icon="↑"
            label="Analyze Uploaded Files"
            collapsed={collapsed}
            disabled={isBusy}
            onClick={onAnalyzeUploads}
            variant="primary"
          />
          <SbButton
            icon="▶"
            label="Run Demo Mode"
            collapsed={collapsed}
            disabled={isBusy}
            onClick={onRunDemo}
          />
        </SbSection>

        <div className={styles.divider} />

        <SbSection icon="⬇" label="EXPORT" collapsed={collapsed}>
          <SbButton
            icon="📋"
            label="Export CSV"
            collapsed={collapsed}
            disabled={!hasPayload}
            onClick={onExportCsv}
          />
          <SbButton
            icon="📄"
            label="Export PDF"
            collapsed={collapsed}
            disabled={!hasPayload || exportingPdf}
            onClick={onExportPdf}
          />
        </SbSection>

        <div className={styles.divider} />

        <SbSection icon="⚙" label="SETTINGS" collapsed={collapsed}>
          <SbToggle
            icon="✦"
            label="Enable AI"
            collapsed={collapsed}
            checked={aiEnabled}
            onChange={onAiEnabledChange}
          />
          <SbToggle
            icon="◎"
            label="Demo visuals"
            collapsed={collapsed}
            checked={demoMode}
            onChange={onDemoModeChange}
          />
        </SbSection>
      </div>

      {/* Status area */}
      <div className={styles.sbStatus}>
        {!collapsed && status && (
          <p className={styles.statusText}>{status}</p>
        )}
        {collapsed && (
          <span className={styles.sbBtnIcon} title={status || "Ready"}>
            {isBusy ? "⟳" : "●"}
          </span>
        )}
      </div>
    </nav>
  );
}
