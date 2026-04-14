import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  loadSavedAccountMatchingIds,
  querySavedAccountsPage,
} from "@/lib/database-client";
import type {
  AccountListItem,
  DatabaseGridView,
  DatabaseSortOrder,
} from "@/types/database";

const GALLERY_PAGE_SIZE = 48;
const LIST_PAGE_SIZE = 100;

interface UseSavedAccountsQueryArgs {
  accountViewMode: "public" | "private";
  searchQuery: string;
  filterGroup: string;
  filterMediaType: string;
  sortOrder: DatabaseSortOrder;
  gridView: DatabaseGridView;
}

function buildQueryKey({
  accountViewMode,
  searchQuery,
  filterGroup,
  filterMediaType,
  sortOrder,
  gridView,
}: UseSavedAccountsQueryArgs) {
  return JSON.stringify({
    accountViewMode,
    searchQuery: searchQuery.trim(),
    filterGroup,
    filterMediaType,
    sortOrder,
    gridView,
  });
}

export function useSavedAccountsQuery(args: UseSavedAccountsQueryArgs) {
  const {
    accountViewMode,
    searchQuery,
    filterGroup,
    filterMediaType,
    sortOrder,
    gridView,
  } = args;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const query = useMemo(
    () => ({
      accountViewMode,
      searchQuery: deferredSearchQuery,
      filterGroup,
      filterMediaType,
      sortOrder,
      gridView,
    }),
    [
      accountViewMode,
      deferredSearchQuery,
      filterGroup,
      filterMediaType,
      sortOrder,
      gridView,
    ]
  );

  const queryKey = useMemo(() => buildQueryKey(query), [query]);
  const pageSize = query.gridView === "gallery" ? GALLERY_PAGE_SIZE : LIST_PAGE_SIZE;

  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [matchingIds, setMatchingIds] = useState<number[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const activeQueryKeyRef = useRef(queryKey);

  useEffect(() => {
    activeQueryKeyRef.current = queryKey;
    setLoading(true);

    void Promise.all([
      querySavedAccountsPage({
        accountViewMode: query.accountViewMode,
        searchQuery: query.searchQuery,
        filterGroup: query.filterGroup,
        filterMediaType: query.filterMediaType,
        sortOrder: query.sortOrder,
        offset: 0,
        limit: pageSize,
      }),
      loadSavedAccountMatchingIds({
        accountViewMode: query.accountViewMode,
        searchQuery: query.searchQuery,
        filterGroup: query.filterGroup,
        filterMediaType: query.filterMediaType,
      }),
    ]).then(([page, ids]) => {
      if (activeQueryKeyRef.current !== queryKey) {
        return;
      }

      startTransition(() => {
        setAccounts(page?.items || []);
        setTotalCount(page?.totalCount || 0);
        setHasMore(Boolean(page?.hasMore));
        setNextOffset(page?.nextOffset || 0);
        setMatchingIds(ids);
        setLoading(false);
      });
    }).catch(() => {
      if (activeQueryKeyRef.current !== queryKey) {
        return;
      }
      setLoading(false);
    });
  }, [pageSize, query, queryKey]);

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) {
      return;
    }

    const currentKey = queryKey;
    setLoadingMore(true);
    try {
      const page = await querySavedAccountsPage({
        accountViewMode: query.accountViewMode,
        searchQuery: query.searchQuery,
        filterGroup: query.filterGroup,
        filterMediaType: query.filterMediaType,
        sortOrder: query.sortOrder,
        offset: nextOffset,
        limit: pageSize,
      });
      if (activeQueryKeyRef.current !== currentKey || !page) {
        return;
      }

      startTransition(() => {
        setAccounts((previous) => {
          const seen = new Set(previous.map((item) => item.id));
          const appended = page.items.filter((item) => !seen.has(item.id));
          return [...previous, ...appended];
        });
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
      });
    } finally {
      if (activeQueryKeyRef.current === currentKey) {
        setLoadingMore(false);
      }
    }
  };

  const refresh = async () => {
    const currentKey = buildQueryKey(query);
    activeQueryKeyRef.current = currentKey;
    setLoading(true);
    try {
      const [page, ids] = await Promise.all([
        querySavedAccountsPage({
          accountViewMode: query.accountViewMode,
          searchQuery: query.searchQuery,
          filterGroup: query.filterGroup,
          filterMediaType: query.filterMediaType,
          sortOrder: query.sortOrder,
          offset: 0,
          limit: pageSize,
        }),
        loadSavedAccountMatchingIds({
          accountViewMode: query.accountViewMode,
          searchQuery: query.searchQuery,
          filterGroup: query.filterGroup,
          filterMediaType: query.filterMediaType,
        }),
      ]);
      if (activeQueryKeyRef.current !== currentKey) {
        return;
      }
      startTransition(() => {
        setAccounts(page?.items || []);
        setTotalCount(page?.totalCount || 0);
        setHasMore(Boolean(page?.hasMore));
        setNextOffset(page?.nextOffset || 0);
        setMatchingIds(ids);
        setLoading(false);
      });
    } catch {
      if (activeQueryKeyRef.current === currentKey) {
        setLoading(false);
      }
    }
  };

  return {
    accounts,
    matchingIds,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    refresh,
  };
}
