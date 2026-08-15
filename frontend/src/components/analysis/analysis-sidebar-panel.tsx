import {
  Bot,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileUp,
  FlaskConical,
  Gauge,
  Play,
  Settings,
  Upload,
} from "lucide-react";

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
 * Shared control surface for the single-well and portfolio workspaces. The
 * scope changes file cardinality, labels and sample/demo actions while keeping
 * export and AI controls consistent.
 */

type Props = {
  scope: "single" | "portfolio";
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
  scope,
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
  const isPortfolio = scope === "portfolio";

  return (
    <>
      <SbSection
        icon={isPortfolio ? <Gauge size={16} /> : <FileUp size={16} />}
        label={isPortfolio ? "PORTFOLIO INPUT" : "WELL INPUT"}
        collapsed={collapsed}
      >
        <SbFilePicker
          icon={<FileUp size={16} />}
          label={isPortfolio ? "Select LAS files…" : "Select LAS file…"}
          collapsed={collapsed}
          accept=".las,.LAS"
          multiple={isPortfolio}
          onChange={onFileChange}
        />
        {isPortfolio && (
          <SbButton
            icon={<FlaskConical size={16} />}
            label="Analyze Sample Portfolio"
            collapsed={collapsed}
            disabled={isBusy}
            onClick={onAnalyzeSample}
          />
        )}
        <SbButton
          icon={<Upload size={16} />}
          label={isPortfolio ? "Analyze Portfolio" : "Analyze Well"}
          collapsed={collapsed}
          disabled={isBusy}
          onClick={onAnalyzeUploads}
          variant="primary"
        />
        {isPortfolio && (
          <SbButton
            icon={<Play size={16} />}
            label="Run Portfolio Demo"
            collapsed={collapsed}
            disabled={isBusy}
            onClick={onRunDemo}
          />
        )}
      </SbSection>

      <SbDivider />

      <SbSection icon={<Download size={16} />} label="EXPORT" collapsed={collapsed}>
        <SbButton
          icon={<FileSpreadsheet size={16} />}
          label="Export CSV"
          collapsed={collapsed}
          disabled={!hasPayload}
          onClick={onExportCsv}
        />
        <SbButton
          icon={<FileDown size={16} />}
          label="Export PDF"
          collapsed={collapsed}
          disabled={!hasPayload || exportingPdf}
          onClick={onExportPdf}
        />
      </SbSection>

      <SbDivider />

      <SbSection icon={<Settings size={16} />} label="SETTINGS" collapsed={collapsed}>
        <SbToggle
          icon={<Bot size={16} />}
          label="Enable AI"
          collapsed={collapsed}
          checked={aiEnabled}
          onChange={onAiEnabledChange}
        />
        {isPortfolio && (
          <SbToggle
            icon={<Eye size={16} />}
            label="Demo visuals"
            collapsed={collapsed}
            checked={demoMode}
            onChange={onDemoModeChange}
          />
        )}
      </SbSection>
    </>
  );
}
