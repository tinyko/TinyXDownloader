import { useCallback, useState } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { runMultiFetchQueue } from "@/lib/fetch/runMultiFetchQueue";
import { useMultiFetchRuntime } from "@/hooks/fetch/useMultiFetchRuntime";
import type { FetchMode, MultipleAccount, PrivateType } from "@/types/fetch";

const BATCH_SIZE = 200;
const MULTIPLE_FETCH_CONCURRENCY = 2;

export interface MultiFetchOptions {
  mode?: FetchMode;
  privateType?: PrivateType;
  mediaType?: string;
  retweets?: boolean;
  authToken?: string;
}

export function useMultiFetchController() {
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const {
    multipleAccounts,
    setMultipleAccountsState,
    stopAllRef,
    accountStartTimesRef,
    accountStopFlagsRef,
    accountMediaCountRef,
    accountTimeoutSecondsRef,
    multipleAccountsRef,
    diffVisibilityRef,
    activeAccountRequestIdsRef,
    resetRuntimeState,
    queueMultipleAccountUpdate,
    flushMultipleAccountUpdates,
    clearAccountRuntimeState,
    markAccountDiffVisible,
    cancelAllActiveAccountRequests,
  } = useMultiFetchRuntime();

  const resetMultipleQueueState = useCallback(() => {
    setIsFetchingAll(false);
    resetRuntimeState();
  }, [resetRuntimeState]);

  const handleFetchAll = useCallback(
    async (
      accountsOverride?: MultipleAccount[],
      options?: MultiFetchOptions
    ) => {
      const requestedAccounts = accountsOverride ?? multipleAccountsRef.current;
      if (requestedAccounts.length === 0) {
        toast.error("No accounts to fetch");
        return;
      }

      if (isFetchingAll) {
        toast.warning("A queue is already in progress");
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

      if (!resolvedAuthToken.trim()) {
        toast.error("Please enter your auth token");
        return;
      }

      setIsFetchingAll(true);
      stopAllRef.current = false;
      activeAccountRequestIdsRef.current.clear();

      const timeoutSeconds = getSettings().fetchTimeout || 60;
      const fetchSettings = getSettings();
      const isSingleModeMultiple = fetchSettings.fetchMode === "single";
      const batchSizeMultiple = isSingleModeMultiple ? 0 : BATCH_SIZE;
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

      setIsFetchingAll(false);
      activeAccountRequestIdsRef.current.clear();
      if (completed) {
        toast.success("All accounts fetched");
      }
    },
    [
      clearAccountRuntimeState,
      flushMultipleAccountUpdates,
      isFetchingAll,
      markAccountDiffVisible,
      queueMultipleAccountUpdate,
      setMultipleAccountsState,
    ]
  );

  const handleStopAll = useCallback(() => {
    stopAllRef.current = true;
    setIsFetchingAll(false);

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
  }, [cancelAllActiveAccountRequests, setMultipleAccountsState]);

  return {
    multipleAccounts,
    isFetchingAll,
    setMultipleAccountsState,
    resetMultipleQueueState,
    handleFetchAll,
    handleStopAll,
  };
}
