import type { Layout } from "plotly.js";
import Plot from "react-plotly.js";

import { PLOT_CONFIG } from "../controllers/plot-controller";
import { EmptyPlot } from "./empty-plot";
import styles from "./plot-figure.module.css";

type Props = {
  /** Plotly traces. Typed loosely because trace shapes vary widely per chart. */
  data: Array<Record<string, unknown>>;
  layout: Partial<Layout>;
  /** Fixed pixel height of the plot; width is always 100%. */
  height: number;
  /** When false, renders the empty-state placeholder instead of the plot. */
  hasData?: boolean;
  emptyMessage?: string;
};

/**
 * Reusable Plotly wrapper. Centralizes the shared config, sizing, and empty-state
 * fallback that every chart in the app previously duplicated inline.
 */
export function PlotFigure({ data, layout, height, hasData = true, emptyMessage = "No data available." }: Props) {
  if (!hasData) {
    return <EmptyPlot message={emptyMessage} />;
  }

  return (
    <Plot
      data={data as never}
      layout={layout}
      config={PLOT_CONFIG}
      className={styles.figure}
      style={{ height: `${height}px` }}
    />
  );
}
