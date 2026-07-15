import { PLOT_LAYOUT_BASE, SEQ_TRACT_COLOR } from "../../controllers/plot-controller";
import type { SequenceBoundaryRow, WellReport } from "../../models/analyze-models";
import { PlotFigure } from "../plot-figure";

type Props = {
  report: WellReport | null;
  boundaries: SequenceBoundaryRow[];
};

export function SequenceLogChart({ report, boundaries }: Props) {
  const seq = report?.sequence_stratigraphy;
  const hasData = seq?.status === "ok";

  const intervalShapes = (seq?.intervals_auto || []).map((interval) => ({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 1,
    y0: interval.top,
    y1: interval.base,
    fillcolor: SEQ_TRACT_COLOR[interval.tract] || SEQ_TRACT_COLOR.UNDEF,
    line: { width: 0 },
    layer: "below",
  }));

  const boundaryShapes = boundaries.map((boundary) => ({
    type: "line",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 1,
    y0: boundary.depth,
    y1: boundary.depth,
    line: {
      color:
        boundary.status === "accepted"
          ? "rgba(22,132,70,1.0)" // solid green — confirmed pick
          : boundary.status === "rejected"
            ? "rgba(186,48,48,1.0)" // solid muted red — discarded pick
            : "rgba(170,120,30,1.0)", // amber/ochre — unreviewed; clearly visible
      dash: boundary.status === "accepted" ? "solid" : boundary.status === "rejected" ? "dash" : "dot",
      width: boundary.status === "accepted" ? 2.0 : boundary.status === "rejected" ? 1.8 : 1.5,
    },
  }));

  return (
    <PlotFigure
      height={660}
      hasData={hasData}
      emptyMessage="No sequence-ready well selected."
      data={[
        {
          type: "scatter",
          mode: "lines",
          x: seq?.tracks.signal || [],
          y: seq?.tracks.depth || [],
          line: { color: "#8b6914", width: 1.4 }, // dark amber — raw/noisy, subordinate
          name: "Signal",
        },
        {
          type: "scatter",
          mode: "lines",
          x: seq?.tracks.signal_smooth || [],
          y: seq?.tracks.depth || [],
          line: { color: "#1a5ea8", width: 2.2 }, // steel blue — interpreter's working curve
          name: "Smoothed",
        },
      ]}
      layout={{
        ...PLOT_LAYOUT_BASE,
        title: { text: `Well: ${report?.well_name || ""}`, font: { size: 14 } },
        yaxis: { title: "Depth", autorange: "reversed" },
        xaxis: { title: `${seq?.source_curve || "Curve"} (transformed)` },
        shapes: [...intervalShapes, ...boundaryShapes] as Array<Record<string, unknown>>,
      }}
    />
  );
}
