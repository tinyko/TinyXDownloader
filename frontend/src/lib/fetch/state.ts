/**
 * Fetch State Manager
 * Manages resumable fetch state for large accounts
 */

import type { AccountInfo, TimelineEntry } from "@/types/api";

const FETCH_STATE_KEY = "twitter_fetch_state";
const CURSOR_STATE_KEY = "twitter_cursor_state";

let fetchStateCache: Record<string, FetchState> | null = null;
let cursorStateCache: Record<string, CursorState> | null = null;

export interface FetchScope {
  username: string;
  mediaType?: string;
  retweets?: boolean;
  timelineType?: string;
  queryKey?: string;
}

export interface NormalizedFetchScope {
  username: string;
  mediaType: string;
  retweets: boolean;
  timelineType: string;
  queryKey: string;
}

export interface FetchState extends NormalizedFetchScope {
  cursor: string;
  accountInfo: AccountInfo | null;
  totalFetched: number;
  completed: boolean;
  lastUpdated: number;
}

export interface ResumableFetchInfo extends NormalizedFetchScope {
  canResume: boolean;
  mediaCount: number;
  lastUpdated: Date | null;
}

interface CursorState {
  cursor: string;
  lastUpdated: number;
}

type FetchStateInput = Partial<FetchState> &
  FetchScope & {
    timeline?: TimelineEntry[];
  };

function normalizeScope(scope: FetchScope): NormalizedFetchScope {
  return {
    username: scope.username.trim(),
    mediaType: scope.mediaType || "all",
    retweets: scope.retweets ?? false,
    timelineType: scope.timelineType || "timeline",
    queryKey: scope.queryKey || "",
  };
}

export function buildFetchStateKey(scope: FetchScope): string {
  const normalized = normalizeScope(scope);
  return [
    normalized.username.toLowerCase(),
    normalized.mediaType,
    normalized.timelineType,
    normalized.retweets ? "1" : "0",
    normalized.queryKey,
  ].join("|");
}

function matchesUsername(state: FetchState, username: string): boolean {
  return state.username.toLowerCase() === username.trim().toLowerCase();
}

function migrateFetchStates(raw: unknown): Record<string, FetchState> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const migrated: Record<string, FetchState> = {};

  for (const [legacyKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const record = value as Partial<FetchState> & {
      username?: string;
      authToken?: string;
      timeline?: TimelineEntry[];
      accountInfo?: AccountInfo | null;
    };
    const scope = normalizeScope({
      username: record.username || legacyKey,
      mediaType: record.mediaType,
      retweets: record.retweets,
      timelineType: record.timelineType,
      queryKey: record.queryKey,
    });

    migrated[buildFetchStateKey(scope)] = {
      ...scope,
      cursor: typeof record.cursor === "string" ? record.cursor : "",
      accountInfo: record.accountInfo || null,
      totalFetched:
        typeof record.totalFetched === "number"
          ? record.totalFetched
          : Array.isArray(record.timeline)
            ? record.timeline.length
            : 0,
      completed: record.completed ?? false,
      lastUpdated:
        typeof record.lastUpdated === "number" ? record.lastUpdated : Date.now(),
    };
  }

  return migrated;
}

function writeFetchStates(allStates: Record<string, FetchState>): void {
  fetchStateCache = allStates;
  localStorage.setItem(FETCH_STATE_KEY, JSON.stringify(allStates));
}

function migrateCursorStates(raw: unknown): Record<string, CursorState> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const migrated: Record<string, CursorState> = {};

  for (const [legacyKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const record = value as Partial<CursorState>;
    const cursor = typeof record.cursor === "string" ? record.cursor : "";
    if (!cursor) {
      continue;
    }

    const scope = normalizeScope({ username: legacyKey });
    migrated[buildFetchStateKey(scope)] = {
      cursor,
      lastUpdated:
        typeof record.lastUpdated === "number" ? record.lastUpdated : Date.now(),
    };
  }

  return migrated;
}

function findResumableState(
  username: string,
  preferredScope?: FetchScope
): FetchState | null {
  const allStates = getAllFetchStates();
  const resumableStates = Object.values(allStates)
    .filter(
      (state) =>
        matchesUsername(state, username) &&
        !!state.cursor &&
        !state.completed &&
        state.totalFetched > 0
    )
    .sort((left, right) => right.lastUpdated - left.lastUpdated);

  if (resumableStates.length === 0) {
    return null;
  }

  if (preferredScope) {
    const preferredKey = buildFetchStateKey(preferredScope);
    const preferred = resumableStates.find(
      (state) => buildFetchStateKey(state) === preferredKey
    );
    if (preferred) {
      return preferred;
    }
  }

  return resumableStates[0] || null;
}

/**
 * Save current fetch state for resume capability
 */
export function saveFetchState(
  state: FetchStateInput
): void {
  try {
    const scope = normalizeScope(state);
    const existing = getFetchState(scope);
    const updated: FetchState = {
      ...scope,
      cursor: state.cursor ?? existing?.cursor ?? "",
      accountInfo: state.accountInfo || existing?.accountInfo || null,
      totalFetched:
        state.totalFetched ??
        (Array.isArray(state.timeline) ? state.timeline.length : undefined) ??
        existing?.totalFetched ??
        0,
      completed: state.completed ?? false,
      lastUpdated: Date.now(),
    };

    const allStates = getAllFetchStates();
    allStates[buildFetchStateKey(scope)] = updated;

    writeFetchStates(allStates);
  } catch (error) {
    console.error("Failed to save fetch state:", error);
  }
}

/**
 * Get fetch state for a specific scope
 */
