import { useCallback } from "react";

import type {
  MultiFetchSessionSource,
  MultiFetchSessionStatus,
  MultipleAccount,
} from "@/types/fetch";
import { useMultiFetchAccountRuntime } from "@/hooks/fetch/useMultiFetchAccountRuntime";
import { useMultiFetchSessionState } from "@/hooks/fetch/useMultiFetchSessionState";

export function useMultiFetchRuntime() {
  const sessionState = useMultiFetchSessionState();
  const accountRuntime = useMultiFetchAccountRuntime({
    setMultipleAccountsState: sessionState.setActiveSessionAccounts,
  });

  const replaceActiveSession = useCallback(
    (
      accounts: MultipleAccount[],
      meta: {
        source: MultiFetchSessionSource;
        title: string;
      },
      status: MultiFetchSessionStatus = "ready"
    ) => {
      accountRuntime.resetRuntimeRefs();
      const session = sessionState.replaceActiveSessionState(accounts, meta, status);
      return session;
    },
    [accountRuntime, sessionState]
  );

  const removeCurrentSession = useCallback(() => {
    accountRuntime.clearRuntimeRefs();
    sessionState.removeCurrentSessionState();
  }, [accountRuntime, sessionState]);

  const resetRuntimeState = useCallback(() => {
    accountRuntime.clearRuntimeRefs();
    sessionState.resetSessionState();
  }, [accountRuntime, sessionState]);

  return {
    activeSession: sessionState.activeSession,
    recentSessions: sessionState.recentSessions,
    setMultipleAccountsState: sessionState.setActiveSessionAccounts,
    stopAllRef: accountRuntime.stopAllRef,
    accountStartTimesRef: accountRuntime.accountStartTimesRef,
    accountStopFlagsRef: accountRuntime.accountStopFlagsRef,
    accountMediaCountRef: accountRuntime.accountMediaCountRef,
    accountTimeoutSecondsRef: accountRuntime.accountTimeoutSecondsRef,
    activeSessionRef: sessionState.activeSessionRef,
    diffVisibilityRef: accountRuntime.diffVisibilityRef,
    activeAccountRequestIdsRef: accountRuntime.activeAccountRequestIdsRef,
    resetRuntimeState,
    replaceActiveSession,
    archiveCurrentSession: sessionState.archiveCurrentSession,
    removeCurrentSession,
    removeRecentSession: sessionState.removeRecentSession,
    clearRecentSessions: sessionState.clearRecentSessions,
    setActiveSessionStatus: sessionState.setActiveSessionStatus,
    queueMultipleAccountUpdate: accountRuntime.queueMultipleAccountUpdate,
    flushMultipleAccountUpdates: accountRuntime.flushMultipleAccountUpdates,
    clearAccountRuntimeState: accountRuntime.clearAccountRuntimeState,
    markAccountDiffVisible: accountRuntime.markAccountDiffVisible,
    cancelAccountActiveRequest: accountRuntime.cancelAccountActiveRequest,
    cancelAllActiveAccountRequests: accountRuntime.cancelAllActiveAccountRequests,
  };
}
