import {
  loadSnapshotSummaryFromDB,
  loadSnapshotTweetIdsFromDB,
} from "@/lib/fetch/snapshot-client";
import type { FetchScope } from "@/lib/fetch/state";
import type { TwitterResponse } from "@/types/api";

export interface IncrementalBoundaryState {
  accountInfo: TwitterResponse["account_info"] | null;
  savedCompletedCount: number;
  knownTweetIds: Set<string>;
  isIncrementalRefresh: boolean;
}

export async function loadIncrementalBoundaryState(
  fetchScope: FetchScope
): Promise<IncrementalBoundaryState> {
  const savedSummary = await loadSnapshotSummaryFromDB(fetchScope);
  const savedTweetIds =
    savedSummary?.completed && savedSummary.total_urls > 0
      ? await loadSnapshotTweetIdsFromDB(fetchScope)
      : [];

  if (
    savedSummary?.completed &&
    savedSummary.total_urls > 0 &&
    savedTweetIds.length > 0
  ) {
    return {
      accountInfo: savedSummary.account_info,
      savedCompletedCount: savedSummary.total_urls,
      knownTweetIds: new Set(savedTweetIds),
      isIncrementalRefresh: true,
    };
  }

  return {
    accountInfo: savedSummary?.account_info || null,
    savedCompletedCount: 0,
    knownTweetIds: new Set<string>(),
    isIncrementalRefresh: false,
  };
}
