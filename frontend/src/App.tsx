import { lazy, Suspense, startTransition, useState, useEffect, useRef, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSettings, updateSettings, applyThemeMode, applyFont } from "@/lib/settings";
import { APP_VERSION } from "@/lib/app-info";
import { applyTheme } from "@/lib/themes";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { logger } from "@/lib/logger";
import {
  saveFetchState,
  getFetchState,
  clearFetchState,
  clearFetchStatesForUsername,
  getResumableInfo,
  saveCursor,
  clearCursor,
  clearCursorsForUsername,
  type FetchScope,
  type FetchState,
  type ResumableFetchInfo,
} from "@/lib/fetch-state";

// Components
import { TitleBar } from "@/components/TitleBar";
import { Header } from "@/components/Header";
import { ActivityPanel } from "@/components/ActivityPanel";
import {
  type GlobalDownloadHistoryItem,
  type GlobalDownloadSessionMeta,
  type GlobalDownloadState,
} from "@/components/GlobalDownloadPanel";
import { FetchWorkspaceSidebar } from "@/components/FetchWorkspaceSidebar";
import { MultiAccountWorkspace } from "@/components/MultiAccountWorkspace";
import { type FetchMode, type PrivateType, type FetchType, type MultipleAccount } from "@/components/SearchBar";
import type { HistoryItem } from "@/components/FetchHistory";
import { useActivityPanelState } from "@/hooks/useActivityPanelState";
import type { TimelineEntry, TwitterResponse } from "@/types/api";

// Wails bindings
import { CancelExtractorRequest, DownloadSavedScopes, ExtractDateRangeStructured, ExtractTimelineStructured, GetDownloadStatus, GetAccountSnapshotStructured, GetStoredAuthTokens, SaveAccountSnapshotChunk, SaveStoredAuthTokens, StopDownload } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { backend, main } from "../wailsjs/go/models";

const HISTORY_KEY = "twitter_media_fetch_history";
const MAX_HISTORY = 10;
const BATCH_SIZE = 200; // Fetch in batches for progressive display and resume
const MULTIPLE_PROGRESS_FLUSH_INTERVAL = 2000;
const DIFF_VISIBILITY_MS = 1000;
const MULTIPLE_FETCH_CONCURRENCY = 2;
const RESULT_UPDATE_THROTTLE_MS = 500;
type WorkspaceTab = "fetch" | "saved";

const MediaList = lazy(() =>
  import("@/components/MediaList").then((module) => ({ default: module.MediaList }))
);
const DatabaseView = lazy(() =>
  import("@/components/DatabaseView").then((module) => ({ default: module.DatabaseView }))
);
const SettingsPage = lazy(() =>
  import("@/components/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const DebugLoggerPage = lazy(() =>
  import("@/components/DebugLoggerPage").then((module) => ({ default: module.DebugLoggerPage }))
);

function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

function resolveFetchTimelineType(
  useDateRange: boolean,
  mode: FetchMode,
  privateType: PrivateType | undefined,
  mediaType: string,
  retweets: boolean
): string {
  if (useDateRange) {
    return "date_range";
  }

  if (mode === "private") {
    return privateType === "likes" ? "likes" : "bookmarks";
  }

  if (mediaType === "text" || retweets) {
    return "timeline";
  }

  return "media";
}

function parseUsername(input: string): string {
  let clean = input.trim();
  if (clean.startsWith("@")) {
    clean = clean.slice(1);
  }
  if (clean.includes("x.com/") || clean.includes("twitter.com/")) {
    const match = clean.match(/(?:x\.com|twitter\.com)\/([^/?]+)/);
    if (match) clean = match[1];
  }
  return clean.trim();
}

function parseUsernameList(input: string): string[] {
  const seen = new Set<string>();
  const usernames: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const parsed = parseUsername(line);
    if (!parsed) {
      continue;
    }
    const key = parsed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    usernames.push(parsed);
  }

  return usernames;
}

function buildTimelineEntryKey(entry: TimelineEntry): string {
  return `${entry.tweet_id}:${entry.url}`;
}

function buildKnownTweetIdSet(timeline: TimelineEntry[]): Set<string> {
  return new Set(timeline.map((entry) => entry.tweet_id));
}

interface TimelineAccumulator {
  timeline: TimelineEntry[];
  entryKeys: Set<string>;
  tweetIds: Set<string>;
}

function createTimelineAccumulator(initialTimeline: TimelineEntry[] = []): TimelineAccumulator {
  const timeline: TimelineEntry[] = [];
  const entryKeys = new Set<string>();
  const tweetIds = new Set<string>();

  for (const entry of initialTimeline) {
    const entryKey = buildTimelineEntryKey(entry);
    if (entryKeys.has(entryKey)) {
      continue;
    }

    entryKeys.add(entryKey);
    tweetIds.add(entry.tweet_id);
    timeline.push(entry);
  }

  return {
    timeline,
    entryKeys,
    tweetIds,
  };
}

function appendUniqueEntries(accumulator: TimelineAccumulator, entries: TimelineEntry[]): TimelineEntry[] {
  const addedEntries: TimelineEntry[] = [];

  for (const entry of entries) {
    const entryKey = buildTimelineEntryKey(entry);
    if (accumulator.entryKeys.has(entryKey)) {
      continue;
    }

    accumulator.entryKeys.add(entryKey);
    accumulator.tweetIds.add(entry.tweet_id);
    accumulator.timeline.push(entry);
    addedEntries.push(entry);
  }

  return addedEntries;
}

function createResultTimeline(accumulator: TimelineAccumulator): TimelineEntry[] {
  return accumulator.timeline.slice();
}

function normalizeStructuredTimelineEntry(
  entry: backend.TimelineEntry | TimelineEntry
): TimelineEntry {
  return {
    url: entry.url,
    date: entry.date,
    tweet_id: String(entry.tweet_id ?? ""),
    type: entry.type,
    is_retweet: entry.is_retweet,
    extension: entry.extension,
    width: entry.width,
    height: entry.height,
    content: entry.content,
    view_count: entry.view_count,
    bookmark_count: entry.bookmark_count,
    favorite_count: entry.favorite_count,
    retweet_count: entry.retweet_count,
    reply_count: entry.reply_count,
    source: entry.source,
    verified: entry.verified,
    original_filename: entry.original_filename,
    author_username: entry.author_username,
  };
}

function normalizeStructuredResponse(
  response: backend.TwitterResponse | TwitterResponse | null | undefined
): TwitterResponse | null {
  if (!response) {
    return null;
  }

  return {
    account_info: {
      name: response.account_info.name,
      nick: response.account_info.nick,
      date: response.account_info.date,
      followers_count: response.account_info.followers_count,
      friends_count: response.account_info.friends_count,
      profile_image: response.account_info.profile_image,
      statuses_count: response.account_info.statuses_count,
    },
    total_urls: response.total_urls,
    timeline: (response.timeline || []).map((entry) =>
      normalizeStructuredTimelineEntry(entry)
    ),
    metadata: {
      new_entries: response.metadata?.new_entries ?? 0,
      page: response.metadata?.page ?? 0,
      batch_size: response.metadata?.batch_size ?? 0,
      has_more: response.metadata?.has_more ?? false,
      cursor: response.metadata?.cursor,
      completed: response.metadata?.completed,
    },
    cursor: response.cursor,
    completed: response.completed,
  };
}

function WorkspaceLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-8 text-center">
      <div className="space-y-3">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm text-muted-foreground">Loading {label}...</p>
      </div>
    </div>
  );
}

