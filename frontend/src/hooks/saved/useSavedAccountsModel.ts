import { useDeferredValue, useMemo } from "react";

import type { AccountListItem, DatabaseSortOrder } from "@/types/database";

export interface SavedAccountsModelArgs {
  accounts: AccountListItem[];
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
  sortOrder: DatabaseSortOrder;
}

interface NormalizedAccountRecord {
  account: AccountListItem;
  normalizedUsername: string;
  normalizedName: string;
  isPrivate: boolean;
}

interface AccountPartitions {
  publicRecords: NormalizedAccountRecord[];
  privateRecords: NormalizedAccountRecord[];
  publicAccounts: AccountListItem[];
  privateAccounts: AccountListItem[];
}

function isPrivateAccount(username: string) {
  return username === "bookmarks" || username === "likes";
}

function compareNormalizedAccounts(
  leftRecord: NormalizedAccountRecord,
  rightRecord: NormalizedAccountRecord,
  sortOrder: DatabaseSortOrder
) {
  const left = leftRecord.account;
  const right = rightRecord.account;

  switch (sortOrder) {
    case "oldest":
      return left.id - right.id;
    case "username-asc":
      return leftRecord.normalizedUsername.localeCompare(rightRecord.normalizedUsername);
    case "username-desc":
      return rightRecord.normalizedUsername.localeCompare(leftRecord.normalizedUsername);
    case "followers-high":
      return right.followers_count - left.followers_count;
    case "followers-low":
      return left.followers_count - right.followers_count;
    case "posts-high":
      return right.statuses_count - left.statuses_count;
    case "posts-low":
      return left.statuses_count - right.statuses_count;
    case "media-high":
      return right.total_media - left.total_media;
    case "media-low":
      return left.total_media - right.total_media;
    case "newest":
    default:
      return right.id - left.id;
  }
}

export function useSavedAccountsModel({
  accounts,
  accountViewMode,
  searchQuery,
  filterGroup,
  filterMediaType,
  sortOrder,
}: SavedAccountsModelArgs) {
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const normalizedAccounts = useMemo<NormalizedAccountRecord[]>(
    () =>
      accounts.map((account) => ({
        account,
        normalizedUsername: account.username.toLowerCase(),
        normalizedName: account.name.toLowerCase(),
        isPrivate: isPrivateAccount(account.username),
      })),
    [accounts]
  );

  const normalizedQuery = useMemo(
    () => deferredSearchQuery.trim().toLowerCase(),
    [deferredSearchQuery]
  );

  const partitions = useMemo<AccountPartitions>(() => {
    const publicRecords: NormalizedAccountRecord[] = [];
    const privateRecords: NormalizedAccountRecord[] = [];
    const publicAccounts: AccountListItem[] = [];
    const privateAccounts: AccountListItem[] = [];

    for (const record of normalizedAccounts) {
      if (record.isPrivate) {
        privateRecords.push(record);
        privateAccounts.push(record.account);
        continue;
      }

      publicRecords.push(record);
      publicAccounts.push(record.account);
    }

    return {
      publicRecords,
      privateRecords,
      publicAccounts,
      privateAccounts,
    };
  }, [normalizedAccounts]);

  const baseRecords =
    accountViewMode === "public" ? partitions.publicRecords : partitions.privateRecords;

  const sortCache = useMemo(() => {
    const cache: Record<DatabaseSortOrder, NormalizedAccountRecord[]> = {
      newest: baseRecords,
      oldest: [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "oldest")
      ),
      "username-asc": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "username-asc")
      ),
      "username-desc": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "username-desc")
      ),
      "followers-high": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "followers-high")
      ),
      "followers-low": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "followers-low")
      ),
      "posts-high": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "posts-high")
      ),
      "posts-low": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "posts-low")
      ),
      "media-high": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "media-high")
      ),
      "media-low": [...baseRecords].sort((left, right) =>
        compareNormalizedAccounts(left, right, "media-low")
      ),
    };

    return cache;
  }, [baseRecords]);

  const hasSearch = normalizedQuery !== "";
  const hasGroupFilter = filterGroup !== "all";
  const hasMediaFilter = filterMediaType !== "all";

  return useMemo(() => {
    const noFiltersApplied =
      !hasSearch &&
      !hasGroupFilter &&
      !hasMediaFilter &&
      sortOrder === "newest";

    if (noFiltersApplied) {
      return {
        deferredSearchQuery,
        publicAccounts: partitions.publicAccounts,
        privateAccounts: partitions.privateAccounts,
        filteredAccounts: baseRecords.map((record) => record.account),
      };
    }

    const filteredRecords =
      hasSearch || hasGroupFilter || hasMediaFilter
        ? baseRecords.filter((record) => {
            const account = record.account;

            if (hasSearch) {
              const matchesUsername = record.normalizedUsername.includes(normalizedQuery);
              const matchesName = record.normalizedName.includes(normalizedQuery);
              if (!matchesUsername && !matchesName) {
                return false;
              }
            }

            if (hasGroupFilter) {
              if (filterGroup === "ungrouped" && account.group_name) {
                return false;
              }
              if (filterGroup !== "ungrouped" && account.group_name !== filterGroup) {
                return false;
              }
            }

            if (hasMediaFilter) {
              const accountMediaType = account.media_type || "all";
              if (filterMediaType === "all-media") {
                if (accountMediaType !== "all") {
                  return false;
                }
              } else if (accountMediaType !== filterMediaType) {
                return false;
              }
            }

            return true;
          })
        : baseRecords;

    const sortedRecords =
      filteredRecords === baseRecords
        ? sortCache[sortOrder]
        : [...filteredRecords].sort((left, right) =>
            compareNormalizedAccounts(left, right, sortOrder)
          );

    return {
      deferredSearchQuery,
      publicAccounts: partitions.publicAccounts,
      privateAccounts: partitions.privateAccounts,
      filteredAccounts: sortedRecords.map((record) => record.account),
    };
  }, [
    baseRecords,
    deferredSearchQuery,
    filterGroup,
    filterMediaType,
    hasGroupFilter,
    hasMediaFilter,
    hasSearch,
    normalizedQuery,
    partitions.privateAccounts,
    partitions.publicAccounts,
    sortCache,
    sortOrder,
  ]);
}
