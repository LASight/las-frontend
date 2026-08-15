import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import styles from "../app.module.css";
import { SidebarPanel, useAppShell, useShellStatus } from "../app-shell-context";
import { AnalysisRunSelector } from "../components/analysis/analysis-run-selector";
import { AnalysisSidebarPanel } from "../components/analysis/analysis-sidebar-panel";
import { AssistantDrawer } from "../components/assistant-drawer";
import { FileValidationModal } from "../components/FileValidationModal";
import { OverviewTab } from "../components/overview/overview-tab";
import { SectionPanel } from "../components/section-panel";
import { SequenceTab } from "../components/sequence/sequence-tab";
import { TabBar } from "../components/tab-bar";
import { useAnalysis } from "../hooks/use-analysis";
import { useChat } from "../hooks/use-chat";
import { useReportExport } from "../hooks/use-report-export";
import { useSequenceAi } from "../hooks/use-sequence-ai";
import { useSequenceReview } from "../hooks/use-sequence-review";
import type { HistoryItem } from "../models/auth-models";
import { historyGateway } from "../services/history-service";

function recentAnalysisLabel(item: HistoryItem): string {
  const date = new Date(item.created_at);
  const dateLabel = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return dateLabel ? `${item.label} · ${dateLabel}` : item.label;
}

/**
 * The LASight workspace: QC, petrophysics, ML and AI over digital LAS files.
 *
 * Behaviour is unchanged from the old `App.tsx`. Three things moved:
 * the sidebar controls now portal in through {@link SidebarPanel}, the
 * Overview/Sequence tabs are routes rather than `useState`, and a digitization
 * job can hand its exported LAS straight here via `?analysis=<id>`.
 */
export function AnalysisWorkspace() {
  const { collapsed } = useAppShell();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [demoMode, setDemoMode] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const queryClient = useQueryClient();

  const analysis = useAnalysis({
    scope: "single",
    onNewAnalysis: () => {
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
  const recentAnalyses = useQuery({
    queryKey: ["history", "las", "single"],
    queryFn: async () => {
      const page = await historyGateway.list({ kind: "las", limit: 100, offset: 0 });
      return page.items
        .filter((item) => item.file_count === 1 && item.state !== "failed")
        .map((item) => ({ value: item.item_id, label: recentAnalysisLabel(item) }));
    },
  });
  const sequence = useSequenceReview(analysis.payload);
  const sequenceAi = useSequenceAi();
  const reportExport = useReportExport({
    scope: "single",
    getPayload: () => analysis.payload,
    onStatus: analysis.setStatus,
  });

  const chat = useChat({
    getAnalysisId: () => analysis.payload?.analysis_id || null,
    isAiEnabled: () => analysis.aiEnabled,
    onStatus: (message) => analysis.setStatus(message),
  });

  const activeTab = location.pathname.endsWith("/sequence") ? "sequence" : "overview";

  useShellStatus(analysis.status, analysis.isBusy);

  useEffect(() => {
    if (!analysis.payload?.analysis_id) return;
    chat.resetForAnalysis();
    sequence.resetForAnalysis();
    sequenceAi.resetForAnalysis();
    navigate("/analysis", { replace: true });
  }, [analysis.payload?.analysis_id]);

  // Handoff from the digitization workspace: `?analysis=<id>` means the backend
  // already ran the analysis on a freshly exported LAS, so adopt it rather than
  // making the user re-upload the file they just produced. The parameter is
  // cleared once consumed so a refresh does not re-adopt a stale id.
  const adoptedId = searchParams.get("analysis");
  useEffect(() => {
    if (!adoptedId) return;
    void analysis.adoptAnalysis(adoptedId);
    setSearchParams({}, { replace: true });
  }, [adoptedId]);

  async function runDemoMode() {
    setDemoMode(true);
    analysis.setStatus("Launching demo mode workflow...");
    await analysis.runSampleAnalysis();
    analysis.setStatus(
      "Demo mode ready. Use Export PDF/CSV for committee/company showcase."
    );
  }

  const payload = analysis.payload;

  return (
    <>
      <SidebarPanel>
        <AnalysisSidebarPanel
          scope="single"
          collapsed={collapsed}
          isBusy={analysis.isBusy}
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
        <AnalysisRunSelector
          currentAnalysisId={payload?.analysis_id ?? ""}
          currentWellName={payload?.wells?.[0]?.well_name}
          currentFileName={payload?.wells?.[0]?.file_name}
          options={recentAnalyses.data ?? []}
          loading={recentAnalyses.isPending}
          onSelect={(analysisId) => {
            if (analysisId && analysisId !== payload?.analysis_id) {
              void analysis.adoptAnalysis(analysisId);
            }
          }}
        />

        <SectionPanel>
          <TabBar />
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
        scope="single"
        open={assistantOpen}
        onToggle={() => setAssistantOpen((previous) => !previous)}
        analysisId={analysis.payload?.analysis_id || null}
        aiEnabled={analysis.aiEnabled}
        aiMeta={analysis.aiMeta}
        aiInterpretation={
          analysis.aiText || analysis.payload?.ai_interpretation || "No AI interpretation."
        }
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
    </>
  );
}
