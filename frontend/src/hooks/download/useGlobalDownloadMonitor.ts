import { useCallback, useEffect, useRef, useState } from "react";

import { resolveDownloadTerminalStatus } from "@/lib/tasks/lifecycle";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  type DownloadSessionResultStatus,
  type DownloadSessionResultSummary,
  type GlobalDownloadHistoryItem,
  type GlobalDownloadSessionMeta,
  type GlobalDownloadState,
  type GlobalDownloadTaskState,
} from "@/types/download";
import { GetDownloadStatus, StopDownload } from "../../../wailsjs/go/main/App";
import { EventsOn } from "../../../wailsjs/runtime/runtime";

const DOWNLOAD_HISTORY_KEY = "twitter_media_download_history";
const MAX_DOWNLOAD_HISTORY = 60;

function getSummaryTotal(summary: DownloadSessionResultSummary | null | undefined) {
  return (summary?.downloaded ?? 0) + (summary?.skipped ?? 0) + (summary?.failed ?? 0);
}

function mergeDownloadFailures(
  current: DownloadSessionResultSummary["failures"] | null | undefined,
  next: DownloadSessionResultSummary["failures"] | null | undefined
) {
  const merged = [...(current ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  return merged.filter((failure) => {
    const key = `${failure.index}:${failure.tweet_id}:${failure.url}:${failure.error}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeDownloadSummary(
  current: DownloadSessionResultSummary | null | undefined,
  next: DownloadSessionResultSummary | null | undefined
): DownloadSessionResultSummary | null {
  if (!current && !next) {
    return null;
  }

  return {
    downloaded: next?.downloaded ?? current?.downloaded,
    skipped: next?.skipped ?? current?.skipped,
    failed: next?.failed ?? current?.failed,
    message: next?.message || current?.message,
    failures: mergeDownloadFailures(current?.failures, next?.failures),
  };
}

function resolveFinalDownloadProgress(
  progress: GlobalDownloadState | null | undefined,
  summary: DownloadSessionResultSummary | null | undefined,
  status: DownloadSessionResultStatus
): GlobalDownloadState | null {
  const summaryTotal = getSummaryTotal(summary);
  if (!progress && summaryTotal <= 0) {
    return null;
  }

  const progressCurrent = progress?.current ?? 0;
  const progressTotal = progress?.total ?? 0;
  const shouldUseSummaryTotal = status !== "cancelled" || !progress;
  const current = shouldUseSummaryTotal
    ? Math.max(progressCurrent, summaryTotal)
    : progressCurrent;
  const total = Math.max(progressTotal, current, summaryTotal);

  return {
    in_progress: false,
    current,
    total,
    percent: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
  };
}

function getFallbackDownloadMeta(): GlobalDownloadSessionMeta {
  return {
    source: "media-list",
    title: "Download Task",
    subtitle: "Background download task",
  };
}

function buildDownloadHistoryItem({
  id,
  meta,
  status,
  progress,
  summary,
}: {
  id: string;
  meta: GlobalDownloadSessionMeta;
  status: DownloadSessionResultStatus;
  progress: GlobalDownloadState | null;
  summary: DownloadSessionResultSummary | null;
}): GlobalDownloadHistoryItem {
  return {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    status,
    current: progress?.current ?? 0,
    total: progress?.total ?? 0,
    finishedAt: Date.now(),
    summary,
  };
}

function loadDownloadHistory(): GlobalDownloadHistoryItem[] {
  try {
    const saved = localStorage.getItem(DOWNLOAD_HISTORY_KEY);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? (parsed as GlobalDownloadHistoryItem[]) : [];
  } catch (error) {
    console.error("Failed to load download history:", error);
    return [];
  }
}

export function useGlobalDownloadMonitor() {
  const [globalDownloadState, setGlobalDownloadState] = useState<GlobalDownloadState | null>(null);
  const [globalDownloadTaskState, setGlobalDownloadTaskState] = useState<GlobalDownloadTaskState>({
    status: null,
    progress: null,
    summary: null,
  });
  const [globalDownloadMeta, setGlobalDownloadMeta] = useState<GlobalDownloadSessionMeta | null>(null);
  const [globalDownloadHistory, setGlobalDownloadHistory] = useState<GlobalDownloadHistoryItem[]>(() =>
    loadDownloadHistory()
  );
  const activeDownloadSessionRef = useRef<{
    id: string;
    meta: GlobalDownloadSessionMeta;
  } | null>(null);
  const lastFinishedDownloadIdRef = useRef<string | null>(null);
  const previousDownloadStateRef = useRef<GlobalDownloadState | null>(null);
  const requestedCancelRef = useRef(false);
  const terminalStatusOverrideRef = useRef<DownloadSessionResultStatus | null>(null);
  const terminalResultSummaryRef = useRef<DownloadSessionResultSummary | null>(null);

  const persistDownloadHistory = useCallback((history: GlobalDownloadHistoryItem[]) => {
    try {
      localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save download history:", error);
    }
  }, []);

  const handleDownloadSessionStart = useCallback((meta: GlobalDownloadSessionMeta) => {
    const sessionId = crypto.randomUUID();
    setGlobalDownloadMeta(meta);
    activeDownloadSessionRef.current = {
      id: sessionId,
      meta,
    };
    requestedCancelRef.current = false;
    terminalStatusOverrideRef.current = null;
    terminalResultSummaryRef.current = null;
    setGlobalDownloadTaskState((previous) => ({
      status: "running",
      progress: previous.status === "running" ? previous.progress : null,
      summary: null,
    }));
  }, []);

  const upsertDownloadHistoryItem = useCallback(
    (item: GlobalDownloadHistoryItem) => {
      setGlobalDownloadHistory((previousHistory) => {
        const existing = previousHistory.find((historyItem) => historyItem.id === item.id);
        const status =
          existing?.status === "cancelled" && item.status !== "cancelled"
            ? existing.status
            : item.status;
        const summary = mergeDownloadSummary(existing?.summary, item.summary);
        const merged = existing
          ? {
              ...existing,
              ...item,
              status,
              summary,
            }
          : {
              ...item,
              status,
              summary,
            };
        const next = [
          merged,
          ...previousHistory.filter((historyItem) => historyItem.id !== item.id),
        ].slice(0, MAX_DOWNLOAD_HISTORY);
        persistDownloadHistory(next);
        return next;
      });
    },
    [persistDownloadHistory]
  );

  const patchDownloadHistoryStatus = useCallback(
    (
      sessionId: string | null,
      status: DownloadSessionResultStatus,
      summary?: DownloadSessionResultSummary | null
    ) => {
      if (!sessionId) {
        return;
      }

      setGlobalDownloadHistory((previousHistory) => {
        const next = previousHistory.map((item) => {
          if (item.id !== sessionId) {
            return item;
          }
          if (item.status === "cancelled" && status !== "cancelled") {
            return {
              ...item,
              summary: mergeDownloadSummary(item.summary, summary),
            };
          }
          return {
            ...item,
            status,
            summary: mergeDownloadSummary(item.summary, summary),
          };
        });
        persistDownloadHistory(next);
        return next;
      });
      setGlobalDownloadTaskState((previous) =>
        previous.status === "cancelled" && status !== "cancelled"
          ? {
              ...previous,
              summary: mergeDownloadSummary(previous.summary, summary),
            }
          : {
              ...previous,
              status,
              summary: mergeDownloadSummary(previous.summary, summary),
            }
      );
    },
    [persistDownloadHistory]
  );

  const handleDownloadSessionFinish = useCallback(
    (
      status: DownloadSessionResultStatus = "completed",
      summary?: DownloadSessionResultSummary
    ) => {
      const activeSession = activeDownloadSessionRef.current;
      const mergedSummary = mergeDownloadSummary(terminalResultSummaryRef.current, summary);
      terminalStatusOverrideRef.current = status;
      terminalResultSummaryRef.current = mergedSummary;

      const latestProgress = previousDownloadStateRef.current?.in_progress
        ? previousDownloadStateRef.current
        : globalDownloadTaskState.progress;
      const summaryTotal = getSummaryTotal(mergedSummary);
      const terminalStatus = resolveDownloadTerminalStatus({
        requestedCancel: requestedCancelRef.current,
        current: latestProgress?.current ?? summaryTotal,
        total: latestProgress?.total ?? summaryTotal,
        override: status,
      });

      if (!activeSession) {
        if (lastFinishedDownloadIdRef.current) {
          patchDownloadHistoryStatus(lastFinishedDownloadIdRef.current, terminalStatus, mergedSummary);
        } else {
          setGlobalDownloadTaskState((previous) => ({
            ...previous,
            status: terminalStatus,
            progress: resolveFinalDownloadProgress(previous.progress, mergedSummary, terminalStatus),
            summary: mergedSummary,
          }));
        }
        return;
      }

      const finalProgress = resolveFinalDownloadProgress(
        latestProgress,
        mergedSummary,
        terminalStatus
      );

      lastFinishedDownloadIdRef.current = activeSession.id;
      upsertDownloadHistoryItem(
        buildDownloadHistoryItem({
          id: activeSession.id,
          meta: activeSession.meta,
          status: terminalStatus,
          progress: finalProgress,
          summary: mergedSummary,
        })
      );
      setGlobalDownloadTaskState({
        status: terminalStatus,
        progress: finalProgress,
        summary: mergedSummary,
      });
      setGlobalDownloadState(null);
      activeDownloadSessionRef.current = null;
      previousDownloadStateRef.current = finalProgress;
      requestedCancelRef.current = false;
      terminalStatusOverrideRef.current = null;
      terminalResultSummaryRef.current = null;
      setGlobalDownloadMeta(null);
    },
    [globalDownloadTaskState.progress, patchDownloadHistoryStatus, upsertDownloadHistoryItem]
  );

  const handleDownloadSessionFail = useCallback((summary?: DownloadSessionResultSummary) => {
    handleDownloadSessionFinish("failed", summary);
  }, [handleDownloadSessionFinish]);

  const handleGlobalStopDownload = useCallback(async () => {
    if (!globalDownloadState?.in_progress) {
      return;
    }

    requestedCancelRef.current = true;
    setGlobalDownloadTaskState((previous) => ({
      ...previous,
      status: "cancelling",
    }));

    try {
      const stopped = await StopDownload();
      if (stopped) {
        toast.info("Download stopping...");
      } else {
        requestedCancelRef.current = false;
        setGlobalDownloadTaskState((previous) => ({
          ...previous,
          status: "running",
        }));
      }
    } catch (error) {
      console.error("Failed to stop download:", error);
      requestedCancelRef.current = false;
      setGlobalDownloadTaskState((previous) => ({
        ...previous,
        status: "running",
      }));
    }
  }, [globalDownloadState?.in_progress]);

  useEffect(() => {
    const syncDownloadState = (state: GlobalDownloadState) => {
      const previousState = previousDownloadStateRef.current;

      if (state.in_progress) {
        setGlobalDownloadState(state);
        setGlobalDownloadTaskState({
          status: requestedCancelRef.current ? "cancelling" : "running",
          progress: state,
          summary: null,
        });
        previousDownloadStateRef.current = state;
        return;
      }

      if (previousState?.in_progress) {
        const activeSession = activeDownloadSessionRef.current;
        const meta = activeSession?.meta || getFallbackDownloadMeta();
        const summary = terminalResultSummaryRef.current;
        const terminalStatus = resolveDownloadTerminalStatus({
          requestedCancel: requestedCancelRef.current,
          current: previousState.current,
          total: previousState.total,
          override: terminalStatusOverrideRef.current,
        });
        const finalProgress = resolveFinalDownloadProgress(
          previousState,
          summary,
          terminalStatus
        );
        const historyId = activeSession?.id || crypto.randomUUID();

        lastFinishedDownloadIdRef.current = historyId;

        upsertDownloadHistoryItem(
          buildDownloadHistoryItem({
            id: historyId,
            meta,
            status: terminalStatus,
            progress: finalProgress,
            summary,
          })
        );
        setGlobalDownloadTaskState({
          status: terminalStatus,
          progress: finalProgress,
          summary,
        });
        previousDownloadStateRef.current = finalProgress;
      } else {
        previousDownloadStateRef.current = state;
      }

      setGlobalDownloadState(null);
      activeDownloadSessionRef.current = null;
      requestedCancelRef.current = false;
      terminalStatusOverrideRef.current = null;
      terminalResultSummaryRef.current = null;
      setGlobalDownloadMeta(null);
    };

    GetDownloadStatus()
      .then(syncDownloadState)
      .catch((error) => {
        console.error("Failed to load global download status:", error);
      });

    const unsubscribe = EventsOn("download-state", (state: GlobalDownloadState) => {
      syncDownloadState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [upsertDownloadHistoryItem]);

  const removeDownloadHistory = useCallback(
    (id: string) => {
      setGlobalDownloadHistory((previousHistory) => {
        const next = previousHistory.filter((item) => item.id !== id);
        persistDownloadHistory(next);
        return next;
      });
    },
    [persistDownloadHistory]
  );

  const clearDownloadHistory = useCallback(() => {
    setGlobalDownloadHistory([]);
    persistDownloadHistory([]);
  }, [persistDownloadHistory]);

  return {
    globalDownloadState,
    globalDownloadTaskState,
    globalDownloadMeta,
    globalDownloadHistory,
    removeDownloadHistory,
    clearDownloadHistory,
    handleDownloadSessionStart,
    handleDownloadSessionFinish,
    handleDownloadSessionFail,
    handleGlobalStopDownload,
  };
}
