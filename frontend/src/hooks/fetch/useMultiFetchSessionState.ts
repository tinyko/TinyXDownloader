import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MultiFetchSession,
  MultiFetchSessionSource,
  MultiFetchSessionStatus,
  MultiFetchSessionSummary,
  MultipleAccount,
} from "@/types/fetch";

const MULTI_FETCH_HISTORY_KEY = "twitter_media_multi_fetch_sessions";
const MAX_MULTI_FETCH_HISTORY = 24;

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
    finishedAt: Date.now(),
    status: statusOverride ?? session.status,
    accountCount: session.accounts.length,
    totalMedia: session.accounts.reduce((sum, account) => sum + account.mediaCount, 0),
    counts,
  };
}

function loadRecentSessions(): MultiFetchSessionSummary[] {
  try {
    const saved = localStorage.getItem(MULTI_FETCH_HISTORY_KEY);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? (parsed as MultiFetchSessionSummary[]) : [];
  } catch (error) {
    console.error("Failed to load multi-fetch history:", error);
    return [];
  }
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

export function useMultiFetchSessionState() {
  const [activeSession, setActiveSession] = useState<MultiFetchSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<MultiFetchSessionSummary[]>(() =>
    loadRecentSessions()
  );
  const activeSessionRef = useRef<MultiFetchSession | null>(null);

  const persistRecentSessions = useCallback((next: MultiFetchSessionSummary[]) => {
    try {
      localStorage.setItem(MULTI_FETCH_HISTORY_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Failed to save multi-fetch history:", error);
    }
  }, []);

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
          const baseAccounts = typeof value === "function" ? value([]) : value;
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

  const archiveCurrentSession = useCallback(
    (statusOverride?: MultiFetchSessionStatus) => {
      const current = activeSessionRef.current;
      if (!current) {
        return;
      }

      const summary = summarizeMultiFetchSession(current, statusOverride);
      setRecentSessions((previous) => {
        const next = [
          summary,
          ...previous.filter((item) => item.id !== summary.id),
        ].slice(0, MAX_MULTI_FETCH_HISTORY);
        persistRecentSessions(next);
        return next;
      });
      setActiveSessionState(null);
    },
    [persistRecentSessions, setActiveSessionState]
  );

  const replaceActiveSessionState = useCallback(
    (
      accounts: MultipleAccount[],
      meta: {
        source: MultiFetchSessionSource;
        title: string;
      },
      status: MultiFetchSessionStatus
    ) => {
      const current = activeSessionRef.current;
      if (current) {
        setRecentSessions((previous) => {
          const next = [
            summarizeMultiFetchSession(current),
            ...previous.filter((item) => item.id !== current.id),
          ].slice(0, MAX_MULTI_FETCH_HISTORY);
          persistRecentSessions(next);
          return next;
        });
      }

      const session = createMultiFetchSession(accounts, meta, status);
      setActiveSessionState(session);
      return session;
    },
    [persistRecentSessions, setActiveSessionState]
  );

  const removeCurrentSessionState = useCallback(() => {
    setActiveSessionState(null);
  }, [setActiveSessionState]);

  const removeRecentSession = useCallback((sessionId: string) => {
    setRecentSessions((previous) => {
      const next = previous.filter((session) => session.id !== sessionId);
      persistRecentSessions(next);
      return next;
    });
  }, [persistRecentSessions]);

  const clearRecentSessions = useCallback(() => {
    setRecentSessions([]);
    persistRecentSessions([]);
  }, [persistRecentSessions]);

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
      if (status === "completed" || status === "failed" || status === "cancelled") {
        const current = activeSessionRef.current;
        if (!current) {
          return;
        }
        const summary = summarizeMultiFetchSession(
          {
            ...current,
            status,
          },
          status
        );
        setRecentSessions((previous) => {
          const next = [
            summary,
            ...previous.filter((item) => item.id !== summary.id),
          ].slice(0, MAX_MULTI_FETCH_HISTORY);
          persistRecentSessions(next);
          return next;
        });
      }
    },
    [persistRecentSessions, setActiveSessionState]
  );

  const resetSessionState = useCallback(() => {
    setActiveSessionState(null);
    setRecentSessions([]);
    persistRecentSessions([]);
  }, [persistRecentSessions, setActiveSessionState]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  return {
    activeSession,
    recentSessions,
    activeSessionRef,
    setActiveSessionAccounts,
    archiveCurrentSession,
    replaceActiveSessionState,
    removeCurrentSessionState,
    removeRecentSession,
    clearRecentSessions,
    setActiveSessionStatus,
    resetSessionState,
  };
}
