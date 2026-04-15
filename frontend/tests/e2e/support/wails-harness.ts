import type { Page } from "@playwright/test";

import {
  loadSavedAccountsFixture,
  type SavedAccountsFixture,
} from "./fixture-data";

type IntegrityOutcome = "completed" | "failed";

export interface IntegrityPlan {
  mode: "quick" | "deep";
  outcome: IntegrityOutcome;
  checkedFiles?: number;
  issueCount?: number;
  error?: string;
  settleAfterPolls?: number;
}

interface HarnessConfig {
  savedAccounts: SavedAccountsFixture;
  integrityPlans: IntegrityPlan[];
  initialDownloadFolders: string[];
  defaultSettings: {
    downloadPath: string;
    proxy: string;
    sfxEnabled: boolean;
    rememberPublicToken: boolean;
    rememberPrivateToken: boolean;
    fetchMode: "single" | "batch";
    mediaType: "all" | "image" | "video" | "gif" | "text";
    includeRetweets: boolean;
    theme: string;
    themeMode: "auto" | "light" | "dark";
    fontFamily: string;
  };
  storedTokens: {
    public_token: string;
    private_token: string;
  };
}

const DEFAULT_SETTINGS = {
  downloadPath: "/tmp/xdownloader-e2e-downloads",
  proxy: "",
  sfxEnabled: false,
  rememberPublicToken: true,
  rememberPrivateToken: true,
  fetchMode: "batch" as const,
  mediaType: "all" as const,
  includeRetweets: false,
  theme: "yellow",
  themeMode: "light" as const,
  fontFamily: "google-sans",
};

const DEFAULT_STORED_TOKENS = {
  public_token: "public-token-e2e",
  private_token: "private-token-e2e",
};

function buildHarnessConfig(overrides?: Partial<HarnessConfig>): HarnessConfig {
  return {
    savedAccounts: overrides?.savedAccounts || loadSavedAccountsFixture(),
    integrityPlans: overrides?.integrityPlans || [
      {
        mode: "quick",
        outcome: "completed",
        checkedFiles: 18,
        issueCount: 0,
        settleAfterPolls: 2,
      },
    ],
    initialDownloadFolders: overrides?.initialDownloadFolders || [],
    defaultSettings: overrides?.defaultSettings || DEFAULT_SETTINGS,
    storedTokens: overrides?.storedTokens || DEFAULT_STORED_TOKENS,
  };
}

