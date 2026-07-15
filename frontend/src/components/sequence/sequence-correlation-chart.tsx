import { PLOT_LAYOUT_BASE } from "../../controllers/plot-controller";
import type { SequenceCorrelation } from "../../models/analyze-models";
import { PlotFigure } from "../plot-figure";

type Props = {
  correlation: SequenceCorrelation | null;
};

export function SequenceCorrelationChart({ correlation }: Props) {
  const hasData = Boolean(
    correlation && correlation.status === "ok" && correlation.surface_names?.length
  );

  return (
    <PlotFigure
      height={360}
      hasData={hasData}
      emptyMessage="Need multiple wells with valid sequence picks."
      data={[
        {
          type: "heatmap",
          z: correlation?.relative_matrix,
          x: correlation?.well_names,
          y: correlation?.surface_names,
          zmin: 0,
          zmax: 1,
          colorscale: "Blues",
          customdata: correlation?.depth_matrix,
          hovertemplate:
            "Surface %{y}<br>Well %{x}<br>Relative position %{z:.3f}<br>Depth %{customdata:.2f}<extra></extra>",
        },
      ]}
      layout={{
        ...PLOT_LAYOUT_BASE,
        margin: { l: 84, r: 22, t: 28, b: 55 },
        xaxis: { tickangle: -24 },
        yaxis: { autorange: "reversed" },
      }}
    />
  );
}
