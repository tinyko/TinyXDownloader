export interface GlobalDownloadState {
  in_progress: boolean;
  current: number;
  total: number;
  percent: number;
}

export interface GlobalDownloadSessionMeta {
  source: "media-list" | "database-single" | "database-bulk" | "multi-account-workspace";
  title: string;
  subtitle?: string;
  targetKey?: string;
  accountId?: number;
  accountName?: string;
}

export interface GlobalDownloadHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
  status: "completed" | "interrupted";
  current: number;
  total: number;
  finishedAt: number;
}