export async function installWailsHarness(
  page: Page,
  overrides?: Partial<HarnessConfig>
) {
  const config = buildHarnessConfig(overrides);

  await page.addInitScript((rawConfig: HarnessConfig) => {
    const browserWindow = window as typeof window & {
      go: {
        main: {
          App: Record<string, (...args: unknown[]) => Promise<unknown>>;
        };
      };
      runtime: Record<string, unknown>;
    };
    const SETTINGS_KEY = "twitter-media-downloader-settings";
    const config = rawConfig;

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config.defaultSettings));

    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const downloadedFolders = new Set<string>(config.initialDownloadFolders);
    const savedAccounts = config.savedAccounts.accounts.slice();
    const snapshots = new Map<string, {
      account_info: Record<string, unknown>;
      timeline: Array<Record<string, unknown>>;
      cursor: string;
      completed: boolean;
      total_urls: number;
    }>();

    const activeExtractorRequests = new Map<
      string,
      {
        cancel: () => void;
      }
    >();

    let storedTokens = { ...config.storedTokens };
    let currentDownloadState = {
      in_progress: false,
      current: 0,
      total: 0,
      percent: 0,
    };
    let activeDownloadTask: {
      cancelled: boolean;
      scopeUsernames: string[];
    } | null = null;
    let lastIntegrityStatus: Record<string, unknown> | null = null;
    let integrityTask: {
      mode: "quick" | "deep";
      phase: string;
      status: "running" | "cancelling";
      pollCount: number;
      cancelRequested: boolean;
      plan: IntegrityPlan;
      report: Record<string, unknown> | null;
    } | null = null;
    const integrityPlansQueue = config.integrityPlans.slice();

    const noop = () => undefined;
    const isPrivateAccount = (username: string) =>
      username === "bookmarks" || username === "likes";
    const normalizeString = (value: unknown) => String(value || "").trim();
    const toLower = (value: unknown) => normalizeString(value).toLowerCase();

    const emitRuntimeEvent = (eventName: string, ...args: unknown[]) => {
      const handlers = listeners.get(eventName);
      if (!handlers) {
        return;
      }

      for (const handler of Array.from(handlers)) {
        handler(...args);
      }
    };

    const addRuntimeListener = (
      eventName: string,
      callback: (...args: unknown[]) => void,
      maxCallbacks: number
    ) => {
      const wrapped = (...args: unknown[]) => {
        callback(...args);
        if (maxCallbacks > 0) {
          maxCallbacks -= 1;
          if (maxCallbacks === 0) {
            removeRuntimeListener(eventName, wrapped);
          }
        }
      };

      const handlers = listeners.get(eventName) || new Set();
      handlers.add(wrapped);
      listeners.set(eventName, handlers);

      return () => {
        removeRuntimeListener(eventName, wrapped);
      };
    };

    const removeRuntimeListener = (
      eventName: string,
      callback?: (...args: unknown[]) => void
    ) => {
      if (!callback) {
        listeners.delete(eventName);
        return;
      }

      const handlers = listeners.get(eventName);
      if (!handlers) {
        return;
      }
      handlers.delete(callback);
      if (handlers.size === 0) {
        listeners.delete(eventName);
      }
    };

    const scopeKey = (scope: Record<string, unknown>) =>
      JSON.stringify({
        username: normalizeString(scope.username),
        media_type: normalizeString(scope.media_type || "all"),
        timeline_type: normalizeString(scope.timeline_type || "timeline"),
        retweets: Boolean(scope.retweets),
        query_key: normalizeString(scope.query_key),
      });

    const buildDownloadFolderName = (username: string) => {
      if (username === "bookmarks") {
        return "My Bookmarks";
      }
      if (username === "likes") {
        return "My Likes";
      }
      return username;
    };

    const getSavedAccounts = (accountViewMode: string) =>
      savedAccounts.filter((account) =>
        accountViewMode === "private"
          ? isPrivateAccount(account.username)
          : !isPrivateAccount(account.username)
      );

    const compareBySort = (sortOrder: string) => {
      switch (sortOrder) {
        case "oldest":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            String(left.last_fetched).localeCompare(String(right.last_fetched)) ||
            Number(left.id) - Number(right.id);
        case "username-asc":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            String(left.username).localeCompare(String(right.username)) ||
            Number(left.id) - Number(right.id);
        case "username-desc":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            String(right.username).localeCompare(String(left.username)) ||
            Number(right.id) - Number(left.id);
        case "followers-high":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(right.followers_count) - Number(left.followers_count) ||
            Number(right.id) - Number(left.id);
        case "followers-low":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(left.followers_count) - Number(right.followers_count) ||
            Number(left.id) - Number(right.id);
        case "posts-high":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(right.statuses_count) - Number(left.statuses_count) ||
            Number(right.id) - Number(left.id);
        case "posts-low":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(left.statuses_count) - Number(right.statuses_count) ||
            Number(left.id) - Number(right.id);
        case "media-high":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(right.total_media) - Number(left.total_media) ||
            Number(right.id) - Number(left.id);
        case "media-low":
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            Number(left.total_media) - Number(right.total_media) ||
            Number(left.id) - Number(right.id);
        case "newest":
        default:
          return (left: Record<string, unknown>, right: Record<string, unknown>) =>
            String(right.last_fetched).localeCompare(String(left.last_fetched)) ||
            Number(right.id) - Number(left.id);
      }
    };

    const filterAccounts = ({
      account_view_mode,
      search_query,
      filter_group,
      filter_media_type,
      sort_order,
    }: Record<string, unknown>) => {
      const accountViewMode = normalizeString(account_view_mode || "public");
      const searchQuery = toLower(search_query);
      const filterGroup = normalizeString(filter_group || "all");
      const filterMediaType = normalizeString(filter_media_type || "all");

      const filtered = getSavedAccounts(accountViewMode).filter((account) => {
        if (searchQuery) {
          const haystack = `${account.username} ${account.name}`.toLowerCase();
          if (!haystack.includes(searchQuery)) {
            return false;
          }
        }

        if (accountViewMode !== "private") {
          if (filterGroup === "ungrouped" && account.group_name) {
            return false;
          }
          if (
            filterGroup &&
            filterGroup !== "all" &&
            filterGroup !== "ungrouped" &&
            account.group_name !== filterGroup
          ) {
            return false;
          }

          if (filterMediaType === "all-media" && account.media_type !== "all") {
            return false;
          }
          if (
            filterMediaType &&
            filterMediaType !== "all" &&
            filterMediaType !== "all-media" &&
            account.media_type !== filterMediaType
          ) {
            return false;
          }
        }

        return true;
      });

      return filtered.sort(compareBySort(normalizeString(sort_order || "newest")));
    };

    const buildAccountInfo = (username: string, totalItems: number) => {
      const matched = savedAccounts.find((account) => account.username === username);
      const fallbackName = username
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");

      return {
        name: username,
        nick: matched?.name || `${fallbackName} Account`,
        date: "2026-04-14T07:00:00Z",
        followers_count: matched?.followers_count || 1200,
        friends_count: 180,
        profile_image: matched?.profile_image || "/icon.svg",
        statuses_count: matched?.statuses_count || totalItems * 8,
      };
    };

    const buildTimelineEntries = (username: string, page: number, itemCount: number) =>
      Array.from({ length: itemCount }, (_, index) => {
        const number = page * itemCount + index + 1;
        return {
          url: `https://example.test/${username}/media/${number}.jpg`,
          date: `2026-04-${String((number % 9) + 10).padStart(2, "0")}T08:00:00Z`,
          tweet_id: `${username}-${page}-${number}`,
          type: "photo",
          is_retweet: false,
          extension: "jpg",
          width: 1200,
          height: 900,
          content: `${username} item ${number}`,
          view_count: 100 + number,
          bookmark_count: 10 + number,
          favorite_count: 20 + number,
          retweet_count: 5 + number,
          reply_count: 2 + number,
          source: "web",
          verified: false,
          original_filename: `${username}-${number}.jpg`,
          author_username: username,
        };
      });

    const buildTimelineResponse = (request: Record<string, unknown>) => {
      const username = normalizeString(request.username) || "bookmarks";
      const page = Number(request.page || 0);
      const isQueueFetch = username.startsWith("multi-");
      const itemsPerPage = isQueueFetch ? 4 : 5;
      const totalItems = isQueueFetch ? 4 : 10;
      const completed = isQueueFetch ? true : page >= 1;
      const cursor = completed ? "" : `${username}-cursor-${page + 1}`;
      const timeline = buildTimelineEntries(username, page, itemsPerPage);

      return {
        account_info: buildAccountInfo(username, totalItems),
        total_urls: completed ? totalItems : (page + 1) * itemsPerPage,
        timeline,
        metadata: {
          new_entries: timeline.length,
          page: page + 1,
          batch_size: Number(request.batch_size || itemsPerPage),
          has_more: !completed,
          cursor,
          completed,
        },
        cursor,
        completed,
      };
    };

    const scheduleDownloadStep = (
      task: { cancelled: boolean; scopeUsernames: string[] },
      progressValues: number[],
      total: number,
      resolve: (value: Record<string, unknown>) => void
    ) => {
      const runStep = (index: number) => {
        if (activeDownloadTask !== task) {
          return;
        }

        if (task.cancelled) {
          currentDownloadState = {
            in_progress: false,
            current: Math.min(currentDownloadState.current, total),
            total,
            percent:
              total === 0
                ? 0
                : Math.round((currentDownloadState.current / total) * 100),
          };
          emitRuntimeEvent("download-state", currentDownloadState);
          activeDownloadTask = null;
          resolve({
            success: true,
            downloaded: currentDownloadState.current,
            skipped: 0,
            failed: 0,
            message: "download cancelled",
          });
          return;
        }

        if (index >= progressValues.length) {
          for (const username of task.scopeUsernames) {
            downloadedFolders.add(buildDownloadFolderName(username));
          }

          currentDownloadState = {
            in_progress: false,
            current: total,
            total,
            percent: 100,
          };
          emitRuntimeEvent("download-state", currentDownloadState);
          activeDownloadTask = null;
          resolve({
            success: true,
            downloaded: total,
            skipped: 0,
            failed: 0,
            message: "download completed",
          });
          return;
        }

        const current = progressValues[index];
        currentDownloadState = {
          in_progress: true,
          current,
          total,
          percent: total === 0 ? 0 : Math.round((current / total) * 100),
        };
        emitRuntimeEvent("download-state", currentDownloadState);
        window.setTimeout(() => runStep(index + 1), 180);
      };

      window.setTimeout(() => runStep(0), 120);
    };

    const resolveIntegrityPlan = (mode: "quick" | "deep") => {
      const matchingIndex = integrityPlansQueue.findIndex((plan) => plan.mode === mode);
      if (matchingIndex >= 0) {
        return integrityPlansQueue.splice(matchingIndex, 1)[0];
      }

      return {
        mode,
        outcome: "completed",
        checkedFiles: 12,
        issueCount: 0,
        settleAfterPolls: 2,
      } satisfies IntegrityPlan;
    };

    const buildIntegrityReport = (mode: "quick" | "deep", checkedFiles: number, issueCount: number) => ({
      mode,
      download_path: config.defaultSettings.downloadPath,
      scanned_files: checkedFiles,
      checked_files: checkedFiles,
      complete_files: Math.max(checkedFiles - issueCount, 0),
      partial_files: issueCount,
      incomplete_files: 0,
      untracked_files: 1,
      unverifiable_files: 0,
      issues: issueCount
        ? [
            {
              path: `${config.defaultSettings.downloadPath}/broken-file.mp4`,
              relative_path: "broken-file.mp4",
              reason: "size mismatch",
              local_size: 12,
              remote_size: 18,
              url: "https://example.test/broken-file.mp4",
            },
          ]
        : [],
    });

    const appMethods = {
      async GetDefaults() {
        return {
          downloadPath: config.defaultSettings.downloadPath,
          appDataDir: "/tmp/xdownloader-e2e-appdata",
          smokeMode: "",
          smokeReportPath: "",
        };
      },
      async WriteSettingsSnapshot() {
        return true;
      },
      async CreateDatabaseBackup() {
        return "/tmp/xdownloader-e2e-backup.zip";
      },
      async ExportSupportBundle() {
        return "/tmp/xdownloader-e2e-support.zip";
      },
      async RestoreDatabaseBackup() {
        return {
          success: true,
          requires_restart: true,
          message: "Database backup restored. Restart the app to refresh open views.",
        };
      },
      async OpenAppDataFolder() {
        return true;
      },
      async GetStoredAuthTokens() {
        return storedTokens;
      },
      async SaveStoredAuthTokens(tokens: Record<string, unknown>) {
        storedTokens = {
          public_token: normalizeString(tokens.public_token),
          private_token: normalizeString(tokens.private_token),
        };
        return true;
      },
      async IsFFmpegInstalled() {
        return true;
      },
      async IsExifToolInstalled() {
        return true;
      },
      async DownloadFFmpeg() {
        return true;
      },
      async DownloadExifTool() {
        return true;
      },
      async SelectFolder(currentPath: string) {
        return currentPath || config.defaultSettings.downloadPath;
      },
      async OpenFolder() {
        return true;
      },
      async GetFolderPath(basePath: string, folderName: string) {
        return `${basePath}/${folderName}`;
      },
      async GetDownloadDirectorySnapshot() {
        return Array.from(downloadedFolders);
      },
      async CheckFolderExists(_basePath: string, folderName: string) {
        return downloadedFolders.has(folderName);
      },
      async GetSavedAccountsBootstrap() {
        return {
          groups: config.savedAccounts.groups,
          public_count: config.savedAccounts.public_count,
          private_count: config.savedAccounts.private_count,
          account_refs: savedAccounts.map((account) => ({
            id: account.id,
            username: account.username,
          })),
        };
      },
      async QuerySavedAccounts(request: Record<string, unknown>) {
        const filtered = filterAccounts(request);
        const offset = Number(request.offset || 0);
        const limit = Number(request.limit || 100);
        const items = filtered.slice(offset, offset + limit);
        const nextOffset = offset + items.length;

        return {
          items,
          total_count: filtered.length,
          has_more: nextOffset < filtered.length,
          next_offset: nextOffset,
        };
      },
      async GetSavedAccountMatchingIDs(request: Record<string, unknown>) {
        return filterAccounts(request).map((account) => account.id);
      },
      async GetAccountsByIDs(ids: number[]) {
        return ids
          .map((id) => savedAccounts.find((account) => account.id === Number(id)))
          .filter(Boolean);
      },
      async GetDownloadStatus() {
        return currentDownloadState;
      },
      async StopDownload() {
        if (!activeDownloadTask) {
          return false;
        }

        activeDownloadTask.cancelled = true;
        return true;
      },
      async DownloadSavedScopes(request: Record<string, unknown>) {
        const scopes = Array.isArray(request.scopes) ? request.scopes : [];
        const scopeUsernames = scopes
          .map((scope) => normalizeString((scope as Record<string, unknown>).username))
          .filter(Boolean);
        const total = Math.max(
          1,
          scopeUsernames.reduce((sum, username) => {
            const matched = savedAccounts.find((account) => account.username === username);
            return sum + (matched?.total_media || 6);
          }, 0)
        );
        const progressValues = Array.from(
          new Set([
            Math.max(1, Math.round(total * 0.25)),
            Math.max(1, Math.round(total * 0.6)),
          ])
        ).filter((value) => value < total);

        currentDownloadState = {
          in_progress: true,
          current: 0,
          total,
          percent: 0,
        };
        emitRuntimeEvent("download-state", currentDownloadState);

        return await new Promise<Record<string, unknown>>((resolve) => {
          const task = {
            cancelled: false,
            scopeUsernames,
          };
          activeDownloadTask = task;
          scheduleDownloadStep(task, progressValues, total, resolve);
        });
      },
      async CancelExtractorRequest(requestId: string) {
        const pending = activeExtractorRequests.get(requestId);
        if (!pending) {
          return false;
        }

        pending.cancel();
        return true;
      },
      async ExtractTimelineStructured(request: Record<string, unknown>) {
        const requestId = normalizeString(request.request_id);
        const response = buildTimelineResponse(request);
        const username = normalizeString(request.username);
        const delayMs = username.startsWith("multi-") ? 850 : 1200;

        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            activeExtractorRequests.delete(requestId);
            resolve(response);
          }, delayMs);

          activeExtractorRequests.set(requestId, {
            cancel: () => {
              if (settled) {
                return;
              }
              window.clearTimeout(timer);
              window.setTimeout(() => {
                if (settled) {
                  return;
                }
                settled = true;
                activeExtractorRequests.delete(requestId);
                reject(new Error("extractor canceled"));
              }, 250);
            },
          });
        });
      },
      async ExtractDateRangeStructured(request: Record<string, unknown>) {
        return appMethods.ExtractTimelineStructured(request);
      },
      async SaveAccountSnapshotChunk(request: Record<string, unknown>) {
        const key = scopeKey((request.scope || {}) as Record<string, unknown>);
        const existing =
          snapshots.get(key) ||
          ({
            account_info: request.account_info || {},
            timeline: [],
            cursor: "",
            completed: false,
            total_urls: 0,
          } as const);
        const incomingEntries = Array.isArray(request.entries) ? request.entries : [];
        const mergedTimeline = [...existing.timeline];
        for (const entry of incomingEntries) {
          const tweetId = normalizeString((entry as Record<string, unknown>).tweet_id);
          if (!mergedTimeline.some((current) => normalizeString(current.tweet_id) === tweetId)) {
            mergedTimeline.push(entry as Record<string, unknown>);
          }
        }

        snapshots.set(key, {
          account_info: (request.account_info || existing.account_info) as Record<string, unknown>,
          timeline: mergedTimeline,
          cursor: normalizeString(request.cursor || existing.cursor),
          completed: Boolean(request.completed),
          total_urls: Number(request.total_media || existing.total_urls || mergedTimeline.length),
        });
        return true;
      },
      async GetAccountSnapshotStructured(scope: Record<string, unknown>) {
        const snapshot = snapshots.get(scopeKey(scope));
        if (!snapshot) {
          return null;
        }

        return {
          account_info: snapshot.account_info,
          total_urls: snapshot.total_urls,
          timeline: snapshot.timeline,
          metadata: {
            new_entries: snapshot.timeline.length,
            page: 1,
            batch_size: snapshot.timeline.length,
            has_more: false,
            cursor: snapshot.cursor,
            completed: snapshot.completed,
          },
          cursor: snapshot.cursor,
          completed: snapshot.completed,
        };
      },
      async GetAccountSnapshotSummaryStructured(scope: Record<string, unknown>) {
        const snapshot = snapshots.get(scopeKey(scope));
        if (!snapshot) {
          return null;
        }

        return {
          account_info: snapshot.account_info,
          total_urls: snapshot.total_urls,
          cursor: snapshot.cursor,
          completed: snapshot.completed,
        };
      },
      async GetAccountSnapshotTweetIDs(scope: Record<string, unknown>) {
        const snapshot = snapshots.get(scopeKey(scope));
        if (!snapshot) {
          return [];
        }

        return snapshot.timeline.map((entry) => normalizeString(entry.tweet_id));
      },
      async StartDownloadIntegrityTask(request: Record<string, unknown>) {
        const mode = normalizeString(request.mode) === "deep" ? "deep" : "quick";
        const plan = resolveIntegrityPlan(mode);
        const checkedFiles = Math.max(1, Number(plan.checkedFiles || 12));
        const issueCount = Math.max(0, Number(plan.issueCount || 0));
        const report =
          plan.outcome === "completed"
            ? buildIntegrityReport(mode, checkedFiles, issueCount)
            : null;

        integrityTask = {
          mode,
          phase: "scanning",
          status: "running",
          pollCount: 0,
          cancelRequested: false,
          plan,
          report,
        };

        lastIntegrityStatus = {
          status: "running",
          in_progress: true,
          cancelled: false,
          mode,
          phase: "scanning",
          scanned_files: checkedFiles,
          checked_files: Math.max(1, Math.floor(checkedFiles / 3)),
          verified_files: 0,
          partial_files: issueCount,
          incomplete_files: 0,
          untracked_files: 0,
          unverifiable_files: 0,
          issues_count: issueCount,
          error: "",
          report: null,
        };

        return lastIntegrityStatus;
      },
      async GetDownloadIntegrityTaskStatus() {
        if (!integrityTask) {
          return (
            lastIntegrityStatus || {
              status: "completed",
              in_progress: false,
              cancelled: false,
              mode: "",
              phase: "",
              scanned_files: 0,
              checked_files: 0,
              verified_files: 0,
              partial_files: 0,
              incomplete_files: 0,
              untracked_files: 0,
              unverifiable_files: 0,
              issues_count: 0,
              error: "",
              report: null,
            }
          );
        }

        integrityTask.pollCount += 1;
        const settleAfterPolls = Math.max(1, Number(integrityTask.plan.settleAfterPolls || 2));
        const checkedFiles = Math.max(1, Number(integrityTask.plan.checkedFiles || 12));
        const issueCount = Math.max(0, Number(integrityTask.plan.issueCount || 0));

        if (integrityTask.cancelRequested) {
          if (integrityTask.pollCount < settleAfterPolls) {
            lastIntegrityStatus = {
              status: "cancelling",
              in_progress: true,
              cancelled: false,
              mode: integrityTask.mode,
              phase: "cancelling",
              scanned_files: checkedFiles,
              checked_files: Math.max(1, Math.floor(checkedFiles / 2)),
              verified_files: 0,
              partial_files: issueCount,
              incomplete_files: 0,
              untracked_files: 0,
              unverifiable_files: 0,
              issues_count: issueCount,
              error: "",
              report: null,
            };
            return lastIntegrityStatus;
          }

          lastIntegrityStatus = {
            status: "cancelled",
            in_progress: false,
            cancelled: true,
            mode: integrityTask.mode,
            phase: "cancelled",
            scanned_files: checkedFiles,
            checked_files: Math.max(1, Math.floor(checkedFiles / 2)),
            verified_files: 0,
            partial_files: issueCount,
            incomplete_files: 0,
            untracked_files: 0,
            unverifiable_files: 0,
            issues_count: issueCount,
            error: "",
            report: null,
          };
          integrityTask = null;
          return lastIntegrityStatus;
        }

        if (integrityTask.pollCount < settleAfterPolls) {
          lastIntegrityStatus = {
            status: "running",
            in_progress: true,
            cancelled: false,
            mode: integrityTask.mode,
            phase: "scanning",
            scanned_files: checkedFiles,
            checked_files: Math.max(1, Math.floor((checkedFiles * integrityTask.pollCount) / settleAfterPolls)),
            verified_files: 0,
            partial_files: issueCount,
            incomplete_files: 0,
            untracked_files: 0,
            unverifiable_files: 0,
            issues_count: issueCount,
            error: "",
            report: null,
          };
          return lastIntegrityStatus;
        }

        if (integrityTask.plan.outcome === "failed") {
          lastIntegrityStatus = {
            status: "failed",
            in_progress: false,
            cancelled: false,
            mode: integrityTask.mode,
            phase: "failed",
            scanned_files: checkedFiles,
            checked_files: checkedFiles,
            verified_files: 0,
            partial_files: 0,
            incomplete_files: 0,
            untracked_files: 0,
            unverifiable_files: 0,
            issues_count: 0,
            error: integrityTask.plan.error || "remote manifest unavailable",
            report: null,
          };
          integrityTask = null;
          return lastIntegrityStatus;
        }

        lastIntegrityStatus = {
          status: "completed",
          in_progress: false,
          cancelled: false,
          mode: integrityTask.mode,
          phase: "completed",
          scanned_files: checkedFiles,
          checked_files: checkedFiles,
          verified_files: checkedFiles,
          partial_files: issueCount,
          incomplete_files: 0,
          untracked_files: 1,
          unverifiable_files: 0,
          issues_count: issueCount,
          error: "",
          report: integrityTask.report,
        };
        integrityTask = null;
        return lastIntegrityStatus;
      },
      async CancelDownloadIntegrityTask() {
        if (!integrityTask) {
          return false;
        }

        integrityTask.cancelRequested = true;
        integrityTask.status = "cancelling";
        integrityTask.phase = "cancelling";
        integrityTask.pollCount = 0;
        return true;
      },
      async CheckDownloadIntegrity(request: Record<string, unknown>) {
        const mode = normalizeString(request.mode) === "deep" ? "deep" : "quick";
        return buildIntegrityReport(mode, 12, 0);
      },
    } satisfies Record<string, (...args: unknown[]) => Promise<unknown>>;

    const runtime = {
      EventsOnMultiple(eventName: string, callback: (...args: unknown[]) => void, maxCallbacks: number) {
        return addRuntimeListener(eventName, callback, maxCallbacks);
      },
      EventsOn(eventName: string, callback: (...args: unknown[]) => void) {
        return addRuntimeListener(eventName, callback, -1);
      },
      EventsOff(eventName: string, ...additionalEventNames: string[]) {
        removeRuntimeListener(eventName);
        for (const name of additionalEventNames) {
          removeRuntimeListener(name);
        }
      },
      EventsOffAll() {
        listeners.clear();
      },
      EventsEmit(eventName: string, ...args: unknown[]) {
        emitRuntimeEvent(eventName, ...args);
      },
      BrowserOpenURL: noop,
      WindowMinimise: noop,
      WindowToggleMaximise: noop,
      WindowIsMaximised: () => false,
      WindowIsFullscreen: () => false,
      WindowIsMinimised: () => false,
      WindowIsNormal: () => true,
      WindowGetPosition: () => [0, 0],
      WindowGetSize: () => [1600, 1200],
      LogPrint: noop,
      LogTrace: noop,
      LogDebug: noop,
      LogInfo: noop,
      LogWarning: noop,
      LogError: noop,
      LogFatal: noop,
      Quit: noop,
    };

    browserWindow.go = {
      main: {
        App: new Proxy(appMethods, {
          get(target, prop) {
            if (typeof prop === "string" && prop in target) {
              return target[prop as keyof typeof target];
            }
            return async () => null;
          },
        }),
      },
    };

    browserWindow.runtime = runtime;
  }, config);
}
