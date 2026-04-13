import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TimelineEntry } from "@/types/api";
import type { MediaWorkspaceViewMode } from "@/types/media";
import {
  useMediaTimelineModel,
  type IndexedTimelineEntry,
} from "@/hooks/media/useMediaTimelineModel";

const INITIAL_VISIBLE_COUNT = 10;
const LOAD_MORE_COUNT = 10;

export function useMediaWorkspaceViewState(timeline: TimelineEntry[]) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<MediaWorkspaceViewMode>("list");
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const { mediaCounts, filteredTimeline, indexedTimeline, timelineIndexByKey } =
    useMediaTimelineModel(timeline, filterType, sortBy);

  const previewIndex = previewKey ? timelineIndexByKey.get(previewKey) ?? null : null;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 300);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    setPreviewKey(null);
    setSelectedItems(new Set());
  }, [filteredTimeline.length, filterType, sortBy]);

  useEffect(() => {
    if (viewMode !== "gallery") {
      return;
    }

    const currentLoadMoreRef = loadMoreRef.current;
    if (!currentLoadMoreRef) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + LOAD_MORE_COUNT, filteredTimeline.length)
          );
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentLoadMoreRef);
    return () => observer.unobserve(currentLoadMoreRef);
  }, [filteredTimeline.length, viewMode]);

  useEffect(() => {
    if (previewIndex !== null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [previewIndex]);

  const closePreview = useCallback(() => {
    setPreviewKey(null);
  }, []);

  const openPreview = useCallback((itemKey: string) => {
    setPreviewKey(itemKey);
  }, []);

  const goToPrevious = useCallback(() => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewKey(indexedTimeline[previewIndex - 1].key);
    }
  }, [indexedTimeline, previewIndex]);

  const goToNext = useCallback(() => {
    if (previewIndex !== null && previewIndex < indexedTimeline.length - 1) {
      setPreviewKey(indexedTimeline[previewIndex + 1].key);
    }
  }, [indexedTimeline, previewIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (previewIndex === null) {
        return;
      }
      if (event.key === "Escape") {
        closePreview();
      }
      if (event.key === "ArrowLeft") {
        goToPrevious();
      }
      if (event.key === "ArrowRight") {
        goToNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, goToNext, goToPrevious, previewIndex]);

  const toggleSelectAll = useCallback(() => {
    if (selectedItems.size === filteredTimeline.length) {
      setSelectedItems(new Set());
      return;
    }
    setSelectedItems(new Set(indexedTimeline.map((entry) => entry.key)));
  }, [filteredTimeline.length, indexedTimeline, selectedItems.size]);

  const toggleItem = useCallback((itemKey: string) => {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const visibleTimeline = useMemo(
    () => filteredTimeline.slice(0, visibleCount),
    [filteredTimeline, visibleCount]
  );

  return {
    scrollContainerRef,
    loadMoreRef,
    selectedItems,
    sortBy,
    setSortBy,
    filterType,
    setFilterType,
    viewMode,
    setViewMode,
    visibleCount,
    showScrollTop,
    mediaCounts,
    filteredTimeline,
    visibleTimeline,
    indexedTimeline,
    previewKey,
    previewIndex,
    openPreview,
    closePreview,
    goToPrevious,
    goToNext,
    toggleSelectAll,
    toggleItem,
    scrollToTop,
  };
}

export type MediaWorkspaceIndexedEntry = IndexedTimelineEntry<TimelineEntry>;
