import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { getTimelineItemKey } from "@/hooks/media/useMediaTimelineModel";
import { loadSavedTimelineItemsPage } from "@/lib/fetch/snapshot-client";
import type { FetchScope } from "@/lib/fetch/state";
import type { AccountTimelineItemsPage, SavedTimelineItem } from "@/types/api";

interface UseSavedTimelinePagerOptions {
  pageSize?: number;
}

export function useSavedTimelinePager(
  scope: FetchScope,
  filterType: string,
  sortBy: string,
  options: UseSavedTimelinePagerOptions = {}
) {
  const { pageSize = 120 } = options;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scopeResetKey = `${scope.username}|${scope.mediaType}|${scope.timelineType}|${
    scope.retweets ? "1" : "0"
  }|${scope.queryKey}|${filterType}|${sortBy}|${pageSize}`;

  const [page, setPage] = useState<AccountTimelineItemsPage | null>(null);
  const [items, setItems] = useState<SavedTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasMore = Boolean(page?.has_more);
  const nextOffset = page?.next_offset ?? 0;

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const data = await loadSavedTimelineItemsPage(
          scope,
          offset,
          pageSize,
          filterType,
          sortBy
        );
        if (!data) {
          return;
        }

        startTransition(() => {
          setPage(data);
          setItems((previous) => {
            if (!append) {
              return data.items;
            }

            const seen = new Set(previous.map((item) => getTimelineItemKey(item)));
            const appended = data.items.filter((item) => !seen.has(getTimelineItemKey(item)));
            return [...previous, ...appended];
          });
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      filterType,
      pageSize,
      scope,
      sortBy,
    ]
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage, scopeResetKey]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadPage(nextOffset, true);
        }
      },
      { threshold: 0.1, rootMargin: "120px" }
    );

    const currentRef = loadMoreRef.current;
    observer.observe(currentRef);
    return () => observer.unobserve(currentRef);
  }, [hasMore, loadPage, loadingMore, nextOffset]);

  return {
    page,
    items,
    loading,
    loadingMore,
    hasMore,
    nextOffset,
    loadMoreRef,
    reloadFirstPage: () => loadPage(0, false),
  };
}
