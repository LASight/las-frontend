import type { InputHTMLAttributes } from "react";
import { useId } from "react";

import styles from "./field.module.css";

/**
 * A labelled input with room for an error and a hint.
 *
 * The wizard steps write this markup out by hand — four elements and two
 * conditionals per field — which was tolerable at three fields on one step. The
 * account and sign-up forms have twelve between them, so it becomes a component
 * here rather than a fourth copy.
 *
 * `useId` rather than a caller-supplied id: the label has to be tied to its
 * input for a screen reader and for click-to-focus, and an id the caller has to
 * remember to pass is an id someone eventually forgets.
 */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** Shown in red below the input, and marks the input invalid. */
  error?: string | null;
  /** Shown in grey below the input when there is no error. */
  hint?: string;
};

export function TextField({ label, error, hint, className = "", ...rest }: Props) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`${styles.input} ${error ? styles.inputInvalid : ""} ${className}`.trim()}
        // Announces the failure rather than only colouring the border, which is
        // invisible to anyone not looking at the border.
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <span className={styles.fieldError} id={`${id}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
