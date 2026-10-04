import { useId } from "react";
import styles from "./prediction-controls.module.css";

export interface PredictionControlsProps {
  showPrediction: boolean; onShowPredictionChange: (show: boolean) => void;
  predictionOpacity: number; onPredictionOpacityChange: (opacity: number) => void;
}
export function PredictionControls({ showPrediction, onShowPredictionChange, predictionOpacity, onPredictionOpacityChange }: PredictionControlsProps) {
  const id = useId();
  return <div className={styles.controls} role="group" aria-label="Prediction display">
    <label><input type="checkbox" checked={showPrediction} onChange={(event) => onShowPredictionChange(event.target.checked)} /> Show prediction</label>
    <label htmlFor={id}>Prediction opacity <output>{predictionOpacity}%</output></label>
    <input id={id} aria-label="Prediction opacity" type="range" min={0} max={100} step={1} value={predictionOpacity} onChange={(event) => onPredictionOpacityChange(Number(event.target.value))} />
    <small>Display only. Manual corrections remain visible; saved data is unchanged.</small>
  </div>;
}
