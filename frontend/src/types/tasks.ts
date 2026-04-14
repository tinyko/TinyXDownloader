export type TaskLifecycleStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskTerminalStatus = Exclude<TaskLifecycleStatus, "running" | "cancelling">;

export interface TaskProgressSnapshot {
  current: number;
  total: number;
  percent: number;
}

export interface TaskCardSummary {
  status: TaskLifecycleStatus | null;
  title: string;
  description: string;
  phase?: string;
  progress?: TaskProgressSnapshot | null;
  canCancel: boolean;
}
