import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CloudDownload,
  Download,
  Hourglass,
  Trash2,
  User,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  MultiFetchSession,
  MultiFetchSessionSummary,
  MultipleAccount,
} from "@/types/fetch";
import { cn } from "@/lib/utils";

interface MultiAccountWorkspaceProps {
  session: MultiFetchSession | null;
  recentSessions: MultiFetchSessionSummary[];
  isFetchingAll: boolean;
  isDownloading: boolean;
  onDownloadFetched: () => void;
  onRemoveCurrentSession: () => void;
  onRemoveRecentSession: (sessionId: string) => void;
  onClearRecentSessions: () => void;
}

const STATUS_ORDER: Record<MultipleAccount["status"], number> = {
  fetching: 0,
  pending: 1,
  incomplete: 2,
  failed: 3,
  completed: 4,
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

function getStatusMeta(status: MultipleAccount["status"]) {
  switch (status) {
    case "fetching":
      return {
        label: "Fetching",
        icon: CloudDownload,
        tone: "bg-blue-500/15 text-blue-300 border-blue-500/20",
      };
    case "pending":
      return {
        label: "Pending",
        icon: Hourglass,
        tone: "bg-slate-500/15 text-slate-300 border-slate-500/20",
      };
    case "completed":
      return {
        label: "Completed",
        icon: CheckCircle2,
        tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
      };
    case "incomplete":
      return {
        label: "Incomplete",
        icon: AlertCircle,
        tone: "bg-amber-500/15 text-amber-300 border-amber-500/20",
      };
    case "failed":
      return {
        label: "Failed",
        icon: XCircle,
        tone: "bg-red-500/15 text-red-300 border-red-500/20",
      };
  }
}

function getSessionBadgeTone(
  status: MultiFetchSession["status"] | MultiFetchSessionSummary["status"],
  isFetchingAll: boolean
) {
  if (isFetchingAll || status === "running") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  switch (status) {
    case "completed":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "stopped":
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
    case "ready":
    default:
      return "border-slate-500/20 bg-slate-500/10 text-slate-300";
  }
}

function formatSessionStatusLabel(
  status: MultiFetchSession["status"] | MultiFetchSessionSummary["status"],
  isFetchingAll: boolean
) {
  if (isFetchingAll || status === "running") {
    return "Queue Running";
  }
  switch (status) {
    case "completed":
      return "Queue Complete";
    case "failed":
      return "Completed With Issues";
    case "stopped":
      return "Queue Stopped";
    case "ready":
    default:
      return "Ready To Run";
  }
}

function buildStats(accounts: MultipleAccount[]) {
  return accounts.reduce(
    (summary, account) => {
      summary[account.status] += 1;
      summary.totalMedia += account.mediaCount;
      return summary;
    },
    {
      pending: 0,
      fetching: 0,
      completed: 0,
      incomplete: 0,
      failed: 0,
      totalMedia: 0,
    }
  );
}

export function MultiAccountWorkspace({
  session,
  recentSessions,
  isFetchingAll,
  isDownloading,
  onDownloadFetched,
  onRemoveCurrentSession,
  onRemoveRecentSession,
  onClearRecentSessions,
}: MultiAccountWorkspaceProps) {
  const accounts = session?.accounts || [];
  const sortedAccounts = [...accounts].sort((a, b) => {
    const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return b.mediaCount - a.mediaCount;
  });
  const stats = buildStats(accounts);

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-5 overflow-hidden">
      {session ? (
        <div className="rounded-[24px] border border-border/70 bg-muted/20 p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 self-start">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {session.title}
                  </h2>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium",
                      getSessionBadgeTone(session.status, isFetchingAll)
                    )}
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatSessionStatusLabel(session.status, isFetchingAll)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Started {new Date(session.createdAt).toLocaleTimeString()} •{" "}
                  {session.source === "saved-update"
                    ? "Saved accounts update session"
                    : "Manual multi-account fetch session"}
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 lg:min-w-[320px] lg:max-w-[360px]">
                <Button
                  className="h-10 w-full rounded-xl"
                  onClick={onDownloadFetched}
                  disabled={stats.totalMedia === 0 || isDownloading}
                >
                  <Download className="h-4 w-4" />
                  {isDownloading ? "Downloading..." : "Download Current Results"}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 w-full rounded-xl"
                  onClick={onRemoveCurrentSession}
                  disabled={isFetchingAll}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Current Session
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[760px] grid-cols-5 gap-2">
                <StatCard label="Accounts" value={formatNumber(accounts.length)} />
                <StatCard label="Fetching" value={formatNumber(stats.fetching)} />
                <StatCard label="Completed" value={formatNumber(stats.completed)} />
                <StatCard label="Issues" value={formatNumber(stats.incomplete + stats.failed)} />
                <StatCard label="Items" value={formatNumber(stats.totalMedia)} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {session ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {sortedAccounts.map((account) => {
              const meta = getStatusMeta(account.status);
              const StatusIcon = meta.icon;

              return (
                <article
                  key={account.id}
                  className="rounded-[22px] border border-border/70 bg-card/70 p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3">
                      {account.accountInfo?.profile_image ? (
                        <img
                          src={account.accountInfo.profile_image}
                          alt={account.accountInfo.nick}
                          className="h-12 w-12 rounded-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                          <User className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}

                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold tracking-tight">
                          {account.accountInfo?.nick || `@${account.username}`}
                        </h3>
                        <p className="truncate text-sm text-muted-foreground">
                          @{account.accountInfo?.name || account.username}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                          Media Items
                        </p>
                        <p className="mt-1 text-2xl font-semibold tracking-tight">
                          {formatNumber(account.mediaCount)}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            meta.tone
                          )}
                        >
                          <StatusIcon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>

                        {account.showDiff ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                            New items
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {account.error ? (
                      <p className="line-clamp-2 text-xs leading-5 text-red-300/90">
                        {account.error}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-8 py-12 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">
              No Active Multi-Account Session
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Start a new multi-account fetch from the left input panel, or use
              Update Selected from Saved Accounts to open a fresh session here.
            </p>
          </div>
        </div>
      )}

      {recentSessions.length > 0 ? (
        <section className="rounded-[24px] border border-border/70 bg-card/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Recent Sessions</h3>
              <p className="text-xs text-muted-foreground">
                Previous multi-account runs stay here until you remove them.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClearRecentSessions}>
              Clear All
            </Button>
          </div>

          <div className="space-y-2">
            {recentSessions.map((recent) => (
              <div
                key={recent.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{recent.title}</p>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        getSessionBadgeTone(recent.status, false)
                      )}
                    >
                      {formatSessionStatusLabel(recent.status, false)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {recent.accountCount.toLocaleString()} account(s) •{" "}
                    {recent.totalMedia.toLocaleString()} item(s) •{" "}
                    {new Date(recent.createdAt).toLocaleTimeString()}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => onRemoveRecentSession(recent.id)}
                  aria-label={`Remove ${recent.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
