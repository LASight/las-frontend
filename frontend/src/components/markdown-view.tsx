import { renderMarkdown } from "../services/markdown-service";
import styles from "./markdown-view.module.css";

type Props = {
  text: string;
};

export function MarkdownView({ text }: Props) {
  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
