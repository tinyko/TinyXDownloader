import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MultiFetchSession,
  MultiFetchSessionSource,
  MultiFetchSessionStatus,
  MultiFetchSessionSummary,
  MultipleAccount,
} from "@/types/fetch";

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

export function useMultiFetchSessionState() {
  const [activeSession, setActiveSession] = useState<MultiFetchSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<MultiFetchSessionSummary[]>([]);
  const activeSessionRef = useRef<MultiFetchSession | null>(null);

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
      setRecentSessions((previous) => [
        summary,
        ...previous.filter((item) => item.id !== summary.id),
      ]);
      setActiveSessionState(null);
    },
    [setActiveSessionState]
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
        setRecentSessions((previous) => [
          summarizeMultiFetchSession(current),
          ...previous.filter((item) => item.id !== current.id),
        ]);
      }

      const session = createMultiFetchSession(accounts, meta, status);
      setActiveSessionState(session);
      return session;
    },
    [setActiveSessionState]
  );

  const removeCurrentSessionState = useCallback(() => {
    setActiveSessionState(null);
  }, [setActiveSessionState]);

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

  const resetSessionState = useCallback(() => {
    setActiveSessionState(null);
    setRecentSessions([]);
  }, [setActiveSessionState]);

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