export function getFetchState(scope: FetchScope): FetchState | null {
  try {
    const allStates = getAllFetchStates();
    return allStates[buildFetchStateKey(scope)] || null;
  } catch (error) {
    console.error("Failed to get fetch state:", error);
    return null;
  }
}

/**
 * Get all fetch states
 */
export function getAllFetchStates(): Record<string, FetchState> {
  if (fetchStateCache) {
    return fetchStateCache;
  }

  try {
    const stored = localStorage.getItem(FETCH_STATE_KEY);
    if (stored) {
      fetchStateCache = migrateFetchStates(JSON.parse(stored));
      return fetchStateCache;
    }
  } catch (error) {
    console.error("Failed to parse fetch states:", error);
  }
  fetchStateCache = {};
  return fetchStateCache;
}

/**
 * Check if there's a resumable fetch for the exact scope
 */
export function hasResumableFetch(scope: FetchScope): boolean {
  const state = getFetchState(scope);
  if (!state) return false;

  return !!state.cursor && !state.completed && state.totalFetched > 0;
}

/**
 * Get resumable fetch info for display.
 * If `preferredScope` exists, exact match wins; otherwise the most recent incomplete scope is returned.
 */
export function getResumableInfo(
  username: string,
  preferredScope?: FetchScope
): ResumableFetchInfo {
  const state = findResumableState(username, preferredScope);
  if (!state) {
    return {
      canResume: false,
      mediaCount: 0,
      lastUpdated: null,
      mediaType: preferredScope?.mediaType || "all",
      retweets: preferredScope?.retweets ?? false,
      timelineType: preferredScope?.timelineType || "timeline",
      queryKey: preferredScope?.queryKey || "",
      username: username.trim(),
    };
  }

  return {
    canResume: true,
    mediaCount: state.totalFetched,
    lastUpdated: new Date(state.lastUpdated),
    mediaType: state.mediaType,
    retweets: state.retweets,
    timelineType: state.timelineType,
    queryKey: state.queryKey,
    username: state.username,
  };
}

/**
 * Clear fetch state for one exact scope
 */
export function clearFetchState(scope: FetchScope): void {
  try {
    const allStates = getAllFetchStates();
    delete allStates[buildFetchStateKey(scope)];
    writeFetchStates(allStates);
  } catch (error) {
    console.error("Failed to clear fetch state:", error);
  }
}

/**
 * Clear all fetch states for a username
 */
export function clearFetchStatesForUsername(username: string): void {
  try {
    const allStates = getAllFetchStates();
    const filtered = Object.fromEntries(
      Object.entries(allStates).filter(
        ([, state]) => !matchesUsername(state, username)
      )
    );
    writeFetchStates(filtered);
  } catch (error) {
    console.error("Failed to clear fetch states:", error);
  }
}

/**
 * Clear all incomplete fetch states (cleanup)
 */
export function clearAllIncompleteFetchStates(): void {
  try {
    const allStates = getAllFetchStates();
    const completed = Object.fromEntries(
      Object.entries(allStates).filter(([, state]) => state.completed)
    );

    writeFetchStates(completed);
  } catch (error) {
    console.error("Failed to clear fetch states:", error);
  }
}

/**
 * Save cursor only (lightweight, can be called every batch)
 */
export function saveCursor(scope: FetchScope, cursor: string): void {
  try {
    const allCursors = getAllCursors();
    allCursors[buildFetchStateKey(scope)] = {
      cursor,
      lastUpdated: Date.now(),
    };
    cursorStateCache = allCursors;
    localStorage.setItem(CURSOR_STATE_KEY, JSON.stringify(allCursors));
  } catch (error) {
    console.error("Failed to save cursor:", error);
  }
}

/**
 * Get cursor for scope from localStorage
 */
export function getCursor(scope: FetchScope): string | null {
  try {
    const allCursors = getAllCursors();
    return allCursors[buildFetchStateKey(scope)]?.cursor || null;
  } catch (error) {
    console.error("Failed to get cursor:", error);
    return null;
  }
}

/**
 * Get all cursors
 */
function getAllCursors(): Record<string, CursorState> {
  if (cursorStateCache) {
    return cursorStateCache;
  }

  try {
    const stored = localStorage.getItem(CURSOR_STATE_KEY);
    if (stored) {
      cursorStateCache = migrateCursorStates(JSON.parse(stored));
      return cursorStateCache;
    }
  } catch (error) {
    console.error("Failed to parse cursors:", error);
  }
  cursorStateCache = {};
  return cursorStateCache;
}

/**
 * Clear cursor for exact scope
 */
export function clearCursor(scope: FetchScope): void {
  try {
    const allCursors = getAllCursors();
    delete allCursors[buildFetchStateKey(scope)];
    cursorStateCache = allCursors;
    localStorage.setItem(CURSOR_STATE_KEY, JSON.stringify(allCursors));
  } catch (error) {
    console.error("Failed to clear cursor:", error);
  }
}

/**
 * Clear all cursors for a username
 */
export function clearCursorsForUsername(username: string): void {
  try {
    const allCursors = getAllCursors();
    const filtered = Object.fromEntries(
      Object.entries(allCursors).filter(([key]) => {
        const [storedUsername] = key.split("|");
        return storedUsername !== username.trim().toLowerCase();
      })
    );
    cursorStateCache = filtered;
    localStorage.setItem(CURSOR_STATE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to clear cursors:", error);
  }
}

/**
 * Merge new timeline entries with existing (deduplicate by tweet_id)
 */
export function mergeTimelines(
  existing: TimelineEntry[],
  newEntries: TimelineEntry[]
): TimelineEntry[] {
  const seenIds = new Set(existing.map((entry) => entry.tweet_id));
  const unique = newEntries.filter((entry) => !seenIds.has(entry.tweet_id));
  return [...existing, ...unique];
}
