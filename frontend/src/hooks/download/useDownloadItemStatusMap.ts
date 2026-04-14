import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { EventsOn } from "../../../wailsjs/runtime/runtime";

export interface DownloadItemStatusEvent {
  tweet_id: number;
  index: number;
  status: "success" | "failed" | "skipped";
}

interface PendingItemStatuses {
  downloaded: Set<string>;
  failed: Set<string>;
  skipped: Set<string>;
}

interface UseDownloadItemStatusMapOptions {
  flushMs?: number;
  resetKey?: string;
}

export function useDownloadItemStatusMap(options: UseDownloadItemStatusMapOptions = {}) {
  const { flushMs = 60, resetKey } = options;
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);
  const [downloadedItems, setDownloadedItems] = useState<Set<string>>(new Set());
  const [failedItems, setFailedItems] = useState<Set<string>>(new Set());
  const [skippedItems, setSkippedItems] = useState<Set<string>>(new Set());

  const currentDownloadingItemKeyRef = useRef<string | null>(null);
  const bulkDownloadKeyMapRef = useRef<Map<number, string>>(new Map());
  const pendingItemStatusesRef = useRef<PendingItemStatuses>({
    downloaded: new Set(),
    failed: new Set(),
    skipped: new Set(),
  });
  const flushItemStatusesTimerRef = useRef<number | null>(null);

  const flushPendingItemStatuses = useCallback(() => {
    flushItemStatusesTimerRef.current = null;

    const pending = pendingItemStatusesRef.current;
    if (
      pending.downloaded.size === 0 &&
      pending.failed.size === 0 &&
      pending.skipped.size === 0
    ) {
      return;
    }

    pendingItemStatusesRef.current = {
      downloaded: new Set(),
      failed: new Set(),
      skipped: new Set(),
    };

    const downloaded = Array.from(pending.downloaded);
    const failed = Array.from(pending.failed);
    const skipped = Array.from(pending.skipped);

    startTransition(() => {
      if (downloaded.length > 0) {
        setDownloadedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of downloaded) {
            next.add(itemKey);
          }
          return next;
        });
        setFailedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of downloaded) {
            next.delete(itemKey);
          }
          return next;
        });
        setSkippedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of downloaded) {
            next.delete(itemKey);
          }
          return next;
        });
      }

      if (failed.length > 0) {
        setFailedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of failed) {
            next.add(itemKey);
          }
          return next;
        });
        setDownloadedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of failed) {
            next.delete(itemKey);
          }
          return next;
        });
        setSkippedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of failed) {
            next.delete(itemKey);
          }
          return next;
        });
      }

      if (skipped.length > 0) {
        setSkippedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of skipped) {
            next.add(itemKey);
          }
          return next;
        });
        setDownloadedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of skipped) {
            next.delete(itemKey);
          }
          return next;
        });
        setFailedItems((prev) => {
          const next = new Set(prev);
          for (const itemKey of skipped) {
            next.delete(itemKey);
          }
          return next;
        });
      }
    });
  }, []);

  const schedulePendingItemStatusFlush = useCallback(() => {
    if (flushItemStatusesTimerRef.current !== null) {
      return;
    }

    if (flushMs <= 0) {
      flushPendingItemStatuses();
      return;
    }

    flushItemStatusesTimerRef.current = window.setTimeout(() => {
      flushPendingItemStatuses();
    }, flushMs);
  }, [flushMs, flushPendingItemStatuses]);

  const beginSingleDownload = useCallback((itemKey: string) => {
    setDownloadingItem(itemKey);
    currentDownloadingItemKeyRef.current = itemKey;
  }, []);

  const endSingleDownload = useCallback((clearDelayMs = 200) => {
    setDownloadingItem(null);
    window.setTimeout(() => {
      currentDownloadingItemKeyRef.current = null;
    }, clearDelayMs);
  }, []);

  const beginBulkDownload = useCallback((itemKeys: string[]) => {
    bulkDownloadKeyMapRef.current = new Map(itemKeys.map((itemKey, index) => [index, itemKey]));
  }, []);

  const clearBulkDownload = useCallback(() => {
    bulkDownloadKeyMapRef.current = new Map();
  }, []);

  const resetStatuses = useCallback(() => {
    setDownloadingItem(null);
    setDownloadedItems(new Set());
    setFailedItems(new Set());
    setSkippedItems(new Set());
    currentDownloadingItemKeyRef.current = null;
    bulkDownloadKeyMapRef.current = new Map();
    pendingItemStatusesRef.current = {
      downloaded: new Set(),
      failed: new Set(),
      skipped: new Set(),
    };
    if (flushItemStatusesTimerRef.current !== null) {
      window.clearTimeout(flushItemStatusesTimerRef.current);
      flushItemStatusesTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = EventsOn("download-item-status", (status: DownloadItemStatusEvent) => {
      const currentKey = currentDownloadingItemKeyRef.current;
      const bulkKey = bulkDownloadKeyMapRef.current.get(status.index);
      const itemKey = currentKey || bulkKey;
      if (!itemKey) {
        return;
      }

      if (status.status === "success") {
        pendingItemStatusesRef.current.downloaded.add(itemKey);
        pendingItemStatusesRef.current.failed.delete(itemKey);
        pendingItemStatusesRef.current.skipped.delete(itemKey);
      } else if (status.status === "failed") {
        pendingItemStatusesRef.current.failed.add(itemKey);
        pendingItemStatusesRef.current.downloaded.delete(itemKey);
        pendingItemStatusesRef.current.skipped.delete(itemKey);
      } else if (status.status === "skipped") {
        pendingItemStatusesRef.current.skipped.add(itemKey);
        pendingItemStatusesRef.current.downloaded.delete(itemKey);
        pendingItemStatusesRef.current.failed.delete(itemKey);
      }
      schedulePendingItemStatusFlush();
    });

    return () => {
      if (flushItemStatusesTimerRef.current !== null) {
        window.clearTimeout(flushItemStatusesTimerRef.current);
        flushItemStatusesTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [schedulePendingItemStatusFlush]);

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      resetStatuses();
    }, 0);

    return () => {
      window.clearTimeout(resetTimer);
    };
  }, [resetKey, resetStatuses]);

  return {
    downloadingItem,
    downloadedItems,
    failedItems,
    skippedItems,
    beginSingleDownload,
    endSingleDownload,
    beginBulkDownload,
    clearBulkDownload,
    resetStatuses,
  };
}
