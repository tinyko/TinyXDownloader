import type { MutableRefObject } from "react";

import { logger } from "@/lib/logger";
import {
  clearCursor,
  clearFetchState,
  saveCursor,
  saveFetchState,
} from "@/lib/fetch/state";
import {
  appendUniqueEntries,
  buildFetchScope,
  collectIncrementalEntries,
  createTimelineAccumulator,
  resolveFetchTimelineType,
} from "@/lib/fetch/session";
import {
  loadSnapshotSummaryFromDB,
  loadSnapshotTweetIdsFromDB,
  normalizeStructuredResponse,
  saveAccountSnapshotChunk,
} from "@/lib/fetch/snapshot-client";
import type { FetchMode, MultipleAccount, PrivateType } from "@/types/fetch";
import type { TwitterResponse } from "@/types/api";
import { ExtractTimelineStructured } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

interface RunMultiFetchSessionOptions {
  account: MultipleAccount;
  queueMode: FetchMode;
  queuePrivateType: PrivateType;
  queueMediaType: string;
  queueRetweets: boolean;
  resolvedAuthToken: string;
  timeoutSeconds: number;
  batchSize: number;
  stopAllRef: MutableRefObject<boolean>;
  accountStartTimesRef: MutableRefObject<Map<string, number>>;
  accountStopFlagsRef: MutableRefObject<Map<string, boolean>>;
  accountMediaCountRef: MutableRefObject<Map<string, number>>;
  accountTimeoutSecondsRef: MutableRefObject<Map<string, number>>;
  activeAccountRequestIdsRef: MutableRefObject<Map<string, string>>;
  queueMultipleAccountUpdate: (
    accountId: string,
    patch: Partial<MultipleAccount>
  ) => void;
  flushMultipleAccountUpdates: () => void;
  clearAccountRuntimeState: (accountId: string) => void;
  markAccountDiffVisible: (accountId: string) => void;
}

