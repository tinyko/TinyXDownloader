import {
  clearCursor,
  clearFetchState,
  saveCursor,
  saveFetchState,
  type FetchScope,
} from "@/lib/fetch/state";
import {
  appendUniqueEntries,
  collectIncrementalEntries,
  createTimelineAccumulator,
  type TimelineAccumulator,
} from "@/lib/fetch/session";
import { extractTimelineStructuredWithRetry } from "@/lib/fetch/extractor-client";
import {
  normalizeStructuredResponse,
  saveAccountSnapshotChunk,
} from "@/lib/fetch/snapshot-client";
import type { TimelineEntry, TwitterResponse } from "@/types/api";
import { main } from "../../../wailsjs/go/models";

export type TimelineFetchStopReason = "continue" | "stopped" | "timeout";
export type TimelineFetchExitReason = "completed" | "stopped" | "timeout" | "error";

const MAX_CONSECUTIVE_EMPTY_MEDIA_CURSOR_PAGES = 5;

export interface TimelineFetchBatchState {
  data: TwitterResponse;
  accountInfo: TwitterResponse["account_info"] | null;
  accumulator: TimelineAccumulator;
  batchNewEntries: TimelineEntry[];
  cursor?: string;
  hasMore: boolean;
  page: number;
  currentTotalFetched: number;
  overlapReached: boolean;
  isIncremental: boolean;
}

export interface TimelineFetchLoopResult {
  reason: TimelineFetchExitReason;
  accountInfo: TwitterResponse["account_info"] | null;
  accumulator: TimelineAccumulator;
  cursor?: string;
  hasMore: boolean;
  page: number;
  currentTotalFetched: number;
  overlapReached: boolean;
  isIncremental: boolean;
  error?: unknown;
}

interface RunTimelineFetchLoopOptions {
  scope: FetchScope;
  buildRequest: (
    page: number,
    cursor: string | undefined,
    requestId: string
  ) => main.TimelineRequest;
  readStopReason: () => TimelineFetchStopReason;
  initialCursor?: string;
  initialAccountInfo?: TwitterResponse["account_info"] | null;
  initialEntries?: TimelineEntry[];
  incrementalBaseCount?: number;
  knownTweetIds?: Set<string>;
  seenSessionEntryKeys?: Set<string>;
  onAttemptStart?: (requestId: string) => void;
  onAttemptFinish?: (requestId: string) => void;
  onBeforeRequest?: (page: number, cursor?: string) => void;
  onBatch?: (state: TimelineFetchBatchState) => void | Promise<void>;
}

function isExtractorCancellationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("extractor canceled");
}

function shouldStopAfterEmptyMediaCursorPages(
  scope: FetchScope,
  consecutiveEmptyPages: number
) {
  const timelineType = (scope.timelineType || "timeline").toLowerCase();
  const mediaType = (scope.mediaType || "all").toLowerCase();

  return (
    timelineType === "media" &&
    mediaType === "all" &&
    consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_MEDIA_CURSOR_PAGES
  );
}

function buildTimelineFetchLoopResult(
  reason: TimelineFetchExitReason,
  accountInfo: TwitterResponse["account_info"] | null,
  accumulator: TimelineAccumulator,
  cursor: string | undefined,
  hasMore: boolean,
  page: number,
  incrementalBaseCount: number,
  overlapReached: boolean,
  isIncremental: boolean,
  error?: unknown
): TimelineFetchLoopResult {
  return {
    reason,
    accountInfo,
    accumulator,
    cursor,
    hasMore,
    page,
    currentTotalFetched: incrementalBaseCount + accumulator.timeline.length,
    overlapReached,
    isIncremental,
    error,
  };
}

