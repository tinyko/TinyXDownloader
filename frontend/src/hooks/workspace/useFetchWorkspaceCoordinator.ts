import { useCallback } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import {
  buildFetchScope,
  createMultipleAccounts,
  formatNumberWithComma,
  parseUsername,
  parseUsernameList,
} from "@/lib/fetch/session";
import type { FetchScope } from "@/lib/fetch/state";
import type {
  FetchMode,
  FetchType,
  HistoryItem,
  MultiFetchSessionSource,
  MultipleAccount,
  PrivateType,
} from "@/types/fetch";
import { backend } from "../../../wailsjs/go/models";

interface UseFetchWorkspaceCoordinatorOptions {
  username: string;
  setUsername: (value: string) => void;
  loading: boolean;
  publicAuthToken: string;
  setFetchedMediaType: (value: string) => void;
  setFetchType: (value: FetchType) => void;
  setWorkspaceTab: (value: "fetch" | "saved") => void;
  setSavedTimelineSelection: (value: { account: backend.AccountListItem; scope: FetchScope } | null) => void;
  setSearchMode: (value: FetchMode) => void;
  setSearchPrivateType: (value: PrivateType) => void;
  createPendingSession: (
    accounts: MultipleAccount[],
    meta: {
      source: MultiFetchSessionSource;
      title: string;
    }
  ) => Promise<unknown>;
  clearLiveResult: () => void;
  clearResumeInfo: () => void;
  resetMultipleQueueState: () => void;
  handleFetchSingle: (
    useDateRange: boolean,
    startDate?: string,
    endDate?: string,
    mediaType?: string,
    retweets?: boolean,
    mode?: FetchMode,
    privateType?: PrivateType,
    authToken?: string,
    isResume?: boolean
  ) => Promise<void>;
  handleFetchAll: (
    accountsOverride?: MultipleAccount[],
    options?: {
      mode?: FetchMode;
      privateType?: PrivateType;
      mediaType?: string;
      retweets?: boolean;
      authToken?: string;
    },
    sessionMeta?: {
      source: MultiFetchSessionSource;
      title: string;
    }
  ) => Promise<void>;
}

