import type { WellReport } from "../../models/analyze-models";
import { Button } from "../button";
import layout from "../layout.module.css";
import { SectionPanel } from "../section-panel";

type Props = {
  readyWells: WellReport[];
  selectedWell: string;
  onSelectWell: (well: string) => void;
  threshold: number;
  onThresholdChange: (value: number) => void;
  onSuggest: () => void;
  suggestDisabled: boolean;
  onResetEdits: () => void;
  status: string;
};

export function SequenceControls({
  readyWells,
  selectedWell,
  onSelectWell,
  threshold,
  onThresholdChange,
  onSuggest,
  suggestDisabled,
  onResetEdits,
  status,
}: Props) {
  return (
    <SectionPanel title="Sequence Stratigraphy Studio">
      <div className={`${layout.row} ${layout.wrap}`}>
        <label className={layout.field}>
          <span>Well</span>
          <select
            value={selectedWell}
            onChange={(event) => onSelectWell(event.target.value)}
            disabled={!readyWells.length}
          >
            {readyWells.map((well) => (
              <option key={well.well_name} value={well.well_name}>
                {well.well_name}
              </option>
            ))}
          </select>
        </label>

        <label className={layout.field}>
          <span>Confidence threshold ({threshold.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(threshold * 100)}
            onChange={(event) => onThresholdChange(Number(event.target.value) / 100)}
          />
        </label>

        <Button variant="primary" onClick={onSuggest} disabled={suggestDisabled}>
          AI Autocomplete Suggestions
        </Button>

        <Button variant="secondary" onClick={onResetEdits} disabled={!selectedWell}>
          Reset Human Edits
        </Button>
      </div>
      <p className={layout.status}>{status}</p>
    </SectionPanel>
  );
}
