import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractTimelineStructuredWithRetry } from "@/lib/fetch/extractor-client";
import { runTimelineFetchLoop } from "@/lib/fetch/runTimelineFetchLoop";
import { saveAccountSnapshotChunk } from "@/lib/fetch/snapshot-client";
import type { TwitterResponse } from "@/types/api";

vi.mock("@/lib/fetch/extractor-client", () => ({
  extractTimelineStructuredWithRetry: vi.fn(),
}));

vi.mock("@/lib/fetch/snapshot-client", () => ({
  normalizeStructuredResponse: vi.fn((response: TwitterResponse | null) => response),
  saveAccountSnapshotChunk: vi.fn(),
}));

const accountInfo = {
  name: "Awake_Kamuy",
  nick: "Awake Kamuy",
  date: "",
  followers_count: 0,
  friends_count: 0,
  profile_image: "",
  statuses_count: 0,
};

const existingEntry = {
  url: "https://example.com/existing.jpg",
  date: "2026-04-16T00:00:00Z",
  tweet_id: "1",
  type: "photo",
  is_retweet: false,
  extension: "jpg",
  width: 1,
  height: 1,
};

function emptyCursorResponse(cursor: string): TwitterResponse {
  return {
    account_info: accountInfo,
    total_urls: 0,
    timeline: [],
    metadata: {
      new_entries: 0,
      page: 1,
      batch_size: 200,
      has_more: true,
      cursor,
      completed: false,
    },
    cursor,
    completed: false,
  };
}

describe("runTimelineFetchLoop", () => {
  beforeEach(() => {
    vi.mocked(extractTimelineStructuredWithRetry).mockReset();
    vi.mocked(saveAccountSnapshotChunk).mockReset();
  });

  it("completes public media/all after consecutive empty cursor pages", async () => {
    vi.mocked(extractTimelineStructuredWithRetry).mockImplementation(async () => {
      const call = vi.mocked(extractTimelineStructuredWithRetry).mock.calls.length;
      return emptyCursorResponse(`cursor-${call}`);
    });

    const result = await runTimelineFetchLoop({
      scope: {
        username: "Awake_Kamuy",
        mediaType: "all",
        timelineType: "media",
        retweets: false,
      },
      initialCursor: "cursor-start",
      initialAccountInfo: accountInfo,
      initialEntries: [existingEntry],
      readStopReason: () => "continue",
      buildRequest: (_page, cursor, requestId) =>
        ({
          username: "Awake_Kamuy",
          auth_token: "token",
          timeline_type: "media",
          batch_size: 200,
          page: 1,
          media_type: "all",
          retweets: false,
          request_id: requestId,
          cursor,
        }) as never,
    });

    expect(extractTimelineStructuredWithRetry).toHaveBeenCalledTimes(5);
    expect(result.reason).toBe("completed");
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeUndefined();
    expect(result.currentTotalFetched).toBe(1);
    expect(saveAccountSnapshotChunk).toHaveBeenLastCalledWith(
      expect.objectContaining({
        username: "Awake_Kamuy",
        mediaType: "all",
        timelineType: "media",
      }),
      accountInfo,
      [],
      undefined,
      true,
      1
    );
  });
});
