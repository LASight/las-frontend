import type { ReactNode } from "react";

import styles from "./auth-layout.module.css";

/**
 * The frame the sign-in and sign-up pages share.
 *
 * Both are one card with a brand, a heading and a form; the only difference is
 * what goes in the form. Two full page components would have duplicated the
 * layout and drifted apart the first time one of them grew a field.
 */

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** The "no account yet?" line at the foot of the card. */
  footer: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>W</div>
          <span className={styles.appName}>WellSight</span>
        </div>

        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {children}

        <p className={styles.switch}>{footer}</p>
      </main>
    </div>
  );
}
