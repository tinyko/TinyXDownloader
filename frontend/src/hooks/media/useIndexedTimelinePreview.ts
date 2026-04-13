import { useCallback, useEffect, useMemo, useState } from "react";

import { getTimelineItemKey } from "@/hooks/media/useMediaTimelineModel";

interface MediaKeyItem {
  tweet_id: string;
  url: string;
}

export interface IndexedTimelineItem<T> {
  item: T;
  index: number;
  key: string;
}

interface UseIndexedTimelinePreviewOptions {
  resetKey?: string;
}

export function useIndexedTimelinePreview<T extends MediaKeyItem>(
  items: T[],
  options: UseIndexedTimelinePreviewOptions = {}
) {
  const { resetKey } = options;
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const indexedItems = useMemo<IndexedTimelineItem<T>[]>(
    () => items.map((item, index) => ({ item, index, key: getTimelineItemKey(item) })),
    [items]
  );

  const timelineIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < indexedItems.length; index += 1) {
      map.set(indexedItems[index].key, index);
    }
    return map;
  }, [indexedItems]);

  const previewIndex = previewKey ? timelineIndexByKey.get(previewKey) ?? null : null;

  const openPreview = useCallback((itemKey: string) => {
    setPreviewKey(itemKey);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewKey(null);
  }, []);

  const goToPrevious = useCallback(() => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewKey(indexedItems[previewIndex - 1].key);
    }
  }, [indexedItems, previewIndex]);

  const goToNext = useCallback(() => {
    if (previewIndex !== null && previewIndex < indexedItems.length - 1) {
      setPreviewKey(indexedItems[previewIndex + 1].key);
    }
  }, [indexedItems, previewIndex]);

  useEffect(() => {
    setPreviewKey(null);
  }, [resetKey]);

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

  return {
    indexedItems,
    timelineIndexByKey,
    previewKey,
    setPreviewKey,
    previewIndex,
    openPreview,
    closePreview,
    goToPrevious,
    goToNext,
  };
}
