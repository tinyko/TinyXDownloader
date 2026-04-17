import type { TaskLifecycleStatus, TaskTerminalStatus } from "@/types/tasks";

export interface GlobalDownloadState {
  in_progress: boolean;
  current: number;
  total: number;
  percent: number;
}

export interface GlobalDownloadTaskState {
  status: TaskLifecycleStatus | null;
  progress: GlobalDownloadState | null;
  summary?: DownloadSessionResultSummary | null;
}

export interface GlobalDownloadSessionMeta {
  source: "media-list" | "database-single" | "database-bulk" | "multi-account-workspace";
  title: string;
  subtitle?: string;
  targetKey?: string;
  accountId?: number;
  accountName?: string;
}

export type DownloadSessionResultStatus = TaskTerminalStatus;

export interface DownloadSessionResultSummary {
  downloaded?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  failures?: DownloadFailureDetail[];
}

export interface DownloadFailureDetail {
  tweet_id: number;
  index: number;
  url: string;
  error: string;
}

export type DownloadSessionFinishHandler = (
  status?: DownloadSessionResultStatus,
  summary?: DownloadSessionResultSummary
) => void;

export type DownloadSessionFailHandler = (
  summary?: DownloadSessionResultSummary
) => void;

export interface GlobalDownloadHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
  status: TaskTerminalStatus;
  current: number;
  total: number;
  finishedAt: number;
  summary?: DownloadSessionResultSummary | null;
}
