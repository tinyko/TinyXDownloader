import { useMemo } from "react";

import type {
  GlobalDownloadHistoryItem,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/components/GlobalDownloadPanel";
import type { FetchType, MultipleAccount } from "@/components/SearchBar";
import type { ResumableFetchInfo } from "@/lib/fetch-state";
import type { TwitterResponse } from "@/types/api";

interface UseActivityPanelStateArgs {
  loading: boolean;
  fetchType: FetchType;
  username: string;
  elapsedTime: number;
  remainingTime: number | null;
  multipleAccounts: MultipleAccount[];
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
  multipleAccounts,
  result,
  resumeInfo,
  globalDownloadState,
  globalDownloadMeta,
  globalDownloadHistory,
}: UseActivityPanelStateArgs) {
  return useMemo(() => {
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
        ? "Multiple Fetch Queue"
        : username.trim()
          ? `@${username.trim()}`
          : "Idle";

    const activeFetchDescription =
      fetchType === "multiple"
        ? `${multipleStatusCounts.fetching} fetching • ${multipleStatusCounts.completed} completed`
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

    return {
      fetch: {
        loading,
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
    multipleAccounts,
    remainingTime,
    result,
    resumeInfo,
    username,
  ]);
}
