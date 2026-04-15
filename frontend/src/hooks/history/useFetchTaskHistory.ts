import { useCallback, useState } from "react";

import type { FetchTaskHistoryInput, FetchTaskHistoryItem } from "@/types/history";

const FETCH_TASK_HISTORY_KEY = "twitter_media_fetch_task_history";
const MAX_FETCH_TASK_HISTORY = 60;

function loadFetchTaskHistory(): FetchTaskHistoryItem[] {
  try {
    const saved = localStorage.getItem(FETCH_TASK_HISTORY_KEY);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? (parsed as FetchTaskHistoryItem[]) : [];
  } catch (error) {
    console.error("Failed to load fetch task history:", error);
    return [];
  }
}

export function useFetchTaskHistory() {
  const [fetchTaskHistory, setFetchTaskHistory] = useState<FetchTaskHistoryItem[]>(() =>
    loadFetchTaskHistory()
  );

  const saveHistory = useCallback((history: FetchTaskHistoryItem[]) => {
    try {
      localStorage.setItem(FETCH_TASK_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save fetch task history:", error);
    }
  }, []);

  const addFetchTaskHistory = useCallback(
    (entry: FetchTaskHistoryInput) => {
      setFetchTaskHistory((previous) => {
        const updated = [
          {
            ...entry,
            id: crypto.randomUUID(),
          },
          ...previous,
        ].slice(0, MAX_FETCH_TASK_HISTORY);
        saveHistory(updated);
        return updated;
      });
    },
    [saveHistory]
  );

  const removeFetchTaskHistory = useCallback(
    (id: string) => {
      setFetchTaskHistory((previous) => {
        const updated = previous.filter((item) => item.id !== id);
        saveHistory(updated);
        return updated;
      });
    },
    [saveHistory]
  );

  const clearFetchTaskHistory = useCallback(() => {
    setFetchTaskHistory([]);
    saveHistory([]);
  }, [saveHistory]);

  return {
    fetchTaskHistory,
    addFetchTaskHistory,
    removeFetchTaskHistory,
    clearFetchTaskHistory,
  };
}
