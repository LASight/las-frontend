import { fmt } from "../../controllers/format-controller";
import type { AnalyzePayload } from "../../models/analyze-models";
import layout from "../layout.module.css";
import { MetricCard } from "../metric-card";
import { SectionPanel } from "../section-panel";

type Props = {
  payload: AnalyzePayload;
};

export function PortfolioSummary({ payload }: Props) {
  const summary = payload.portfolio_summary;

  return (
    <SectionPanel title="Portfolio Summary">
      <div className={layout.metricsGrid}>
        <MetricCard label="Wells" value={String(summary?.well_count ?? 0)} />
        <MetricCard label="Avg QC" value={fmt(summary?.avg_qc_score, 1)} />
        <MetricCard label="Depth Samples" value={String(summary?.total_depth_points ?? 0)} />
        <MetricCard label="Wells With Potential Pay" value={String(summary?.wells_with_pay ?? 0)} />
        <MetricCard label="Avg Anomaly %" value={fmt(summary?.avg_anomaly_pct, 2)} />
        <MetricCard label="Density Transform" value={payload.density_transform?.method || "N/A"} />
        <MetricCard
          label="Transform Support Points"
          value={String(payload.density_transform?.support_points ?? "N/A")}
        />
      </div>
    </SectionPanel>
  );
}
