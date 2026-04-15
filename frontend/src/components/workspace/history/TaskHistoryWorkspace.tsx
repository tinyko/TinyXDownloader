import {
  Clock3,
  DatabaseZap,
  Download,
  RefreshCcw,
  Trash2,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GlobalDownloadHistoryItem } from "@/types/download";
import type { MultiFetchSessionSummary } from "@/types/fetch";
import type { FetchTaskHistoryItem } from "@/types/history";
import { cn } from "@/lib/utils";

interface TaskHistoryWorkspaceProps {
  fetchHistory: FetchTaskHistoryItem[];
  queueHistory: MultiFetchSessionSummary[];
  downloadHistory: GlobalDownloadHistoryItem[];
  onRemoveFetchHistory: (id: string) => void;
  onClearFetchHistory: () => void;
  onRemoveQueueHistory: (id: string) => void;
  onClearQueueHistory: () => void;
  onRemoveDownloadHistory: (id: string) => void;
  onClearDownloadHistory: () => void;
  onClearAllHistory: () => void;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getStatusTone(status: string) {
  switch (status) {
    case "completed":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "cancelled":
      return "border-slate-500/20 bg-slate-500/10 text-slate-300";
    default:
      return "border-border/70 bg-muted/40 text-foreground";
  }
}

function formatFetchVariant(entry: FetchTaskHistoryItem) {
  if (entry.mode === "private") {
    return entry.privateType === "likes" ? "Private likes" : "Private bookmarks";
  }
  if (entry.useDateRange && entry.startDate && entry.endDate) {
    return `Date range ${entry.startDate} to ${entry.endDate}`;
  }
  return entry.timelineType === "media" ? "Public media" : "Public timeline";
}

function formatFetchOptions(entry: FetchTaskHistoryItem) {
  return [
    entry.mediaType,
    entry.retweets ? "retweets on" : "retweets off",
    `${entry.totalItems.toLocaleString()} item(s)`,
    formatDuration(entry.durationMs),
  ].join(" • ");
}

function SectionShell({
  title,
  subtitle,
  action,
  children,
  testId,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex min-h-0 flex-col rounded-[24px] border border-border/70 bg-card/50 p-4 shadow-sm"
      data-testid={testId}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Clock3;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

export function TaskHistoryWorkspace({
  fetchHistory,
  queueHistory,
  downloadHistory,
  onRemoveFetchHistory,
  onClearFetchHistory,
  onRemoveQueueHistory,
  onClearQueueHistory,
  onRemoveDownloadHistory,
  onClearDownloadHistory,
  onClearAllHistory,
}: TaskHistoryWorkspaceProps) {
  const totalHistoryItems = fetchHistory.length + queueHistory.length + downloadHistory.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5" data-testid="task-history-workspace">
      <section className="rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Task History</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Recent fetch runs, queue sessions, and download tasks live here instead of the
              diagnostics drawer. History is capped and can be cleared anytime so it does not grow
              without bounds.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            onClick={onClearAllHistory}
            disabled={totalHistoryItems === 0}
            data-testid="task-history-clear-all"
          >
            <Trash2 className="h-4 w-4" />
            Clear All History
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Single Fetches" value={fetchHistory.length} icon={Clock3} />
          <SummaryCard label="Queue Runs" value={queueHistory.length} icon={RefreshCcw} />
          <SummaryCard label="Downloads" value={downloadHistory.length} icon={Download} />
          <SummaryCard label="Total Retained" value={totalHistoryItems} icon={DatabaseZap} />
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="grid min-h-0 gap-5">
          <SectionShell
            title="Single Fetches"
            subtitle="Retains the latest 60 single-account fetch tasks."
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-2 text-xs"
                onClick={onClearFetchHistory}
                disabled={fetchHistory.length === 0}
              >
                Clear
              </Button>
            }
            testId="task-history-fetch-section"
          >
            {fetchHistory.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No single fetch tasks yet.
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1">
                {fetchHistory.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-3">
                          {entry.image ? (
                            <img
                              src={entry.image}
                              alt={entry.displayName || entry.username}
                              className="h-10 w-10 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/70">
                              <UserRound className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {entry.mode === "private" && entry.privateType === "bookmarks"
                                ? "My Bookmarks"
                                : entry.mode === "private" && entry.privateType === "likes"
                                  ? "My Likes"
                                  : `@${entry.username}`}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatFetchVariant(entry)}
                            </p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatFetchOptions(entry)}</p>
                        <p className="text-xs text-muted-foreground">
                          Finished {formatTimestamp(entry.finishedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge className={cn("border", getStatusTone(entry.status))}>
                          {entry.status}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() => onRemoveFetchHistory(entry.id)}
                          aria-label={`Remove ${entry.username} fetch history`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionShell>

          <SectionShell
            title="Queue Runs"
            subtitle="Retains the latest 24 multi-account queue sessions."
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-2 text-xs"
                onClick={onClearQueueHistory}
                disabled={queueHistory.length === 0}
              >
                Clear
              </Button>
            }
            testId="task-history-queue-section"
          >
            {queueHistory.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No queue runs yet.
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1">
                {queueHistory.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{entry.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.accountCount.toLocaleString()} account(s) •{" "}
                          {entry.totalMedia.toLocaleString()} item(s)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Started {formatTimestamp(entry.createdAt)} • Finished{" "}
                          {formatTimestamp(entry.finishedAt || entry.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge className={cn("border", getStatusTone(entry.status))}>
                          {entry.status}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() => onRemoveQueueHistory(entry.id)}
                          aria-label={`Remove ${entry.title}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionShell>
        </div>

        <SectionShell
          title="Downloads"
          subtitle="Retains the latest 60 completed, failed, or cancelled download tasks."
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs"
              onClick={onClearDownloadHistory}
              disabled={downloadHistory.length === 0}
            >
              Clear
            </Button>
          }
          testId="task-history-download-section"
        >
          {downloadHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              No download tasks yet.
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto pr-1">
              {downloadHistory.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.subtitle || "Download task"} • {item.current.toLocaleString()} /{" "}
                        {item.total.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Finished {formatTimestamp(item.finishedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={cn("border", getStatusTone(item.status))}>
                        {item.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => onRemoveDownloadHistory(item.id)}
                        aria-label={`Remove ${item.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionShell>
      </div>
    </div>
  );
}
