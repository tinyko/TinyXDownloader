import { useCallback, useEffect, useState } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { logger } from "@/lib/logger";
import {
  clearCursorsForUsername,
  clearFetchStatesForUsername,
  getResumableInfo,
  type ResumableFetchInfo,
} from "@/lib/fetch/state";
import {
  buildFetchScope,
  parseUsernameList,
  resolveFetchTimelineType,
} from "@/lib/fetch/session";
import { runSingleFetchSession } from "@/lib/fetch/runSingleFetchSession";
import { useSingleFetchRuntime } from "@/hooks/fetch/useSingleFetchRuntime";
import type { FetchMode, PrivateType, SingleFetchTaskStatus } from "@/types/fetch";
import type { TwitterResponse } from "@/types/api";
import type { FetchTaskHistoryInput } from "@/types/history";

interface SingleFetchControllerOptions {
  username: string;
  setUsername: (username: string) => void;
  onAddToHistory?: (data: TwitterResponse, inputUsername: string) => void;
  onRecordTask?: (entry: FetchTaskHistoryInput) => void;
}

function resolveFetchErrorMessage(message: string, mode: FetchMode) {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (
    mode === "public" &&
    (lower.includes("additional anti-bot headers") ||
      lower.includes("authenticated cookies"))
  ) {
    return "This public account currently requires a public auth token. Add one in Settings and try again.";
  }

  if (trimmed) {
    return trimmed;
  }

  return "Failed to fetch media";
}

