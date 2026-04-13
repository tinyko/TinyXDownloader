import {
  AlertTriangle,
  Download,
  StopCircle,
  Wifi,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  GlobalDownloadHistoryItem,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";

interface ActivityPanelProps {
  fetch: {
    loading: boolean;
    fetchType: "single" | "multiple";
    title: string;
    description: string;
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
  download: {
    state: GlobalDownloadState | null;
    meta: GlobalDownloadSessionMeta | null;
    history: GlobalDownloadHistoryItem[];
  };
  failures: {
    count: number;
    hasFailures: boolean;
    incomplete: number;
    failed: number;
  };
  onStopDownload: () => void | Promise<void>;
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm">
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

export function ActivityPanel({
  fetch,
  download,
  failures,
  onStopDownload,
}: ActivityPanelProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        <SectionCard
          title="Fetch"
          subtitle={fetch.description}
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
              <Badge variant={fetch.loading ? "default" : "secondary"}>
                {fetch.loading ? "Running" : "Idle"}
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
          subtitle={download.meta?.subtitle || "Background download task status."}
          action={
            <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
              <Download className="h-3.5 w-3.5" />
              <span>Task monitor</span>
            </div>
          }
        >
          <div className="space-y-3">
            {download.state?.in_progress ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">
                      {download.meta?.title || "Downloading media"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {download.state.current.toLocaleString()} / {download.state.total.toLocaleString()} completed
                    </p>
                  </div>
                  <Badge>{download.state.percent}%</Badge>
                </div>
                <Progress value={download.state.percent} className="h-2.5" />
                <Button
                  variant="destructive"
                  className="h-10 w-full justify-center gap-2"
                  onClick={onStopDownload}
                >
                  <StopCircle className="h-4 w-4" />
                  Stop Download
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
                  Last completed or interrupted downloads
                </span>
              </div>
              {download.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent download tasks yet.</p>
              ) : (
                download.history.slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-xl bg-muted/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.subtitle || "Recent download task"}
                        </p>
                      </div>
                      <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                        {item.status === "completed" ? "Done" : "Interrupted"}
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
      </div>
    </aside>
  );
}
