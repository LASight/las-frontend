import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import styles from "../app.module.css";
import { SidebarPanel, useAppShell, useShellStatus } from "../app-shell-context";
import { AnalysisSidebarPanel } from "../components/analysis/analysis-sidebar-panel";
import { AssistantDrawer } from "../components/assistant-drawer";
import { FileValidationModal } from "../components/FileValidationModal";
import { EmptyPlot } from "../components/empty-plot";
import { PortfolioOverview } from "../components/overview/portfolio-overview";
import { SectionPanel } from "../components/section-panel";
import { useAnalysis } from "../hooks/use-analysis";
import { useChat } from "../hooks/use-chat";
import { useReportExport } from "../hooks/use-report-export";

export function PortfolioWorkspace() {
  const { collapsed } = useAppShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoMode, setDemoMode] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const analysis = useAnalysis({ scope: "portfolio" });
  const reportExport = useReportExport({
    scope: "portfolio",
    getPayload: () => analysis.payload,
    onStatus: analysis.setStatus,
  });
  const chat = useChat({
    getAnalysisId: () => analysis.payload?.analysis_id || null,
    isAiEnabled: () => analysis.aiEnabled,
    onStatus: analysis.setStatus,
  });

  useShellStatus(analysis.status, analysis.isBusy);

  useEffect(() => {
    if (analysis.payload?.analysis_id) chat.resetForAnalysis();
  }, [analysis.payload?.analysis_id]);

  const adoptedId = searchParams.get("analysis");
  useEffect(() => {
    if (!adoptedId) return;
    void analysis.adoptAnalysis(adoptedId);
    setSearchParams({}, { replace: true });
  }, [adoptedId]);

  async function runDemoMode() {
    setDemoMode(true);
    analysis.setStatus("Launching portfolio demo...");
    await analysis.runSampleAnalysis();
  }

  const payload = analysis.payload;

  return (
    <>
      <SidebarPanel>
        <AnalysisSidebarPanel
          scope="portfolio"
          collapsed={collapsed}
          isBusy={analysis.isBusy}
          aiEnabled={analysis.aiEnabled}
          demoMode={demoMode}
          hasPayload={!!payload}
          exportingPdf={reportExport.exportingPdf}
          onFileChange={analysis.setFileList}
          onAnalyzeSample={() => void analysis.runSampleAnalysis()}
          onAnalyzeUploads={() => void analysis.runUploadAnalysis()}
          onRunDemo={() => void runDemoMode()}
          onExportCsv={reportExport.exportCsv}
          onExportPdf={() => void reportExport.exportPdf()}
          onAiEnabledChange={analysis.setAiEnabled}
          onDemoModeChange={setDemoMode}
        />
      </SidebarPanel>

      {analysis.fileValidation.state === "confirming" &&
        analysis.fileValidation.validationPayload && (
          <FileValidationModal
            reports={analysis.fileValidation.validationPayload.files}
            onConfirm={(decisions) => void analysis.proceedWithAnalysis(decisions)}
            onCancel={() => {
              analysis.fileValidation.cancel();
              analysis.setStatus("Cancelled.");
            }}
          />
        )}

      <main className={`${styles.mainBody} ${demoMode ? styles.demoMode : ""}`}>
        {payload ? (
          <PortfolioOverview
            payload={payload}
            aiMeta={analysis.aiMeta}
            aiLoading={analysis.aiLoading}
            aiText={analysis.aiText}
          />
        ) : (
          <SectionPanel title="Portfolio Analytics">
            <EmptyPlot message="No multi-well portfolio loaded." />
          </SectionPanel>
        )}
      </main>

      <AssistantDrawer
        scope="portfolio"
        open={assistantOpen}
        onToggle={() => setAssistantOpen((previous) => !previous)}
        analysisId={payload?.analysis_id || null}
        aiEnabled={analysis.aiEnabled}
        aiMeta={analysis.aiMeta}
        aiInterpretation={analysis.aiText || payload?.ai_interpretation || "No AI interpretation."}
        aiLoading={analysis.aiLoading}
        messages={chat.messages}
        isPending={chat.isPending}
        onSendText={chat.sendMessageWithText}
        onClear={chat.clear}
        onWidthChange={(value) => {
          document.documentElement.style.setProperty("--assistant-width", `${value}px`);
        }}
      />
    </>
  );
}
