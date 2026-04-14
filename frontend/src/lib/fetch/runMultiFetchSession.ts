import type { MutableRefObject } from "react";

import { logger } from "@/lib/logger";
import {
  buildFetchScope,
  resolveFetchTimelineType,
} from "@/lib/fetch/session";
import {
} from "@/lib/fetch/snapshot-client";
import { runTimelineFetchLoop } from "@/lib/fetch/runTimelineFetchLoop";
import { loadIncrementalBoundaryState } from "@/lib/fetch/bootstrapTimelineFetchSession";
import type { FetchMode, MultipleAccount, PrivateType } from "@/types/fetch";
import type { TwitterResponse } from "@/types/api";
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
  const boundaryState = await loadIncrementalBoundaryState(accountScope);
  const seenSessionEntryKeys = new Set<string>();
  let accountInfo: TwitterResponse["account_info"] | null = boundaryState.accountInfo;
  const incrementalBaseCount = boundaryState.savedCompletedCount;
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

  const loopResult = await runTimelineFetchLoop({
    scope: accountScope,
    initialAccountInfo: accountInfo,
    incrementalBaseCount,
    knownTweetIds: boundaryState.knownTweetIds,
    seenSessionEntryKeys,
    readStopReason: () => {
      if (stopAllRef.current || accountStopFlagsRef.current.get(accountId)) {
        return "stopped";
      }
      const startedAt = accountStartTimesRef.current.get(accountId);
      if (startedAt) {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        if (elapsed >= timeoutSeconds) {
          return "timeout";
        }
      }
      return "continue";
    },
    buildRequest: (page, nextCursor, requestId) =>
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
        cursor: nextCursor,
      }),
    onAttemptStart: (requestId) => {
      activeAccountRequestIdsRef.current.set(accountId, requestId);
    },
    onAttemptFinish: (requestId) => {
      if (activeAccountRequestIdsRef.current.get(accountId) === requestId) {
        activeAccountRequestIdsRef.current.delete(accountId);
      }
    },
    onBatch: ({ accountInfo: nextAccountInfo, currentTotalFetched, cursor, overlapReached }) => {
      if (nextAccountInfo && !accountInfo) {
        accountInfo = nextAccountInfo;
      }

      currentMediaCount = currentTotalFetched;
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

      if (overlapReached) {
        logger.info(
          `@${account.username}: reached saved overlap boundary, stopping refresh early.`
        );
      }
    },
  });

  accountInfo = loopResult.accountInfo;
  currentMediaCount = loopResult.currentTotalFetched;

  const startTime = accountStartTimesRef.current.get(accountId);
  const elapsedSecs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

  clearAccountRuntimeState(accountId);
  activeAccountRequestIdsRef.current.delete(accountId);
  accountMediaCountRef.current.set(accountId, currentMediaCount);

  if (loopResult.reason === "timeout") {
    logger.warning(`@${account.username}: timeout - ${currentMediaCount} items (${elapsedSecs}s)`);
    queueMultipleAccountUpdate(accountId, {
      status: currentMediaCount === 0 ? "failed" : "incomplete",
    });
    flushMultipleAccountUpdates();
    return;
  }

  if (loopResult.reason === "stopped") {
    logger.info(`@${account.username}: stopped - ${currentMediaCount} items (${elapsedSecs}s)`);
    queueMultipleAccountUpdate(accountId, {
      status: currentMediaCount === 0 ? "failed" : "incomplete",
      mediaCount: currentMediaCount,
    });
    flushMultipleAccountUpdates();
    return;
  }

  if (loopResult.reason === "completed") {
    logger.success(
      `@${account.username}: completed - ${currentMediaCount} items (${elapsedSecs}s)`
    );
    queueMultipleAccountUpdate(accountId, {
      status: "completed",
      cursor: undefined,
    });
    flushMultipleAccountUpdates();
    return;
  }

  const errorMsg =
    loopResult.error instanceof Error
      ? loopResult.error.message
      : String(loopResult.error);
  const isAuthError =
    errorMsg.toLowerCase().includes("401") ||
    errorMsg.toLowerCase().includes("unauthorized") ||
    errorMsg.toLowerCase().includes("auth token may be invalid") ||
    errorMsg.toLowerCase().includes("auth token may be expired") ||
    errorMsg.toLowerCase().includes("invalid or expired");

  queueMultipleAccountUpdate(accountId, {
    status: isAuthError || currentMediaCount === 0 ? "failed" : "incomplete",
    error: errorMsg,
    mediaCount: currentMediaCount,
  });
  flushMultipleAccountUpdates();
  logger.error(`@${account.username}: failed - ${errorMsg} (${elapsedSecs}s)`);
}
