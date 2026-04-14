import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useActivityPanelState } from "@/hooks/workspace/useActivityPanelState";
import type { DownloadIntegrityTaskStatus } from "@/types/settings";
import type { GlobalDownloadTaskState } from "@/types/download";
import type { MultiFetchSession } from "@/types/fetch";

function createDownloadTaskState(
  overrides: Partial<GlobalDownloadTaskState> = {}
): GlobalDownloadTaskState {
  return {
    status: null,
    progress: null,
    ...overrides,
  };
}

function createIntegrityStatus(
  overrides: Partial<DownloadIntegrityTaskStatus> = {}
): DownloadIntegrityTaskStatus {
  return {
    status: "completed",
    in_progress: false,
    cancelled: false,
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
    ...overrides,
  };
}

function createMultiFetchSession(
  overrides: Partial<MultiFetchSession> = {}
): MultiFetchSession {
  return {
    id: "session-1",
    source: "manual-fetch",
    title: "Fetching 3 Accounts",
    createdAt: Date.now(),
    status: "cancelling",
    accounts: [
      {
        id: "1",
        username: "alice",
        status: "completed",
        mediaCount: 10,
        previousMediaCount: 0,
        elapsedTime: 5,
        remainingTime: 10,
      },
      {
        id: "2",
        username: "bob",
        status: "fetching",
        mediaCount: 4,
        previousMediaCount: 0,
        elapsedTime: 5,
        remainingTime: 10,
      },
      {
        id: "3",
        username: "carol",
        status: "failed",
        mediaCount: 0,
        previousMediaCount: 0,
        elapsedTime: 5,
        remainingTime: 10,
      },
    ],
    ...overrides,
  };
}

describe("useActivityPanelState", () => {
  it("summarizes a running single fetch with cancel support", () => {
    const { result } = renderHook(() =>
      useActivityPanelState({
        fetchType: "single",
        username: "alice",
        elapsedTime: 12,
        remainingTime: 48,
        singleFetchTaskStatus: "running",
        activeSession: null,
        result: null,
        resumeInfo: null,
        globalDownloadTaskState: createDownloadTaskState(),
        globalDownloadMeta: null,
        globalDownloadHistory: [],
        integrityTaskStatus: null,
        integrityReport: null,
      })
    );

    expect(result.current.fetch.status).toBe("running");
    expect(result.current.fetch.canCancel).toBe(true);
    expect(result.current.fetch.description).toBe("Fetch is running");
  });

  it("summarizes a cancelling multi-account fetch and preserves queue failure counts", () => {
    const { result } = renderHook(() =>
      useActivityPanelState({
        fetchType: "multiple",
        username: "",
        elapsedTime: 30,
        remainingTime: null,
        singleFetchTaskStatus: null,
        activeSession: createMultiFetchSession(),
        result: null,
        resumeInfo: null,
        globalDownloadTaskState: createDownloadTaskState(),
        globalDownloadMeta: null,
        globalDownloadHistory: [],
        integrityTaskStatus: null,
        integrityReport: null,
      })
    );

    expect(result.current.fetch.status).toBe("cancelling");
    expect(result.current.fetch.progress?.current).toBe(2);
    expect(result.current.failures.failed).toBe(1);
    expect(result.current.failures.hasFailures).toBe(true);
  });

  it("summarizes download and integrity tasks with unified lifecycle labels", () => {
    const { result } = renderHook(() =>
      useActivityPanelState({
        fetchType: "single",
        username: "",
        elapsedTime: 0,
        remainingTime: null,
        singleFetchTaskStatus: null,
        activeSession: null,
        result: null,
        resumeInfo: null,
        globalDownloadTaskState: createDownloadTaskState({
          status: "failed",
          progress: {
            in_progress: false,
            current: 2,
            total: 5,
            percent: 40,
          },
        }),
        globalDownloadMeta: {
          source: "database-bulk",
          title: "Bulk download",
        },
        globalDownloadHistory: [],
        integrityTaskStatus: createIntegrityStatus({
          status: "running",
          in_progress: true,
          checked_files: 5,
          scanned_files: 10,
          phase: "verifying",
        }),
        integrityReport: null,
      })
    );

    expect(result.current.download.status).toBe("failed");
    expect(result.current.download.description).toContain("finished with errors");
    expect(result.current.integrity.status).toBe("running");
    expect(result.current.integrity.canCancel).toBe(true);
    expect(result.current.integrity.progress?.percent).toBe(50);
  });
});
