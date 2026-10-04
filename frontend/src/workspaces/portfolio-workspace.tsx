import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartNoAxesCombined, Columns3, FolderOpen, Play, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import styles from "../app.module.css";
import { SidebarPanel, useAppShell, useShellStatus } from "../app-shell-context";
import { AnalysisSidebarPanel } from "../components/analysis/analysis-sidebar-panel";
import { AssistantDrawer } from "../components/assistant-drawer";
import { FileValidationModal } from "../components/FileValidationModal";
import { WellLogComparison } from "../components/comparison/well-log-comparison";
import { PortfolioOverview } from "../components/overview/portfolio-overview";
import { useAnalysis } from "../hooks/use-analysis";
import { useChat } from "../hooks/use-chat";
import { useReportExport } from "../hooks/use-report-export";
import { historyGateway } from "../services/history-service";
import comparisonStyles from "./portfolio-workspace.module.css";

export function PortfolioWorkspace() {
  const { collapsed } = useAppShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoMode, setDemoMode] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const queryClient = useQueryClient();
  const adoptingId = useRef<string | null>(null);
  const activeTab = searchParams.get("view") === "analytics" ? "analytics" : "logs";
  const analysis = useAnalysis({
    scope: "portfolio",
    onNewAnalysis: (nextPayload) => {
      adoptingId.current = nextPayload.analysis_id;
      void queryClient.invalidateQueries({ queryKey: ["history"] });
      if (nextPayload.analysis_id && searchParams.get("analysis") !== nextPayload.analysis_id) {
        setSearchParams(previous => {
          const next = new URLSearchParams(previous);
          next.set("analysis", nextPayload.analysis_id);
          return next;
        }, { replace: true });
      }
    },
  });
  const recentPortfolios = useQuery({
    queryKey: ["history", "las", "portfolio"],
    queryFn: async () => {
      const page = await historyGateway.list({ kind: "las", limit: 100, offset: 0 });
      return page.items.filter(item => item.file_count >= 2 && item.state !== "failed");
    },
  });
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

  const visibleStatus = analysis.fileValidation.error ? `Error: ${analysis.fileValidation.error}` : analysis.status;
  useShellStatus(visibleStatus, analysis.isBusy);

  useEffect(() => {
    if (analysis.payload?.analysis_id) chat.resetForAnalysis();
  }, [analysis.payload?.analysis_id]);

  const adoptedId = searchParams.get("analysis");
  useEffect(() => {
    if (!adoptedId || adoptingId.current === adoptedId) return;
    adoptingId.current = adoptedId;
    void analysis.adoptAnalysis(adoptedId);
  }, [adoptedId]);

  async function runSafely(action: () => Promise<void>) {
    try { await action(); }
    catch (error) { analysis.setStatus(`Error: ${error instanceof Error ? error.message : "Could not prepare comparison."}`); }
  }

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
           onAnalyzeSample={() => void runSafely(analysis.runSampleAnalysis)}
           onAnalyzeUploads={() => void runSafely(analysis.runUploadAnalysis)}
           onRunDemo={() => void runSafely(runDemoMode)}
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
            onConfirm={(decisions) => void runSafely(() => analysis.proceedWithAnalysis(decisions))}
            onCancel={() => {
              analysis.fileValidation.cancel();
              analysis.setStatus("Cancelled.");
            }}
          />
        )}

      <main className={`${styles.mainBody} ${demoMode ? styles.demoMode : ""}`}>
        <header className={comparisonStyles.header}>
          <div><p className={comparisonStyles.eyebrow}>MULTI-WELL WORKSPACE</p><h1>Compare wells</h1>
            <p>Inspect reported-depth logs side by side, or review portfolio analytics.</p></div>
          <label className={comparisonStyles.saved}><FolderOpen size={16} /> Saved portfolio
            <select aria-label="Saved portfolio" value={adoptedId || payload?.analysis_id || ""} disabled={recentPortfolios.isPending || analysis.isBusy}
              onChange={event => {
                const id = event.target.value;
                if (!id || id === adoptedId) return;
                setSearchParams(previous => { const next = new URLSearchParams(previous); next.set("analysis", id); return next; });
              }}>
              <option value="">{recentPortfolios.isPending ? "Loading saved portfolios…" : "Choose a saved portfolio"}</option>
              {(adoptedId || payload?.analysis_id) && !recentPortfolios.data?.some(item => item.item_id === (adoptedId || payload?.analysis_id)) &&
                <option value={adoptedId || payload?.analysis_id}>{payload ? `Current analysis · ${payload.wells.length} files` : `Selected analysis · ${adoptedId}`}</option>}
              {recentPortfolios.data?.map(item => <option key={item.item_id} value={item.item_id}>{item.label} · {item.file_count} files</option>)}
            </select>
          </label>
        </header>
        {recentPortfolios.isError && <p className={comparisonStyles.status}>Saved portfolios could not be loaded. You can still choose LAS files below or open My Files.</p>}
        <div className={comparisonStyles.tabs} role="tablist" aria-label="Comparison views">
          <button type="button" role="tab" aria-selected={activeTab === "logs"} aria-controls="portfolio-view" onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set("view", "logs"); return next; })}><Columns3 size={17} /> Well logs</button>
          <button type="button" role="tab" aria-selected={activeTab === "analytics"} aria-controls="portfolio-view" onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set("view", "analytics"); return next; })}><ChartNoAxesCombined size={17} /> Analytics</button>
        </div>
        <details className={comparisonStyles.upload} open={!payload}>
          <summary>{payload ? "Prepare another comparison" : "Load logs for comparison"}</summary>
          <p>Choose at least two LAS files. Each source file remains a separate column; choose up to four columns after validation.</p>
          <div className={comparisonStyles.actions}>
            <label className={comparisonStyles.filePicker}><Upload size={16} /> Choose LAS files
              <input aria-label="Choose LAS files" type="file" accept=".las" multiple disabled={analysis.isBusy} onChange={event => analysis.setFileList(event.target.files)} />
            </label>
            <button type="button" className={comparisonStyles.primary} disabled={analysis.isBusy || !analysis.fileList || analysis.fileList.length < 2} onClick={() => void runSafely(analysis.runUploadAnalysis)}><Play size={16} /> Prepare comparison</button>
            <Link to="/history"><FolderOpen size={16} /> My Files</Link>
          </div>
          {analysis.fileList?.length ? <ul className={comparisonStyles.files} aria-label="Chosen LAS files">{Array.from(analysis.fileList).map((file, index) => <li key={`${index}:${file.name}`}>{file.name}</li>)}</ul> : <p className={comparisonStyles.hint}>No LAS files chosen yet.</p>}
          {analysis.fileList?.length === 1 && <p className={comparisonStyles.hint}>Choose at least two LAS files to prepare a comparison.</p>}
        </details>
        <p className={comparisonStyles.status} role={analysis.fileValidation.error ? "alert" : "status"}>{visibleStatus}</p>
        <div id="portfolio-view" role="tabpanel" aria-label={activeTab === "logs" ? "Well logs" : "Analytics"}>
        {payload && activeTab === "logs" ? <WellLogComparison key={payload.analysis_id} analysisId={payload.analysis_id} wells={payload.wells} /> : payload ? (
          <PortfolioOverview
            payload={payload}
            aiMeta={analysis.aiMeta}
            aiLoading={analysis.aiLoading}
            aiText={analysis.aiText}
          />
        ) : (
          <p className={comparisonStyles.empty}>No portfolio loaded. Choose LAS files and prepare a comparison above, or select a saved portfolio.</p>
        )}
        </div>
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
