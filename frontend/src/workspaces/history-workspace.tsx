import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileChartColumn, ScanLine } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import appStyles from "../app.module.css";
import { useShellStatus } from "../app-shell-context";
import { EmptyPlot } from "../components/empty-plot";
import fieldStyles from "../components/form/field.module.css";
import { SectionPanel } from "../components/section-panel";
import { SkeletonText } from "../components/skeleton-text";
import type { HistoryItem, HistoryKind } from "../models/auth-models";
import { historyGateway } from "../services/history-service";
import styles from "./history-workspace.module.css";

/**
 * "My Files" — every raster and LAS file this account has worked on.
 *
 * The two workflows write to different tables, but to the person who ran them
 * this is one list in date order. The union happens in the backend's
 * `user_history` view, so paging here is paging over both rather than merging
 * two separately-paginated lists and getting a page with holes in it.
 *
 * Until this existed, closing the tab lost everything: analyses and jobs lived
 * in process memory and every id was unrecoverable the moment the server
 * restarted.
 */

const PAGE_SIZE = 20;

type Filter = "all" | HistoryKind;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "las", label: "LAS analyses" },
  { value: "raster", label: "Digitized scans" },
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * Where a row opens.
 *
 * A LAS analysis reopens the analysis workspace by id. A raster does too *if*
 * it was ever sent to analysis; otherwise it goes back into the wizard, which
 * is the only thing there is to return to. A raster whose pixels have been
 * evicted will find the wizard reporting the job is gone — which is the honest
 * answer, and the reason the row still shows what it was.
 */
function destinationFor(item: HistoryItem): string | null {
  if (item.kind === "las") {
    const workspace = item.file_count > 1 ? "portfolio" : "analysis";
    return `/${workspace}?analysis=${item.item_id}`;
  }
  if (item.analysis_id) return `/analysis?analysis=${item.analysis_id}`;
  return `/digitize/${item.item_id}`;
}

function stateBadgeClass(state: string): string {
  if (state === "failed") return `${styles.badge} ${styles.badgeFailed}`;
  if (state === "done") return `${styles.badge} ${styles.badgeDone}`;
  return styles.badge;
}

export function HistoryWorkspace() {
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();

  const kind = filter === "all" ? undefined : filter;

  const history = useQuery({
    queryKey: ["history", filter, offset],
    queryFn: () => historyGateway.list({ kind, limit: PAGE_SIZE, offset }),
  });

  const remove = useMutation({
    mutationFn: (item: HistoryItem) => historyGateway.remove(item.kind, item.item_id),
    // Invalidate rather than splice the row out locally: the totals and the
    // page boundaries both move, and recomputing them by hand is how a list
    // ends up showing nineteen of twenty rows.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["history"] }),
  });

  const items = history.data?.items ?? [];
  const total = history.data?.total ?? 0;

  useShellStatus(
    history.isPending
      ? "Loading your files…"
      : total === 0
        ? "Nothing analyzed yet."
        : `${total} item${total === 1 ? "" : "s"} in your history.`,
    history.isPending
  );

  function changeFilter(next: Filter) {
    setFilter(next);
    // A filter change with a stale offset lands on an empty page whenever the
    // narrower list is shorter than the current position.
    setOffset(0);
  }

  const errorMessage = history.error instanceof Error ? history.error.message : null;

  return (
    <main className={appStyles.mainBody}>
      <SectionPanel
        title="My files"
        right={
          <div className={styles.filters}>
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.chip} ${filter === option.value ? styles.chipActive : ""}`}
                onClick={() => changeFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {history.isPending && <SkeletonText />}

        {errorMessage && <p className={fieldStyles.error}>{errorMessage}</p>}

        {!history.isPending && !errorMessage && items.length === 0 && (
          <EmptyPlot
            message={
              filter === "all"
                ? "Nothing here yet. Analyze a LAS file or digitize a scan and it will appear."
                : "Nothing of this kind yet."
            }
          />
        )}

        {items.length > 0 && (
          <ul className={styles.list}>
            {items.map((item) => {
              const destination = destinationFor(item);
              return (
                <li key={`${item.kind}-${item.item_id}`} className={styles.row}>
                  <span className={styles.icon} aria-hidden="true">
                    {item.kind === "las" ? <FileChartColumn size={19} /> : <ScanLine size={19} />}
                  </span>

                  <div className={styles.main}>
                    {destination ? (
                      <Link className={styles.label} to={destination}>
                        {item.label}
                      </Link>
                    ) : (
                      <span className={styles.labelInert}>{item.label}</span>
                    )}

                    <span className={styles.meta}>
                      <span className={stateBadgeClass(item.state)}>{item.state}</span>
                      <span className={styles.dot}>{formatDate(item.created_at)}</span>
                      {item.kind === "las" && (
                        <span className={styles.dot}>
                          {item.file_count} well{item.file_count === 1 ? "" : "s"}
                        </span>
                      )}
                      {item.quality !== null && (
                        <span className={styles.dot}>
                          {(item.quality * 100).toFixed(0)}% coverage
                        </span>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={styles.deleteBtn}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item)}
                    title="Remove from your history"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div className={styles.pager}>
            <button
              type="button"
              className={fieldStyles.secondaryBtn}
              disabled={offset === 0}
              onClick={() => setOffset((previous) => Math.max(0, previous - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <button
              type="button"
              className={fieldStyles.secondaryBtn}
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((previous) => previous + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </SectionPanel>
    </main>
  );
}