function mergeFetchedWithSavedTimeline(
  fetchedTimeline: TimelineEntry[],
  savedTimeline: TimelineEntry[]
): TimelineEntry[] {
  const seen = new Set<string>();
  const merged: TimelineEntry[] = [];

  for (const entry of fetchedTimeline) {
    const key = buildTimelineEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }

  for (const entry of savedTimeline) {
    const key = buildTimelineEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

function collectIncrementalEntries(
  batchTimeline: TimelineEntry[],
  knownTweetIds: Set<string>,
  sessionEntryKeys: Set<string>
): { freshEntries: TimelineEntry[]; overlapReached: boolean } {
  const freshEntries: TimelineEntry[] = [];
  let overlapReached = false;

  for (const entry of batchTimeline) {
    if (knownTweetIds.has(entry.tweet_id)) {
      overlapReached = true;
      continue;
    }

    const entryKey = buildTimelineEntryKey(entry);
    if (sessionEntryKeys.has(entryKey)) {
      continue;
    }

    sessionEntryKeys.add(entryKey);
    freshEntries.push(entry);
  }

  return { freshEntries, overlapReached };
}

function createMultipleAccounts(
  usernames: string[],
  options: {
    mode: FetchMode;
    privateType?: PrivateType;
    mediaType: string;
    retweets: boolean;
  }
): MultipleAccount[] {
  return usernames.map((username) => ({
    id: crypto.randomUUID(),
    username,
    mode: options.mode,
    privateType: options.privateType,
    mediaType: options.mediaType,
    retweets: options.retweets,
    status: "pending",
    mediaCount: 0,
    previousMediaCount: 0,
    elapsedTime: 0,
    remainingTime: null,
    showDiff: false,
  }));
}

function App() {
  const initialSettings = getSettings();
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("fetch");
  const [savedTabVisited, setSavedTabVisited] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TwitterResponse | null>(null);
  const [fetchedMediaType, setFetchedMediaType] = useState<string>("all");
  const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);
  const [resumeInfo, setResumeInfo] = useState<ResumableFetchInfo | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [newMediaCount, setNewMediaCount] = useState<number | null>(null);
  const [publicAuthToken, setPublicAuthToken] = useState("");
  const [privateAuthToken, setPrivateAuthToken] = useState("");
  const [rememberPublicToken, setRememberPublicToken] = useState(initialSettings.rememberPublicToken);
  const [rememberPrivateToken, setRememberPrivateToken] = useState(initialSettings.rememberPrivateToken);
  const [useDateRange, setUseDateRange] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [storedTokensReady, setStoredTokensReady] = useState(false);
  const [globalDownloadState, setGlobalDownloadState] = useState<GlobalDownloadState | null>(null);
  const [globalDownloadMeta, setGlobalDownloadMeta] = useState<GlobalDownloadSessionMeta | null>(null);
  const [globalDownloadHistory, setGlobalDownloadHistory] = useState<GlobalDownloadHistoryItem[]>([]);
  const stopFetchRef = useRef(false);
  const fetchStartTimeRef = useRef<number | null>(null);
  const timeoutIntervalRef = useRef<number | null>(null);
  const singleFetchRequestIdRef = useRef<string | null>(null);
  const pendingResultRef = useRef<TwitterResponse | null>(null);
  const resultUpdateTimerRef = useRef<number | null>(null);
  const lastResultUpdateRef = useRef(0);
  
  // Multiple mode state
  const [fetchType, setFetchType] = useState<FetchType>("single");
  const [multipleAccounts, setMultipleAccounts] = useState<MultipleAccount[]>([]);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  
  // Mode state for SearchBar
  const [searchMode, setSearchMode] = useState<FetchMode>("public");
  const [searchPrivateType, setSearchPrivateType] = useState<PrivateType>("bookmarks");
  const stopAllRef = useRef(false);
  const accountStartTimesRef = useRef<Map<string, number>>(new Map());
  const accountStopFlagsRef = useRef<Map<string, boolean>>(new Map());
  const accountMediaCountRef = useRef<Map<string, number>>(new Map());
  const accountTimeoutSecondsRef = useRef<Map<string, number>>(new Map());
  const multipleAccountsRef = useRef<MultipleAccount[]>([]);
  const pendingAccountUpdatesRef = useRef<Map<string, Partial<MultipleAccount>>>(new Map());
  const diffVisibilityRef = useRef<Map<string, number>>(new Map());
  const activeAccountRequestIdsRef = useRef<Map<string, string>>(new Map());
  const activeDownloadMetaRef = useRef<GlobalDownloadSessionMeta | null>(null);
  const previousDownloadStateRef = useRef<GlobalDownloadState | null>(null);

  const setMultipleAccountsState = useCallback(
    (
      value:
        | MultipleAccount[]
        | ((previous: MultipleAccount[]) => MultipleAccount[])
    ) => {
      setMultipleAccounts((previous) => {
        const next =
          typeof value === "function"
            ? (value as (previous: MultipleAccount[]) => MultipleAccount[])(previous)
            : value;
        multipleAccountsRef.current = next;
        return next;
      });
    },
    []
  );

  const resetMultipleQueueState = useCallback(() => {
    setMultipleAccountsState([]);
    setIsFetchingAll(false);
    stopAllRef.current = true;
    accountStartTimesRef.current.clear();
    accountTimeoutSecondsRef.current.clear();
    accountStopFlagsRef.current.clear();
    accountMediaCountRef.current.clear();
    pendingAccountUpdatesRef.current.clear();
    diffVisibilityRef.current.clear();
    activeAccountRequestIdsRef.current.clear();
  }, [setMultipleAccountsState]);

  const queueMultipleAccountUpdate = useCallback(
    (accountId: string, patch: Partial<MultipleAccount>) => {
      const existing = pendingAccountUpdatesRef.current.get(accountId) || {};
      pendingAccountUpdatesRef.current.set(accountId, {
        ...existing,
        ...patch,
      });
    },
    []
  );

  const flushMultipleAccountUpdates = useCallback(() => {
    if (pendingAccountUpdatesRef.current.size === 0) {
      return;
    }

    const queuedUpdates = new Map(pendingAccountUpdatesRef.current);
    pendingAccountUpdatesRef.current.clear();

    startTransition(() => {
      setMultipleAccountsState((previous) =>
        previous.map((account) => {
          const patch = queuedUpdates.get(account.id);
          return patch ? { ...account, ...patch } : account;
        })
      );
    });
  }, [setMultipleAccountsState]);

  const clearAccountRuntimeState = useCallback(
    (accountId: string) => {
      accountStartTimesRef.current.delete(accountId);
      accountTimeoutSecondsRef.current.delete(accountId);
      diffVisibilityRef.current.delete(accountId);
      queueMultipleAccountUpdate(accountId, { showDiff: false });
    },
    [queueMultipleAccountUpdate]
  );

  const markAccountDiffVisible = useCallback(
    (accountId: string) => {
      diffVisibilityRef.current.set(accountId, Date.now() + DIFF_VISIBILITY_MS);
      queueMultipleAccountUpdate(accountId, { showDiff: true });
    },
    [queueMultipleAccountUpdate]
  );

  const cancelSingleActiveRequest = useCallback(async () => {
    const requestId = singleFetchRequestIdRef.current;
    if (!requestId) {
      return false;
    }

    singleFetchRequestIdRef.current = null;

    try {
      return await CancelExtractorRequest(requestId);
    } catch {
      return false;
    }
  }, []);

  const cancelAccountActiveRequest = useCallback(async (accountId: string) => {
    const requestId = activeAccountRequestIdsRef.current.get(accountId);
    if (!requestId) {
      return false;
    }

    activeAccountRequestIdsRef.current.delete(accountId);

    try {
      return await CancelExtractorRequest(requestId);
    } catch {
      return false;
    }
  }, []);

  const cancelAllActiveAccountRequests = useCallback(async () => {
    const requestIds = Array.from(activeAccountRequestIdsRef.current.values());
    activeAccountRequestIdsRef.current.clear();

    if (requestIds.length === 0) {
      return;
    }

    await Promise.all(
      requestIds.map((requestId) =>
        CancelExtractorRequest(requestId).catch(() => false)
      )
    );
  }, []);

  const handleDownloadSessionStart = useCallback((meta: GlobalDownloadSessionMeta) => {
    setGlobalDownloadMeta(meta);
    activeDownloadMetaRef.current = meta;
  }, []);

  const handleGlobalStopDownload = useCallback(async () => {
    try {
      const stopped = await StopDownload();
      if (stopped) {
        toast.info("Download stopped");
      }
    } catch (error) {
      console.error("Failed to stop download:", error);
    }
  }, []);

  const flushResultUpdate = useCallback((immediateResult?: TwitterResponse | null) => {
    if (resultUpdateTimerRef.current !== null) {
      window.clearTimeout(resultUpdateTimerRef.current);
      resultUpdateTimerRef.current = null;
    }

    const nextResult =
      immediateResult === undefined ? pendingResultRef.current : immediateResult;
    pendingResultRef.current = null;

    if (nextResult === undefined) {
      return;
    }

    lastResultUpdateRef.current = Date.now();
    startTransition(() => {
      setResult(nextResult ?? null);
    });
  }, []);

  const scheduleResultUpdate = useCallback(
    (nextResult: TwitterResponse | null, immediate = false) => {
      pendingResultRef.current = nextResult;

      if (immediate) {
        flushResultUpdate(nextResult);
        return;
      }

      const elapsed = Date.now() - lastResultUpdateRef.current;
      if (elapsed >= RESULT_UPDATE_THROTTLE_MS) {
        flushResultUpdate(nextResult);
        return;
      }

      if (resultUpdateTimerRef.current !== null) {
        return;
      }

      resultUpdateTimerRef.current = window.setTimeout(() => {
        flushResultUpdate();
      }, RESULT_UPDATE_THROTTLE_MS - elapsed);
    },
    [flushResultUpdate]
  );

  useEffect(() => {
    return () => {
      if (resultUpdateTimerRef.current !== null) {
        window.clearTimeout(resultUpdateTimerRef.current);
      }
    };
  }, []);

  const loadSnapshotFromDB = useCallback(
    async (scope: FetchScope): Promise<TwitterResponse | null> => {
      try {
        const snapshot = await GetAccountSnapshotStructured({
          username: scope.username,
          media_type: scope.mediaType || "all",
          timeline_type: scope.timelineType || "timeline",
          retweets: scope.retweets ?? false,
          query_key: scope.queryKey || "",
        });
        if (!snapshot) {
          return null;
        }

        return normalizeStructuredResponse(snapshot);
      } catch (error) {
        console.error("Failed to load snapshot from database:", error);
        return null;
      }
    },
    []
  );

  const buildFetchScope = useCallback(
    ({
      username,
      mediaType = "all",
      timelineType = "timeline",
      retweets = false,
      queryKey = "",
    }: FetchScope): FetchScope => ({
      username: username.trim(),
      mediaType,
      timelineType,
      retweets,
      queryKey,
    }),
    []
  );

  const buildTwitterResponse = useCallback(
    (
      accountInfo: TwitterResponse["account_info"],
      timeline: TwitterResponse["timeline"],
      newEntries: number,
      page: number,
      batchSize: number,
      hasMore: boolean,
      cursor?: string,
      completed = true
    ): TwitterResponse => ({
      account_info: accountInfo,
      timeline,
      total_urls: timeline.length,
      metadata: {
        new_entries: newEntries,
        page,
        batch_size: batchSize,
        has_more: hasMore,
        cursor,
        completed,
      },
      cursor,
      completed,
    }),
    []
  );

  const saveAccountSnapshotChunk = useCallback(
    async (
      scope: FetchScope,
      accountInfo: TwitterResponse["account_info"],
      entries: TwitterResponse["timeline"],
      cursor: string | undefined,
      completed: boolean,
      totalMedia: number
    ) => {
      await SaveAccountSnapshotChunk(new main.SaveAccountSnapshotChunkRequest({
        scope: {
          username: scope.username,
          media_type: scope.mediaType || "all",
          timeline_type: scope.timelineType || "timeline",
          retweets: scope.retweets ?? false,
          query_key: scope.queryKey || "",
        },
        account_info: accountInfo,
        entries,
        cursor: cursor || "",
        completed,
        total_media: totalMedia,
      }));
    },
    []
  );

  const handleMultiAccountDownload = useCallback(async () => {
    if (globalDownloadState?.in_progress) {
      toast.warning("A download is already in progress");
      return;
    }

    const accountsToDownload = multipleAccountsRef.current.filter(
      (account) => account.mediaCount > 0
    );

    if (accountsToDownload.length === 0) {
      toast.error("No fetched media is ready to download yet");
      return;
    }
    const scopes = accountsToDownload.map((account) => {
      const accountMode = account.mode ?? searchMode;
      const accountPrivateType = account.privateType ?? searchPrivateType;
      const accountMediaType = account.mediaType ?? fetchedMediaType ?? "all";
      const accountRetweets = account.retweets ?? false;
      const timelineType = resolveFetchTimelineType(
        false,
        accountMode,
        accountPrivateType,
        accountMediaType,
        accountRetweets
      );

      return {
        username: account.username,
        media_type: accountMediaType,
        timeline_type: timelineType,
        retweets: accountRetweets,
        query_key: "",
      };
    });

    const totalItems = accountsToDownload.reduce(
      (sum, account) => sum + account.mediaCount,
      0
    );

    handleDownloadSessionStart({
      source: "multi-account-workspace",
      title: `Downloading ${accountsToDownload.length} Accounts`,
      subtitle: `${formatNumberWithComma(totalItems)} item(s) from ${formatNumberWithComma(accountsToDownload.length)} fetched account(s)`,
      targetKey: "multi-account-workspace",
    });

    try {
      const settings = getSettings();
      const response = await DownloadSavedScopes(new main.DownloadSavedScopesRequest({
        scopes,
        output_dir: settings.downloadPath || "",
        proxy: settings.proxy || "",
      }));

      if (response.success) {
        const parts: string[] = [];
        if (response.downloaded > 0) {
          parts.push(`${response.downloaded} downloaded`);
        }
        if (response.skipped > 0) {
          parts.push(`${response.skipped} skipped`);
        }
        if (response.failed > 0) {
          parts.push(`${response.failed} failed`);
        }
        toast.success(parts.length > 0 ? parts.join(", ") : "Download completed");
      } else {
        toast.error(response.message || "Download failed");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Multi-account download failed: ${errorMsg}`);
      toast.error("Multi-account download failed");
    }
  }, [
    buildFetchScope,
    fetchedMediaType,
    globalDownloadState?.in_progress,
    handleDownloadSessionStart,
    searchMode,
    searchPrivateType,
  ]);

  const handleDownloadFetchedAccounts = useCallback(() => {
    void handleMultiAccountDownload();
  }, [handleMultiAccountDownload]);

  useEffect(() => {
    const settings = getSettings();
    applyThemeMode(settings.themeMode);
    applyTheme(settings.theme);
    applyFont(settings.fontFamily);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentSettings = getSettings();
      if (currentSettings.themeMode === "auto") {
        applyThemeMode("auto");
        applyTheme(currentSettings.theme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    loadHistory();

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (workspaceTab === "saved") {
      setSavedTabVisited(true);
    }
  }, [workspaceTab]);

  useEffect(() => {
    let active = true;

    const loadStoredTokens = async () => {
      try {
        const tokens = await GetStoredAuthTokens();
        if (!active) {
          return;
        }

        if (rememberPublicToken && tokens.public_token) {
          setPublicAuthToken(tokens.public_token);
        }
        if (rememberPrivateToken && tokens.private_token) {
          setPrivateAuthToken(tokens.private_token);
        }
      } catch (error) {
        console.error("Failed to load stored auth tokens:", error);
      } finally {
        if (active) {
          setStoredTokensReady(true);
        }
      }
    };

    loadStoredTokens();

    return () => {
      active = false;
    };
  }, [rememberPublicToken, rememberPrivateToken]);

  useEffect(() => {
    multipleAccountsRef.current = multipleAccounts;
  }, [multipleAccounts]);

  useEffect(() => {
    if (!storedTokensReady) {
      return;
    }

    SaveStoredAuthTokens({
      public_token: rememberPublicToken ? publicAuthToken.trim() : "",
      private_token: rememberPrivateToken ? privateAuthToken.trim() : "",
    }).catch((error) => {
      console.error("Failed to persist auth tokens:", error);
    });
  }, [storedTokensReady, publicAuthToken, privateAuthToken, rememberPublicToken, rememberPrivateToken]);

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setFetchHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const saveHistory = (history: HistoryItem[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("Failed to save history:", err);
    }
  };

  const addToHistory = (data: TwitterResponse, inputUsername: string) => {
    // Clean username (remove @ and extract from URL if needed)
    let cleanUsername = inputUsername.trim();
    if (cleanUsername.startsWith("@")) {
      cleanUsername = cleanUsername.slice(1);
    }
    if (cleanUsername.includes("x.com/") || cleanUsername.includes("twitter.com/")) {
      const match = cleanUsername.match(/(?:x\.com|twitter\.com)\/([^/?]+)/);
      if (match) cleanUsername = match[1];
    }

    setFetchHistory((prev) => {
      // Use username from API response (account_info.name) for consistency
      const apiUsername = data.account_info.name;
      const filtered = prev.filter((h) => h.username.toLowerCase() !== apiUsername.toLowerCase());
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        username: apiUsername,           // username/handle from API
        name: data.account_info.nick,    // display name from API
        image: data.account_info.profile_image,
        mediaCount: data.total_urls,
        timestamp: Date.now(),
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  };

  const removeFromHistory = (id: string) => {
    setFetchHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      saveHistory(updated);
      return updated;
    });
  };

  const clearFetchHistory = () => {
    setFetchHistory([]);
    saveHistory([]);
  };

  const handleHistorySelect = (item: HistoryItem) => {
    setWorkspaceTab("fetch");
    setUsername(item.username);
  };

  // Check for resumable fetch when username changes
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
  }, [username, checkResumable]);

  const handleStopFetch = useCallback(async () => {
    stopFetchRef.current = true;
    logger.info("Stopping fetch...");
    toast.info("Stopping...");
    await cancelSingleActiveRequest();
  }, [cancelSingleActiveRequest]);

  // Timer effect for fetch timeout
  useEffect(() => {
    if (loading && fetchStartTimeRef.current !== null) {
      const settings = getSettings();
      const timeoutSeconds = settings.fetchTimeout || 60;
      
      // Update timer every second
      timeoutIntervalRef.current = window.setInterval(() => {
        if (fetchStartTimeRef.current !== null) {
          const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
          setElapsedTime(elapsed);
          const remaining = Math.max(0, timeoutSeconds - elapsed);
          setRemainingTime(remaining);
          
          // Auto-stop if timeout reached
          if (remaining <= 0) {
            stopFetchRef.current = true;
            logger.warning("Fetch timeout reached. Stopping...");
            toast.warning("Fetch timeout reached. Stopping...");
            handleStopFetch();
          }
        }
      }, 1000);
    } else {
      if (timeoutIntervalRef.current !== null) {
        clearInterval(timeoutIntervalRef.current);
        timeoutIntervalRef.current = null;
      }
      setElapsedTime(0);
      setRemainingTime(null);
      fetchStartTimeRef.current = null;
    }

    return () => {
      if (timeoutIntervalRef.current !== null) {
        clearInterval(timeoutIntervalRef.current);
        timeoutIntervalRef.current = null;
      }
    };
  }, [loading, handleStopFetch]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      const timedOutAccountIds: string[] = [];

      for (const [accountId, expiresAt] of diffVisibilityRef.current.entries()) {
        if (now >= expiresAt) {
          diffVisibilityRef.current.delete(accountId);
          queueMultipleAccountUpdate(accountId, { showDiff: false });
        }
      }

      for (const [accountId, startTime] of accountStartTimesRef.current.entries()) {
        const timeoutSeconds = accountTimeoutSecondsRef.current.get(accountId);
        if (!timeoutSeconds) {
          continue;
        }

        const elapsed = Math.floor((now - startTime) / 1000);
        const remaining = Math.max(0, timeoutSeconds - elapsed);
        queueMultipleAccountUpdate(accountId, {
          elapsedTime: elapsed,
          remainingTime: remaining,
        });

        if (remaining <= 0) {
          accountStopFlagsRef.current.set(accountId, true);
          timedOutAccountIds.push(accountId);
          clearAccountRuntimeState(accountId);

          const mediaCount = accountMediaCountRef.current.get(accountId) || 0;
          queueMultipleAccountUpdate(accountId, {
            status: mediaCount === 0 ? "failed" : "incomplete",
            remainingTime: 0,
            mediaCount,
          });
        }
      }

      flushMultipleAccountUpdates();

      if (timedOutAccountIds.length > 0) {
        Promise.all(
          timedOutAccountIds.map((accountId) => cancelAccountActiveRequest(accountId))
        ).catch(() => {});
      }
    }, MULTIPLE_PROGRESS_FLUSH_INTERVAL);

    return () => {
      clearInterval(interval);
    };
  }, [cancelAccountActiveRequest, clearAccountRuntimeState, flushMultipleAccountUpdates, queueMultipleAccountUpdate]);

  useEffect(() => {
    const syncDownloadState = (state: GlobalDownloadState) => {
      const previousState = previousDownloadStateRef.current;

      if (state.in_progress) {
        setGlobalDownloadState(state);
        previousDownloadStateRef.current = state;
        return;
      }

      if (previousState?.in_progress) {
        const meta = activeDownloadMetaRef.current || {
          source: "media-list" as const,
          title: "Downloading media",
          subtitle: "Background download task",
        };

        setGlobalDownloadHistory((previousHistory) => [
          {
            id: crypto.randomUUID(),
            title: meta.title,
            subtitle: meta.subtitle,
            status: previousState.current >= previousState.total
              ? ("completed" as const)
              : ("interrupted" as const),
            current: previousState.current,
            total: previousState.total,
            finishedAt: Date.now(),
          },
          ...previousHistory,
        ].slice(0, 6));
      }

      setGlobalDownloadState(null);
      activeDownloadMetaRef.current = null;
      previousDownloadStateRef.current = state;
    };

    GetDownloadStatus()
      .then(syncDownloadState)
      .catch((error) => {
        console.error("Failed to load global download status:", error);
      });

    const unsubscribe = EventsOn("download-state", (state: GlobalDownloadState) => {
      syncDownloadState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const activityPanelState = useActivityPanelState({
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
  });

  const handleFetch = async (
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
    // Prevent multiple concurrent fetches
    if (loading || isFetchingAll) {
      logger.warning("A fetch is already in progress, please wait or stop it first");
      toast.warning("A fetch is already in progress");
      return;
    }

    // Validate based on mode
    const isBookmarks = mode === "private" && privateType === "bookmarks";
    const isLikes = mode === "private" && privateType === "likes";
    const parsedUsernames = !isBookmarks ? parseUsernameList(username) : [];

    // Username required for public mode and likes mode
    if (!isBookmarks && parsedUsernames.length === 0) {
      toast.error("Please enter a username");
      return;
    }

    if (isLikes && parsedUsernames.length > 1) {
      toast.error("Likes mode only supports one username at a time");
      return;
    }

    // Use auth token from SearchBar
    if (!authToken?.trim()) {
      toast.error("Please enter your auth token");
      return;
    }

    const effectiveMediaType = mediaType || "all";
    const effectiveRetweets = retweets || false;
    const shouldUseQueue = mode === "public" && parsedUsernames.length > 1;

    if (shouldUseQueue) {
      if (useDateRange) {
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
      flushResultUpdate(null);
      setResumeInfo(null);

      await handleFetchAll(accounts, {
        mode,
        privateType,
        mediaType: effectiveMediaType,
        retweets: effectiveRetweets,
        authToken: authToken.trim(),
      });
      return;
    }

    resetMultipleQueueState();
    setFetchType("single");

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

    // Reset state for new fetch
    setLoading(true);
    setFetchedMediaType(effectiveMediaType);
    stopFetchRef.current = false;
    fetchStartTimeRef.current = Date.now();
    setElapsedTime(0);
    setNewMediaCount(null);
    
    // Get timeout from settings
    const settings = getSettings();
    const timeoutSeconds = settings.fetchTimeout || 60;
    setRemainingTime(timeoutSeconds);

    // Determine what we're fetching for logging
    const fetchTarget = isBookmarks
      ? "your bookmarks"
      : isLikes
        ? "your likes"
        : `@${singleUsername}`;

    // Check for resume state
    let existingState: FetchState | null = null;
    let cursor: string | undefined;
    let accountInfo: TwitterResponse["account_info"] | null = null;
    let savedCompletedSnapshot: TwitterResponse | null = null;
    let knownTweetIds = new Set<string>();
    const seenSessionEntryKeys = new Set<string>();
    const sessionAccumulator = createTimelineAccumulator();
    const freshAccumulator = createTimelineAccumulator();
    let overlapReached = false;
    let totalNewItemsFound = 0;
    let isIncrementalRefresh = false;

    if (isResume) {
      existingState = getFetchState(fetchScope);
      const savedSnapshot = await loadSnapshotFromDB(fetchScope);
      if (savedSnapshot && savedSnapshot.cursor && !savedSnapshot.completed) {
        cursor = savedSnapshot.cursor;
        accountInfo = savedSnapshot.account_info;
        appendUniqueEntries(sessionAccumulator, savedSnapshot.timeline || []);
        logger.info(`Resuming ${fetchTarget} from ${sessionAccumulator.timeline.length} items...`);
        scheduleResultUpdate(savedSnapshot, true);
      } else if (existingState && existingState.cursor && !existingState.completed) {
        cursor = existingState.cursor;
        accountInfo = existingState.accountInfo;
        logger.info(`Resuming ${fetchTarget} from ${existingState.totalFetched} items...`);
      } else {
        toast.error("No resumable fetch found");
        setLoading(false);
        return;
      }
    } else {
      // Fresh fetch - clear any existing state for the exact scope
      clearFetchState(fetchScope);
      clearCursor(fetchScope);
      const savedSnapshot = await loadSnapshotFromDB(fetchScope);
      if (savedSnapshot?.completed && savedSnapshot.timeline.length > 0) {
        savedCompletedSnapshot = savedSnapshot;
        knownTweetIds = buildKnownTweetIdSet(savedSnapshot.timeline);
        accountInfo = savedSnapshot.account_info;
        isIncrementalRefresh = true;
        scheduleResultUpdate(savedSnapshot, true);
        logger.info(
          `Refreshing ${fetchTarget} with ${formatNumberWithComma(savedSnapshot.timeline.length)} saved items as the overlap boundary...`
        );
      } else {
        scheduleResultUpdate(null, true);
        logger.info(`Fetching ${fetchTarget}...`);
      }
    }

    try {
      let finalData: TwitterResponse | null = null;

      if (useDateRange && startDate && endDate && mode === "public") {
        // Date range mode - single fetch (only for public mode)
        logger.info(`Using date range: ${startDate} to ${endDate}`);
        
        // Check timeout before date range fetch
        if (fetchStartTimeRef.current !== null) {
          const settings = getSettings();
          const timeoutSeconds = settings.fetchTimeout || 60;
          const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
          if (elapsed >= timeoutSeconds) {
            logger.warning(`Timeout reached (${timeoutSeconds}s). Stopping fetch...`);
            stopFetchRef.current = true;
            toast.warning("Fetch timeout reached. Stopping...");
            setLoading(false);
            return;
          }
        }
        
        const requestId = crypto.randomUUID();
        singleFetchRequestIdRef.current = requestId;

        finalData = normalizeStructuredResponse(
          await ExtractDateRangeStructured(new main.DateRangeRequest({
          username: singleUsername,
          auth_token: authToken.trim(),
          start_date: startDate,
          end_date: endDate,
          media_filter: effectiveMediaType,
          retweets: effectiveRetweets,
          request_id: requestId,
        })).finally(() => {
          if (singleFetchRequestIdRef.current === requestId) {
            singleFetchRequestIdRef.current = null;
          }
        })
        );
        
        if (finalData && finalData.account_info) {
          try {
            await saveAccountSnapshotChunk(
              fetchScope,
              finalData.account_info,
              finalData.timeline,
              finalData.cursor,
              finalData.completed ?? true,
              finalData.total_urls
            );
          } catch (err) {
            console.error("Failed to save date range data to database:", err);
          }
        }
      } else {
        // Timeline mode - check fetch mode from settings
        const settings = getSettings();
        const isSingleMode = settings.fetchMode === "single";
        const batchSize = isSingleMode ? 0 : BATCH_SIZE;
        
        let hasMore = true;
        let page = 0;

        // Single mode: one fetch, no loop
        // Batch mode: loop until done or stopped
        while (hasMore && !stopFetchRef.current) {
          // Check timeout before each batch
          if (fetchStartTimeRef.current !== null) {
            const settings = getSettings();
            const timeoutSeconds = settings.fetchTimeout || 60;
            const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
            if (elapsed >= timeoutSeconds) {
              logger.warning(`Timeout reached (${timeoutSeconds}s). Stopping fetch...`);
              stopFetchRef.current = true;
              toast.warning("Fetch timeout reached. Stopping...");
              
              // IMPORTANT: Save state immediately before breaking out of loop
              // This ensures no data is lost when timeout occurs
              const currentTotalFetched = isIncrementalRefresh && savedCompletedSnapshot
                ? savedCompletedSnapshot.timeline.length + freshAccumulator.timeline.length
                : sessionAccumulator.timeline.length;

              if (accountInfo && currentTotalFetched > 0) {
                saveFetchState({
                  ...fetchScope,
                  cursor: cursor || "",
                  accountInfo,
                  totalFetched: currentTotalFetched,
                  completed: false,
                });

                try {
                  await saveAccountSnapshotChunk(
                    fetchScope,
                    accountInfo,
                    [],
                    cursor,
                    false,
                    currentTotalFetched
                  );
                  logger.info(`Saved ${currentTotalFetched} items before timeout`);
                } catch (err) {
                  console.error("Failed to save timeout state to database:", err);
                }
              }
              break;
            }
          }

          const batchNum = page + 1;
          logger.info(isSingleMode ? "Fetching all media..." : `Fetching batch ${batchNum}${cursor ? " (resuming)" : ""}...`);

          const requestId = crypto.randomUUID();
          singleFetchRequestIdRef.current = requestId;

          const structuredData = await ExtractTimelineStructured(new main.TimelineRequest({
            username: isBookmarks ? "" : singleUsername,
            auth_token: authToken.trim(),
            timeline_type: timelineType,
            batch_size: batchSize,
            page: page,
            media_type: effectiveMediaType,
            retweets: effectiveRetweets,
            request_id: requestId,
            cursor: cursor,
          })).finally(() => {
            if (singleFetchRequestIdRef.current === requestId) {
              singleFetchRequestIdRef.current = null;
            }
          });
          const data = normalizeStructuredResponse(structuredData);
          if (!data) {
            throw new Error("Empty timeline response");
          }

          // Set account info from first response
          if (!accountInfo && data.account_info) {
            accountInfo = data.account_info;
            if (isBookmarks) {
              // For bookmarks, ensure name is "bookmarks" and nick is "My Bookmarks"
              accountInfo.name = "bookmarks";
              accountInfo.nick = "My Bookmarks";
            } else if (isLikes) {
              // For likes, ensure name is "likes" and nick is "My Likes"
              accountInfo.name = "likes";
              accountInfo.nick = "My Likes";
            }
          }

          let batchNewEntries = data.timeline;

          if (isIncrementalRefresh && savedCompletedSnapshot) {
            const { freshEntries, overlapReached: batchOverlapReached } =
              collectIncrementalEntries(
                data.timeline,
                knownTweetIds,
                seenSessionEntryKeys
              );

            batchNewEntries = appendUniqueEntries(freshAccumulator, freshEntries);
            totalNewItemsFound = freshAccumulator.timeline.length;
            overlapReached = overlapReached || batchOverlapReached;

            if (totalNewItemsFound > 0) {
              setNewMediaCount(totalNewItemsFound);
            }
          } else {
            batchNewEntries = appendUniqueEntries(sessionAccumulator, data.timeline);
            const newCount = batchNewEntries.length;

            if (newCount > 0) {
              setNewMediaCount(newCount);
            }
          }

          // Update cursor for next batch
          cursor = data.cursor;
          hasMore = !!data.cursor && !data.completed;
          if (overlapReached) {
            hasMore = false;
            cursor = undefined;
            logger.info(
              `Reached previously saved items for ${fetchTarget}; stopping incremental refresh early.`
            );
          }
          page++;

          // Save cursor every batch (lightweight, just a string)
          if (cursor && hasMore) {
            saveCursor(fetchScope, cursor);
          }

          // Update UI progressively - show results immediately
          if (accountInfo) {
            const currentTimeline =
              isIncrementalRefresh && savedCompletedSnapshot
                ? mergeFetchedWithSavedTimeline(
                    freshAccumulator.timeline,
                    savedCompletedSnapshot.timeline
                  )
                : createResultTimeline(sessionAccumulator);
            const currentResponse = buildTwitterResponse(
              accountInfo,
              currentTimeline,
              batchNewEntries.length,
              page,
              batchSize,
              hasMore,
              cursor,
              !hasMore
            );
            scheduleResultUpdate(currentResponse, !hasMore || page === 1);
          }

          const currentTotalFetched = isIncrementalRefresh && savedCompletedSnapshot
            ? savedCompletedSnapshot.timeline.length + freshAccumulator.timeline.length
            : sessionAccumulator.timeline.length;
          logger.info(`Fetched ${currentTotalFetched} items total`);

          saveFetchState({
            ...fetchScope,
            cursor: cursor || "",
            accountInfo: accountInfo,
            totalFetched: currentTotalFetched,
            completed: !hasMore,
          });

          if (accountInfo) {
            try {
              await saveAccountSnapshotChunk(
                fetchScope,
                accountInfo,
                batchNewEntries,
                cursor,
                !hasMore,
                currentTotalFetched
              );
            } catch (err) {
              console.error("Failed to save progress to database:", err);
            }
          }
        }

        // If stopped by user, keep state for resume
        if (stopFetchRef.current) {
          const elapsedSecs = fetchStartTimeRef.current ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000) : 0;
          const currentTotalFetched = isIncrementalRefresh && savedCompletedSnapshot
            ? savedCompletedSnapshot.timeline.length + freshAccumulator.timeline.length
            : sessionAccumulator.timeline.length;
          logger.info(`Stopped at ${currentTotalFetched} items - can resume later (${elapsedSecs}s)`);
          toast.info(`Stopped at ${formatNumberWithComma(currentTotalFetched)} items`);
          const resumable = getResumableInfo(cleanUsername, fetchScope);
          setResumeInfo(resumable.canResume ? resumable : null);
        } else {
          // Completed - clear state
          clearFetchState(fetchScope);
          clearCursor(fetchScope);
          setResumeInfo(null);
        }

        // Build final response
        finalData = accountInfo
          ? buildTwitterResponse(
              accountInfo,
              isIncrementalRefresh && savedCompletedSnapshot
                ? mergeFetchedWithSavedTimeline(
                    freshAccumulator.timeline,
                    savedCompletedSnapshot.timeline
                  )
                : createResultTimeline(sessionAccumulator),
              isIncrementalRefresh
                ? totalNewItemsFound
                : sessionAccumulator.timeline.length,
              page,
              batchSize,
              false,
              cursor,
              !stopFetchRef.current
            )
          : null;
      }

      if (finalData) {
        flushResultUpdate(finalData);

        // Only add to history for public mode
        if (mode === "public") {
          addToHistory(finalData, singleUsername);
        }

        try {
          await saveAccountSnapshotChunk(
            fetchScope,
            finalData.account_info,
            useDateRange ? finalData.timeline : [],
            finalData.cursor,
            finalData.completed ?? !stopFetchRef.current,
            finalData.total_urls
          );
        } catch (err) {
          console.error("Failed to save final status to database:", err);
        }

        if (!stopFetchRef.current) {
          const elapsedSecs = fetchStartTimeRef.current ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000) : 0;
          if (isIncrementalRefresh) {
            if (totalNewItemsFound > 0) {
              logger.success(
                `Found ${totalNewItemsFound} new media items (${finalData.total_urls} total, ${elapsedSecs}s)`
              );
              toast.success(
                `${formatNumberWithComma(totalNewItemsFound)} new media items found`
              );
              setNewMediaCount(totalNewItemsFound);
            } else {
              logger.success(`No new media items (${elapsedSecs}s)`);
              toast.success("No new media items");
              setNewMediaCount(null);
            }
          } else {
            logger.success(`Found ${finalData.total_urls} media items (${elapsedSecs}s)`);
            toast.success(`${finalData.total_urls} media items found`);
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const elapsedSecs = fetchStartTimeRef.current ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000) : 0;
      const isCanceled = stopFetchRef.current || errorMsg.toLowerCase().includes("extractor canceled");

      if (isCanceled) {
        logger.info(`Fetch stopped: ${errorMsg} (${elapsedSecs}s)`);
      } else {
        logger.error(`Failed to fetch: ${errorMsg} (${elapsedSecs}s)`);
        toast.error("Failed to fetch media");
      }

      let partialResponse: TwitterResponse | null = null;
      const currentTotalFetched = isIncrementalRefresh && savedCompletedSnapshot
        ? savedCompletedSnapshot.timeline.length + freshAccumulator.timeline.length
        : sessionAccumulator.timeline.length;
      if (accountInfo && currentTotalFetched > 0) {
        partialResponse = buildTwitterResponse(
          accountInfo,
          isIncrementalRefresh && savedCompletedSnapshot
            ? mergeFetchedWithSavedTimeline(
                freshAccumulator.timeline,
                savedCompletedSnapshot.timeline
              )
            : createResultTimeline(sessionAccumulator),
          0,
          0,
          BATCH_SIZE,
          true,
          cursor,
          false
        );
      } else {
        partialResponse = await loadSnapshotFromDB(fetchScope);
      }

      if (partialResponse) {
        flushResultUpdate(partialResponse);
        saveFetchState({
          ...fetchScope,
          cursor: partialResponse.cursor || cursor || "",
          accountInfo: partialResponse.account_info,
          totalFetched: partialResponse.timeline.length,
          completed: false,
        });

        const resumable = getResumableInfo(cleanUsername, fetchScope);
        setResumeInfo(resumable.canResume ? resumable : null);
        toast.info(`Saved ${formatNumberWithComma(partialResponse.timeline.length)} items - can resume`);

        try {
          await saveAccountSnapshotChunk(
            fetchScope,
            partialResponse.account_info,
            [],
            partialResponse.cursor || cursor,
            false,
            partialResponse.timeline.length
          );
        } catch (dbErr) {
          console.error("Failed to save partial data to database:", dbErr);
        }
      }
    } finally {
      singleFetchRequestIdRef.current = null;
      setLoading(false);
      // Reset timer when fetch completes or stops
      fetchStartTimeRef.current = null;
      setElapsedTime(0);
      setRemainingTime(null);
    }
  };

  // Handle resume fetch
  const handleResume = (authToken: string, mediaType?: string, retweets?: boolean) => {
    if (!resumeInfo?.canResume) {
      toast.error("No resumable fetch found");
      return;
    }

    handleFetch(
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
  };

  // Clear resume state
  const handleClearResume = () => {
    if (username.trim()) {
      clearFetchStatesForUsername(username.trim());
      clearCursorsForUsername(username.trim());
      setResumeInfo(null);
      toast.info("Resume data cleared");
    }
  };

  const handleLoadFromDB = useCallback(async (account: backend.AccountListItem) => {
    const scope = buildFetchScope({
      username: account.username,
      mediaType: account.media_type || "all",
      timelineType: account.timeline_type || "timeline",
      retweets: account.retweets ?? false,
      queryKey: account.query_key || "",
    });

    try {
      const data = await loadSnapshotFromDB(scope);
      if (!data) {
        toast.error("Failed to load saved data");
        return;
      }

      resetMultipleQueueState();
      flushResultUpdate(data);
      setUsername(account.username);
      setFetchedMediaType(account.media_type || "all");
      setNewMediaCount(null);
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
    } catch (error) {
      console.error("Failed to load saved account:", error);
      toast.error("Failed to load saved data");
    }
  }, [buildFetchScope, flushResultUpdate, loadSnapshotFromDB, resetMultipleQueueState]);

  // Handle update selected accounts from database view
  const handleUpdateSelected = (usernames: string[]) => {
    if (usernames.length === 0) {
      toast.error("No accounts selected");
      return;
    }

    // Parse usernames (same as handleImportFile)
    const parsedUsernames = usernames.map(parseUsername).filter(Boolean);
    const currentSettings = getSettings();
    const accounts = createMultipleAccounts(parsedUsernames, {
      mode: "public",
      mediaType: currentSettings.mediaType,
      retweets: currentSettings.includeRetweets,
    });

    // Merge with existing accounts (avoid duplicates by username)
    setMultipleAccountsState((prev) => {
      const existingUsernames = new Set(prev.map((acc) => acc.username.toLowerCase()));
      const newAccounts = accounts.filter(
        (acc) => !existingUsernames.has(acc.username.toLowerCase())
      );
      return [...prev, ...newAccounts];
    });

    // Set fetch type to multiple and navigate to home
    setFetchType("multiple");
    setWorkspaceTab("fetch");
    toast.success(`Added ${formatNumberWithComma(accounts.length)} account(s) to multiple fetch`);
  };

  // Handle import txt file
  const handleImportFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
        
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
  };

  // Handle fetch all accounts
  const handleFetchAll = async (
    accountsOverride?: MultipleAccount[],
    options?: {
      mode?: FetchMode;
      privateType?: PrivateType;
      mediaType?: string;
      retweets?: boolean;
      authToken?: string;
    }
  ) => {
    const requestedAccounts = accountsOverride ?? multipleAccountsRef.current;
    if (requestedAccounts.length === 0) {
      toast.error("No accounts to fetch");
      return;
    }

    const queueMode = options?.mode ?? searchMode;
    const queuePrivateType = options?.privateType ?? searchPrivateType;
    const queueMediaType = options?.mediaType ?? fetchedMediaType ?? "all";
    const queueRetweets = options?.retweets ?? false;
    const resolvedAuthToken =
      options?.authToken ??
      (queueMode === "public" ? publicAuthToken.trim() : privateAuthToken.trim());

    if (queueMode === "private" && queuePrivateType === "bookmarks") {
      toast.error("Bookmarks only support one account at a time");
      return;
    }

    if (!resolvedAuthToken.trim()) {
      toast.error("Please enter your auth token");
      return;
    }

    setIsFetchingAll(true);
    setLoading(false);
    setFetchType("multiple");
    flushResultUpdate(null);
    setResumeInfo(null);
    stopAllRef.current = false;
    activeAccountRequestIdsRef.current.clear();

    // Get timeout from settings
    const settings = getSettings();
    const timeoutSeconds = settings.fetchTimeout || 60;

    const seededAccounts = requestedAccounts.map((account) => ({
      ...account,
      mode: account.mode ?? queueMode,
      privateType: account.privateType ?? queuePrivateType,
      mediaType: account.mediaType ?? queueMediaType,
      retweets: account.retweets ?? queueRetweets,
      status: "pending" as const,
      mediaCount: 0,
      previousMediaCount: 0,
      elapsedTime: 0,
      remainingTime: timeoutSeconds,
      error: undefined,
      showDiff: false,
    }));

    // Reset all accounts to pending
    setMultipleAccountsState(seededAccounts);

    // Get current accounts list (use state getter function)
    const currentAccounts = [...seededAccounts];
    const fetchSettings = getSettings();
    const isSingleModeMultiple = fetchSettings.fetchMode === "single";
    const batchSizeMultiple = isSingleModeMultiple ? 0 : BATCH_SIZE;

    const fetchAccount = async (account: MultipleAccount) => {
      const accountId = account.id;
      const cleanUsername = account.username.trim();
      const accountMode = account.mode ?? queueMode;
      const accountPrivateType = account.privateType ?? queuePrivateType;
      const accountMediaType = account.mediaType ?? queueMediaType;
      const accountRetweets = account.retweets ?? queueRetweets;
      const multipleTimelineType = resolveFetchTimelineType(
        false,
        accountMode,
        accountPrivateType,
        accountMediaType,
        accountRetweets
      );
      const accountScope = buildFetchScope({
        username: cleanUsername,
        mediaType: accountMediaType,
        timelineType: multipleTimelineType,
        retweets: accountRetweets,
      });
      const savedSnapshot = await loadSnapshotFromDB(accountScope);
      const incrementalSnapshot =
        savedSnapshot?.completed && savedSnapshot.timeline.length > 0
          ? savedSnapshot
          : null;
      const knownTweetIds = incrementalSnapshot
        ? buildKnownTweetIdSet(incrementalSnapshot.timeline)
        : new Set<string>();
      const seenSessionEntryKeys = new Set<string>();
      const queuedEntryAccumulator = createTimelineAccumulator();
      let overlapReached = false;
      let accountInfo: TwitterResponse["account_info"] | null =
        incrementalSnapshot?.account_info || null;
      let cursor: string | undefined;
      let hasMore = true;
      let page = 0;
      const incrementalBaseCount = incrementalSnapshot?.timeline.length || 0;
      let currentMediaCount = incrementalBaseCount;
      let previousMediaCount =
        incrementalBaseCount || account.mediaCount || 0;

      accountStopFlagsRef.current.set(accountId, false);
      accountMediaCountRef.current.set(accountId, previousMediaCount);

      queueMultipleAccountUpdate(accountId, {
        status: "fetching",
        accountInfo: accountInfo || undefined,
        mediaCount: previousMediaCount,
        previousMediaCount,
        elapsedTime: 0,
        remainingTime: timeoutSeconds,
        error: undefined,
        showDiff: false,
      });
      flushMultipleAccountUpdates();

      accountStartTimesRef.current.set(accountId, Date.now());
      accountTimeoutSecondsRef.current.set(accountId, timeoutSeconds);

      try {
        // Check if account should be stopped
        if (stopAllRef.current) {
          clearAccountRuntimeState(accountId);
          // Check if any media was fetched
          const mediaCount = accountMediaCountRef.current.get(accountId) || account.mediaCount || 0;
          queueMultipleAccountUpdate(accountId, {
            status: mediaCount === 0 ? "failed" : "incomplete",
            mediaCount,
          });
          flushMultipleAccountUpdates();
          return;
        }

        while (hasMore && !stopAllRef.current) {
          // Check if this specific account should be stopped (timeout)
          if (accountStopFlagsRef.current.get(accountId)) {
            if (accountInfo && currentMediaCount > 0) {
              saveFetchState({
                ...accountScope,
                cursor: cursor || "",
                accountInfo,
                totalFetched: currentMediaCount,
                completed: false,
              });

              try {
                await saveAccountSnapshotChunk(
                  accountScope,
                  accountInfo,
                  [],
                  cursor,
                  false,
                  currentMediaCount
                );
              } catch (err) {
                console.error("Failed to save timeout state to database:", err);
              }
            }
            break;
          }

          const requestId = crypto.randomUUID();
          activeAccountRequestIdsRef.current.set(accountId, requestId);

          const structuredData = await ExtractTimelineStructured(new main.TimelineRequest({
            username: accountMode === "private" && accountPrivateType === "bookmarks" ? "" : cleanUsername,
            auth_token: resolvedAuthToken.trim(),
            timeline_type: multipleTimelineType,
            batch_size: batchSizeMultiple,
            page: page,
            media_type: accountMediaType,
            retweets: accountRetweets,
            request_id: requestId,
            cursor: cursor,
          })).finally(() => {
            if (activeAccountRequestIdsRef.current.get(accountId) === requestId) {
              activeAccountRequestIdsRef.current.delete(accountId);
            }
          });
          const data = normalizeStructuredResponse(structuredData);
          if (!data) {
            throw new Error("Empty timeline response");
          }

          if (!accountInfo && data.account_info) {
            accountInfo = data.account_info;
          }

          let batchNewEntries = data.timeline;

          if (incrementalSnapshot) {
            const { freshEntries, overlapReached: batchOverlapReached } =
              collectIncrementalEntries(
                data.timeline,
                knownTweetIds,
                seenSessionEntryKeys
              );

            batchNewEntries = appendUniqueEntries(queuedEntryAccumulator, freshEntries);
            currentMediaCount = incrementalBaseCount + queuedEntryAccumulator.timeline.length;
            overlapReached = overlapReached || batchOverlapReached;
          } else {
            batchNewEntries = appendUniqueEntries(queuedEntryAccumulator, data.timeline);
            currentMediaCount = queuedEntryAccumulator.timeline.length;
          }

          cursor = data.cursor;
          hasMore = !!data.cursor && !data.completed;
          if (overlapReached) {
            hasMore = false;
            cursor = undefined;
            logger.info(
              `@${account.username}: reached saved overlap boundary, stopping refresh early.`
            );
          }
          page++;

          // Save cursor every batch (lightweight, just a string)
          if (cursor && hasMore) {
            saveCursor(accountScope, cursor);
          }

          // Update account with progress
          accountMediaCountRef.current.set(accountId, currentMediaCount);
          const hasNewItems = currentMediaCount > previousMediaCount;

          queueMultipleAccountUpdate(accountId, {
            accountInfo: accountInfo || undefined,
            previousMediaCount: previousMediaCount,
            mediaCount: currentMediaCount,
            cursor,
          });
          if (hasNewItems) {
            markAccountDiffVisible(accountId);
          }
          flushMultipleAccountUpdates();
          
          // Update previous count for next iteration
          previousMediaCount = currentMediaCount;

          if (accountInfo) {
            saveFetchState({
              ...accountScope,
              cursor: cursor || "",
              accountInfo,
              totalFetched: currentMediaCount,
              completed: !hasMore,
            });

            try {
              await saveAccountSnapshotChunk(
                accountScope,
                accountInfo,
                batchNewEntries,
                cursor,
                !hasMore,
                currentMediaCount
              );
            } catch (err) {
              console.error("Failed to save progress to database:", err);
            }
          }
        }

        // Calculate elapsed time before clearing
        const startTime = accountStartTimesRef.current.get(accountId);
        const elapsedSecs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

        clearAccountRuntimeState(accountId);
        activeAccountRequestIdsRef.current.delete(accountId);

        // Update final status - check if media was fetched
        const finalMediaCount = currentMediaCount;
        accountMediaCountRef.current.set(accountId, finalMediaCount);
        
        // Check if stopped due to timeout (accountStopFlags was set by timeout handler)
        const wasTimeout = accountStopFlagsRef.current.get(accountId);
        
        if (wasTimeout) {
          // Timeout: incomplete if media was fetched, failed if no media
          logger.warning(`@${account.username}: timeout - ${finalMediaCount} items (${elapsedSecs}s)`);
          queueMultipleAccountUpdate(accountId, {
            status: finalMediaCount === 0 ? "failed" : "incomplete",
          });
        } else if (stopAllRef.current) {
          // Stopped by user: incomplete if media was fetched, failed if no media
          logger.info(`@${account.username}: stopped - ${finalMediaCount} items (${elapsedSecs}s)`);
          queueMultipleAccountUpdate(accountId, {
            status: finalMediaCount === 0 ? "failed" : "incomplete",
          });
        } else if (hasMore) {
          // Has more but stopped (e.g., API error): incomplete if media was fetched, failed if no media
          logger.warning(`@${account.username}: incomplete - ${finalMediaCount} items (${elapsedSecs}s)`);
          queueMultipleAccountUpdate(accountId, {
            status: finalMediaCount === 0 ? "failed" : "incomplete",
          });
        } else {
          // Completed successfully
          logger.success(`@${account.username}: completed - ${finalMediaCount} items (${elapsedSecs}s)`);
          clearFetchState(accountScope);
          clearCursor(accountScope);
          queueMultipleAccountUpdate(accountId, {
            status: "completed",
            cursor: undefined,
          });
        }
        flushMultipleAccountUpdates();
      } catch (error) {
        const startTime = accountStartTimesRef.current.get(accountId);
        const elapsedSecs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isCanceled =
          stopAllRef.current ||
          accountStopFlagsRef.current.get(accountId) === true ||
          errorMsg.toLowerCase().includes("extractor canceled");

        clearAccountRuntimeState(accountId);
        activeAccountRequestIdsRef.current.delete(accountId);

        if (isCanceled && accountInfo && currentMediaCount > 0) {
          saveFetchState({
            ...accountScope,
            cursor: cursor || "",
            accountInfo,
            totalFetched: currentMediaCount,
            completed: false,
          });

          try {
            await saveAccountSnapshotChunk(
              accountScope,
              accountInfo,
              [],
              cursor,
              false,
              currentMediaCount
            );
          } catch (dbErr) {
            console.error("Failed to save canceled state to database:", dbErr);
          }
        }
        
        // Check if any media was fetched before the error
        const mediaCount = accountMediaCountRef.current.get(accountId) || 0;

        const isAuthError = errorMsg.toLowerCase().includes("401") || 
                           errorMsg.toLowerCase().includes("unauthorized") ||
                           errorMsg.toLowerCase().includes("auth token may be invalid") ||
                           errorMsg.toLowerCase().includes("auth token may be expired") ||
                           errorMsg.toLowerCase().includes("invalid or expired");

        const status = isAuthError || mediaCount === 0 ? ("failed" as const) : ("incomplete" as const);
        
        accountMediaCountRef.current.delete(accountId);

        queueMultipleAccountUpdate(accountId, {
          status,
          error: isCanceled ? undefined : errorMsg,
          mediaCount,
        });
        flushMultipleAccountUpdates();

        if (isCanceled) {
          logger.info(`@${account.username}: stopped - ${mediaCount} items (${elapsedSecs}s)`);
        } else {
          logger.error(`@${account.username}: failed - ${errorMsg} (${elapsedSecs}s)`);
        }
      }
    };

    let nextAccountIndex = 0;

    const getNextAccount = () => {
      if (stopAllRef.current) {
        return null;
      }

      const account = currentAccounts[nextAccountIndex];
      nextAccountIndex += 1;
      return account || null;
    };

    const worker = async () => {
      while (!stopAllRef.current) {
        const account = getNextAccount();
        if (!account) {
          return;
        }

        await fetchAccount(account);
      }
    };

    const workerCount = Math.min(MULTIPLE_FETCH_CONCURRENCY, currentAccounts.length);
    await Promise.all(
      Array.from({ length: workerCount }, () => worker())
    );

    setIsFetchingAll(false);
    activeAccountRequestIdsRef.current.clear();
    if (!stopAllRef.current) {
      toast.success("All accounts fetched");
    }
  };

  // Handle stop all
  const handleStopAll = () => {
    stopAllRef.current = true;
    setIsFetchingAll(false);

    accountStartTimesRef.current.clear();
    accountTimeoutSecondsRef.current.clear();
    diffVisibilityRef.current.clear();

    // Update all fetching accounts - check if they have media using ref (most up-to-date value)
    setMultipleAccountsState((prev) =>
      prev.map((acc) => {
        if (acc.status === "fetching") {
          // If no media was fetched, mark as failed; otherwise incomplete
          const mediaCount = accountMediaCountRef.current.get(acc.id) || acc.mediaCount || 0;
          const status = mediaCount === 0 ? ("failed" as const) : ("incomplete" as const);
          return { ...acc, status, mediaCount, showDiff: false };
        }
        return acc;
      })
    );

    cancelAllActiveAccountRequests().catch(() => {});
    toast.info("Stopped all fetches");
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <TitleBar />

        <div className="mt-10 h-[calc(100vh-2.5rem)] w-full overflow-hidden px-4 py-4 md:px-6 md:py-6 xl:px-8">
          <div className="flex h-full min-h-0 flex-col gap-6">
            <Header
              version={APP_VERSION}
              onOpenDiagnostics={() => setDiagnosticsOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              workspaceTab={workspaceTab}
              onWorkspaceTabChange={setWorkspaceTab}
            />

            {workspaceTab === "fetch" ? (
              <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)_340px]">
                <section
                  className="min-h-0 min-w-0 overflow-y-auto pr-1"
                  aria-label="Fetch controls"
                >
                  <FetchWorkspaceSidebar
                    username={username}
                    loading={loading}
                    onUsernameChange={setUsername}
                    onFetch={handleFetch}
                    onStopFetch={handleStopFetch}
                    onResume={handleResume}
                    onClearResume={handleClearResume}
                    resumeInfo={resumeInfo}
                    onImportFile={handleImportFile}
                    onStopAll={handleStopAll}
                    isFetchingAll={isFetchingAll}
                    mode={searchMode}
                    privateType={searchPrivateType}
                    useDateRange={useDateRange}
                    startDate={startDate}
                    endDate={endDate}
                    publicAuthToken={publicAuthToken}
                    privateAuthToken={privateAuthToken}
                    onModeChange={(mode, privateType) => {
                      setSearchMode(mode);
                      if (privateType) {
                        setSearchPrivateType(privateType);
                      }
                    }}
                  />
                </section>

                <section
                  className="min-h-0 min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm"
                  aria-label="Fetch results"
                >
                  {result && fetchType === "single" ? (
                    <Suspense fallback={<WorkspaceLoadingState label="media results" />}>
                      <MediaList
                        accountInfo={result.account_info}
                        timeline={result.timeline}
                        totalUrls={result.total_urls}
                        fetchedMediaType={fetchedMediaType}
                        newMediaCount={newMediaCount}
                        downloadState={globalDownloadState}
                        downloadMeta={globalDownloadMeta}
                        onDownloadSessionStart={handleDownloadSessionStart}
                      />
                    </Suspense>
                  ) : fetchType === "multiple" && multipleAccounts.length > 0 ? (
                    <MultiAccountWorkspace
                      accounts={multipleAccounts}
                      isFetchingAll={isFetchingAll}
                      isDownloading={Boolean(globalDownloadState?.in_progress)}
                      onDownloadFetched={handleDownloadFetchedAccounts}
                    />
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-8 text-center">
                      <div className="max-w-md space-y-3">
                        <h2 className="text-2xl font-semibold tracking-tight">
                          Fetch Workspace
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Start a fetch from the left control panel. Current results, previews,
                          and download actions will stay here while the right activity rail keeps
                          fetch and download status visible.
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                <section
                  className="min-h-0 min-w-0 overflow-hidden"
                  aria-label="Activity panel"
                >
                  <ActivityPanel
                    fetch={activityPanelState.fetch}
                    download={activityPanelState.download}
                    failures={activityPanelState.failures}
                    onStopDownload={handleGlobalStopDownload}
                  />
                </section>
              </div>
            ) : null}

            {savedTabVisited && workspaceTab === "saved" ? (
              <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <section
                  className="min-h-0 min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm"
                  aria-label="Saved accounts library"
                >
                  <Suspense fallback={<WorkspaceLoadingState label="saved accounts" />}>
                    <DatabaseView
                      onLoadAccount={handleLoadFromDB}
                      onUpdateSelected={handleUpdateSelected}
                      downloadState={globalDownloadState}
                      downloadMeta={globalDownloadMeta}
                      onStopDownload={handleGlobalStopDownload}
                      onDownloadSessionStart={handleDownloadSessionStart}
                      recentFetches={fetchHistory}
                      onSelectRecentFetch={handleHistorySelect}
                      onRemoveRecentFetch={removeFromHistory}
                      onClearRecentFetches={clearFetchHistory}
                    />
                  </Suspense>
                </section>
                <section
                  className="min-h-0 min-w-0 overflow-hidden"
                  aria-label="Activity panel"
                >
                  <ActivityPanel
                    fetch={activityPanelState.fetch}
                    download={activityPanelState.download}
                    failures={activityPanelState.failures}
                    onStopDownload={handleGlobalStopDownload}
                  />
                </section>
              </div>
            ) : null}
          </div>
        </div>
        <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
          <DialogContent className="left-auto right-0 top-0 h-full w-full max-w-[min(100vw,44rem)] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[44rem]">
            <DialogTitle className="sr-only">Diagnostics</DialogTitle>
            <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 pb-5 pr-14 pt-5">
              <Suspense fallback={<WorkspaceLoadingState label="diagnostics" />}>
                <DebugLoggerPage embedded fillHeight />
              </Suspense>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="left-auto right-0 top-0 h-full w-full max-w-[min(100vw,48rem)] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[48rem]">
            <DialogTitle className="sr-only">Settings</DialogTitle>
            <div className="h-full overflow-y-auto px-5 pb-5 pr-14 pt-5">
              <Suspense fallback={<WorkspaceLoadingState label="settings" />}>
                <SettingsPage
                  embedded
                  mode={searchMode}
                  privateType={searchPrivateType}
                  publicAuthToken={publicAuthToken}
                  privateAuthToken={privateAuthToken}
                  onPublicAuthTokenChange={setPublicAuthToken}
                  onPrivateAuthTokenChange={setPrivateAuthToken}
                  rememberPublicToken={rememberPublicToken}
                  rememberPrivateToken={rememberPrivateToken}
                  onRememberPublicTokenChange={(value) => {
                    updateSettings({ rememberPublicToken: value });
                    setRememberPublicToken(value);
                  }}
                  onRememberPrivateTokenChange={(value) => {
                    updateSettings({ rememberPrivateToken: value });
                    setRememberPrivateToken(value);
                  }}
                  useDateRange={useDateRange}
                  startDate={startDate}
                  endDate={endDate}
                  onUseDateRangeChange={setUseDateRange}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                />
              </Suspense>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

export default App;
