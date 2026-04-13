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
import type { FetchMode, PrivateType } from "@/types/fetch";
import type { TwitterResponse } from "@/types/api";

interface SingleFetchControllerOptions {
  username: string;
  setUsername: (username: string) => void;
  onAddToHistory?: (data: TwitterResponse, inputUsername: string) => void;
}

export function useSingleFetchController({
  username,
  setUsername,
  onAddToHistory,
}: SingleFetchControllerOptions) {
  const [loading, setLoading] = useState(false);
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
    logger.info("Stopping fetch...");
    toast.info("Stopping...");
    await cancelSingleActiveRequest();
  }, [cancelSingleActiveRequest]);

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

      if (!authToken?.trim()) {
        toast.error("Please enter your auth token");
        return;
      }

      const effectiveMediaType = mediaType || "all";
      const effectiveRetweets = retweets || false;

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

      setLoading(true);
      stopFetchRef.current = false;
      beginFetchTiming();
      setNewMediaCount(null);

      const fetchTarget = isBookmarks
        ? "your bookmarks"
        : isLikes
          ? "your likes"
          : `@${singleUsername}`;

      try {
        await runSingleFetchSession({
          useDateRange,
          startDate,
          endDate,
          mediaType: effectiveMediaType,
          retweets: effectiveRetweets,
          mode,
          privateType,
          authToken: authToken.trim(),
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
        });
      } finally {
        setLoading(false);
      }
    },
    [
      beginFetchTiming,
      flushResultUpdate,
      loading,
      onAddToHistory,
      result,
      scheduleResultUpdate,
      setUsername,
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
