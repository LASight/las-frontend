import type { AnalyzePayload } from "../../models/analyze-models";
import layout from "../layout.module.css";
import { MarkdownView } from "../markdown-view";
import { SectionPanel } from "../section-panel";
import { SkeletonText } from "../skeleton-text";
import { WellCard } from "../well/well-card";
import { CrossWellAnalytics } from "./cross-well-analytics";
import { PortfolioSummary } from "./portfolio-summary";

type Props = {
  payload: AnalyzePayload;
  aiMeta: string;
  aiLoading: boolean;
  aiText: string;
};

export function OverviewTab({ payload, aiMeta, aiLoading, aiText }: Props) {
  return (
    <>
      <PortfolioSummary payload={payload} />

      <CrossWellAnalytics analytics={payload.portfolio_analytics} />

      <SectionPanel title="AI Technical Interpretation">
        <p className={layout.meta}>{aiMeta}</p>
        {aiLoading ? (
          <SkeletonText />
        ) : (
          <MarkdownView text={aiText || payload.ai_interpretation || "No AI interpretation."} />
        )}
      </SectionPanel>

      <SectionPanel title="Per-Well Diagnostic Workspace">
        <div className={layout.wellGrid}>
          {payload.wells?.map((well) => (
            <WellCard key={`${well.file_name}-${well.well_name}`} well={well} />
          ))}
        </div>
      </SectionPanel>

      {payload.errors?.length ? (
        <SectionPanel title="Errors">
          <ul className={layout.errorList}>
            {payload.errors.map((error, idx) => (
              <li key={`${error.file_name || "file"}-${idx}`}>
                {error.file_name || "file"}: {error.error}
              </li>
            ))}
          </ul>
        </SectionPanel>
      ) : null}
    </>
  );
}
