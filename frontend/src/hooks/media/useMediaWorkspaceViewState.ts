import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TimelineEntry } from "@/types/api";
import type { MediaWorkspaceViewMode } from "@/types/media";
import {
  useMediaTimelineModel,
  type IndexedTimelineEntry,
} from "@/hooks/media/useMediaTimelineModel";

const INITIAL_VISIBLE_COUNT = 10;
const LOAD_MORE_COUNT = 10;

interface SelectionState {
  resetKey: string;
  items: Set<string>;
}

interface PreviewState {
  resetKey: string;
  previewKey: string | null;
}

interface VisibleCountState {
  resetKey: string;
  count: number;
}

export function useMediaWorkspaceViewState(timeline: TimelineEntry[]) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [sortBy, setSortBy] = useState<string>("date-desc");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<MediaWorkspaceViewMode>("list");
  const [showScrollTop, setShowScrollTop] = useState(false);

  const { mediaCounts, filteredTimeline, indexedTimeline, timelineIndexByKey } =
    useMediaTimelineModel(timeline, filterType, sortBy);
  const viewResetKey = `${filteredTimeline.length}|${filterType}|${sortBy}`;
  const [selectionState, setSelectionState] = useState<SelectionState>({
    resetKey: viewResetKey,
    items: new Set(),
  });
  const [previewState, setPreviewState] = useState<PreviewState>({
    resetKey: viewResetKey,
    previewKey: null,
  });
  const [visibleCountState, setVisibleCountState] = useState<VisibleCountState>({
    resetKey: viewResetKey,
    count: INITIAL_VISIBLE_COUNT,
  });

  const selectedItems =
    selectionState.resetKey === viewResetKey ? selectionState.items : new Set<string>();
  const previewKey =
    previewState.resetKey === viewResetKey ? previewState.previewKey : null;
  const visibleCount =
    visibleCountState.resetKey === viewResetKey
      ? visibleCountState.count
      : INITIAL_VISIBLE_COUNT;

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
          setVisibleCountState((current) => {
            const currentCount =
              current.resetKey === viewResetKey
                ? current.count
                : INITIAL_VISIBLE_COUNT;
            return {
              resetKey: viewResetKey,
              count: Math.min(currentCount + LOAD_MORE_COUNT, filteredTimeline.length),
            };
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentLoadMoreRef);
    return () => observer.unobserve(currentLoadMoreRef);
  }, [filteredTimeline.length, viewMode, viewResetKey]);

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
    setPreviewState({
      resetKey: viewResetKey,
      previewKey: null,
    });
  }, [viewResetKey]);

  const openPreview = useCallback((itemKey: string) => {
    setPreviewState({
      resetKey: viewResetKey,
      previewKey: itemKey,
    });
  }, [viewResetKey]);

  const goToPrevious = useCallback(() => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewState({
        resetKey: viewResetKey,
        previewKey: indexedTimeline[previewIndex - 1].key,
      });
    }
  }, [indexedTimeline, previewIndex, viewResetKey]);

  const goToNext = useCallback(() => {
    if (previewIndex !== null && previewIndex < indexedTimeline.length - 1) {
      setPreviewState({
        resetKey: viewResetKey,
        previewKey: indexedTimeline[previewIndex + 1].key,
      });
    }
  }, [indexedTimeline, previewIndex, viewResetKey]);

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
      setSelectionState({
        resetKey: viewResetKey,
        items: new Set(),
      });
      return;
    }
    setSelectionState({
      resetKey: viewResetKey,
      items: new Set(indexedTimeline.map((entry) => entry.key)),
    });
  }, [filteredTimeline.length, indexedTimeline, selectedItems.size, viewResetKey]);

  const toggleItem = useCallback((itemKey: string) => {
    setSelectionState((current) => {
      const currentItems =
        current.resetKey === viewResetKey ? current.items : new Set<string>();
      const next = new Set(currentItems);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return {
        resetKey: viewResetKey,
        items: next,
      };
    });
  }, [viewResetKey]);

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
