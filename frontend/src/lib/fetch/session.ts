import type { MultipleAccount, FetchMode, PrivateType } from "@/types/fetch";
import type { FetchScope } from "@/lib/fetch/state";
import type { TimelineEntry, TwitterResponse } from "@/types/api";

export interface TimelineAccumulator {
  timeline: TimelineEntry[];
  entryKeys: Set<string>;
  tweetIds: Set<string>;
}

export function formatNumberWithComma(num: number): string {
  return num.toLocaleString();
}

export function resolveFetchTimelineType(
  useDateRange: boolean,
  mode: FetchMode,
  privateType: PrivateType | undefined,
  mediaType: string,
  retweets: boolean
): string {
  if (useDateRange) {
    return "date_range";
  }

  if (mode === "private") {
    return privateType === "likes" ? "likes" : "bookmarks";
  }

  if (mediaType === "text" || retweets) {
    return "timeline";
  }

  return "media";
}

export function parseUsername(input: string): string {
  let clean = input.trim();
  if (clean.startsWith("@")) {
    clean = clean.slice(1);
  }
  if (clean.includes("x.com/") || clean.includes("twitter.com/")) {
    const match = clean.match(/(?:x\.com|twitter\.com)\/([^/?]+)/);
    if (match) clean = match[1];
  }
  return clean.trim();
}

export function parseUsernameList(input: string): string[] {
  const seen = new Set<string>();
  const usernames: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const parsed = parseUsername(line);
    if (!parsed) {
      continue;
    }
    const key = parsed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    usernames.push(parsed);
  }

  return usernames;
}

export function buildTimelineEntryKey(entry: TimelineEntry): string {
  return `${entry.tweet_id}:${entry.url}`;
}

export function scopesMatch(
  left: FetchScope | null | undefined,
  right: FetchScope | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.username === right.username &&
    (left.mediaType || "all") === (right.mediaType || "all") &&
    (left.timelineType || "timeline") === (right.timelineType || "timeline") &&
    Boolean(left.retweets) === Boolean(right.retweets) &&
    (left.queryKey || "") === (right.queryKey || "")
  );
}

export function buildFetchScope({
  username,
  mediaType = "all",
  timelineType = "timeline",
  retweets = false,
  queryKey = "",
}: FetchScope): FetchScope {
  return {
    username: username.trim(),
    mediaType,
    timelineType,
    retweets,
    queryKey,
  };
}

export function createTimelineAccumulator(initialTimeline: TimelineEntry[] = []): TimelineAccumulator {
  const timeline: TimelineEntry[] = [];
  const entryKeys = new Set<string>();
  const tweetIds = new Set<string>();

  for (const entry of initialTimeline) {
    const entryKey = buildTimelineEntryKey(entry);
    if (entryKeys.has(entryKey)) {
      continue;
    }

    entryKeys.add(entryKey);
    tweetIds.add(entry.tweet_id);
    timeline.push(entry);
  }

  return {
    timeline,
    entryKeys,
    tweetIds,
  };
}

export function appendUniqueEntries(accumulator: TimelineAccumulator, entries: TimelineEntry[]): TimelineEntry[] {
  const addedEntries: TimelineEntry[] = [];

  for (const entry of entries) {
    const entryKey = buildTimelineEntryKey(entry);
    if (accumulator.entryKeys.has(entryKey)) {
      continue;
    }

    accumulator.entryKeys.add(entryKey);
    accumulator.tweetIds.add(entry.tweet_id);
    accumulator.timeline.push(entry);
    addedEntries.push(entry);
  }

  return addedEntries;
}

export function createResultTimeline(accumulator: TimelineAccumulator): TimelineEntry[] {
  return accumulator.timeline.slice();
}

export function mergeFetchedWithSavedTimeline(
  fetchedTimeline: TimelineEntry[],
  savedTimeline: TimelineEntry[]
): TimelineEntry[] {
  const seen = new Set<string>();
  const merged: TimelineEntry[] = [];

  for (const entry of fetchedTimeline) {
    const key = buildTimelineEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }

  for (const entry of savedTimeline) {
    const key = buildTimelineEntryKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

export function collectIncrementalEntries(
  batchTimeline: TimelineEntry[],
  knownTweetIds: Set<string>,
  sessionEntryKeys: Set<string>
): { freshEntries: TimelineEntry[]; overlapReached: boolean } {
  const freshEntries: TimelineEntry[] = [];
  let overlapReached = false;

  for (const entry of batchTimeline) {
    if (knownTweetIds.has(entry.tweet_id)) {
      overlapReached = true;
      continue;
    }

    const entryKey = buildTimelineEntryKey(entry);
    if (sessionEntryKeys.has(entryKey)) {
      continue;
    }

    sessionEntryKeys.add(entryKey);
    freshEntries.push(entry);
  }

  return { freshEntries, overlapReached };
}

export function createMultipleAccounts(
  usernames: string[],
  options: {
    mode: FetchMode;
    privateType?: PrivateType;
    mediaType: string;
    retweets: boolean;
  }
): MultipleAccount[] {
  return usernames.map((username) => ({
    id: crypto.randomUUID(),
    username,
    mode: options.mode,
    privateType: options.privateType,
    mediaType: options.mediaType,
    retweets: options.retweets,
    status: "pending",
    mediaCount: 0,
    previousMediaCount: 0,
    elapsedTime: 0,
    remainingTime: null,
    showDiff: false,
  }));
}

export function buildTwitterResponse(
  accountInfo: TwitterResponse["account_info"],
  timeline: TwitterResponse["timeline"],
  newEntries: number,
  page: number,
  batchSize: number,
  hasMore: boolean,
  cursor?: string,
  completed = true
): TwitterResponse {
  return {
    account_info: accountInfo,
    timeline,
    total_urls: timeline.length,
    metadata: {
      new_entries: newEntries,
      page,
      batch_size: batchSize,
      has_more: hasMore,
      cursor,
      completed,
    },
    cursor,
    completed,
  };
}
