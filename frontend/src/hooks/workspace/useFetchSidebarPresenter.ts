import { useCallback, useMemo } from "react";

import { formatNumberWithComma, parseUsernameList } from "@/lib/fetch/session";
import { getSettings } from "@/lib/settings";
import type { FetchMode, PrivateType } from "@/types/fetch";

interface UseFetchSidebarPresenterOptions {
  username: string;
  mode?: FetchMode;
  privateType?: PrivateType;
  useDateRange: boolean;
  startDate: string;
  endDate: string;
  publicAuthToken: string;
  privateAuthToken: string;
  onFetch: (
    useDateRange: boolean,
    startDate?: string,
    endDate?: string,
    mediaType?: string,
    retweets?: boolean,
    mode?: FetchMode,
    privateType?: PrivateType,
    authToken?: string,
    isResume?: boolean
  ) => void;
  onResume?: (authToken: string, mediaType?: string, retweets?: boolean) => void;
}

export function useFetchSidebarPresenter({
  username,
  mode: externalMode,
  privateType: externalPrivateType,
  useDateRange,
  startDate,
  endDate,
  publicAuthToken,
  privateAuthToken,
  onFetch,
  onResume,
}: UseFetchSidebarPresenterOptions) {
  const mode = externalMode || "public";
  const privateType = externalPrivateType || "bookmarks";
  const isLikesMode = mode === "private" && privateType === "likes";
  const isBookmarksMode = mode === "private" && privateType === "bookmarks";
  const parsedUsernames = useMemo(() => parseUsernameList(username), [username]);
  const detectedAccountCount = parsedUsernames.length;
  const isQueueInput = mode === "public" && detectedAccountCount > 1;
  const currentAuthToken = mode === "public" ? publicAuthToken : privateAuthToken;
  const hasAuthToken = currentAuthToken.trim().length > 0;

  const inputLabel = isLikesMode ? "Your Username" : "Username / Usernames";
  const inputPlaceholder = isLikesMode
    ? "your_username or https://x.com/your_username"
    : "Paste one or more usernames/URLs, one per line";

  const inputHint = isQueueInput
    ? "Multiple accounts detected. Clicking fetch will automatically run a queue with the current options."
    : isLikesMode
      ? "Likes mode supports one username at a time."
      : "Paste one account per line. A single line opens the usual single-account result view.";

  const fetchButtonLabel = isBookmarksMode
    ? "Fetch Bookmarks"
    : isQueueInput
      ? `Fetch ${formatNumberWithComma(detectedAccountCount)} Accounts`
      : isLikesMode
        ? "Fetch Likes"
        : "Start Fetch";

  const handleFetch = useCallback(() => {
    const currentSettings = getSettings();
    const effectiveUseDateRange = mode === "public" ? useDateRange : false;
    const authToken = mode === "public" ? publicAuthToken : privateAuthToken;

    onFetch(
      effectiveUseDateRange,
      startDate,
      endDate,
      currentSettings.mediaType,
      currentSettings.includeRetweets,
      mode,
      privateType,
      authToken,
      false
    );
  }, [
    endDate,
    mode,
    onFetch,
    privateAuthToken,
    privateType,
    publicAuthToken,
    startDate,
    useDateRange,
  ]);

  const handleResume = useCallback(() => {
    const currentSettings = getSettings();
    const authToken = mode === "public" ? publicAuthToken : privateAuthToken;
    onResume?.(authToken, currentSettings.mediaType, currentSettings.includeRetweets);
  }, [mode, onResume, privateAuthToken, publicAuthToken]);

  return {
    mode,
    privateType,
    isLikesMode,
    isBookmarksMode,
    detectedAccountCount,
    isQueueInput,
    hasAuthToken,
    inputLabel,
    inputPlaceholder,
    inputHint,
    fetchButtonLabel,
    handleFetch,
    handleResume,
  };
}
