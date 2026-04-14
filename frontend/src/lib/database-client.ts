import {
  GetAccountsByIDs,
  GetSavedAccountMatchingIDs,
  GetSavedAccountsBootstrap,
  QuerySavedAccounts,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

import type {
  AccountListItem,
  SavedAccountsBootstrap,
  SavedAccountsQueryPage,
} from "@/types/database";

type RawAccountListItem = Partial<AccountListItem> & {
  retweets?: boolean | number;
  completed?: boolean | number;
};

interface RawSavedAccountsBootstrap {
  groups?: Array<{
    name?: string;
    color?: string;
  }>;
  public_count?: number;
  private_count?: number;
  account_refs?: Array<{
    id?: number;
    username?: string;
  }>;
}

interface RawSavedAccountsQueryPage {
  items?: RawAccountListItem[];
  total_count?: number;
  has_more?: boolean;
  next_offset?: number;
}

function normalizeAccountListItem(item: RawAccountListItem): AccountListItem {
  return {
    id: item.id ?? 0,
    username: item.username ?? "",
    name: item.name ?? "",
    profile_image: item.profile_image ?? "",
    total_media: item.total_media ?? 0,
    last_fetched: item.last_fetched ?? "",
    group_name: item.group_name ?? "",
    group_color: item.group_color ?? "",
    media_type: item.media_type ?? "all",
    timeline_type: item.timeline_type ?? "timeline",
    retweets: Boolean(item.retweets),
    query_key: item.query_key ?? "",
    cursor: item.cursor ?? "",
    completed: Boolean(item.completed),
    followers_count: item.followers_count ?? 0,
    statuses_count: item.statuses_count ?? 0,
  } as AccountListItem;
}

export function normalizeSavedAccountsBootstrap(
  data: RawSavedAccountsBootstrap | null | undefined
): SavedAccountsBootstrap | null {
  if (!data) {
    return null;
  }

  return {
    groups: (data.groups || []).map((group) => ({
      name: group.name ?? "",
      color: group.color ?? "",
    })),
    publicCount: data.public_count ?? 0,
    privateCount: data.private_count ?? 0,
    accountRefs: (data.account_refs || []).map((ref) => ({
      id: ref.id ?? 0,
      username: ref.username ?? "",
    })),
  };
}

export function normalizeSavedAccountsQueryPage(
  data: RawSavedAccountsQueryPage | null | undefined
): SavedAccountsQueryPage | null {
  if (!data) {
    return null;
  }

  return {
    items: (data.items || []).map(normalizeAccountListItem),
    totalCount: data.total_count ?? 0,
    hasMore: Boolean(data.has_more),
    nextOffset: data.next_offset ?? 0,
  };
}

export async function loadSavedAccountsBootstrap(): Promise<SavedAccountsBootstrap | null> {
  try {
    return normalizeSavedAccountsBootstrap(await GetSavedAccountsBootstrap());
  } catch (error) {
    console.error("Failed to load saved accounts bootstrap:", error);
    return null;
  }
}

export async function querySavedAccountsPage(params: {
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
  sortOrder: string;
  offset: number;
  limit: number;
}): Promise<SavedAccountsQueryPage | null> {
  try {
    return normalizeSavedAccountsQueryPage(
      await QuerySavedAccounts(
        new main.SavedAccountsQueryRequest({
          account_view_mode: params.accountViewMode,
          search_query: params.searchQuery,
          filter_group: params.filterGroup,
          filter_media_type: params.filterMediaType,
          sort_order: params.sortOrder,
          offset: params.offset,
          limit: params.limit,
        })
      )
    );
  } catch (error) {
    console.error("Failed to query saved accounts page:", error);
    return null;
  }
}

export async function loadSavedAccountMatchingIds(params: {
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
}): Promise<number[]> {
  try {
    const ids = await GetSavedAccountMatchingIDs(
      new main.SavedAccountsIDsRequest({
        account_view_mode: params.accountViewMode,
        search_query: params.searchQuery,
        filter_group: params.filterGroup,
        filter_media_type: params.filterMediaType,
      })
    );
    return Array.isArray(ids) ? ids.map((id) => Number(id)) : [];
  } catch (error) {
    console.error("Failed to load matching saved account ids:", error);
    return [];
  }
}

export async function loadSavedAccountsByIds(ids: number[]): Promise<AccountListItem[]> {
  if (ids.length === 0) {
    return [];
  }

  try {
    const items = await GetAccountsByIDs(ids);
    return Array.isArray(items) ? items.map(normalizeAccountListItem) : [];
  } catch (error) {
    console.error("Failed to load saved accounts by ids:", error);
    return [];
  }
}
