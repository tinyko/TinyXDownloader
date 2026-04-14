import type { MultiFetchSessionStatus } from "@/types/fetch";
import type { DownloadIntegrityTaskStatus } from "@/types/settings";
import type {
  TaskLifecycleStatus,
  TaskTerminalStatus,
} from "@/types/tasks";

interface ResolveDownloadTerminalStatusArgs {
  requestedCancel: boolean;
  current: number;
  total: number;
  override?: TaskTerminalStatus | null;
}

export function isTaskActive(status: TaskLifecycleStatus | null | undefined) {
  return status === "running" || status === "cancelling";
}

export function canCancelTask(status: TaskLifecycleStatus | null | undefined) {
  return status === "running";
}

export function mapMultiFetchSessionToTaskStatus(
  status: MultiFetchSessionStatus | null | undefined
): TaskLifecycleStatus | null {
  switch (status) {
    case "running":
    case "cancelling":
    case "completed":
    case "failed":
    case "cancelled":
      return status;
    case "ready":
    default:
      return null;
  }
}

export function normalizeIntegrityTaskStatus(
  status: DownloadIntegrityTaskStatus | null | undefined
): TaskLifecycleStatus | null {
  if (!status) {
    return null;
  }
  if (status.status) {
    return status.status;
  }
  if (status.cancelled) {
    return "cancelled";
  }
  if (status.in_progress) {
    return "running";
  }
  if (status.error) {
    return "failed";
  }
  if (status.report) {
    return "completed";
  }
  return null;
}

export function resolveDownloadTerminalStatus({
  requestedCancel,
  current,
  total,
  override = null,
}: ResolveDownloadTerminalStatusArgs): TaskTerminalStatus {
  if (requestedCancel) {
    return "cancelled";
  }
  if (override) {
    return override;
  }
  if (total > 0 && current >= total) {
    return "completed";
  }
  return "failed";
}
