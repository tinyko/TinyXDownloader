import type { MutableRefObject } from "react";

import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import {
  clearCursor,
  clearFetchState,
  getFetchState,
  getResumableInfo,
  saveCursor,
  saveFetchState,
  type FetchScope,
  type FetchState,
  type ResumableFetchInfo,
} from "@/lib/fetch/state";
import {
  appendUniqueEntries,
  buildTwitterResponse,
  collectIncrementalEntries,
  createResultTimeline,
  createTimelineAccumulator,
  formatNumberWithComma,
  mergeFetchedWithSavedTimeline,
  scopesMatch,
} from "@/lib/fetch/session";
import {
  loadSnapshotFromDB,
  loadSnapshotSummaryFromDB,
  loadSnapshotTweetIdsFromDB,
  normalizeStructuredResponse,
  saveAccountSnapshotChunk,
} from "@/lib/fetch/snapshot-client";
import type { FetchMode, PrivateType } from "@/types/fetch";
import type { TwitterResponse } from "@/types/api";
import { ExtractDateRangeStructured, ExtractTimelineStructured } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

const BATCH_SIZE = 200;

interface RunSingleFetchSessionOptions {
  useDateRange: boolean;
  startDate?: string;
  endDate?: string;
  mediaType: string;
  retweets: boolean;
  mode: FetchMode;
  privateType?: PrivateType;
  authToken: string;
  singleUsername: string;
  cleanUsername: string;
  timelineType: string;
  fetchScope: FetchScope;
  fetchTarget: string;
  isResume?: boolean;
  currentResult: TwitterResponse | null;
  activeResultScopeRef: MutableRefObject<FetchScope | null>;
  stopFetchRef: MutableRefObject<boolean>;
  fetchStartTimeRef: MutableRefObject<number | null>;
  singleFetchRequestIdRef: MutableRefObject<string | null>;
  scheduleResultUpdate: (
    nextResult: TwitterResponse | null,
    immediate?: boolean,
    nextScope?: FetchScope | null
  ) => void;
  flushResultUpdate: (
    immediateResult?: TwitterResponse | null,
    immediateScope?: FetchScope | null
  ) => void;
  setResumeInfo: (info: ResumableFetchInfo | null) => void;
  setNewMediaCount: (count: number | null) => void;
  onAddToHistory?: (data: TwitterResponse, inputUsername: string) => void;
}

