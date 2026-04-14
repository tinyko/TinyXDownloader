import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type {
  MultiFetchSession,
  MultiFetchSessionSource,
  MultiFetchSessionStatus,
  MultiFetchSessionSummary,
  MultipleAccount,
} from "@/types/fetch";
import { CancelExtractorRequest } from "../../../wailsjs/go/main/App";

const MULTIPLE_PROGRESS_FLUSH_INTERVAL = 2000;
const DIFF_VISIBILITY_MS = 1000;

function countSessionStatuses(accounts: MultipleAccount[]) {
  return accounts.reduce(
    (counts, account) => {
      counts[account.status] += 1;
      return counts;
    },
    {
      pending: 0,
      fetching: 0,
      completed: 0,
      incomplete: 0,
      failed: 0,
    }
  );
}

function summarizeMultiFetchSession(
  session: MultiFetchSession,
  statusOverride?: MultiFetchSessionStatus
): MultiFetchSessionSummary {
  const counts = countSessionStatuses(session.accounts);
  return {
    id: session.id,
    source: session.source,
    title: session.title,
    createdAt: session.createdAt,
    status: statusOverride ?? session.status,
    accountCount: session.accounts.length,
    totalMedia: session.accounts.reduce((sum, account) => sum + account.mediaCount, 0),
    counts,
  };
}

function createMultiFetchSession(
  accounts: MultipleAccount[],
  meta: {
    source: MultiFetchSessionSource;
    title: string;
  },
  status: MultiFetchSessionStatus
): MultiFetchSession {
  return {
    id: crypto.randomUUID(),
    source: meta.source,
    title: meta.title,
    createdAt: Date.now(),
    status,
    accounts,
  };
}

export function useMultiFetchRuntime() {
  const [activeSession, setActiveSession] = useState<MultiFetchSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<MultiFetchSessionSummary[]>([]);

  const stopAllRef = useRef(false);
  const accountStartTimesRef = useRef<Map<string, number>>(new Map());
  const accountStopFlagsRef = useRef<Map<string, boolean>>(new Map());
  const accountMediaCountRef = useRef<Map<string, number>>(new Map());
  const accountTimeoutSecondsRef = useRef<Map<string, number>>(new Map());
  const activeSessionRef = useRef<MultiFetchSession | null>(null);
  const pendingAccountUpdatesRef = useRef<Map<string, Partial<MultipleAccount>>>(new Map());
  const diffVisibilityRef = useRef<Map<string, number>>(new Map());
  const activeAccountRequestIdsRef = useRef<Map<string, string>>(new Map());

  const setActiveSessionState = useCallback(
    (
      value:
        | MultiFetchSession
        | null
        | ((previous: MultiFetchSession | null) => MultiFetchSession | null)
    ) => {
      setActiveSession((previous) => {
        const next =
          typeof value === "function"
            ? (value as (previous: MultiFetchSession | null) => MultiFetchSession | null)(
                previous
              )
            : value;
        activeSessionRef.current = next;
        return next;
      });
    },
    []
  );

  const setActiveSessionAccounts = useCallback(
    (
      value:
        | MultipleAccount[]
        | ((previous: MultipleAccount[]) => MultipleAccount[])
    ) => {
      setActiveSessionState((previous) => {
        if (!previous) {
          const baseAccounts =
            typeof value === "function" ? value([]) : value;
          return createMultiFetchSession(
            baseAccounts,
            {
              source: "manual-fetch",
              title: "Multi-Account Session",
            },
            "ready"
          );
        }

        const nextAccounts =
          typeof value === "function" ? value(previous.accounts) : value;
        return {
          ...previous,
          accounts: nextAccounts,
        };
      });
    },
    [setActiveSessionState]
  );

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

  const archiveCurrentSession = useCallback(
    (statusOverride?: MultiFetchSessionStatus) => {
      const current = activeSessionRef.current;
      if (!current) {
        return;
      }

      const summary = summarizeMultiFetchSession(current, statusOverride);
      setRecentSessions((previous) => [
        summary,
        ...previous.filter((item) => item.id !== summary.id),
      ]);
      setActiveSessionState(null);
    },
    [setActiveSessionState]
  );

  const replaceActiveSession = useCallback(
    (
      accounts: MultipleAccount[],
      meta: {
        source: MultiFetchSessionSource;
        title: string;
      },
      status: MultiFetchSessionStatus = "ready"
    ) => {
      const current = activeSessionRef.current;
      if (current) {
        setRecentSessions((previous) => [
          summarizeMultiFetchSession(current),
          ...previous.filter((item) => item.id !== current.id),
        ]);
      }

      clearRuntimeRefs();
      const session = createMultiFetchSession(accounts, meta, status);
      stopAllRef.current = false;
      setActiveSessionState(session);
      return session;
    },
    [clearRuntimeRefs, setActiveSessionState]
  );

  const removeCurrentSession = useCallback(() => {
    clearRuntimeRefs();
    setActiveSessionState(null);
  }, [clearRuntimeRefs, setActiveSessionState]);

  const removeRecentSession = useCallback((sessionId: string) => {
    setRecentSessions((previous) =>
      previous.filter((session) => session.id !== sessionId)
    );
  }, []);

  const clearRecentSessions = useCallback(() => {
    setRecentSessions([]);
  }, []);

  const setActiveSessionStatus = useCallback(
    (status: MultiFetchSessionStatus) => {
      setActiveSessionState((previous) =>
        previous
          ? {
              ...previous,
              status,
            }
          : previous
      );
    },
    [setActiveSessionState]
  );

  const resetRuntimeState = useCallback(() => {
    clearRuntimeRefs();
    setActiveSessionState(null);
    setRecentSessions([]);
  }, [clearRuntimeRefs, setActiveSessionState]);

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
      setActiveSessionAccounts((previous) =>
        previous.map((account) => {
          const patch = queuedUpdates.get(account.id);
          return patch ? { ...account, ...patch } : account;
        })
      );
    });
  }, [setActiveSessionAccounts]);

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
    activeSessionRef.current = activeSession;
  }, [activeSession]);

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
    activeSession,
    recentSessions,
    setMultipleAccountsState: setActiveSessionAccounts,
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
    archiveCurrentSession,
    removeCurrentSession,
    removeRecentSession,
    clearRecentSessions,
    setActiveSessionStatus,
    queueMultipleAccountUpdate,
    flushMultipleAccountUpdates,
    clearAccountRuntimeState,
    markAccountDiffVisible,
    cancelAccountActiveRequest,
    cancelAllActiveAccountRequests,
  };
}
