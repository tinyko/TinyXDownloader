import { useCallback, useEffect, useRef, useState } from "react";

import { resolveDownloadTerminalStatus } from "@/lib/tasks/lifecycle";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  type DownloadSessionResultStatus,
  type GlobalDownloadHistoryItem,
  type GlobalDownloadSessionMeta,
  type GlobalDownloadState,
  type GlobalDownloadTaskState,
} from "@/types/download";
import { GetDownloadStatus, StopDownload } from "../../../wailsjs/go/main/App";
import { EventsOn } from "../../../wailsjs/runtime/runtime";

const DOWNLOAD_HISTORY_KEY = "twitter_media_download_history";
const MAX_DOWNLOAD_HISTORY = 60;

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
    setGlobalDownloadTaskState((previous) => ({
      status: "running",
      progress: previous.status === "running" ? previous.progress : null,
    }));
  }, []);

  const patchDownloadHistoryStatus = useCallback(
    (sessionId: string | null, status: DownloadSessionResultStatus) => {
      if (!sessionId) {
        return;
      }

      setGlobalDownloadHistory((previousHistory) =>
        {
          const next = previousHistory.map((item) => {
          if (item.id !== sessionId) {
            return item;
          }
          if (item.status === "cancelled" && status !== "cancelled") {
            return item;
          }
          return {
            ...item,
            status,
          };
        });
          persistDownloadHistory(next);
          return next;
        }
      );
      setGlobalDownloadTaskState((previous) =>
        previous.status === "cancelled" && status !== "cancelled"
          ? previous
          : {
              ...previous,
              status,
            }
      );
    },
    [persistDownloadHistory]
  );

  const handleDownloadSessionFinish = useCallback(
    (status: DownloadSessionResultStatus = "completed") => {
      const activeSessionId = activeDownloadSessionRef.current?.id;
      if (activeSessionId) {
        terminalStatusOverrideRef.current = status;
        return;
      }

      patchDownloadHistoryStatus(lastFinishedDownloadIdRef.current, status);
    },
    [patchDownloadHistoryStatus]
  );

  const handleDownloadSessionFail = useCallback(() => {
    handleDownloadSessionFinish("failed");
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
        });
        previousDownloadStateRef.current = state;
        return;
      }

      if (previousState?.in_progress) {
        const activeSession = activeDownloadSessionRef.current;
        const meta = activeSession?.meta || {
          source: "media-list" as const,
          title: "Downloading media",
          subtitle: "Background download task",
        };
        const terminalStatus = resolveDownloadTerminalStatus({
          requestedCancel: requestedCancelRef.current,
          current: previousState.current,
          total: previousState.total,
          override: terminalStatusOverrideRef.current,
        });
        const historyId = activeSession?.id || crypto.randomUUID();

        lastFinishedDownloadIdRef.current = historyId;

        setGlobalDownloadHistory((previousHistory) => {
          const next = [
            {
              id: historyId,
              title: meta.title,
              subtitle: meta.subtitle,
              status: terminalStatus,
              current: previousState.current,
              total: previousState.total,
              finishedAt: Date.now(),
            },
            ...previousHistory,
          ].slice(0, MAX_DOWNLOAD_HISTORY);
          persistDownloadHistory(next);
          return next;
        });
        setGlobalDownloadTaskState({
          status: terminalStatus,
          progress: previousState,
        });
      }

      setGlobalDownloadState(null);
      activeDownloadSessionRef.current = null;
      previousDownloadStateRef.current = state;
      requestedCancelRef.current = false;
      terminalStatusOverrideRef.current = null;
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
  }, [persistDownloadHistory]);

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
