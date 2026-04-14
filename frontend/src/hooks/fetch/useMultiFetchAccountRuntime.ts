import { startTransition, useCallback, useEffect, useRef } from "react";

import type { MultipleAccount } from "@/types/fetch";
import { CancelExtractorRequest } from "../../../wailsjs/go/main/App";

const MULTIPLE_PROGRESS_FLUSH_INTERVAL = 2000;
const DIFF_VISIBILITY_MS = 1000;

interface UseMultiFetchAccountRuntimeOptions {
  setMultipleAccountsState: (
    value:
      | MultipleAccount[]
      | ((previous: MultipleAccount[]) => MultipleAccount[])
  ) => void;
}

export function useMultiFetchAccountRuntime({
  setMultipleAccountsState,
}: UseMultiFetchAccountRuntimeOptions) {
  const stopAllRef = useRef(false);
  const accountStartTimesRef = useRef<Map<string, number>>(new Map());
  const accountStopFlagsRef = useRef<Map<string, boolean>>(new Map());
  const accountMediaCountRef = useRef<Map<string, number>>(new Map());
  const accountTimeoutSecondsRef = useRef<Map<string, number>>(new Map());
  const pendingAccountUpdatesRef = useRef<Map<string, Partial<MultipleAccount>>>(new Map());
  const diffVisibilityRef = useRef<Map<string, number>>(new Map());
  const activeAccountRequestIdsRef = useRef<Map<string, string>>(new Map());

  const clearRuntimeRefs = useCallback(() => {
    stopAllRef.current = true;
    accountStartTimesRef.current.clear();
    accountTimeoutSecondsRef.current.clear();
    accountStopFlagsRef.current.clear();
    accountMediaCountRef.current.clear();
    pendingAccountUpdatesRef.current.clear();
    diffVisibilityRef.current.clear();
    activeAccountRequestIdsRef.current.clear();
  }, []);

  const resetRuntimeRefs = useCallback(() => {
    stopAllRef.current = false;
    accountStartTimesRef.current.clear();
    accountTimeoutSecondsRef.current.clear();
    accountStopFlagsRef.current.clear();
    accountMediaCountRef.current.clear();
    pendingAccountUpdatesRef.current.clear();
    diffVisibilityRef.current.clear();
    activeAccountRequestIdsRef.current.clear();
  }, []);

  const queueMultipleAccountUpdate = useCallback(
    (accountId: string, patch: Partial<MultipleAccount>) => {
      const existing = pendingAccountUpdatesRef.current.get(accountId) || {};
      pendingAccountUpdatesRef.current.set(accountId, {
        ...existing,
        ...patch,
      });
    },
    []
  );

  const flushMultipleAccountUpdates = useCallback(() => {
    if (pendingAccountUpdatesRef.current.size === 0) {
      return;
    }

    const queuedUpdates = new Map(pendingAccountUpdatesRef.current);
    pendingAccountUpdatesRef.current.clear();

    startTransition(() => {
      setMultipleAccountsState((previous) =>
        previous.map((account) => {
          const patch = queuedUpdates.get(account.id);
          return patch ? { ...account, ...patch } : account;
        })
      );
    });
  }, [setMultipleAccountsState]);

  const clearAccountRuntimeState = useCallback(
    (accountId: string) => {
      accountStartTimesRef.current.delete(accountId);
      accountTimeoutSecondsRef.current.delete(accountId);
      diffVisibilityRef.current.delete(accountId);
      queueMultipleAccountUpdate(accountId, { showDiff: false });
    },
    [queueMultipleAccountUpdate]
  );

  const markAccountDiffVisible = useCallback(
    (accountId: string) => {
      diffVisibilityRef.current.set(accountId, Date.now() + DIFF_VISIBILITY_MS);
      queueMultipleAccountUpdate(accountId, { showDiff: true });
    },
    [queueMultipleAccountUpdate]
  );

  const cancelAccountActiveRequest = useCallback(async (accountId: string) => {
    const requestId = activeAccountRequestIdsRef.current.get(accountId);
    if (!requestId) {
      return false;
    }

    activeAccountRequestIdsRef.current.delete(accountId);

    try {
      return await CancelExtractorRequest(requestId);
    } catch {
      return false;
    }
  }, []);

  const cancelAllActiveAccountRequests = useCallback(async () => {
    const requestIds = Array.from(activeAccountRequestIdsRef.current.values());
    activeAccountRequestIdsRef.current.clear();

    if (requestIds.length === 0) {
      return;
    }

    await Promise.all(
      requestIds.map((requestId) =>
        CancelExtractorRequest(requestId).catch(() => false)
      )
    );
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      const timedOutAccountIds: string[] = [];

      for (const [accountId, expiresAt] of diffVisibilityRef.current.entries()) {
        if (now >= expiresAt) {
          diffVisibilityRef.current.delete(accountId);
          queueMultipleAccountUpdate(accountId, { showDiff: false });
        }
      }

      for (const [accountId, startTime] of accountStartTimesRef.current.entries()) {
        const timeoutSeconds = accountTimeoutSecondsRef.current.get(accountId);
        if (!timeoutSeconds) {
          continue;
        }

        const elapsed = Math.floor((now - startTime) / 1000);
        const remaining = Math.max(0, timeoutSeconds - elapsed);
        queueMultipleAccountUpdate(accountId, {
          elapsedTime: elapsed,
          remainingTime: remaining,
        });

        if (remaining <= 0) {
          accountStopFlagsRef.current.set(accountId, true);
          timedOutAccountIds.push(accountId);
          clearAccountRuntimeState(accountId);

          const mediaCount = accountMediaCountRef.current.get(accountId) || 0;
          queueMultipleAccountUpdate(accountId, {
            status: mediaCount === 0 ? "failed" : "incomplete",
            remainingTime: 0,
            mediaCount,
          });
        }
      }

      flushMultipleAccountUpdates();

      if (timedOutAccountIds.length > 0) {
        Promise.all(
          timedOutAccountIds.map((accountId) =>
            cancelAccountActiveRequest(accountId)
          )
        ).catch(() => {});
      }
    }, MULTIPLE_PROGRESS_FLUSH_INTERVAL);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    cancelAccountActiveRequest,
    clearAccountRuntimeState,
    flushMultipleAccountUpdates,
    queueMultipleAccountUpdate,
  ]);

  return {
    stopAllRef,
    accountStartTimesRef,
    accountStopFlagsRef,
    accountMediaCountRef,
    accountTimeoutSecondsRef,
    diffVisibilityRef,
    activeAccountRequestIdsRef,
    clearRuntimeRefs,
    resetRuntimeRefs,
    queueMultipleAccountUpdate,
    flushMultipleAccountUpdates,
    clearAccountRuntimeState,
    markAccountDiffVisible,
    cancelAccountActiveRequest,
    cancelAllActiveAccountRequests,
  };
}
