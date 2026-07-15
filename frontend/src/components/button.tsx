import type { ButtonHTMLAttributes } from "react";

import styles from "./button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "secondary", className = "", ...rest }: Props) {
  const variantClass = variant === "primary" ? styles.primary : styles.secondary;
  return <button className={`${styles.button} ${variantClass} ${className}`.trim()} {...rest} />;
}