export function useFetchWorkspaceCoordinator({
  username,
  setUsername,
  loading,
  publicAuthToken,
  setFetchedMediaType,
  setFetchType,
  setWorkspaceTab,
  setSavedTimelineSelection,
  setSearchMode,
  setSearchPrivateType,
  createPendingSession,
  clearLiveResult,
  clearResumeInfo,
  resetMultipleQueueState,
  handleFetchSingle,
  handleFetchAll,
}: UseFetchWorkspaceCoordinatorOptions) {
  const handleFetch = useCallback(
    async (
      nextUseDateRange: boolean,
      nextStartDate?: string,
      nextEndDate?: string,
      mediaType?: string,
      retweets?: boolean,
      mode: FetchMode = "public",
      privateType?: PrivateType,
      authToken?: string,
      isResume?: boolean
    ) => {
      if (loading) {
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
      const shouldUseQueue = mode === "public" && parsedUsernames.length > 1 && !isResume;

      if (shouldUseQueue) {
        if (nextUseDateRange) {
          toast.error("Date range fetch currently supports one account at a time");
          return;
        }

        const normalizedInput = parsedUsernames.join("\n");
        if (normalizedInput !== username) {
          setUsername(normalizedInput);
        }

        const accounts = createMultipleAccounts(parsedUsernames, {
          mode,
          privateType,
          mediaType: effectiveMediaType,
          retweets: effectiveRetweets,
        });

        setFetchedMediaType(effectiveMediaType);
        setFetchType("multiple");
        setSavedTimelineSelection(null);
        clearLiveResult();
        clearResumeInfo();

        await handleFetchAll(accounts, {
          mode,
          privateType,
          mediaType: effectiveMediaType,
          retweets: effectiveRetweets,
          authToken: resolvedAuthToken,
        }, {
          source: "manual-fetch",
          title: `Fetching ${parsedUsernames.length} Accounts`,
        });
        return;
      }

      resetMultipleQueueState();
      setFetchType("single");
      setSavedTimelineSelection(null);
      setFetchedMediaType(effectiveMediaType);

      await handleFetchSingle(
        nextUseDateRange,
        nextStartDate,
        nextEndDate,
        effectiveMediaType,
        effectiveRetweets,
        mode,
        privateType,
        authToken,
        isResume
      );
    },
    [
      clearLiveResult,
      clearResumeInfo,
      handleFetchAll,
      handleFetchSingle,
      loading,
      resetMultipleQueueState,
      setFetchType,
      setFetchedMediaType,
      setSavedTimelineSelection,
      setUsername,
      username,
    ]
  );

  const handleLoadFromDB = useCallback((account: backend.AccountListItem) => {
    const scope = buildFetchScope({
      username: account.username,
      mediaType: account.media_type || "all",
      timelineType: account.timeline_type || "timeline",
      retweets: account.retweets ?? false,
      queryKey: account.query_key || "",
    });

    resetMultipleQueueState();
    clearLiveResult();
    setSavedTimelineSelection({ account, scope });
    setUsername(account.username);
    setFetchedMediaType(account.media_type || "all");
    setWorkspaceTab("fetch");
    setFetchType("single");

    const isPrivate = account.username === "bookmarks" || account.username === "likes";
    if (isPrivate) {
      setSearchMode("private");
      setSearchPrivateType(account.username === "likes" ? "likes" : "bookmarks");
    } else {
      setSearchMode("public");
    }

    toast.success(`Loaded @${account.username} from database`);
  }, [
    clearLiveResult,
    resetMultipleQueueState,
    setFetchType,
    setFetchedMediaType,
    setSavedTimelineSelection,
    setSearchMode,
    setSearchPrivateType,
    setUsername,
    setWorkspaceTab,
  ]);

  const handleUpdateSelected = useCallback(async (usernames: string[]) => {
    if (usernames.length === 0) {
      toast.error("No accounts selected");
      return;
    }

    if (loading) {
      toast.warning("A fetch is already in progress");
      return;
    }

    const parsedUsernames = usernames.map(parseUsername).filter(Boolean);
    if (parsedUsernames.length === 0) {
      toast.error("No valid public accounts to update");
      return;
    }

    const currentSettings = getSettings();
    const accounts = createMultipleAccounts(parsedUsernames, {
      mode: "public",
      mediaType: currentSettings.mediaType,
      retweets: currentSettings.includeRetweets,
    });

    setUsername(parsedUsernames.join("\n"));
    setSearchMode("public");
    setFetchType("multiple");
    setSavedTimelineSelection(null);
    setFetchedMediaType(currentSettings.mediaType);
    clearLiveResult();
    clearResumeInfo();
    setWorkspaceTab("fetch");

    const authToken = publicAuthToken.trim();
    if (!authToken) {
      await createPendingSession(accounts, {
        source: "saved-update",
        title: `Updating ${parsedUsernames.length} Saved Accounts`,
      });
      toast.warning(
        `Loaded ${formatNumberWithComma(accounts.length)} account(s) into queue. Enter Public Auth Token and start fetch.`
      );
      return;
    }

    await handleFetchAll(accounts, {
      mode: "public",
      mediaType: currentSettings.mediaType,
      retweets: currentSettings.includeRetweets,
      authToken,
    }, {
      source: "saved-update",
      title: `Updating ${parsedUsernames.length} Saved Accounts`,
    });
  }, [
    clearLiveResult,
    clearResumeInfo,
    createPendingSession,
    handleFetchAll,
    loading,
    publicAuthToken,
    setFetchType,
    setFetchedMediaType,
    setSavedTimelineSelection,
    setSearchMode,
    setUsername,
    setWorkspaceTab,
  ]);

  const handleImportFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          toast.error("File is empty");
          return;
        }

        const usernames = lines.map(parseUsername).filter(Boolean);
        setUsername(usernames.join("\n"));
        toast.success(`Imported ${formatNumberWithComma(usernames.length)} account(s)`);
      } catch {
        toast.error("Failed to read file");
      }
    };
    input.click();
  }, [setUsername]);

  const handleHistorySelect = useCallback((item: HistoryItem) => {
    setWorkspaceTab("fetch");
    setSavedTimelineSelection(null);
    setUsername(item.username);
  }, [setSavedTimelineSelection, setUsername, setWorkspaceTab]);

  return {
    handleFetch,
    handleLoadFromDB,
    handleUpdateSelected,
    handleImportFile,
    handleHistorySelect,
  };
}
