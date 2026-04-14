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
  const currentResetKey = resetKey ?? "";
  const [previewState, setPreviewState] = useState<{
    resetKey: string;
    previewKey: string | null;
  }>({
    resetKey: currentResetKey,
    previewKey: null,
  });

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

  const previewKey =
    previewState.resetKey === currentResetKey ? previewState.previewKey : null;
  const previewIndex = previewKey ? timelineIndexByKey.get(previewKey) ?? null : null;

  const openPreview = useCallback((itemKey: string) => {
    setPreviewState({
      resetKey: currentResetKey,
      previewKey: itemKey,
    });
  }, [currentResetKey]);

  const closePreview = useCallback(() => {
    setPreviewState({
      resetKey: currentResetKey,
      previewKey: null,
    });
  }, [currentResetKey]);

  const goToPrevious = useCallback(() => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewState({
        resetKey: currentResetKey,
        previewKey: indexedItems[previewIndex - 1].key,
      });
    }
  }, [currentResetKey, indexedItems, previewIndex]);

  const goToNext = useCallback(() => {
    if (previewIndex !== null && previewIndex < indexedItems.length - 1) {
      setPreviewState({
        resetKey: currentResetKey,
        previewKey: indexedItems[previewIndex + 1].key,
      });
    }
  }, [currentResetKey, indexedItems, previewIndex]);

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
    setPreviewKey: (nextPreviewKey: string | null) =>
      setPreviewState({
        resetKey: currentResetKey,
        previewKey: nextPreviewKey,
      }),
    previewIndex,
    openPreview,
    closePreview,
    goToPrevious,
    goToNext,
  };
}
