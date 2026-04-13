import { useMemo } from "react";

import type { MediaTypeCounts, TimelineEntry } from "@/types/api";

interface NormalizedTimelineEntry {
  item: TimelineEntry;
  key: string;
  typeKey: "photo" | "video" | "gif" | "text" | "other";
  dateUnixMs: number;
  tweetIdNum: number;
}

export interface MediaKeyItem {
  tweet_id: string;
  url: string;
}

export interface IndexedTimelineEntry<T extends MediaKeyItem = TimelineEntry> {
  item: T;
  index: number;
  key: string;
}

export function getTimelineItemKey(item: MediaKeyItem): string {
  return `${item.tweet_id}-${item.url}`;
}

function normalizeMediaType(type: string): NormalizedTimelineEntry["typeKey"] {
  if (type === "photo") return "photo";
  if (type === "video") return "video";
  if (type === "gif" || type === "animated_gif") return "gif";
  if (type === "text") return "text";
  return "other";
}

function parseTimelineDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function useMediaTimelineModel(
  timeline: TimelineEntry[],
  filterType: string,
  sortBy: string
) {
  const baseModel = useMemo(() => {
    const normalizedTimeline = timeline.map<NormalizedTimelineEntry>((item) => ({
      item,
      key: getTimelineItemKey(item),
      typeKey: normalizeMediaType(item.type),
      dateUnixMs: parseTimelineDate(item.date),
      tweetIdNum: Number(item.tweet_id) || 0,
    }));

    const mediaCounts: MediaTypeCounts = {
      photo: 0,
      video: 0,
      gif: 0,
      text: 0,
    };

    for (const entry of normalizedTimeline) {
      if (entry.typeKey === "photo") mediaCounts.photo += 1;
      else if (entry.typeKey === "video") mediaCounts.video += 1;
      else if (entry.typeKey === "gif") mediaCounts.gif += 1;
      else if (entry.typeKey === "text") mediaCounts.text += 1;
    }

    return {
      normalizedTimeline,
      mediaCounts,
    };
  }, [timeline]);

  return useMemo(() => {
    const { normalizedTimeline, mediaCounts } = baseModel;

    const filteredNormalized =
      filterType === "all"
        ? normalizedTimeline.slice()
        : normalizedTimeline.filter((entry) => entry.typeKey === filterType);

    filteredNormalized.sort((left, right) => {
      if (sortBy === "date-desc") {
        return right.dateUnixMs - left.dateUnixMs;
      }
      if (sortBy === "date-asc") {
        return left.dateUnixMs - right.dateUnixMs;
      }
      if (sortBy === "tweet-id-desc") {
        return right.tweetIdNum - left.tweetIdNum;
      }
      if (sortBy === "tweet-id-asc") {
        return left.tweetIdNum - right.tweetIdNum;
      }
      return 0;
    });

    const filteredTimeline = filteredNormalized.map((entry) => entry.item);
    const indexedTimeline = filteredNormalized.map<IndexedTimelineEntry>((entry, index) => ({
      item: entry.item,
      index,
      key: entry.key,
    }));

    const timelineIndexByKey = new Map<string, number>();
    for (let index = 0; index < indexedTimeline.length; index += 1) {
      timelineIndexByKey.set(indexedTimeline[index].key, index);
    }

    return {
      mediaCounts,
      filteredTimeline,
      indexedTimeline,
      timelineIndexByKey,
    };
  }, [baseModel, filterType, sortBy]);
}
