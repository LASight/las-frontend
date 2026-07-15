import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { ChatMessage } from "../hooks/use-chat";
import { renderMarkdown } from "../services/markdown-service";
import styles from "./assistant-drawer.module.css";

type DrawerTab = "chat" | "brief";

type Props = {
  open: boolean;
  onToggle: () => void;
  analysisId: string | null;
  aiEnabled: boolean;
  aiMeta: string;
  aiInterpretation: string;
  aiLoading: boolean;
  messages: ChatMessage[];
  isPending: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onClear: () => void;
  onWidthChange: (value: number) => void;
};

const QUICK_PROMPTS = [
  "Give me the top 3 technical risks across wells and why.",
  "Which well should we prioritize and what confirms it?",
  "Summarize sequence boundary confidence issues for the selected dataset.",
];

const MIN_WIDTH = 320;
const MAX_WIDTH = 760;

function HelmetIcon() {
  return <span className={styles.helmet}>⛑</span>;
}

export function AssistantDrawer({
  open,
  onToggle,
  analysisId,
  aiEnabled,
  aiMeta,
  aiInterpretation,
  aiLoading,
  messages,
  isPending,
  onSendText,
  onClear,
  onWidthChange,
}: Props) {
  const [tab, setTab] = useState<DrawerTab>("chat");
  const [draftInput, setDraftInput] = useState("");
  const isResizingRef = useRef(false);

  useEffect(() => {
    function clampWidth(nextWidth: number): number {
      const viewportSafeMax = Math.max(MIN_WIDTH, window.innerWidth - 140);
      return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.min(viewportSafeMax, Math.round(nextWidth))));
    }

    function onMouseMove(event: MouseEvent) {
      if (!isResizingRef.current || !open) return;
      onWidthChange(clampWidth(window.innerWidth - event.clientX));
    }

    function stopResize() {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResize);
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, [open, onWidthChange]);

  useEffect(() => {
    if (!open) return;
    setDraftInput("");
  }, [analysisId, open]);

  async function sendDraft() {
    const text = draftInput.trim();
    if (!text || isPending || !analysisId) return;
    await onSendText(text);
    setDraftInput("");
  }

  function startResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (!open || window.innerWidth <= 760) return;
    event.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.fab} ${open ? styles.fabOpen : ""}`}
        onClick={onToggle}
        aria-label="Toggle AI assistant"
      >
        <HelmetIcon />
        <span className={styles.fabLabel}>{open ? "Close" : "Assistant"}</span>
      </button>

      <aside className={`${styles.drawer} ${open ? styles.open : ""}`}>
        <div
          className={styles.resizeHandle}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant"
          title="Drag to resize"
        />
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>AI ASSISTANT</p>
            <h3 className={styles.title}>
              <HelmetIcon /> Geological Copilot
            </h3>
            <p className={styles.meta}>Analysis: {analysisId ? `${analysisId.slice(0, 8)}...` : "none"}</p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.dot} ${aiEnabled ? styles.dotOn : styles.dotOff}`}>
              {aiEnabled ? "AI on" : "AI off"}
            </span>
            <button type="button" onClick={onToggle} className={styles.closeBtn}>
              ×
            </button>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "chat" ? styles.tabActive : ""}`}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "brief" ? styles.tabActive : ""}`}
            onClick={() => setTab("brief")}
          >
            AI Brief
          </button>
        </div>

        {tab === "chat" ? (
          <>
            <div className={styles.promptRow}>
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.promptBtn}
                  disabled={!analysisId || isPending}
                  onClick={() => {
                    void onSendText(prompt);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className={styles.messages}>
              {messages.map((message, idx) => (
                <div
                  key={`${message.role}-${idx}`}
                  className={`${styles.bubble} ${
                    message.role === "user"
                      ? styles.user
                      : message.role === "system"
                        ? styles.system
                        : styles.assistant
                  }`}
                >
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                </div>
              ))}
            </div>

            <textarea
              className={styles.input}
              rows={4}
              value={draftInput}
              onChange={(event) => setDraftInput(event.target.value)}
              placeholder="Ask AI about ranking, risks, facies, sequence picks, or recommended actions..."
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendDraft();
                }
              }}
            />

            <div className={styles.footer}>
              <button type="button" className={styles.primary} onClick={() => void sendDraft()} disabled={!analysisId || isPending}>
                {isPending ? "Sending..." : "Send"}
              </button>
              <button type="button" className={styles.secondary} onClick={onClear}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <div className={styles.briefWrap}>
            <p className={styles.meta}>{aiMeta}</p>
            {aiLoading ? (
              <div className={styles.skeleton}>
                <div className={styles.line} />
                <div className={`${styles.line} ${styles.short}`} />
                <div className={styles.line} />
              </div>
            ) : (
              <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(aiInterpretation) }} />
            )}
          </div>
        )}
      </aside>
    </>
  );
}
