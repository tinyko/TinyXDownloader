import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, StopCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export interface GlobalDownloadState {
  in_progress: boolean;
  current: number;
  total: number;
  percent: number;
}

export interface GlobalDownloadSessionMeta {
  source: "media-list" | "database-single" | "database-bulk" | "multi-account-workspace";
  title: string;
  subtitle?: string;
  targetKey?: string;
  accountId?: number;
  accountName?: string;
}

export interface GlobalDownloadHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
  status: "completed" | "interrupted";
  current: number;
  total: number;
  finishedAt: number;
}

interface GlobalDownloadPanelProps {
  state: GlobalDownloadState | null;
  meta: GlobalDownloadSessionMeta | null;
  history?: GlobalDownloadHistoryItem[];
  onStop: () => void | Promise<void>;
}

function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

export function GlobalDownloadPanel({
  state,
  meta,
  history = [],
  onStop,
}: GlobalDownloadPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const hasActiveDownload = Boolean(state?.in_progress);
  const hasHistory = history.length > 0;

  const recentHistory = useMemo(() => history.slice(0, 5), [history]);

  if (!hasActiveDownload && !hasHistory) {
    return null;
  }

  const title = meta?.title || "Downloading media";
  const subtitle = meta?.subtitle || "Download is running in the background";

  return (
    <div className="fixed bottom-4 right-4 left-[4.5rem] z-50 sm:left-auto sm:w-[360px]">
      <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 shrink-0 text-primary" />
              <p className="truncate text-sm font-semibold">
                {hasActiveDownload ? title : "Download Center"}
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasActiveDownload ? subtitle : `${history.length} recent task${history.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveDownload && state ? (
              <Badge variant="secondary">
                {formatNumberWithComma(state.current)} / {formatNumberWithComma(state.total)}
              </Badge>
            ) : null}
            {hasHistory ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            ) : null}
          </div>
        </div>

        {hasActiveDownload && state ? (
          <div className="mt-3 space-y-2">
            <Progress value={state.percent} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{state.percent}% complete</span>
              <Button variant="destructive" size="sm" className="h-8 gap-1.5" onClick={onStop}>
                <StopCircle className="h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </div>
        ) : null}

        {hasHistory && expanded ? (
          <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
            {recentHistory.map((item) => (
              <div key={item.id} className="rounded-xl bg-muted/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.subtitle || "Recent download task"}
                    </p>
                  </div>
                  <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                    {item.status === "completed" ? "Done" : "Interrupted"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {formatNumberWithComma(item.current)} / {formatNumberWithComma(item.total)}
                  </span>
                  <span>{new Date(item.finishedAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
