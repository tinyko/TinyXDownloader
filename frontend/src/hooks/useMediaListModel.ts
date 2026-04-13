import { useMemo } from "react";

import type { TimelineEntry } from "@/types/api";

export interface MediaTypeCounts {
  photo: number;
  video: number;
  gif: number;
  text: number;
}

interface NormalizedTimelineEntry {
  item: TimelineEntry;
  key: string;
  typeKey: "photo" | "video" | "gif" | "text" | "other";
  dateUnixMs: number;
  tweetIdNum: number;
}

export function getMediaItemKey(item: TimelineEntry): string {
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

export function useMediaListModel(
  timeline: TimelineEntry[],
  filterType: string,
  sortBy: string
) {
  return useMemo(() => {
    const normalizedTimeline = timeline.map<NormalizedTimelineEntry>((item) => ({
      item,
      key: getMediaItemKey(item),
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
    const indexedTimeline = filteredNormalized.map((entry, index) => ({
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
  }, [filterType, sortBy, timeline]);
}
