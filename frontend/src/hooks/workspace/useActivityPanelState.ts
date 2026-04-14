import { useMemo } from "react";

import { canCancelTask, mapMultiFetchSessionToTaskStatus, normalizeIntegrityTaskStatus } from "@/lib/tasks/lifecycle";
import type {
  GlobalDownloadHistoryItem,
  GlobalDownloadSessionMeta,
  GlobalDownloadTaskState,
} from "@/types/download";
import type {
  FetchType,
  MultiFetchSession,
  SingleFetchTaskStatus,
} from "@/types/fetch";
import type { ResumableFetchInfo } from "@/lib/fetch/state";
import type { TwitterResponse } from "@/types/api";
import type {
  DownloadIntegrityReport,
  DownloadIntegrityTaskStatus,
} from "@/types/settings";
import type { TaskCardSummary } from "@/types/tasks";

interface UseActivityPanelStateArgs {
  fetchType: FetchType;
  username: string;
  elapsedTime: number;
  remainingTime: number | null;
  singleFetchTaskStatus: SingleFetchTaskStatus;
  activeSession: MultiFetchSession | null;
  result: TwitterResponse | null;
  resumeInfo: ResumableFetchInfo | null;
  globalDownloadTaskState: GlobalDownloadTaskState;
  globalDownloadMeta: GlobalDownloadSessionMeta | null;
  globalDownloadHistory: GlobalDownloadHistoryItem[];
  integrityTaskStatus: DownloadIntegrityTaskStatus | null;
  integrityReport: DownloadIntegrityReport | null;
}

interface FetchActivitySummary extends TaskCardSummary {
  fetchType: FetchType;
  elapsedTime: number;
  remainingTime: number | null;
  latestFetchResult: {
    username: string;
    displayName: string;
    mediaCount: number;
    completed: boolean;
  } | null;
  multipleStatusCounts: {
    pending: number;
    fetching: number;
    completed: number;
    incomplete: number;
    failed: number;
  };
  resumeInfo: ResumableFetchInfo | null;
}

interface DownloadActivitySummary extends TaskCardSummary {
  meta: GlobalDownloadSessionMeta | null;
  history: GlobalDownloadHistoryItem[];
}

interface IntegrityActivitySummary extends TaskCardSummary {
  report: DownloadIntegrityReport | null;
  taskStatus: DownloadIntegrityTaskStatus | null;
}

