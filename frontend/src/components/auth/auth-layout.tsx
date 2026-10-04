import type { ReactNode } from "react";

import { BrandMark } from "../brand-mark";
import styles from "./auth-layout.module.css";

/**
 * The frame the sign-in and sign-up pages share.
 *
 * Both are one form panel next to a decorative hero; the only difference
 * between the two pages is what goes in the form. Two full page components
 * would have duplicated the layout and drifted apart the first time one of
 * them grew a field.
 */

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** The "no account yet?" line at the foot of the form. */
  footer: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className={styles.page}>
      {/* Decoration only — the form panel repeats every word that matters,
          so a screen reader gets the page once, not twice. */}
      <aside className={styles.hero} aria-hidden="true">
        <div className={styles.heroWordmark}>WellSight</div>

        <BrandMark className={styles.heroMark} />

        <div className={styles.heroCopy}>
          <h2 className={styles.heroHeadline}>
            From raster scan to reservoir-ready curve.
          </h2>
          <p className={styles.heroTagline}>
            WellSight digitizes and analyzes well logs so the data in an old
            scan is as usable as the data from a modern tool string.
          </p>
        </div>
      </aside>

      <main className={styles.panel}>
        <div className={styles.formWrap}>
          <div className={styles.brand}>
            <BrandMark className={styles.brandIcon} />
            <span className={styles.appName}>WellSight</span>
          </div>

          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>

          {children}

          <p className={styles.switch}>{footer}</p>
        </div>
      </main>
    </div>
  );
}
