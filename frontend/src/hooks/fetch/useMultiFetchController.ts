import { useCallback, useRef, useState } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { runMultiFetchQueue } from "@/lib/fetch/runMultiFetchQueue";
import { useMultiFetchRuntime } from "@/hooks/fetch/useMultiFetchRuntime";
import type {
  FetchMode,
  MultipleAccount,
  MultiFetchSessionSource,
  PrivateType,
} from "@/types/fetch";

const BATCH_SIZE = 200;
const MULTIPLE_FETCH_CONCURRENCY = 2;

export interface MultiFetchOptions {
  mode?: FetchMode;
  privateType?: PrivateType;
  mediaType?: string;
  retweets?: boolean;
  authToken?: string;
}

export interface MultiFetchSessionMeta {
  source: MultiFetchSessionSource;
  title: string;
}

export function useMultiFetchController() {
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const currentQueuePromiseRef = useRef<Promise<void> | null>(null);
  const {
    activeSession,
    recentSessions,
    setMultipleAccountsState,
    stopAllRef,
    accountStartTimesRef,
    accountStopFlagsRef,
    accountMediaCountRef,
    accountTimeoutSecondsRef,
    activeSessionRef,
    diffVisibilityRef,
    activeAccountRequestIdsRef,
    resetRuntimeState,
    replaceActiveSession,
    removeCurrentSession,
    removeRecentSession,
    clearRecentSessions,
    setActiveSessionStatus,
    queueMultipleAccountUpdate,
    flushMultipleAccountUpdates,
    clearAccountRuntimeState,
    markAccountDiffVisible,
    cancelAllActiveAccountRequests,
  } = useMultiFetchRuntime();

  const resetMultipleQueueState = useCallback(() => {
    setIsFetchingAll(false);
    currentQueuePromiseRef.current = null;
    resetRuntimeState();
  }, [resetRuntimeState]);

  const stopCurrentQueueForReplacement = useCallback(async () => {
    if (!isFetchingAll) {
      return;
    }

    stopAllRef.current = true;
    setIsFetchingAll(false);
    setActiveSessionStatus("cancelling");
    await cancelAllActiveAccountRequests();
    try {
      await currentQueuePromiseRef.current;
    } catch {
      // The outgoing session is being replaced anyway.
    } finally {
      currentQueuePromiseRef.current = null;
    }
  }, [cancelAllActiveAccountRequests, isFetchingAll, setActiveSessionStatus, stopAllRef]);

  const createPendingSession = useCallback(
    (
      accounts: MultipleAccount[],
      meta: MultiFetchSessionMeta
    ) => {
      if (isFetchingAll) {
        return stopCurrentQueueForReplacement().then(() =>
          replaceActiveSession(accounts, meta, "ready")
        );
      }
      return Promise.resolve(replaceActiveSession(accounts, meta, "ready"));
    },
    [isFetchingAll, replaceActiveSession, stopCurrentQueueForReplacement]
  );

  const handleFetchAll = useCallback(
    async (
      accountsOverride?: MultipleAccount[],
      options?: MultiFetchOptions,
      sessionMeta?: MultiFetchSessionMeta
    ) => {
      const requestedAccounts = accountsOverride ?? activeSessionRef.current?.accounts ?? [];
      if (requestedAccounts.length === 0) {
        toast.error("No accounts to fetch");
        return;
      }

      const queueMode = options?.mode ?? "public";
      const queuePrivateType = options?.privateType ?? "bookmarks";
      const queueMediaType = options?.mediaType ?? "all";
      const queueRetweets = options?.retweets ?? false;
      const resolvedAuthToken = options?.authToken ?? "";

      if (queueMode === "private" && queuePrivateType === "bookmarks") {
        toast.error("Bookmarks only support one account at a time");
        return;
      }

      if (queueMode === "private" && !resolvedAuthToken.trim()) {
        toast.error("Please enter your auth token");
        return;
      }

      if (isFetchingAll) {
        await stopCurrentQueueForReplacement();
        toast.info("Stopped current queue and started a new session");
      }

      const session =
        replaceActiveSession(
          requestedAccounts,
          sessionMeta ?? {
            source: "manual-fetch",
            title: `Fetching ${requestedAccounts.length} Accounts`,
          },
          "running"
        );

      setIsFetchingAll(true);
      stopAllRef.current = false;
      activeAccountRequestIdsRef.current.clear();

      const timeoutSeconds = getSettings().fetchTimeout || 60;
      const fetchSettings = getSettings();
      const isSingleModeMultiple = fetchSettings.fetchMode === "single";
      const batchSizeMultiple = isSingleModeMultiple ? 0 : BATCH_SIZE;

      let runPromise: Promise<void> | null = null;
      runPromise = (async () => {
        try {
          const { completed } = await runMultiFetchQueue({
            requestedAccounts,
            queueMode,
            queuePrivateType,
            queueMediaType,
            queueRetweets,
            timeoutSeconds,
            resolvedAuthToken,
            batchSize: batchSizeMultiple,
            concurrency: MULTIPLE_FETCH_CONCURRENCY,
            stopAllRef,
            accountStartTimesRef,
            accountStopFlagsRef,
            accountMediaCountRef,
            accountTimeoutSecondsRef,
            activeAccountRequestIdsRef,
            setMultipleAccountsState,
            queueMultipleAccountUpdate,
            flushMultipleAccountUpdates,
            clearAccountRuntimeState,
            markAccountDiffVisible,
          });

          if (activeSessionRef.current?.id !== session.id) {
            return;
          }

          if (!completed) {
            setActiveSessionStatus("cancelled");
            return;
          }

          const latestAccounts = activeSessionRef.current?.accounts ?? [];
          const hasIssues = latestAccounts.some(
            (account) =>
              account.status === "failed" || account.status === "incomplete"
          );
          setActiveSessionStatus(hasIssues ? "failed" : "completed");
          if (hasIssues) {
            toast.warning("Queue finished with some accounts needing review");
          } else {
            toast.success("All accounts fetched");
          }
        } catch (error) {
          if (activeSessionRef.current?.id === session.id) {
            setActiveSessionStatus("failed");
          }
          const message = error instanceof Error ? error.message : String(error);
          toast.error(message || "Queue failed");
        } finally {
          if (activeSessionRef.current?.id === session.id) {
            setIsFetchingAll(false);
            activeAccountRequestIdsRef.current.clear();
          }
          if (currentQueuePromiseRef.current === runPromise) {
            currentQueuePromiseRef.current = null;
          }
        }
      })();

      currentQueuePromiseRef.current = runPromise;
      await runPromise;
    },
    [
      accountMediaCountRef,
      accountStartTimesRef,
      accountStopFlagsRef,
      accountTimeoutSecondsRef,
      activeAccountRequestIdsRef,
      activeSessionRef,
      clearAccountRuntimeState,
      flushMultipleAccountUpdates,
      isFetchingAll,
      markAccountDiffVisible,
      queueMultipleAccountUpdate,
      replaceActiveSession,
      setActiveSessionStatus,
      setMultipleAccountsState,
      stopAllRef,
      stopCurrentQueueForReplacement,
    ]
  );

  const handleStopAll = useCallback(() => {
    stopAllRef.current = true;
    setIsFetchingAll(false);
    setActiveSessionStatus("cancelling");

    accountStartTimesRef.current.clear();
    accountTimeoutSecondsRef.current.clear();
    diffVisibilityRef.current.clear();

    setMultipleAccountsState((prev) =>
      prev.map((acc) => {
        if (acc.status === "fetching") {
          const mediaCount = accountMediaCountRef.current.get(acc.id) || acc.mediaCount || 0;
          const status = mediaCount === 0 ? ("failed" as const) : ("incomplete" as const);
          return { ...acc, status, mediaCount, showDiff: false };
        }
        return acc;
      })
    );

    void cancelAllActiveAccountRequests();
    toast.info("Stopped all fetches");
  }, [
    accountMediaCountRef,
    accountStartTimesRef,
    accountTimeoutSecondsRef,
    cancelAllActiveAccountRequests,
    diffVisibilityRef,
    setActiveSessionStatus,
    setMultipleAccountsState,
    stopAllRef,
  ]);

  return {
    activeSession,
    recentSessions,
    isFetchingAll,
    setMultipleAccountsState,
    createPendingSession,
    resetMultipleQueueState,
    handleFetchAll,
    handleStopAll,
    removeCurrentSession,
    removeRecentSession,
    clearRecentSessions,
  };
}
