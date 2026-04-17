import { describe, expect, it } from "vitest";

import {
  formatDownloadResultSummary,
  getDownloadResultMessage,
  hasDownloadResultSummary,
} from "@/lib/download/summary";

describe("download result summary", () => {
  it("formats counts once and hides duplicate count-only messages", () => {
    const summary = {
      downloaded: 1,
      skipped: 26868,
      failed: 668,
      message: "1 downloaded, 26868 skipped, 668 failed",
    };

    expect(formatDownloadResultSummary(summary)).toBe(
      "1 downloaded • 26,868 skipped • 668 failed"
    );
    expect(getDownloadResultMessage(summary)).toBe("");
    expect(hasDownloadResultSummary(summary)).toBe(true);
  });

  it("hides backend generated count-only messages", () => {
    expect(
      getDownloadResultMessage({
        downloaded: 1,
        skipped: 26868,
        failed: 668,
        message: "Downloaded 1 files, 26868 skipped, 668 failed",
      })
    ).toBe("");
  });

  it("keeps real error messages", () => {
    expect(
      getDownloadResultMessage({
        downloaded: 1,
        skipped: 0,
        failed: 2,
        message: "x media request failed with status 403",
      })
    ).toBe("x media request failed with status 403");
  });

  it("keeps failure detail samples even when the message is redundant", () => {
    const summary = {
      downloaded: 1,
      skipped: 0,
      failed: 1,
      message: "1 downloaded, 0 skipped, 1 failed",
      failures: [
        {
          tweet_id: 123,
          index: 1,
          url: "https://example.invalid/media.jpg",
          error: "download request failed with status 403",
        },
      ],
    };

    expect(getDownloadResultMessage(summary)).toBe("");
    expect(hasDownloadResultSummary(summary)).toBe(true);
  });
});
