import { useCallback, useEffect, useRef, useState } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import {
  type GlobalDownloadHistoryItem,
  type GlobalDownloadSessionMeta,
  type GlobalDownloadState,
} from "@/types/download";
import { GetDownloadStatus, StopDownload } from "../../../wailsjs/go/main/App";
import { EventsOn } from "../../../wailsjs/runtime/runtime";

export function useGlobalDownloadMonitor() {
  const [globalDownloadState, setGlobalDownloadState] = useState<GlobalDownloadState | null>(null);
  const [globalDownloadMeta, setGlobalDownloadMeta] = useState<GlobalDownloadSessionMeta | null>(null);
  const [globalDownloadHistory, setGlobalDownloadHistory] = useState<GlobalDownloadHistoryItem[]>([]);
  const activeDownloadMetaRef = useRef<GlobalDownloadSessionMeta | null>(null);
  const previousDownloadStateRef = useRef<GlobalDownloadState | null>(null);

  const handleDownloadSessionStart = useCallback((meta: GlobalDownloadSessionMeta) => {
    setGlobalDownloadMeta(meta);
    activeDownloadMetaRef.current = meta;
  }, []);

  const handleGlobalStopDownload = useCallback(async () => {
    try {
      const stopped = await StopDownload();
      if (stopped) {
        toast.info("Download stopped");
      }
    } catch (error) {
      console.error("Failed to stop download:", error);
    }
  }, []);

  useEffect(() => {
    const syncDownloadState = (state: GlobalDownloadState) => {
      const previousState = previousDownloadStateRef.current;

      if (state.in_progress) {
        setGlobalDownloadState(state);
        previousDownloadStateRef.current = state;
        return;
      }

      if (previousState?.in_progress) {
        const meta = activeDownloadMetaRef.current || {
          source: "media-list" as const,
          title: "Downloading media",
          subtitle: "Background download task",
        };

        setGlobalDownloadHistory((previousHistory) => [
          {
            id: crypto.randomUUID(),
            title: meta.title,
            subtitle: meta.subtitle,
            status: previousState.current >= previousState.total
              ? ("completed" as const)
              : ("interrupted" as const),
            current: previousState.current,
            total: previousState.total,
            finishedAt: Date.now(),
          },
          ...previousHistory,
        ].slice(0, 6));
      }

      setGlobalDownloadState(null);
      activeDownloadMetaRef.current = null;
      previousDownloadStateRef.current = state;
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
  }, []);

  return {
    globalDownloadState,
    globalDownloadMeta,
    globalDownloadHistory,
    handleDownloadSessionStart,
    handleGlobalStopDownload,
  };
}