export async function runMultiFetchSession({
  account,
  queueMode,
  queuePrivateType,
  queueMediaType,
  queueRetweets,
  resolvedAuthToken,
  timeoutSeconds,
  batchSize,
  stopAllRef,
  accountStartTimesRef,
  accountStopFlagsRef,
  accountMediaCountRef,
  accountTimeoutSecondsRef,
  activeAccountRequestIdsRef,
  queueMultipleAccountUpdate,
  flushMultipleAccountUpdates,
  clearAccountRuntimeState,
  markAccountDiffVisible,
}: RunMultiFetchSessionOptions) {
  const accountId = account.id;
  const cleanUsername = account.username.trim();
  const accountMode = account.mode ?? queueMode;
  const accountPrivateType = account.privateType ?? queuePrivateType;
  const accountMediaType = account.mediaType ?? queueMediaType;
  const accountRetweets = account.retweets ?? queueRetweets;
  const multipleTimelineType = resolveFetchTimelineType(
    false,
    accountMode,
    accountPrivateType,
    accountMediaType,
    accountRetweets
  );
  const accountScope = buildFetchScope({
    username: cleanUsername,
    mediaType: accountMediaType,
    timelineType: multipleTimelineType,
    retweets: accountRetweets,
  });
  const savedSummary = await loadSnapshotSummaryFromDB(accountScope);
  const savedTweetIds =
    savedSummary?.completed && (savedSummary?.total_urls || 0) > 0
      ? await loadSnapshotTweetIdsFromDB(accountScope)
      : [];
  const hasIncrementalBoundary =
    Boolean(savedSummary?.completed) &&
    (savedSummary?.total_urls || 0) > 0 &&
    savedTweetIds.length > 0;
  const knownTweetIds = hasIncrementalBoundary
    ? new Set(savedTweetIds)
    : new Set<string>();
  const seenSessionEntryKeys = new Set<string>();
  const queuedEntryAccumulator = createTimelineAccumulator();
  let overlapReached = false;
  let accountInfo: TwitterResponse["account_info"] | null =
    savedSummary?.account_info || null;
  let cursor: string | undefined;
  let hasMore = true;
  let page = 0;
  const incrementalBaseCount = hasIncrementalBoundary
    ? savedSummary?.total_urls || 0
    : 0;
  let currentMediaCount = incrementalBaseCount;
  let previousMediaCount = incrementalBaseCount || account.mediaCount || 0;

  accountStopFlagsRef.current.set(accountId, false);
  accountMediaCountRef.current.set(accountId, previousMediaCount);

  queueMultipleAccountUpdate(accountId, {
    status: "fetching",
    accountInfo: accountInfo || undefined,
    mediaCount: previousMediaCount,
    previousMediaCount,
    elapsedTime: 0,
    remainingTime: timeoutSeconds,
    error: undefined,
    showDiff: false,
  });
  flushMultipleAccountUpdates();

  accountStartTimesRef.current.set(accountId, Date.now());
  accountTimeoutSecondsRef.current.set(accountId, timeoutSeconds);

  try {
    if (stopAllRef.current) {
      clearAccountRuntimeState(accountId);
      const mediaCount =
        accountMediaCountRef.current.get(accountId) || account.mediaCount || 0;
      queueMultipleAccountUpdate(accountId, {
        status: mediaCount === 0 ? "failed" : "incomplete",
        mediaCount,
      });
      flushMultipleAccountUpdates();
      return;
    }

    while (hasMore && !stopAllRef.current) {
      if (accountStopFlagsRef.current.get(accountId)) {
        if (accountInfo && currentMediaCount > 0) {
          saveFetchState({
            ...accountScope,
            cursor: cursor || "",
            accountInfo,
            totalFetched: currentMediaCount,
            completed: false,
          });

          try {
            await saveAccountSnapshotChunk(
              accountScope,
              accountInfo,
              [],
              cursor,
              false,
              currentMediaCount
            );
          } catch (err) {
            console.error("Failed to save timeout state to database:", err);
          }
        }
        break;
      }

      const requestId = crypto.randomUUID();
      activeAccountRequestIdsRef.current.set(accountId, requestId);

      const structuredData = await ExtractTimelineStructured(
        new main.TimelineRequest({
          username:
            accountMode === "private" && accountPrivateType === "bookmarks"
              ? ""
              : cleanUsername,
          auth_token: resolvedAuthToken.trim(),
          timeline_type: multipleTimelineType,
          batch_size: batchSize,
          page,
          media_type: accountMediaType,
          retweets: accountRetweets,
          request_id: requestId,
          cursor,
        })
      ).finally(() => {
        if (activeAccountRequestIdsRef.current.get(accountId) === requestId) {
          activeAccountRequestIdsRef.current.delete(accountId);
        }
      });
      const data = normalizeStructuredResponse(structuredData);
      if (!data) {
        throw new Error("Empty timeline response");
      }

      if (!accountInfo && data.account_info) {
        accountInfo = data.account_info;
      }

      let batchNewEntries = data.timeline;

      if (hasIncrementalBoundary) {
        const { freshEntries, overlapReached: batchOverlapReached } =
          collectIncrementalEntries(data.timeline, knownTweetIds, seenSessionEntryKeys);

        batchNewEntries = appendUniqueEntries(queuedEntryAccumulator, freshEntries);
        currentMediaCount = incrementalBaseCount + queuedEntryAccumulator.timeline.length;
        overlapReached = overlapReached || batchOverlapReached;
      } else {
        batchNewEntries = appendUniqueEntries(queuedEntryAccumulator, data.timeline);
        currentMediaCount = queuedEntryAccumulator.timeline.length;
      }

      cursor = data.cursor;
      hasMore = !!data.cursor && !data.completed;
      if (overlapReached) {
        hasMore = false;
        cursor = undefined;
        logger.info(
          `@${account.username}: reached saved overlap boundary, stopping refresh early.`
        );
      }
      page += 1;

      if (cursor && hasMore) {
        saveCursor(accountScope, cursor);
      }

      accountMediaCountRef.current.set(accountId, currentMediaCount);
      const hasNewItems = currentMediaCount > previousMediaCount;

      queueMultipleAccountUpdate(accountId, {
        accountInfo: accountInfo || undefined,
        previousMediaCount,
        mediaCount: currentMediaCount,
        cursor,
      });
      if (hasNewItems) {
        markAccountDiffVisible(accountId);
      }
      flushMultipleAccountUpdates();

      previousMediaCount = currentMediaCount;

      if (accountInfo) {
        saveFetchState({
          ...accountScope,
          cursor: cursor || "",
          accountInfo,
          totalFetched: currentMediaCount,
          completed: !hasMore,
        });

        try {
          await saveAccountSnapshotChunk(
            accountScope,
            accountInfo,
            batchNewEntries,
            cursor,
            !hasMore,
            currentMediaCount
          );
        } catch (err) {
          console.error("Failed to save progress to database:", err);
        }
      }
    }

    const startTime = accountStartTimesRef.current.get(accountId);
    const elapsedSecs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

    clearAccountRuntimeState(accountId);
    activeAccountRequestIdsRef.current.delete(accountId);

    const finalMediaCount = currentMediaCount;
    accountMediaCountRef.current.set(accountId, finalMediaCount);

    const wasTimeout = accountStopFlagsRef.current.get(accountId);

    if (wasTimeout) {
      logger.warning(
        `@${account.username}: timeout - ${finalMediaCount} items (${elapsedSecs}s)`
      );
      queueMultipleAccountUpdate(accountId, {
        status: finalMediaCount === 0 ? "failed" : "incomplete",
      });
    } else if (stopAllRef.current) {
      logger.info(
        `@${account.username}: stopped - ${finalMediaCount} items (${elapsedSecs}s)`
      );
      queueMultipleAccountUpdate(accountId, {
        status: finalMediaCount === 0 ? "failed" : "incomplete",
      });
    } else if (hasMore) {
      logger.warning(
        `@${account.username}: incomplete - ${finalMediaCount} items (${elapsedSecs}s)`
      );
      queueMultipleAccountUpdate(accountId, {
        status: finalMediaCount === 0 ? "failed" : "incomplete",
      });
    } else {
      logger.success(
        `@${account.username}: completed - ${finalMediaCount} items (${elapsedSecs}s)`
      );
      clearFetchState(accountScope);
      clearCursor(accountScope);
      queueMultipleAccountUpdate(accountId, {
        status: "completed",
        cursor: undefined,
      });
    }
    flushMultipleAccountUpdates();
  } catch (error) {
    const startTime = accountStartTimesRef.current.get(accountId);
    const elapsedSecs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isCanceled =
      stopAllRef.current ||
      accountStopFlagsRef.current.get(accountId) === true ||
      errorMsg.toLowerCase().includes("extractor canceled");

    clearAccountRuntimeState(accountId);
    activeAccountRequestIdsRef.current.delete(accountId);

    if (isCanceled && accountInfo && currentMediaCount > 0) {
      saveFetchState({
        ...accountScope,
        cursor: cursor || "",
        accountInfo,
        totalFetched: currentMediaCount,
        completed: false,
      });

      try {
        await saveAccountSnapshotChunk(
          accountScope,
          accountInfo,
          [],
          cursor,
          false,
          currentMediaCount
        );
      } catch (dbErr) {
        console.error("Failed to save canceled state to database:", dbErr);
      }
    }

    const mediaCount = accountMediaCountRef.current.get(accountId) || 0;
    const isAuthError =
      errorMsg.toLowerCase().includes("401") ||
      errorMsg.toLowerCase().includes("unauthorized") ||
      errorMsg.toLowerCase().includes("auth token may be invalid") ||
      errorMsg.toLowerCase().includes("auth token may be expired") ||
      errorMsg.toLowerCase().includes("invalid or expired");

    const status =
      isAuthError || mediaCount === 0 ? ("failed" as const) : ("incomplete" as const);

    accountMediaCountRef.current.delete(accountId);

    queueMultipleAccountUpdate(accountId, {
      status,
      error: isCanceled ? undefined : errorMsg,
      mediaCount,
    });
    flushMultipleAccountUpdates();

    if (isCanceled) {
      logger.info(`@${account.username}: stopped - ${mediaCount} items (${elapsedSecs}s)`);
    } else {
      logger.error(`@${account.username}: failed - ${errorMsg} (${elapsedSecs}s)`);
    }
  }
}