export async function runSingleFetchSession({
  useDateRange,
  startDate,
  endDate,
  mediaType,
  retweets,
  mode,
  privateType,
  authToken,
  singleUsername,
  cleanUsername,
  timelineType,
  fetchScope,
  fetchTarget,
  isResume,
  currentResult,
  activeResultScopeRef,
  stopFetchRef,
  fetchStartTimeRef,
  singleFetchRequestIdRef,
  scheduleResultUpdate,
  flushResultUpdate,
  setResumeInfo,
  setNewMediaCount,
  onAddToHistory,
}: RunSingleFetchSessionOptions) {
  const isBookmarks = mode === "private" && privateType === "bookmarks";
  const isLikes = mode === "private" && privateType === "likes";

  let existingState: FetchState | null = null;
  let cursor: string | undefined;
  let accountInfo: TwitterResponse["account_info"] | null = null;
  let savedCompletedSnapshot: TwitterResponse | null = null;
  let savedCompletedCount = 0;
  let knownTweetIds = new Set<string>();
  const seenSessionEntryKeys = new Set<string>();
  const sessionAccumulator = createTimelineAccumulator();
  const freshAccumulator = createTimelineAccumulator();
  let overlapReached = false;
  let totalNewItemsFound = 0;
  let isIncrementalRefresh = false;

  if (isResume) {
    existingState = getFetchState(fetchScope);
    const savedSnapshot = await loadSnapshotFromDB(fetchScope);
    if (savedSnapshot && savedSnapshot.cursor && !savedSnapshot.completed) {
      cursor = savedSnapshot.cursor;
      accountInfo = savedSnapshot.account_info;
      appendUniqueEntries(sessionAccumulator, savedSnapshot.timeline || []);
      logger.info(
        `Resuming ${fetchTarget} from ${sessionAccumulator.timeline.length} items...`
      );
      scheduleResultUpdate(savedSnapshot, true, fetchScope);
    } else if (existingState && existingState.cursor && !existingState.completed) {
      cursor = existingState.cursor;
      accountInfo = existingState.accountInfo;
      logger.info(
        `Resuming ${fetchTarget} from ${existingState.totalFetched} items...`
      );
    } else {
      toast.error("No resumable fetch found");
      return;
    }
  } else {
    clearFetchState(fetchScope);
    clearCursor(fetchScope);
    const savedSummary = await loadSnapshotSummaryFromDB(fetchScope);
    const savedTweetIds =
      savedSummary?.completed && savedSummary.total_urls > 0
        ? await loadSnapshotTweetIdsFromDB(fetchScope)
        : [];
    if (savedSummary?.completed && savedSummary.total_urls > 0 && savedTweetIds.length > 0) {
      savedCompletedCount = savedSummary.total_urls;
      knownTweetIds = new Set(savedTweetIds);
      accountInfo = savedSummary.account_info;
      isIncrementalRefresh = true;
      const visibleMatchingResult =
        currentResult &&
        currentResult.completed &&
        scopesMatch(activeResultScopeRef.current, fetchScope)
          ? currentResult
          : null;
      if (visibleMatchingResult) {
        savedCompletedSnapshot = visibleMatchingResult;
        savedCompletedCount = visibleMatchingResult.timeline.length;
        scheduleResultUpdate(visibleMatchingResult, true, fetchScope);
      } else {
        scheduleResultUpdate(null, true, null);
      }
      logger.info(
        `Refreshing ${fetchTarget} with ${formatNumberWithComma(
          savedCompletedCount
        )} saved items as the overlap boundary...`
      );
    } else {
      scheduleResultUpdate(null, true, null);
      logger.info(`Fetching ${fetchTarget}...`);
    }
  }

  try {
    let finalData: TwitterResponse | null = null;

    if (useDateRange && startDate && endDate && mode === "public") {
      logger.info(`Using date range: ${startDate} to ${endDate}`);

      if (fetchStartTimeRef.current !== null) {
        const timeoutSeconds = getSettings().fetchTimeout || 60;
        const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
        if (elapsed >= timeoutSeconds) {
          logger.warning(`Timeout reached (${timeoutSeconds}s). Stopping fetch...`);
          stopFetchRef.current = true;
          toast.warning("Fetch timeout reached. Stopping...");
          return;
        }
      }

      const requestId = crypto.randomUUID();
      singleFetchRequestIdRef.current = requestId;

      finalData = normalizeStructuredResponse(
        await ExtractDateRangeStructured(
          new main.DateRangeRequest({
            username: singleUsername,
            auth_token: authToken.trim(),
            start_date: startDate,
            end_date: endDate,
            media_filter: mediaType,
            retweets,
            request_id: requestId,
          })
        ).finally(() => {
          if (singleFetchRequestIdRef.current === requestId) {
            singleFetchRequestIdRef.current = null;
          }
        })
      );

      if (finalData && finalData.account_info) {
        try {
          await saveAccountSnapshotChunk(
            fetchScope,
            finalData.account_info,
            finalData.timeline,
            finalData.cursor,
            finalData.completed ?? true,
            finalData.total_urls
          );
        } catch (err) {
          console.error("Failed to save date range data to database:", err);
        }
      }
    } else {
      const settings = getSettings();
      const isSingleMode = settings.fetchMode === "single";
      const batchSize = isSingleMode ? 0 : BATCH_SIZE;

      let hasMore = true;
      let page = 0;

      while (hasMore && !stopFetchRef.current) {
        if (fetchStartTimeRef.current !== null) {
          const timeoutSeconds = settings.fetchTimeout || 60;
          const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
          if (elapsed >= timeoutSeconds) {
            logger.warning(`Timeout reached (${timeoutSeconds}s). Stopping fetch...`);
            stopFetchRef.current = true;
            toast.warning("Fetch timeout reached. Stopping...");

            const currentTotalFetched = isIncrementalRefresh
              ? savedCompletedCount + freshAccumulator.timeline.length
              : sessionAccumulator.timeline.length;

            if (accountInfo && currentTotalFetched > 0) {
              saveFetchState({
                ...fetchScope,
                cursor: cursor || "",
                accountInfo,
                totalFetched: currentTotalFetched,
                completed: false,
              });

              try {
                await saveAccountSnapshotChunk(
                  fetchScope,
                  accountInfo,
                  [],
                  cursor,
                  false,
                  currentTotalFetched
                );
                logger.info(`Saved ${currentTotalFetched} items before timeout`);
              } catch (err) {
                console.error("Failed to save timeout state to database:", err);
              }
            }
            break;
          }
        }

        const batchNum = page + 1;
        logger.info(
          isSingleMode
            ? "Fetching all media..."
            : `Fetching batch ${batchNum}${cursor ? " (resuming)" : ""}...`
        );

        const requestId = crypto.randomUUID();
        singleFetchRequestIdRef.current = requestId;

        const structuredData = await ExtractTimelineStructured(
          new main.TimelineRequest({
            username: isBookmarks ? "" : singleUsername,
            auth_token: authToken.trim(),
            timeline_type: timelineType,
            batch_size: batchSize,
            page,
            media_type: mediaType,
            retweets,
            request_id: requestId,
            cursor,
          })
        ).finally(() => {
          if (singleFetchRequestIdRef.current === requestId) {
            singleFetchRequestIdRef.current = null;
          }
        });
        const data = normalizeStructuredResponse(structuredData);
        if (!data) {
          throw new Error("Empty timeline response");
        }

        if (!accountInfo && data.account_info) {
          accountInfo = data.account_info;
          if (isBookmarks) {
            accountInfo.name = "bookmarks";
            accountInfo.nick = "My Bookmarks";
          } else if (isLikes) {
            accountInfo.name = "likes";
            accountInfo.nick = "My Likes";
          }
        }

        let batchNewEntries = data.timeline;

        if (isIncrementalRefresh) {
          const { freshEntries, overlapReached: batchOverlapReached } =
            collectIncrementalEntries(data.timeline, knownTweetIds, seenSessionEntryKeys);

          batchNewEntries = appendUniqueEntries(freshAccumulator, freshEntries);
          totalNewItemsFound = freshAccumulator.timeline.length;
          overlapReached = overlapReached || batchOverlapReached;

          if (totalNewItemsFound > 0) {
            setNewMediaCount(totalNewItemsFound);
          }
        } else {
          batchNewEntries = appendUniqueEntries(sessionAccumulator, data.timeline);
          const newCount = batchNewEntries.length;

          if (newCount > 0) {
            setNewMediaCount(newCount);
          }
        }

        cursor = data.cursor;
        hasMore = !!data.cursor && !data.completed;
        if (overlapReached) {
          hasMore = false;
          cursor = undefined;
          logger.info(
            `Reached previously saved items for ${fetchTarget}; stopping incremental refresh early.`
          );
        }
        page += 1;

        if (cursor && hasMore) {
          saveCursor(fetchScope, cursor);
        }

        if (accountInfo && (!isIncrementalRefresh || savedCompletedSnapshot)) {
          const currentTimeline =
            isIncrementalRefresh && savedCompletedSnapshot
              ? mergeFetchedWithSavedTimeline(
                  freshAccumulator.timeline,
                  savedCompletedSnapshot.timeline
                )
              : createResultTimeline(sessionAccumulator);
          const currentResponse = buildTwitterResponse(
            accountInfo,
            currentTimeline,
            batchNewEntries.length,
            page,
            batchSize,
            hasMore,
            cursor,
            !hasMore
          );
          scheduleResultUpdate(currentResponse, !hasMore || page === 1, fetchScope);
        }

        const currentTotalFetched = isIncrementalRefresh
          ? savedCompletedCount + freshAccumulator.timeline.length
          : sessionAccumulator.timeline.length;
        logger.info(`Fetched ${currentTotalFetched} items total`);

        saveFetchState({
          ...fetchScope,
          cursor: cursor || "",
          accountInfo,
          totalFetched: currentTotalFetched,
          completed: !hasMore,
        });

        if (accountInfo) {
          try {
            await saveAccountSnapshotChunk(
              fetchScope,
              accountInfo,
              batchNewEntries,
              cursor,
              !hasMore,
              currentTotalFetched
            );
          } catch (err) {
            console.error("Failed to save progress to database:", err);
          }
        }
      }

      if (stopFetchRef.current) {
        const elapsedSecs = fetchStartTimeRef.current
          ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000)
          : 0;
        const currentTotalFetched = isIncrementalRefresh
          ? savedCompletedCount + freshAccumulator.timeline.length
          : sessionAccumulator.timeline.length;
        logger.info(
          `Stopped at ${currentTotalFetched} items - can resume later (${elapsedSecs}s)`
        );
        toast.info(`Stopped at ${formatNumberWithComma(currentTotalFetched)} items`);
        const resumable = getResumableInfo(cleanUsername, fetchScope);
        setResumeInfo(resumable.canResume ? resumable : null);
      } else {
        clearFetchState(fetchScope);
        clearCursor(fetchScope);
        setResumeInfo(null);
      }

      if (isIncrementalRefresh && !savedCompletedSnapshot) {
        finalData = await loadSnapshotFromDB(fetchScope);
      } else {
        finalData = accountInfo
          ? buildTwitterResponse(
              accountInfo,
              isIncrementalRefresh && savedCompletedSnapshot
                ? mergeFetchedWithSavedTimeline(
                    freshAccumulator.timeline,
                    savedCompletedSnapshot.timeline
                  )
                : createResultTimeline(sessionAccumulator),
              isIncrementalRefresh
                ? totalNewItemsFound
                : sessionAccumulator.timeline.length,
              page,
              batchSize,
              false,
              cursor,
              !stopFetchRef.current
            )
          : null;
      }
    }

    if (finalData) {
      flushResultUpdate(finalData, fetchScope);

      if (mode === "public") {
        onAddToHistory?.(finalData, singleUsername);
      }

      try {
        await saveAccountSnapshotChunk(
          fetchScope,
          finalData.account_info,
          useDateRange ? finalData.timeline : [],
          finalData.cursor,
          finalData.completed ?? !stopFetchRef.current,
          finalData.total_urls
        );
      } catch (err) {
        console.error("Failed to save final status to database:", err);
      }

      if (!stopFetchRef.current) {
        const elapsedSecs = fetchStartTimeRef.current
          ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000)
          : 0;
        if (isIncrementalRefresh) {
          if (totalNewItemsFound > 0) {
            logger.success(
              `Found ${totalNewItemsFound} new media items (${finalData.total_urls} total, ${elapsedSecs}s)`
            );
            toast.success(
              `${formatNumberWithComma(totalNewItemsFound)} new media items found`
            );
            setNewMediaCount(totalNewItemsFound);
          } else {
            logger.success(`No new media items (${elapsedSecs}s)`);
            toast.success("No new media items");
            setNewMediaCount(null);
          }
        } else {
          logger.success(`Found ${finalData.total_urls} media items (${elapsedSecs}s)`);
          toast.success(`${finalData.total_urls} media items found`);
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const elapsedSecs = fetchStartTimeRef.current
      ? Math.floor((Date.now() - fetchStartTimeRef.current) / 1000)
      : 0;
    const isCanceled =
      stopFetchRef.current || errorMsg.toLowerCase().includes("extractor canceled");

    if (isCanceled) {
      logger.info(`Fetch stopped: ${errorMsg} (${elapsedSecs}s)`);
    } else {
      logger.error(`Failed to fetch: ${errorMsg} (${elapsedSecs}s)`);
      toast.error("Failed to fetch media");
    }

    let partialResponse: TwitterResponse | null = null;
    const currentTotalFetched = isIncrementalRefresh
      ? savedCompletedCount + freshAccumulator.timeline.length
      : sessionAccumulator.timeline.length;
    if (
      accountInfo &&
      currentTotalFetched > 0 &&
      (!isIncrementalRefresh || savedCompletedSnapshot)
    ) {
      partialResponse = buildTwitterResponse(
        accountInfo,
        isIncrementalRefresh && savedCompletedSnapshot
          ? mergeFetchedWithSavedTimeline(
              freshAccumulator.timeline,
              savedCompletedSnapshot.timeline
            )
          : createResultTimeline(sessionAccumulator),
        0,
        0,
        BATCH_SIZE,
        true,
        cursor,
        false
      );
    } else {
      partialResponse = await loadSnapshotFromDB(fetchScope);
    }

    if (partialResponse) {
      flushResultUpdate(partialResponse, fetchScope);
      saveFetchState({
        ...fetchScope,
        cursor: partialResponse.cursor || cursor || "",
        accountInfo: partialResponse.account_info,
        totalFetched: partialResponse.timeline.length,
        completed: false,
      });

      const resumable = getResumableInfo(cleanUsername, fetchScope);
      setResumeInfo(resumable.canResume ? resumable : null);
      toast.info(
        `Saved ${formatNumberWithComma(partialResponse.timeline.length)} items - can resume`
      );

      try {
        await saveAccountSnapshotChunk(
          fetchScope,
          partialResponse.account_info,
          [],
          partialResponse.cursor || cursor,
          false,
          partialResponse.timeline.length
        );
      } catch (dbErr) {
        console.error("Failed to save partial data to database:", dbErr);
      }
    }
  } finally {
    singleFetchRequestIdRef.current = null;
  }
}
