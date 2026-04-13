import { useCallback, useEffect, useState } from "react";

import type { TwitterResponse } from "@/types/api";
import type { HistoryItem } from "@/types/fetch";

const HISTORY_KEY = "twitter_media_fetch_history";
const MAX_HISTORY = 10;

export function useFetchHistory() {
  const [fetchHistory, setFetchHistory] = useState<HistoryItem[]>([]);

  const saveHistory = useCallback((history: HistoryItem[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.error("Failed to save history:", err);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setFetchHistory(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }, []);

  const addToHistory = useCallback((data: TwitterResponse, inputUsername: string) => {
    let cleanUsername = inputUsername.trim();
    if (cleanUsername.startsWith("@")) {
      cleanUsername = cleanUsername.slice(1);
    }
    if (cleanUsername.includes("x.com/") || cleanUsername.includes("twitter.com/")) {
      const match = cleanUsername.match(/(?:x\.com|twitter\.com)\/([^/?]+)/);
      if (match) cleanUsername = match[1];
    }

    setFetchHistory((prev) => {
      const apiUsername = data.account_info.name;
      const filtered = prev.filter((h) => h.username.toLowerCase() !== apiUsername.toLowerCase());
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        username: apiUsername,
        name: data.account_info.nick,
        image: data.account_info.profile_image,
        mediaCount: data.total_urls,
        timestamp: Date.now(),
      };
      const updated = [newItem, ...filtered].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  }, [saveHistory]);

  const removeFromHistory = useCallback((id: string) => {
    setFetchHistory((prev) => {
      const updated = prev.filter((h) => h.id !== id);
      saveHistory(updated);
      return updated;
    });
  }, [saveHistory]);

  const clearFetchHistory = useCallback(() => {
    setFetchHistory([]);
    saveHistory([]);
  }, [saveHistory]);

  return {
    fetchHistory,
    addToHistory,
    removeFromHistory,
    clearFetchHistory,
  };
}
