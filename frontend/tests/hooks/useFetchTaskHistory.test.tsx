import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFetchTaskHistory } from "@/hooks/history/useFetchTaskHistory";

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

describe("useFetchTaskHistory", () => {
  beforeEach(() => {
    installStorageMock();
    window.localStorage.clear();
  });

  it("records and clears single fetch task history", () => {
    const { result } = renderHook(() => useFetchTaskHistory());

    act(() => {
      result.current.addFetchTaskHistory({
        username: "alice",
        mode: "public",
        timelineType: "media",
        mediaType: "all",
        retweets: false,
        useDateRange: false,
        status: "completed",
        totalItems: 12,
        startedAt: 1000,
        finishedAt: 4000,
        durationMs: 3000,
      });
    });

    expect(result.current.fetchTaskHistory).toHaveLength(1);
    expect(result.current.fetchTaskHistory[0]?.username).toBe("alice");

    act(() => {
      result.current.clearFetchTaskHistory();
    });

    expect(result.current.fetchTaskHistory).toHaveLength(0);
    expect(window.localStorage.getItem("twitter_media_fetch_task_history")).toBe("[]");
  });
});
