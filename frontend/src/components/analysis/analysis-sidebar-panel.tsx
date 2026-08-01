import {
  SbButton,
  SbDivider,
  SbFilePicker,
  SbSection,
  SbToggle,
} from "../sidebar-controls";

/**
 * The LAS analysis workspace's sidebar controls.
 *
 * Lifted verbatim out of `Sidebar` when the digitization workspace arrived —
 * same sections, same order, same behaviour. What changed is ownership: these
 * controls belong to the analysis workflow, so they live with it and travel
 * with it, instead of being hard-coded into shared chrome.
 */

type Props = {
  collapsed: boolean;
  isBusy: boolean;
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
  onAiEnabledChange: (value: boolean) => void;
  onDemoModeChange: (value: boolean) => void;
};

export function AnalysisSidebarPanel({
  collapsed,
  isBusy,
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
}: Props) {
  return (
    <>
      <SbSection icon="▤" label="FILE & ANALYSIS" collapsed={collapsed}>
        <SbFilePicker
          icon="📂"
          label="Select LAS files…"
          collapsed={collapsed}
          accept=".las,.LAS"
          multiple
          onChange={onFileChange}
        />
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

      <SbDivider />

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

      <SbDivider />

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
    </>
  );
}
