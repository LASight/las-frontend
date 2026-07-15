import type { WellReport } from "../../models/analyze-models";
import { DerivedPlots } from "./derived-plots";
import { RawTrackPlots } from "./raw-track-plots";
import styles from "./well-card.module.css";
import { WellHeader } from "./well-header";

type Props = {
  well: WellReport;
};

export function WellCard({ well }: Props) {
  return (
    <article className={styles.wellCard}>
      <WellHeader well={well} />
      <RawTrackPlots well={well} />
      <DerivedPlots well={well} />
    </article>
  );
}
