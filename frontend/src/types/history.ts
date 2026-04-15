import type { FetchMode, PrivateType } from "@/types/fetch";
import type { TaskTerminalStatus } from "@/types/tasks";

export interface FetchTaskHistoryItem {
  id: string;
  username: string;
  displayName?: string;
  image?: string;
  mode: FetchMode;
  privateType?: PrivateType;
  timelineType: string;
  mediaType: string;
  retweets: boolean;
  useDateRange: boolean;
  startDate?: string;
  endDate?: string;
  status: TaskTerminalStatus;
  totalItems: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export type FetchTaskHistoryInput = Omit<FetchTaskHistoryItem, "id">;
