import {
  AlertTriangle,
  Download,
  FileCheck,
  StopCircle,
  Wifi,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { GlobalDownloadHistoryItem, GlobalDownloadSessionMeta } from "@/types/download";
import type { DownloadIntegrityReport, DownloadIntegrityTaskStatus } from "@/types/settings";
import type { TaskCardSummary, TaskLifecycleStatus } from "@/types/tasks";
import { cn } from "@/lib/utils";

interface ActivityPanelProps {
  fetch: TaskCardSummary & {
    fetchType: "single" | "multiple";
    elapsedTime: number;
    remainingTime: number | null;
    latestFetchResult: {
      username: string;
      displayName: string;
      mediaCount: number;
      completed: boolean;
    } | null;
    multipleStatusCounts: {
      pending: number;
      fetching: number;
      completed: number;
      incomplete: number;
      failed: number;
    };
    resumeInfo: {
      canResume: boolean;
      mediaCount: number;
    } | null;
  };
  download: TaskCardSummary & {
    meta: GlobalDownloadSessionMeta | null;
    history: GlobalDownloadHistoryItem[];
  };
  integrity: TaskCardSummary & {
    report: DownloadIntegrityReport | null;
    taskStatus: DownloadIntegrityTaskStatus | null;
  };
  failures: {
    count: number;
    hasFailures: boolean;
    incomplete: number;
    failed: number;
  };
  onStopFetch?: () => void | Promise<void>;
  onStopDownload: () => void | Promise<void>;
  onStopIntegrity?: () => void | Promise<void>;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function SectionCard({
  title,
  subtitle,
  children,
  action,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-2xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm"
      data-testid={testId}
    >
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function getStatusLabel(status: TaskLifecycleStatus | null) {
  switch (status) {
    case "running":
      return "Running";
    case "cancelling":
      return "Cancelling";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Idle";
  }
}

function getStatusTone(status: TaskLifecycleStatus | null) {
  switch (status) {
    case "running":
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
    case "cancelling":
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
    case "completed":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "cancelled":
      return "border-slate-500/20 bg-slate-500/10 text-slate-300";
    default:
      return "";
  }
}

export function ActivityPanel({
  fetch,
  download,
  integrity,
  failures,
  onStopFetch,
  onStopDownload,
  onStopIntegrity,
}: ActivityPanelProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <SectionCard
          title="Fetch"
          subtitle={fetch.description}
          testId="activity-fetch-card"
          action={
            <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
              <Wifi className="h-3.5 w-3.5" />
              <span>Live status</span>
            </div>
          }
        >
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{fetch.title}</p>
                <p className="text-xs text-muted-foreground">
                  {fetch.fetchType === "multiple"
                    ? "Multiple-account queue"
                    : "Single-account fetch"}
                </p>
              </div>
              <Badge
                className={cn("border", getStatusTone(fetch.status))}
                data-testid="activity-fetch-status"
              >
                {getStatusLabel(fetch.status)}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-muted/50 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Elapsed
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatElapsed(fetch.elapsedTime)}
                </p>
              </div>
              <div className="rounded-xl bg-muted/50 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Remaining
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {fetch.remainingTime === null ? "—" : formatElapsed(fetch.remainingTime)}
                </p>
              </div>
            </div>
            {fetch.progress ? (
              <div className="space-y-2">
                <Progress value={fetch.progress.percent} className="h-2.5" />
                <p className="text-xs text-muted-foreground">
                  {fetch.progress.current.toLocaleString()} / {fetch.progress.total.toLocaleString()} tracked
                </p>
              </div>
            ) : null}
            {fetch.fetchType === "multiple" ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-muted/50 p-2.5">
                  <p className="text-muted-foreground">Fetching</p>
                  <p className="text-lg font-semibold">
                    {fetch.multipleStatusCounts.fetching}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2.5">
                  <p className="text-muted-foreground">Completed</p>
                  <p className="text-lg font-semibold">
                    {fetch.multipleStatusCounts.completed}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2.5">
                  <p className="text-muted-foreground">Incomplete</p>
                  <p className="text-lg font-semibold">{failures.incomplete}</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-2.5">
                  <p className="text-muted-foreground">Failed</p>
                  <p className="text-lg font-semibold">{failures.failed}</p>
                </div>
              </div>
            ) : fetch.latestFetchResult ? (
              <div className="rounded-xl bg-muted/50 p-2.5">
                <p className="font-medium">{fetch.latestFetchResult.displayName}</p>
                <p className="text-sm text-muted-foreground">
                  @{fetch.latestFetchResult.username}
                </p>
                <p className="mt-2 text-sm">
                  {fetch.latestFetchResult.mediaCount.toLocaleString()} items •{" "}
                  {fetch.latestFetchResult.completed ? "Completed" : "Partial"}
                </p>
              </div>
            ) : null}
            {fetch.resumeInfo?.canResume && fetch.fetchType === "single" ? (
              <div className="rounded-xl bg-muted/50 p-2.5 text-sm text-muted-foreground">
                Resume available for {fetch.resumeInfo.mediaCount.toLocaleString()} item(s).
              </div>
            ) : null}
            {(fetch.canCancel || fetch.status === "cancelling") && onStopFetch ? (
              <Button
                variant="destructive"
                className="h-10 w-full justify-center gap-2"
                onClick={() => void onStopFetch()}
                disabled={fetch.status === "cancelling"}
                data-testid="activity-fetch-cancel"
              >
                <StopCircle className="h-4 w-4" />
                {fetch.status === "cancelling" ? "Cancelling..." : "Cancel Fetch"}
              </Button>
            ) : null}

            <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
              {failures.hasFailures ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    {failures.count} queue item(s) need retry or review
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No queued fetch failures right now.
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Download"
          subtitle={download.meta?.subtitle || download.description}
          testId="activity-download-card"
          action={
            <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
              <Download className="h-3.5 w-3.5" />
              <span>Task monitor</span>
            </div>
          }
        >
          <div className="space-y-3">
            {download.progress ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{download.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {download.progress.current.toLocaleString()} / {download.progress.total.toLocaleString()} completed
                    </p>
                  </div>
                  <Badge
                    className={cn("border", getStatusTone(download.status))}
                    data-testid="activity-download-status"
                  >
                    {getStatusLabel(download.status)}
                  </Badge>
                </div>
                <Progress value={download.progress.percent} className="h-2.5" />
                <p className="text-xs text-muted-foreground">
                  {download.progress.percent}% complete
                </p>
                <Button
                  variant="destructive"
                  className="h-10 w-full justify-center gap-2"
                  onClick={() => void onStopDownload()}
                  disabled={download.status === "cancelling"}
                  data-testid="activity-download-cancel"
                >
                  <StopCircle className="h-4 w-4" />
                  {download.status === "cancelling" ? "Cancelling..." : "Cancel Download"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active download. Recent tasks stay listed below.
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">Recent Tasks</h4>
                <span className="text-xs text-muted-foreground">
                  Last completed, failed, or cancelled downloads
                </span>
              </div>
              {download.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent download tasks yet.</p>
              ) : (
                download.history.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-muted/50 p-3"
                    data-testid={`activity-download-history-${item.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.subtitle || "Recent download task"}
                        </p>
                      </div>
                      <Badge
                        className={cn("border", getStatusTone(item.status))}
                        data-testid={`activity-download-history-status-${item.id}`}
                      >
                        {getStatusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.current.toLocaleString()} / {item.total.toLocaleString()} •{" "}
                      {new Date(item.finishedAt).toLocaleTimeString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Integrity"
          subtitle={integrity.description}
          testId="activity-integrity-card"
          action={
            <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
              <FileCheck className="h-3.5 w-3.5" />
              <span>Folder health</span>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">{integrity.title}</p>
                <p className="text-xs text-muted-foreground">
                  {integrity.phase || "Background integrity task status."}
                </p>
              </div>
              <Badge
                className={cn("border", getStatusTone(integrity.status))}
                data-testid="activity-integrity-status"
              >
                {getStatusLabel(integrity.status)}
              </Badge>
            </div>

            {integrity.progress ? (
              <div className="space-y-2">
                <Progress value={integrity.progress.percent} className="h-2.5" />
                <p className="text-xs text-muted-foreground">
                  {integrity.progress.current.toLocaleString()} / {integrity.progress.total.toLocaleString()} files checked
                </p>
              </div>
            ) : null}

            {integrity.report ? (
              <div className="rounded-xl bg-muted/50 p-3 text-sm">
                <p className="font-medium">
                  {integrity.report.partial_files + integrity.report.incomplete_files} issue(s)
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {integrity.report.checked_files.toLocaleString()} checked •{" "}
                  {integrity.report.untracked_files.toLocaleString()} untracked
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No integrity report yet.
              </p>
            )}

            {(integrity.canCancel || integrity.status === "cancelling") && onStopIntegrity ? (
              <Button
                variant="destructive"
                className="h-10 w-full justify-center gap-2"
                onClick={() => void onStopIntegrity()}
                disabled={integrity.status === "cancelling"}
                data-testid="activity-integrity-cancel"
              >
                <StopCircle className="h-4 w-4" />
                {integrity.status === "cancelling" ? "Cancelling..." : "Cancel Integrity Check"}
              </Button>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </aside>
  );
}
