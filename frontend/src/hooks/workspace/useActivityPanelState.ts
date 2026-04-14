import { useMemo } from "react";

import type {
  GlobalDownloadHistoryItem,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import type { FetchType, MultiFetchSession } from "@/types/fetch";
import type { ResumableFetchInfo } from "@/lib/fetch/state";
import type { TwitterResponse } from "@/types/api";

interface UseActivityPanelStateArgs {
  loading: boolean;
  fetchType: FetchType;
  username: string;
  elapsedTime: number;
  remainingTime: number | null;
  activeSession: MultiFetchSession | null;
  result: TwitterResponse | null;
  resumeInfo: ResumableFetchInfo | null;
  globalDownloadState: GlobalDownloadState | null;
  globalDownloadMeta: GlobalDownloadSessionMeta | null;
  globalDownloadHistory: GlobalDownloadHistoryItem[];
}

export function useActivityPanelState({
  loading,
  fetchType,
  username,
  elapsedTime,
  remainingTime,
  activeSession,
  result,
  resumeInfo,
  globalDownloadState,
  globalDownloadMeta,
  globalDownloadHistory,
}: UseActivityPanelStateArgs) {
  return useMemo(() => {
    const multipleAccounts = activeSession?.accounts || [];
    const multipleStatusCounts = multipleAccounts.reduce(
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

    const activeFetchTitle =
      fetchType === "multiple"
        ? activeSession?.title || "Multi-Account Queue"
        : username.trim()
          ? `@${username.trim()}`
          : "Idle";

    const activeFetchDescription =
      fetchType === "multiple"
        ? activeSession
          ? `${multipleStatusCounts.fetching} fetching • ${multipleStatusCounts.completed} completed`
          : "No active multi-account session"
        : loading
          ? "Fetch is running"
          : result
            ? `${result.total_urls.toLocaleString()} media items loaded`
            : resumeInfo?.canResume
              ? `${resumeInfo.mediaCount.toLocaleString()} items ready to resume`
              : "No active fetch";

    const latestFetchResult = result
      ? {
          username: result.account_info.name,
          displayName: result.account_info.nick,
          mediaCount: result.total_urls,
          completed: result.completed ?? true,
        }
      : null;

    const failures =
      multipleStatusCounts.failed + multipleStatusCounts.incomplete;
    const fetchIsRunning =
      fetchType === "multiple"
        ? Boolean(activeSession) && multipleStatusCounts.fetching > 0
        : loading;

    return {
      fetch: {
        loading: fetchIsRunning,
        fetchType,
        title: activeFetchTitle,
        description: activeFetchDescription,
        elapsedTime,
        remainingTime,
        latestFetchResult,
        multipleStatusCounts,
        resumeInfo,
      },
      download: {
        state: globalDownloadState,
        meta: globalDownloadMeta,
        history: globalDownloadHistory,
      },
      failures: {
        count: failures,
        hasFailures: failures > 0,
        incomplete: multipleStatusCounts.incomplete,
        failed: multipleStatusCounts.failed,
      },
    };
  }, [
    elapsedTime,
    fetchType,
    globalDownloadHistory,
    globalDownloadMeta,
    globalDownloadState,
    loading,
    activeSession,
    remainingTime,
    result,
    resumeInfo,
    username,
  ]);
}
