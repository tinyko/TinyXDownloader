import {
  GetAccountTimelineBootstrap,
  GetAccountTimelineItemsPage,
  GetAccountSnapshotStructured,
  GetAccountSnapshotSummaryStructured,
  GetAccountSnapshotTweetIDs,
  GetAccountTimelinePage,
  SaveAccountSnapshotChunk,
} from "../../../wailsjs/go/main/App";
import { backend, main } from "../../../wailsjs/go/models";

import type {
  AccountInfo,
  AccountTimelineBootstrap,
  AccountTimelineItemsPage,
  AccountTimelinePage,
  SavedTimelineItem,
  SnapshotSummary,
  TimelineEntry,
  TwitterResponse,
} from "@/types/api";
import type { FetchScope } from "@/lib/fetch/state";
import type { SavedAccountsWorkspaceData } from "@/types/database";

export function normalizeStructuredTimelineEntry(
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

export function normalizeStructuredSavedTimelineItem(
  item: backend.SavedTimelineItem | SavedTimelineItem
): SavedTimelineItem {
  return {
    url: item.url,
    date: item.date,
    tweet_id: String(item.tweet_id ?? ""),
    type: item.type,
    content: item.content,
    author_username: item.author_username,
    original_filename: item.original_filename,
  };
}

function normalizeStructuredAccountInfo(
  accountInfo: backend.AccountInfo | AccountInfo
): AccountInfo {
  return {
    name: accountInfo.name,
    nick: accountInfo.nick,
    date: accountInfo.date,
    followers_count: accountInfo.followers_count,
    friends_count: accountInfo.friends_count,
    profile_image: accountInfo.profile_image,
    statuses_count: accountInfo.statuses_count,
  };
}

export function normalizeStructuredResponse(
  response: backend.TwitterResponse | TwitterResponse | null | undefined
): TwitterResponse | null {
  if (!response) {
    return null;
  }

  return {
    account_info: normalizeStructuredAccountInfo(response.account_info),
    total_urls: response.total_urls,
    timeline: (response.timeline || []).map((entry) => normalizeStructuredTimelineEntry(entry)),
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

export function normalizeStructuredSummary(
  summary: backend.AccountSnapshotSummary | SnapshotSummary | null | undefined
): SnapshotSummary | null {
  if (!summary) {
    return null;
  }

  return {
    account_info: normalizeStructuredAccountInfo(summary.account_info),
    total_urls: summary.total_urls,
    cursor: summary.cursor,
    completed: Boolean(summary.completed),
  };
}

export function normalizeStructuredTimelinePage(
  page: backend.AccountTimelinePage | AccountTimelinePage | null | undefined
): AccountTimelinePage | null {
  if (!page) {
    return null;
  }

  return {
    summary: normalizeStructuredSummary(page.summary)!,
    media_counts: {
      photo: page.media_counts?.photo ?? 0,
      video: page.media_counts?.video ?? 0,
      gif: page.media_counts?.gif ?? 0,
      text: page.media_counts?.text ?? 0,
    },
    items: (page.items || []).map((item) => normalizeStructuredSavedTimelineItem(item)),
    total_items: page.total_items ?? 0,
    has_more: Boolean(page.has_more),
    next_offset: page.next_offset ?? 0,
  };
}

export function normalizeStructuredTimelineBootstrap(
  bootstrap: backend.AccountTimelineBootstrap | AccountTimelineBootstrap | null | undefined
): AccountTimelineBootstrap | null {
  if (!bootstrap) {
    return null;
  }

  return {
    summary: normalizeStructuredSummary(bootstrap.summary)!,
    media_counts: {
      photo: bootstrap.media_counts?.photo ?? 0,
      video: bootstrap.media_counts?.video ?? 0,
      gif: bootstrap.media_counts?.gif ?? 0,
      text: bootstrap.media_counts?.text ?? 0,
    },
    total_items: bootstrap.total_items ?? 0,
  };
}

export function normalizeStructuredTimelineItemsPage(
  page: backend.AccountTimelineItemsPage | AccountTimelineItemsPage | null | undefined
): AccountTimelineItemsPage | null {
  if (!page) {
    return null;
  }

  return {
    items: (page.items || []).map((item) => normalizeStructuredSavedTimelineItem(item)),
    has_more: Boolean(page.has_more),
    next_offset: page.next_offset ?? 0,
  };
}

function buildScopeRequest(scope: FetchScope) {
  return {
    username: scope.username,
    media_type: scope.mediaType || "all",
    timeline_type: scope.timelineType || "timeline",
    retweets: scope.retweets ?? false,
    query_key: scope.queryKey || "",
  };
}

export async function loadSnapshotFromDB(scope: FetchScope): Promise<TwitterResponse | null> {
  try {
    const snapshot = await GetAccountSnapshotStructured(buildScopeRequest(scope));
    return normalizeStructuredResponse(snapshot);
  } catch (error) {
    console.error("Failed to load snapshot from database:", error);
    return null;
  }
}

export async function loadSnapshotSummaryFromDB(scope: FetchScope): Promise<SnapshotSummary | null> {
  try {
    const summary = await GetAccountSnapshotSummaryStructured(buildScopeRequest(scope));
    return normalizeStructuredSummary(summary);
  } catch (error) {
    console.error("Failed to load snapshot summary from database:", error);
    return null;
  }
}

export async function loadSnapshotTweetIdsFromDB(scope: FetchScope): Promise<string[]> {
  try {
    const tweetIds = await GetAccountSnapshotTweetIDs(buildScopeRequest(scope));
    return Array.isArray(tweetIds) ? tweetIds.filter(Boolean) : [];
  } catch (error) {
    console.error("Failed to load snapshot tweet ids from database:", error);
    return [];
  }
}

export async function loadAccountTimelinePage(
  scope: FetchScope,
  offset: number,
  limit: number,
  filterType: string,
  sortBy: string
): Promise<AccountTimelinePage | null> {
  try {
    const page = await GetAccountTimelinePage(new main.AccountTimelinePageRequest({
      scope: buildScopeRequest(scope),
      offset,
      limit,
      filter_type: filterType,
      sort_by: sortBy,
    }));
    return normalizeStructuredTimelinePage(page);
  } catch (error) {
    console.error("Failed to load account timeline page:", error);
    return null;
  }
}

export async function loadSavedTimelineBootstrap(
  scope: FetchScope,
  filterType: string
): Promise<AccountTimelineBootstrap | null> {
  try {
    const bootstrap = await GetAccountTimelineBootstrap(
      new main.AccountTimelineBootstrapRequest({
        scope: buildScopeRequest(scope),
        filter_type: filterType,
      })
    );
    return normalizeStructuredTimelineBootstrap(bootstrap);
  } catch (error) {
    console.error("Failed to load account timeline bootstrap:", error);
    return null;
  }
}

export async function loadSavedTimelineItemsPage(
  scope: FetchScope,
  offset: number,
  limit: number,
  filterType: string,
  sortBy: string
): Promise<AccountTimelineItemsPage | null> {
  try {
    const page = await GetAccountTimelineItemsPage(
      new main.AccountTimelineItemsPageRequest({
        scope: buildScopeRequest(scope),
        offset,
        limit,
        filter_type: filterType,
        sort_by: sortBy,
      })
    );
    return normalizeStructuredTimelineItemsPage(page);
  } catch (error) {
    console.error("Failed to load saved timeline items page:", error);
    return null;
  }
}

export function normalizeSavedAccountsWorkspaceData(
  data:
    | backend.SavedAccountsWorkspaceData
    | SavedAccountsWorkspaceData
    | null
    | undefined
): SavedAccountsWorkspaceData | null {
  if (!data) {
    return null;
  }

  return {
    accounts: data.accounts || [],
    groups: (data.groups || []).map((group) => ({
      name: group.name,
      color: group.color,
    })),
  };
}

export async function saveAccountSnapshotChunk(
  scope: FetchScope,
  accountInfo: AccountInfo,
  entries: TimelineEntry[],
  cursor: string | undefined,
  completed: boolean,
  totalMedia: number
) {
  await SaveAccountSnapshotChunk(
    new main.SaveAccountSnapshotChunkRequest({
      scope: buildScopeRequest(scope),
      account_info: accountInfo,
      entries,
      cursor: cursor || "",
      completed,
      total_media: totalMedia,
    })
  );
}
