import { useDeferredValue, useMemo } from "react";

import { backend } from "../../../wailsjs/go/models";

type AccountListItem = backend.AccountListItem;

export interface SavedAccountsModelArgs {
  accounts: AccountListItem[];
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
  sortOrder:
    | "newest"
    | "oldest"
    | "username-asc"
    | "username-desc"
    | "followers-high"
    | "followers-low"
    | "posts-high"
    | "posts-low"
    | "media-high"
    | "media-low";
}

interface NormalizedAccountRecord {
  account: AccountListItem;
  normalizedUsername: string;
  normalizedName: string;
  isPrivate: boolean;
}

function isPrivateAccount(username: string) {
  return username === "bookmarks" || username === "likes";
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

  return useMemo(() => {
    const publicAccounts = normalizedAccounts
      .filter((record) => !record.isPrivate)
      .map((record) => record.account);
    const privateAccounts = normalizedAccounts
      .filter((record) => record.isPrivate)
      .map((record) => record.account);
    const baseRecords = normalizedAccounts.filter((record) =>
      accountViewMode === "public" ? !record.isPrivate : record.isPrivate
    );
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    const noFiltersApplied =
      normalizedQuery === "" &&
      filterGroup === "all" &&
      filterMediaType === "all" &&
      sortOrder === "newest";

    if (noFiltersApplied) {
      return {
        deferredSearchQuery,
        publicAccounts,
        privateAccounts,
        filteredAccounts: baseRecords.map((record) => record.account),
      };
    }

    const filteredRecords = baseRecords.filter((record) => {
      const account = record.account;

      if (normalizedQuery) {
        const matchesUsername = record.normalizedUsername.includes(normalizedQuery);
        const matchesName = record.normalizedName.includes(normalizedQuery);
        if (!matchesUsername && !matchesName) {
          return false;
        }
      }

      if (filterGroup !== "all") {
        if (filterGroup === "ungrouped" && account.group_name) {
          return false;
        }
        if (filterGroup !== "ungrouped" && account.group_name !== filterGroup) {
          return false;
        }
      }

      if (filterMediaType !== "all") {
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
    });

    const sortedRecords = filteredRecords.slice();
    sortedRecords.sort((leftRecord, rightRecord) => {
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
    });

    return {
      deferredSearchQuery,
      publicAccounts,
      privateAccounts,
      filteredAccounts: sortedRecords.map((record) => record.account),
    };
  }, [
    accountViewMode,
    deferredSearchQuery,
    filterGroup,
    filterMediaType,
    normalizedAccounts,
    sortOrder,
  ]);
}