export function useActivityPanelState({
  fetchType,
  username,
  elapsedTime,
  remainingTime,
  singleFetchTaskStatus,
  activeSession,
  result,
  resumeInfo,
  globalDownloadTaskState,
  globalDownloadMeta,
  globalDownloadHistory,
  integrityTaskStatus,
  integrityReport,
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

    const failures =
      multipleStatusCounts.failed + multipleStatusCounts.incomplete;

    const fetchStatus =
      fetchType === "multiple"
        ? mapMultiFetchSessionToTaskStatus(activeSession?.status)
        : singleFetchTaskStatus;

    const fetchDescription =
      fetchType === "multiple"
        ? activeSession
          ? fetchStatus === "cancelling"
            ? "Stopping multi-account queue"
            : `${multipleStatusCounts.fetching} fetching • ${multipleStatusCounts.completed} completed`
          : "No active multi-account session"
        : fetchStatus === "running"
          ? "Fetch is running"
          : fetchStatus === "cancelling"
            ? "Stopping current fetch"
            : fetchStatus === "failed"
              ? "The latest fetch ended with an error"
              : fetchStatus === "cancelled"
                ? "The latest fetch was cancelled"
                : result
                  ? `${result.total_urls.toLocaleString()} media items loaded`
                  : resumeInfo?.canResume
                    ? `${resumeInfo.mediaCount.toLocaleString()} items ready to resume`
                    : "No active fetch";

    const fetchSummary: FetchActivitySummary = {
      status: fetchStatus,
      title:
        fetchType === "multiple"
          ? activeSession?.title || "Multi-Account Queue"
          : username.trim()
            ? `@${username.trim()}`
            : "Single-Account Fetch",
      description: fetchDescription,
      phase:
        fetchType === "multiple" && activeSession
          ? `${multipleStatusCounts.fetching} active / ${multipleAccounts.length} total`
          : undefined,
      progress:
        fetchType === "multiple" && multipleAccounts.length > 0
          ? {
              current:
                multipleStatusCounts.completed +
                multipleStatusCounts.incomplete +
                multipleStatusCounts.failed,
              total: multipleAccounts.length,
              percent: Math.round(
                ((multipleStatusCounts.completed +
                  multipleStatusCounts.incomplete +
                  multipleStatusCounts.failed) /
                  multipleAccounts.length) *
                  100
              ),
            }
          : null,
      canCancel: canCancelTask(fetchStatus),
      fetchType,
      elapsedTime,
      remainingTime,
      latestFetchResult: result
        ? {
            username: result.account_info.name,
            displayName: result.account_info.nick,
            mediaCount: result.total_urls,
            completed: result.completed ?? true,
          }
        : null,
      multipleStatusCounts,
      resumeInfo,
    };

    const downloadStatus = globalDownloadTaskState.status;
    const downloadSummary: DownloadActivitySummary = {
      status: downloadStatus,
      title: globalDownloadMeta?.title || "Download Task",
      description:
        downloadStatus === "running"
          ? "Download is in progress"
          : downloadStatus === "cancelling"
            ? "Stopping current download"
            : downloadStatus === "completed"
              ? "The latest download completed successfully"
              : downloadStatus === "failed"
                ? "The latest download finished with errors"
                : downloadStatus === "cancelled"
                  ? "The latest download was cancelled"
                  : "No active download. Recent tasks stay listed below.",
      progress: globalDownloadTaskState.progress
        ? {
            current: globalDownloadTaskState.progress.current,
            total: globalDownloadTaskState.progress.total,
            percent: globalDownloadTaskState.progress.percent,
          }
        : null,
      canCancel: canCancelTask(downloadStatus),
      meta: globalDownloadMeta,
      history: globalDownloadHistory,
    };

    const integrityStatus = normalizeIntegrityTaskStatus(integrityTaskStatus);
    const integrityIssueCount =
      (integrityReport?.partial_files || 0) +
      (integrityReport?.incomplete_files || 0);
    const integrityChecked =
      integrityTaskStatus?.checked_files || integrityReport?.checked_files || 0;
    const integrityScanned = Math.max(
      integrityTaskStatus?.scanned_files || 0,
      integrityChecked
    );

    const integritySummary: IntegrityActivitySummary = {
      status: integrityStatus,
      title:
        integrityTaskStatus?.mode === "deep"
          ? "Deep Integrity Check"
          : integrityTaskStatus?.mode === "quick"
            ? "Quick Integrity Check"
            : "Download Integrity",
      description:
        integrityStatus === "running"
          ? "Integrity scan is running"
          : integrityStatus === "cancelling"
            ? "Stopping integrity scan"
            : integrityStatus === "failed"
              ? integrityTaskStatus?.error || "Integrity check failed"
              : integrityStatus === "cancelled"
                ? "The latest integrity check was cancelled"
                : integrityReport
                  ? integrityIssueCount > 0
                    ? `${integrityIssueCount} issue(s) found across ${integrityReport.checked_files.toLocaleString()} checked file(s)`
                    : `${integrityReport.checked_files.toLocaleString()} checked file(s), no incomplete items found`
                  : "No integrity task has run yet.",
      phase: integrityTaskStatus?.phase || undefined,
      progress:
        integrityScanned > 0
          ? {
              current: integrityChecked,
              total: integrityScanned,
              percent: Math.round((integrityChecked / integrityScanned) * 100),
            }
          : null,
      canCancel: canCancelTask(integrityStatus),
      report: integrityReport,
      taskStatus: integrityTaskStatus,
    };

    return {
      fetch: fetchSummary,
      download: downloadSummary,
      integrity: integritySummary,
      failures: {
        count: failures,
        hasFailures: failures > 0,
        incomplete: multipleStatusCounts.incomplete,
        failed: multipleStatusCounts.failed,
      },
    };
  }, [
    activeSession,
    elapsedTime,
    fetchType,
    globalDownloadHistory,
    globalDownloadMeta,
    globalDownloadTaskState,
    integrityReport,
    integrityTaskStatus,
    remainingTime,
    result,
    resumeInfo,
    singleFetchTaskStatus,
    username,
  ]);
}
