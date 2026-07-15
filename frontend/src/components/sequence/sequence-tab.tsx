import type { useSequenceAi } from "../../hooks/use-sequence-ai";
import type { useSequenceReview } from "../../hooks/use-sequence-review";
import type { SequenceBoundaryRow } from "../../models/analyze-models";
import layout from "../layout.module.css";
import { MarkdownView } from "../markdown-view";
import { SectionPanel } from "../section-panel";
import { SkeletonText } from "../skeleton-text";
import { BoundaryReview } from "./boundary-review";
import { SequenceControls } from "./sequence-controls";
import { SequenceCorrelationChart } from "./sequence-correlation-chart";
import { SequenceLogChart } from "./sequence-log-chart";

type Props = {
  sequence: ReturnType<typeof useSequenceReview>;
  sequenceAi: ReturnType<typeof useSequenceAi>;
  analysisId: string | null;
  aiEnabled: boolean;
  onAnalysisStatus: (message: string) => void;
};

export function SequenceTab({ sequence, sequenceAi, analysisId, aiEnabled, onAnalysisStatus }: Props) {
  const boundaries = sequence.boundaries as SequenceBoundaryRow[];

  function handleSuggest() {
    void sequenceAi.suggest({
      analysisId,
      aiEnabled,
      selectedWell: sequence.selectedWell,
      selectedReport: sequence.selectedReport,
      threshold: sequence.threshold,
      onStatus: sequence.setStatus,
      onAnalysisStatus,
    });
  }

  return (
    <>
      <SequenceControls
        readyWells={sequence.readyWells}
        selectedWell={sequence.selectedWell}
        onSelectWell={sequence.setSelectedWell}
        threshold={sequence.threshold}
        onThresholdChange={sequence.setThreshold}
        onSuggest={handleSuggest}
        suggestDisabled={!analysisId || !sequence.selectedWell}
        onResetEdits={sequence.resetSelectedWellEdits}
        status={sequence.status}
      />

      <SectionPanel title="Sequence Log + Human Review">
        <SequenceLogChart report={sequence.selectedReport} boundaries={boundaries} />
      </SectionPanel>

      <BoundaryReview
        boundaries={boundaries}
        onSetStatus={sequence.setBoundaryStatus}
        manualDepth={sequence.manualDepth}
        onManualDepthChange={sequence.setManualDepth}
        onAddManual={sequence.addManualBoundary}
      />

      <SectionPanel title="Cross-Well Sequence Correlation">
        <SequenceCorrelationChart correlation={sequence.correlation} />
      </SectionPanel>

      <SectionPanel title="AI Sequence Interpretation">
        <p className={layout.meta}>{sequenceAi.meta}</p>
        {sequenceAi.loading ? <SkeletonText /> : <MarkdownView text={sequenceAi.text} />}
      </SectionPanel>
    </>
  );
}
