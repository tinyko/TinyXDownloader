import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalDownloadMonitor } from "@/hooks/download/useGlobalDownloadMonitor";
import type { GlobalDownloadState } from "@/types/download";

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
          GetDownloadStatus: ReturnType<typeof vi.fn>;
          StopDownload: ReturnType<typeof vi.fn>;
        };
      };
    };
    runtime: {
      EventsOnMultiple: ReturnType<typeof vi.fn>;
    };
  }
}

function createDownloadState(
  overrides: Partial<GlobalDownloadState> = {}
): GlobalDownloadState {
  return {
    in_progress: false,
    current: 0,
    total: 0,
    percent: 0,
    ...overrides,
  };
}

function installStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

describe("useGlobalDownloadMonitor", () => {
  let emitDownloadState: ((state: GlobalDownloadState) => void) | null = null;

  beforeEach(() => {
    installStorageMock();
    window.localStorage.clear();
    emitDownloadState = null;
    window.go = {
      main: {
        App: {
          GetDownloadStatus: vi.fn(async () => createDownloadState()),
          StopDownload: vi.fn(async () => true),
        },
      },
    };
    window.runtime = {
      EventsOnMultiple: vi.fn(
        (_eventName: string, handler: (state: GlobalDownloadState) => void) => {
          emitDownloadState = handler;
          return vi.fn();
        }
      ),
    };
  });

  it("tracks a running download and records a completed history entry", async () => {
    const { result } = renderHook(() => useGlobalDownloadMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadStatus).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleDownloadSessionStart({
        source: "media-list",
        title: "Downloading @alice",
        subtitle: "4 item(s)",
      });
      emitDownloadState?.(
        createDownloadState({
          in_progress: true,
          current: 1,
          total: 4,
          percent: 25,
        })
      );
    });

    expect(result.current.globalDownloadTaskState.status).toBe("running");

    act(() => {
      result.current.handleDownloadSessionFinish("completed");
      emitDownloadState?.(
        createDownloadState({
          in_progress: false,
          current: 4,
          total: 4,
          percent: 100,
        })
      );
    });

    await waitFor(() =>
      expect(result.current.globalDownloadHistory[0]?.status).toBe("completed")
    );
  });

  it("marks a download as cancelled when stop is requested", async () => {
    const { result } = renderHook(() => useGlobalDownloadMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadStatus).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleDownloadSessionStart({
        source: "database-bulk",
        title: "Bulk download",
      });
      emitDownloadState?.(
        createDownloadState({
          in_progress: true,
          current: 2,
          total: 10,
          percent: 20,
        })
      );
    });

    await act(async () => {
      await result.current.handleGlobalStopDownload();
    });

    expect(result.current.globalDownloadTaskState.status).toBe("cancelling");
    expect(window.go.main.App.StopDownload).toHaveBeenCalledTimes(1);

    act(() => {
      emitDownloadState?.(
        createDownloadState({
          in_progress: false,
          current: 2,
          total: 10,
          percent: 20,
        })
      );
    });

    await waitFor(() =>
      expect(result.current.globalDownloadHistory[0]?.status).toBe("cancelled")
    );
  });

  it("records a failed history entry when the session is finished as failed", async () => {
    const { result } = renderHook(() => useGlobalDownloadMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadStatus).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleDownloadSessionStart({
        source: "database-single",
        title: "Downloading @bob",
      });
      emitDownloadState?.(
        createDownloadState({
          in_progress: true,
          current: 1,
          total: 3,
          percent: 33,
        })
      );
      result.current.handleDownloadSessionFail({
        downloaded: 1,
        skipped: 0,
        failed: 2,
        message: "1 downloaded, 2 failed",
      });
      emitDownloadState?.(
        createDownloadState({
          in_progress: false,
          current: 1,
          total: 3,
          percent: 33,
        })
      );
    });

    await waitFor(() =>
      expect(result.current.globalDownloadHistory[0]?.status).toBe("failed")
    );
    expect(result.current.globalDownloadHistory[0]?.summary?.failed).toBe(2);
    expect(result.current.globalDownloadTaskState.summary?.message).toBe("1 downloaded, 2 failed");
  });

  it("finalizes failed history immediately when the backend idle event is missed", async () => {
    const { result } = renderHook(() => useGlobalDownloadMonitor());

    await waitFor(() =>
      expect(window.go.main.App.GetDownloadStatus).toHaveBeenCalledTimes(1)
    );

    act(() => {
      result.current.handleDownloadSessionStart({
        source: "database-bulk",
        title: "Bulk downloading 2 accounts",
        subtitle: "5 saved item(s)",
      });
      emitDownloadState?.(
        createDownloadState({
          in_progress: true,
          current: 5,
          total: 5,
          percent: 100,
        })
      );
      result.current.handleDownloadSessionFinish("failed", {
        downloaded: 4,
        skipped: 0,
        failed: 1,
        message: "4 downloaded, 1 failed",
      });
    });

    await waitFor(() =>
      expect(result.current.globalDownloadHistory[0]?.status).toBe("failed")
    );
    expect(result.current.globalDownloadHistory).toHaveLength(1);
    expect(result.current.globalDownloadHistory[0]?.summary?.failed).toBe(1);
    expect(result.current.globalDownloadTaskState.status).toBe("failed");

    act(() => {
      emitDownloadState?.(createDownloadState());
    });

    expect(result.current.globalDownloadHistory).toHaveLength(1);
  });

  it("clears persisted download history on demand", async () => {
    window.localStorage.setItem(
      "twitter_media_download_history",
      JSON.stringify([
        {
          id: "download-1",
          title: "Existing task",
          status: "completed",
          current: 1,
          total: 1,
          finishedAt: Date.now(),
        },
      ])
    );

    const { result } = renderHook(() => useGlobalDownloadMonitor());

    await waitFor(() =>
      expect(result.current.globalDownloadHistory).toHaveLength(1)
    );

    act(() => {
      result.current.clearDownloadHistory();
    });

    expect(result.current.globalDownloadHistory).toHaveLength(0);
    expect(window.localStorage.getItem("twitter_media_download_history")).toBe("[]");
  });
});
