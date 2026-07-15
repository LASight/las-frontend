import { useEffect, useState } from "react";

import styles from "./app.module.css";
import { AssistantDrawer } from "./components/assistant-drawer";
import { FileValidationModal } from "./components/FileValidationModal";
import { OverviewTab } from "./components/overview/overview-tab";
import { SectionPanel } from "./components/section-panel";
import { SequenceTab } from "./components/sequence/sequence-tab";
import { Sidebar } from "./components/sidebar";
import { TabBar, type TabId } from "./components/tab-bar";
import { useAnalysis } from "./hooks/use-analysis";
import { useChat } from "./hooks/use-chat";
import { useReportExport } from "./hooks/use-report-export";
import { useSequenceAi } from "./hooks/use-sequence-ai";
import { useSequenceReview } from "./hooks/use-sequence-review";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [demoMode, setDemoMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const analysis = useAnalysis();
  const sequence = useSequenceReview(analysis.payload);
  const sequenceAi = useSequenceAi();
  const reportExport = useReportExport({
    getPayload: () => analysis.payload,
    onStatus: analysis.setStatus,
  });

  const chat = useChat({
    getAnalysisId: () => analysis.payload?.analysis_id || null,
    isAiEnabled: () => analysis.aiEnabled,
    onStatus: (message) => analysis.setStatus(message),
  });

  useEffect(() => {
    if (!analysis.payload?.analysis_id) return;
    chat.resetForAnalysis();
    sequence.resetForAnalysis();
    sequenceAi.resetForAnalysis();
    setActiveTab("overview");
  }, [analysis.payload?.analysis_id]);

  useEffect(() => {
    if (!document?.documentElement) return;
    if (!document.documentElement.style.getPropertyValue("--assistant-width")) {
      document.documentElement.style.setProperty("--assistant-width", "420px");
    }
  }, []);

  async function runDemoMode() {
    setDemoMode(true);
    analysis.setStatus("Launching demo mode workflow...");
    await analysis.runSampleAnalysis();
    analysis.setStatus("Demo mode ready. Use Export PDF/CSV for committee/company showcase.");
  }

  const payload = analysis.payload;

  return (
    <>
      {analysis.fileValidation.state === "confirming" && analysis.fileValidation.validationPayload && (
        <FileValidationModal
          reports={analysis.fileValidation.validationPayload.files}
          onConfirm={(decisions) => void analysis.proceedWithAnalysis(decisions)}
          onCancel={() => {
            analysis.fileValidation.cancel();
            analysis.setStatus("Cancelled.");
          }}
        />
      )}
      <div className={styles.appLayout}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapseToggle={() => setSidebarCollapsed((prev) => !prev)}
          isBusy={analysis.isBusy}
          status={analysis.status}
          aiEnabled={analysis.aiEnabled}
          demoMode={demoMode}
          hasPayload={!!payload}
          exportingPdf={reportExport.exportingPdf}
          onFileChange={(files) => analysis.setFileList(files)}
          onAnalyzeSample={() => void analysis.runSampleAnalysis()}
          onAnalyzeUploads={() => void analysis.runUploadAnalysis()}
          onRunDemo={() => void runDemoMode()}
          onExportCsv={reportExport.exportCsv}
          onExportPdf={() => void reportExport.exportPdf()}
          onAiEnabledChange={analysis.setAiEnabled}
          onDemoModeChange={setDemoMode}
        />
        <main className={`${styles.mainBody} ${demoMode ? styles.demoMode : ""}`}>
          <SectionPanel>
            <TabBar active={activeTab} onChange={setActiveTab} />
          </SectionPanel>

          {activeTab === "overview" && payload ? (
            <OverviewTab
              payload={payload}
              aiMeta={analysis.aiMeta}
              aiLoading={analysis.aiLoading}
              aiText={analysis.aiText}
            />
          ) : null}

          {activeTab === "sequence" ? (
            <SequenceTab
              sequence={sequence}
              sequenceAi={sequenceAi}
              analysisId={analysis.payload?.analysis_id || null}
              aiEnabled={analysis.aiEnabled}
              onAnalysisStatus={analysis.setStatus}
            />
          ) : null}
        </main>
        <AssistantDrawer
          open={assistantOpen}
          onToggle={() => setAssistantOpen((prev) => !prev)}
          analysisId={analysis.payload?.analysis_id || null}
          aiEnabled={analysis.aiEnabled}
          aiMeta={analysis.aiMeta}
          aiInterpretation={analysis.aiText || analysis.payload?.ai_interpretation || "No AI interpretation."}
          aiLoading={analysis.aiLoading}
          messages={chat.messages}
          isPending={chat.isPending}
          onSendText={async (text) => {
            await chat.sendMessageWithText(text);
          }}
          onClear={chat.clear}
          onWidthChange={(value) => {
            document.documentElement.style.setProperty("--assistant-width", `${value}px`);
          }}
        />
      </div>
    </>
  );
}