export function useSingleFetchController({
  username,
  setUsername,
  onAddToHistory,
  onRecordTask,
}: SingleFetchControllerOptions) {
  const [loading, setLoading] = useState(false);
  const [taskStatus, setTaskStatus] = useState<SingleFetchTaskStatus>(null);
  const [resumeInfo, setResumeInfo] = useState<ResumableFetchInfo | null>(null);
  const [newMediaCount, setNewMediaCount] = useState<number | null>(null);

  const handleRuntimeTimeout = useCallback(() => {
    logger.warning("Fetch timeout reached. Stopping...");
    toast.warning("Fetch timeout reached. Stopping...");
  }, []);

  const {
    result,
    elapsedTime,
    remainingTime,
    stopFetchRef,
    fetchStartTimeRef,
    singleFetchRequestIdRef,
    activeResultScopeRef,
    cancelActiveRequest: cancelSingleActiveRequest,
    flushResultUpdate,
    scheduleResultUpdate,
    clearLiveResult: clearLiveResultBase,
    beginFetchTiming,
    resetFetchTiming,
  } = useSingleFetchRuntime({
    loading,
    onTimeout: handleRuntimeTimeout,
  });

  const clearLiveResult = useCallback(() => {
    clearLiveResultBase();
    setNewMediaCount(null);
  }, [clearLiveResultBase]);

  const clearResumeInfo = useCallback(() => {
    setResumeInfo(null);
  }, []);

  const handleStopFetch = useCallback(async () => {
    stopFetchRef.current = true;
    setTaskStatus("cancelling");
    logger.info("Stopping fetch...");
    toast.info("Stopping...");
    await cancelSingleActiveRequest();
  }, [cancelSingleActiveRequest, stopFetchRef]);

  const checkResumable = useCallback((user: string) => {
    if (!user.trim()) {
      setResumeInfo(null);
      return;
    }
    const info = getResumableInfo(user.trim());
    setResumeInfo(info.canResume ? info : null);
  }, []);

  useEffect(() => {
    checkResumable(username);
  }, [checkResumable, username]);

  const handleFetchSingle = useCallback(
    async (
      useDateRange: boolean,
      startDate?: string,
      endDate?: string,
      mediaType?: string,
      retweets?: boolean,
      mode: FetchMode = "public",
      privateType?: PrivateType,
      authToken?: string,
      isResume?: boolean
    ) => {
      if (loading) {
        logger.warning("A fetch is already in progress, please wait or stop it first");
        toast.warning("A fetch is already in progress");
        return;
      }

      const isBookmarks = mode === "private" && privateType === "bookmarks";
      const isLikes = mode === "private" && privateType === "likes";
      const parsedUsernames = !isBookmarks ? parseUsernameList(username) : [];

      if (!isBookmarks && parsedUsernames.length === 0) {
        toast.error("Please enter a username");
        return;
      }

      if (isLikes && parsedUsernames.length > 1) {
        toast.error("Likes mode only supports one username at a time");
        return;
      }

      if (mode === "private" && !authToken?.trim()) {
        toast.error("Please enter your auth token");
        return;
      }

      const effectiveMediaType = mediaType || "all";
      const effectiveRetweets = retweets || false;
      const resolvedAuthToken = authToken?.trim() ?? "";

      const singleUsername = parsedUsernames[0] || username.trim();
      if (!isBookmarks && singleUsername !== username) {
        setUsername(singleUsername);
      }

      const cleanUsername = isBookmarks ? "bookmarks" : isLikes ? "likes" : singleUsername;
      const timelineType = resolveFetchTimelineType(
        useDateRange,
        mode,
        privateType,
        effectiveMediaType,
        effectiveRetweets
      );
      const queryKey = useDateRange && startDate && endDate ? `${startDate}:${endDate}` : "";
      const fetchScope = buildFetchScope({
        username: cleanUsername,
        mediaType: effectiveMediaType,
        timelineType,
        retweets: effectiveRetweets,
        queryKey,
      });
      const taskStartedAt = Date.now();
      let taskRecorded = false;

      setLoading(true);
      setTaskStatus("running");
      stopFetchRef.current = false;
      beginFetchTiming();
      setNewMediaCount(null);

      const fetchTarget = isBookmarks
        ? "your bookmarks"
        : isLikes
          ? "your likes"
          : `@${singleUsername}`;

      try {
        const terminalStatus = await runSingleFetchSession({
          useDateRange,
          startDate,
          endDate,
          mediaType: effectiveMediaType,
          retweets: effectiveRetweets,
          mode,
          privateType,
          authToken: resolvedAuthToken,
          singleUsername,
          cleanUsername,
          timelineType,
          fetchScope,
          fetchTarget,
          isResume,
          currentResult: result,
          activeResultScopeRef,
          stopFetchRef,
          fetchStartTimeRef,
          singleFetchRequestIdRef,
          scheduleResultUpdate,
          flushResultUpdate,
          setResumeInfo,
          setNewMediaCount,
          onAddToHistory,
          onRecordTask: (payload) => {
            taskRecorded = true;
            onRecordTask?.({
              username: cleanUsername,
              displayName: payload.accountInfo?.nick || undefined,
              image: payload.accountInfo?.profile_image || undefined,
              mode,
              privateType,
              timelineType,
              mediaType: effectiveMediaType,
              retweets: effectiveRetweets,
              useDateRange,
              startDate,
              endDate,
              status: payload.status,
              totalItems: payload.totalItems,
              startedAt: taskStartedAt,
              finishedAt: Date.now(),
              durationMs: Math.max(0, Date.now() - taskStartedAt),
            });
          },
        });
        setTaskStatus(terminalStatus);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Single fetch failed: ${errorMsg}`);
        if (stopFetchRef.current) {
          setTaskStatus("cancelled");
          if (!taskRecorded) {
            onRecordTask?.({
              username: cleanUsername,
              mode,
              privateType,
              timelineType,
              mediaType: effectiveMediaType,
              retweets: effectiveRetweets,
              useDateRange,
              startDate,
              endDate,
              status: "cancelled",
              totalItems: 0,
              startedAt: taskStartedAt,
              finishedAt: Date.now(),
              durationMs: Math.max(0, Date.now() - taskStartedAt),
            });
          }
        } else {
          setTaskStatus("failed");
          toast.error(resolveFetchErrorMessage(errorMsg, mode));
          if (!taskRecorded) {
            onRecordTask?.({
              username: cleanUsername,
              mode,
              privateType,
              timelineType,
              mediaType: effectiveMediaType,
              retweets: effectiveRetweets,
              useDateRange,
              startDate,
              endDate,
              status: "failed",
              totalItems: 0,
              startedAt: taskStartedAt,
              finishedAt: Date.now(),
              durationMs: Math.max(0, Date.now() - taskStartedAt),
            });
          }
        }
      } finally {
        resetFetchTiming();
        setLoading(false);
      }
    },
    [
      activeResultScopeRef,
      beginFetchTiming,
      fetchStartTimeRef,
      flushResultUpdate,
      loading,
      onAddToHistory,
      onRecordTask,
      resetFetchTiming,
      result,
      scheduleResultUpdate,
      singleFetchRequestIdRef,
      setUsername,
      stopFetchRef,
      username,
    ]
  );

  const handleResume = useCallback(
    (authToken: string, mediaType?: string, retweets?: boolean) => {
      if (!resumeInfo?.canResume) {
        toast.error("No resumable fetch found");
        return;
      }

      void handleFetchSingle(
        false,
        undefined,
        undefined,
        resumeInfo.mediaType || mediaType,
        resumeInfo.retweets ?? retweets,
        "public",
        undefined,
        authToken,
        true
      );
    },
    [handleFetchSingle, resumeInfo]
  );

  const handleClearResume = useCallback(() => {
    if (!username.trim()) {
      return;
    }

    clearFetchStatesForUsername(username.trim());
    clearCursorsForUsername(username.trim());
    setResumeInfo(null);
    toast.info("Resume data cleared");
  }, [username]);

  return {
    loading,
    taskStatus,
    result,
    resumeInfo,
    elapsedTime,
    remainingTime,
    newMediaCount,
    handleFetchSingle,
    handleResume,
    handleClearResume,
    handleStopFetch,
    clearLiveResult,
    clearResumeInfo,
  };
}
