import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalIntegrityMonitor } from "@/hooks/integrity/useGlobalIntegrityMonitor";
import type {
  DownloadIntegrityReport,
  DownloadIntegrityTaskStatus,
} from "@/types/settings";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@/lib/toast-with-sound", () => ({
  toastWithSound: toastMocks,
}));

declare global {
  interface Window {
    go: {
      main: {
        App: {
          CancelDownloadIntegrityTask: ReturnType<typeof vi.fn>;
          GetDownloadIntegrityTaskStatus: ReturnType<typeof vi.fn>;
          OpenFolder: ReturnType<typeof vi.fn>;
          StartDownloadIntegrityTask: ReturnType<typeof vi.fn>;
        };
      };
    };
  }
}

function createIntegrityReport(
  overrides: Partial<DownloadIntegrityReport> = {}
): DownloadIntegrityReport {
  return {
    mode: "quick",
    download_path: "/downloads",
    scanned_files: 12,
    checked_files: 12,
    complete_files: 12,
    partial_files: 0,
    incomplete_files: 0,
    untracked_files: 0,
    unverifiable_files: 0,
    issues: [],
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

describe("useGlobalIntegrityMonitor", () => {
  beforeEach(() => {
    window.go = {
      main: {
        App: {
          CancelDownloadIntegrityTask: vi.fn(async () => true),
          GetDownloadIntegrityTaskStatus: vi.fn(async () => createIntegrityStatus()),
          OpenFolder: vi.fn(async () => {}),
          StartDownloadIntegrityTask: vi.fn(async () =>
            createIntegrityStatus({
              status: "running",
              in_progress: true,
              mode: "quick",
              phase: "running",
            })
          ),
        },
      },
    };
  });

  it("loads the initial integrity status on mount", async () => {
    const report = createIntegrityReport({ checked_files: 8 });
    window.go.main.App.GetDownloadIntegrityTaskStatus.mockResolvedValueOnce(
      createIntegrityStatus({ status: "completed", report })
    );

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() => expect(result.current.integrityReport).toEqual(report));
    expect(result.current.integrityStatus).toBe("completed");
  });

  it("starts a new integrity task and exposes the running status", async () => {
    window.go.main.App.StartDownloadIntegrityTask.mockResolvedValueOnce(
      createIntegrityStatus({
        status: "running",
        in_progress: true,
        mode: "deep",
        phase: "running",
      })
    );

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCheckIntegrity("/downloads", "", "deep");
    });

    expect(window.go.main.App.StartDownloadIntegrityTask).toHaveBeenCalledWith({
      download_path: "/downloads",
      proxy: "",
      mode: "deep",
    });
    expect(result.current.integrityStatus).toBe("running");
    expect(result.current.checkingIntegrityMode).toBe("deep");
  });

  it("polls to completion and shows a success toast when no issues are found", async () => {
    const report = createIntegrityReport({ checked_files: 18 });
    window.go.main.App.GetDownloadIntegrityTaskStatus
      .mockResolvedValueOnce(createIntegrityStatus())
      .mockResolvedValueOnce(
        createIntegrityStatus({
          status: "completed",
          report,
          checked_files: 18,
        })
      );

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCheckIntegrity("/downloads", "", "quick");
    });

    await act(async () => {
      await sleep(550);
    });

    await waitFor(() => expect(result.current.integrityReport).toEqual(report));
    expect(result.current.showIntegrityReport).toBe(true);
    expect(toastMocks.success).toHaveBeenCalledWith(
      expect.stringContaining("no incomplete files found")
    );
  });

  it("polls to completion and shows a warning toast when issues are found", async () => {
    const report = createIntegrityReport({
      partial_files: 1,
      incomplete_files: 2,
      checked_files: 7,
    });
    window.go.main.App.GetDownloadIntegrityTaskStatus
      .mockResolvedValueOnce(createIntegrityStatus())
      .mockResolvedValueOnce(
        createIntegrityStatus({
          status: "completed",
          report,
          checked_files: 7,
          partial_files: 1,
          incomplete_files: 2,
        })
      );

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCheckIntegrity("/downloads", "", "quick");
    });

    await act(async () => {
      await sleep(550);
    });

    await waitFor(() => expect(result.current.integrityReport).toEqual(report));
    expect(toastMocks.warning).toHaveBeenCalledWith(
      expect.stringContaining("3 incomplete item(s)")
    );
  });

  it("moves from cancelling to cancelled when the task is stopped", async () => {
    window.go.main.App.GetDownloadIntegrityTaskStatus
      .mockResolvedValueOnce(createIntegrityStatus())
      .mockResolvedValueOnce(
        createIntegrityStatus({
          status: "cancelled",
          cancelled: true,
          mode: "deep",
        })
      );

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCheckIntegrity("/downloads", "", "deep");
      await result.current.handleCancelIntegrityCheck();
    });

    expect(result.current.integrityStatus).toBe("cancelling");

    await act(async () => {
      await sleep(550);
    });

    await waitFor(() => expect(result.current.integrityStatus).toBe("cancelled"));
    expect(toastMocks.info).toHaveBeenCalledWith("Deep integrity check cancelled");
  });

  it("marks the task as failed when polling rejects", async () => {
    window.go.main.App.GetDownloadIntegrityTaskStatus
      .mockResolvedValueOnce(createIntegrityStatus())
      .mockRejectedValueOnce(new Error("poll failed"));

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCheckIntegrity("/downloads", "", "quick");
    });

    await act(async () => {
      await sleep(550);
    });

    await waitFor(() => expect(result.current.integrityStatus).toBe("failed"));
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Integrity check failed: poll failed"
    );
  });

  it("reports when there is no integrity task to cancel", async () => {
    window.go.main.App.CancelDownloadIntegrityTask.mockResolvedValueOnce(false);

    const { result } = renderHook(() => useGlobalIntegrityMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadIntegrityTaskStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      await result.current.handleCancelIntegrityCheck();
    });

    expect(toastMocks.info).toHaveBeenCalledWith(
      "No integrity check is currently running"
    );
  });
});