export async function runTimelineFetchLoop({
  scope,
  buildRequest,
  readStopReason,
  initialCursor,
  initialAccountInfo = null,
  initialEntries = [],
  incrementalBaseCount = 0,
  knownTweetIds = new Set<string>(),
  seenSessionEntryKeys = new Set<string>(),
  onAttemptStart,
  onAttemptFinish,
  onBeforeRequest,
  onBatch,
}: RunTimelineFetchLoopOptions): Promise<TimelineFetchLoopResult> {
  const accumulator = createTimelineAccumulator(initialEntries);
  const isIncremental = knownTweetIds.size > 0;
  let accountInfo = initialAccountInfo;
  let cursor = initialCursor;
  let hasMore = true;
  let page = 0;
  let overlapReached = false;
  let consecutiveEmptyCursorPages = 0;

  const persistPartialState = async () => {
    const currentTotalFetched = incrementalBaseCount + accumulator.timeline.length;
    if (!accountInfo || currentTotalFetched <= 0) {
      return;
    }

    saveFetchState({
      ...scope,
      cursor: cursor || "",
      accountInfo,
      totalFetched: currentTotalFetched,
      completed: false,
    });

    try {
      await saveAccountSnapshotChunk(
        scope,
        accountInfo,
        [],
        cursor,
        false,
        currentTotalFetched
      );
    } catch (error) {
      console.error("Failed to save partial fetch state to database:", error);
    }
  };

  try {
    while (hasMore) {
      const stopReason = readStopReason();
      if (stopReason !== "continue") {
        await persistPartialState();
        return buildTimelineFetchLoopResult(
          stopReason,
          accountInfo,
          accumulator,
          cursor,
          hasMore,
          page,
          incrementalBaseCount,
          overlapReached,
          isIncremental
        );
      }

      onBeforeRequest?.(page, cursor);

      const structuredData = await extractTimelineStructuredWithRetry({
        buildRequest: (requestId) => buildRequest(page, cursor, requestId),
        onAttemptStart,
        onAttemptFinish,
      });
      const data = normalizeStructuredResponse(structuredData);
      if (!data) {
        throw new Error("Empty timeline response");
      }

      if (!accountInfo && data.account_info) {
        accountInfo = data.account_info;
      }

      let batchNewEntries = data.timeline;
      if (isIncremental) {
        const batch = collectIncrementalEntries(
          data.timeline,
          knownTweetIds,
          seenSessionEntryKeys
        );
        batchNewEntries = appendUniqueEntries(accumulator, batch.freshEntries);
        overlapReached = overlapReached || batch.overlapReached;
      } else {
        batchNewEntries = appendUniqueEntries(accumulator, data.timeline);
      }

      cursor = data.cursor;
      hasMore = Boolean(data.cursor) && !data.completed;
      if (hasMore && data.timeline.length === 0) {
        consecutiveEmptyCursorPages += 1;
      } else {
        consecutiveEmptyCursorPages = 0;
      }
      if (overlapReached) {
        hasMore = false;
        cursor = undefined;
      }
      if (shouldStopAfterEmptyMediaCursorPages(scope, consecutiveEmptyCursorPages)) {
        hasMore = false;
        cursor = undefined;
      }
      page += 1;

      if (cursor && hasMore) {
        saveCursor(scope, cursor);
      }

      const currentTotalFetched = incrementalBaseCount + accumulator.timeline.length;
      if (accountInfo) {
        saveFetchState({
          ...scope,
          cursor: cursor || "",
          accountInfo,
          totalFetched: currentTotalFetched,
          completed: !hasMore,
        });

        try {
          await saveAccountSnapshotChunk(
            scope,
            accountInfo,
            batchNewEntries,
            cursor,
            !hasMore,
            currentTotalFetched
          );
        } catch (error) {
          console.error("Failed to save progress to database:", error);
        }
      }

      await onBatch?.({
        data,
        accountInfo,
        accumulator,
        batchNewEntries,
        cursor,
        hasMore,
        page,
        currentTotalFetched,
        overlapReached,
        isIncremental,
      });
    }

    clearFetchState(scope);
    clearCursor(scope);
    return buildTimelineFetchLoopResult(
      "completed",
      accountInfo,
      accumulator,
      cursor,
      false,
      page,
      incrementalBaseCount,
      overlapReached,
      isIncremental
    );
  } catch (error) {
    const stopReason = readStopReason();
    const classifiedReason: TimelineFetchExitReason =
      stopReason === "timeout"
        ? "timeout"
        : stopReason === "stopped" || isExtractorCancellationError(error)
          ? "stopped"
          : "error";

    await persistPartialState();

    return buildTimelineFetchLoopResult(
      classifiedReason,
      accountInfo,
      accumulator,
      cursor,
      hasMore,
      page,
      incrementalBaseCount,
      overlapReached,
      isIncremental,
      error
    );
  }
}
