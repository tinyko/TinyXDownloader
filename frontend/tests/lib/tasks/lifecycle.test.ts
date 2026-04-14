import { describe, expect, it } from "vitest";

import {
  mapMultiFetchSessionToTaskStatus,
  normalizeIntegrityTaskStatus,
  resolveDownloadTerminalStatus,
} from "@/lib/tasks/lifecycle";

describe("task lifecycle helpers", () => {
  it("maps multi-fetch session statuses to shared task statuses", () => {
    expect(mapMultiFetchSessionToTaskStatus("ready")).toBeNull();
    expect(mapMultiFetchSessionToTaskStatus("running")).toBe("running");
    expect(mapMultiFetchSessionToTaskStatus("cancelling")).toBe("cancelling");
    expect(mapMultiFetchSessionToTaskStatus("cancelled")).toBe("cancelled");
  });

  it("normalizes integrity status from both new and legacy fields", () => {
    expect(
      normalizeIntegrityTaskStatus({
        status: "failed",
        in_progress: false,
        cancelled: false,
        mode: "quick",
        phase: "failed",
        scanned_files: 0,
        checked_files: 0,
        verified_files: 0,
        partial_files: 0,
        incomplete_files: 0,
        untracked_files: 0,
        unverifiable_files: 0,
        issues_count: 0,
        error: "boom",
        report: null,
      })
    ).toBe("failed");

    expect(
      normalizeIntegrityTaskStatus({
        status: "completed",
        in_progress: true,
        cancelled: true,
        mode: "quick",
        phase: "",
        scanned_files: 0,
        checked_files: 0,
        verified_files: 0,
        partial_files: 0,
        incomplete_files: 0,
        untracked_files: 0,
        unverifiable_files: 0,
        issues_count: 0,
        error: "",
        report: null,
      })
    ).toBe("completed");
  });

  it("gives cancellation precedence over other download outcomes", () => {
    expect(
      resolveDownloadTerminalStatus({
        requestedCancel: true,
        current: 1,
        total: 5,
        override: "failed",
      })
    ).toBe("cancelled");

    expect(
      resolveDownloadTerminalStatus({
        requestedCancel: false,
        current: 5,
        total: 5,
      })
    ).toBe("completed");

    expect(
      resolveDownloadTerminalStatus({
        requestedCancel: false,
        current: 2,
        total: 5,
      })
    ).toBe("failed");
  });
});
