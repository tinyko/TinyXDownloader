import type { TaskLifecycleStatus } from "@/types/tasks";

export type FetchMode = "public" | "private";
export type PrivateType = "bookmarks" | "likes";
export type FetchType = "single" | "multiple";

export interface HistoryItem {
  id: string;
  username: string;
  name: string;
  image: string;
  mediaCount: number;
  timestamp: number;
}

export interface MultipleAccount {
  id: string;
  username: string;
  mode?: FetchMode;
  privateType?: PrivateType;
  mediaType?: string;
  retweets?: boolean;
  status: "pending" | "fetching" | "completed" | "incomplete" | "failed";
  accountInfo?: {
    name: string;
    nick: string;
    profile_image: string;
  };
  mediaCount: number;
  previousMediaCount: number;
  elapsedTime: number;
  remainingTime: number | null;
  error?: string;
  showDiff?: boolean;
  cursor?: string;
}

export type MultiFetchSessionSource = "manual-fetch" | "saved-update";
export type MultiFetchSessionStatus =
  | "ready"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type SingleFetchTaskStatus = TaskLifecycleStatus | null;

export interface MultiFetchSession {
  id: string;
  source: MultiFetchSessionSource;
  title: string;
  createdAt: number;
  status: MultiFetchSessionStatus;
  accounts: MultipleAccount[];
}

export interface MultiFetchSessionSummary {
  id: string;
  source: MultiFetchSessionSource;
  title: string;
  createdAt: number;
  status: MultiFetchSessionStatus;
  accountCount: number;
  totalMedia: number;
  counts: {
    pending: number;
    fetching: number;
    completed: number;
    incomplete: number;
    failed: number;
  };
}
