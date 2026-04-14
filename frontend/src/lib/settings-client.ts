import {
  CancelDownloadIntegrityTask,
  CheckDownloadIntegrity,
  DownloadExifTool,
  DownloadFFmpeg,
  GetDownloadIntegrityTaskStatus,
  IsExifToolInstalled,
  IsFFmpegInstalled,
  OpenFolder,
  SelectFolder,
  StartDownloadIntegrityTask,
} from "../../wailsjs/go/main/App";
import type {
  DownloadIntegrityMode,
  DownloadIntegrityReport,
  DownloadIntegrityTaskStatus,
} from "@/types/settings";
import type { TaskLifecycleStatus } from "@/types/tasks";

interface RawIntegrityTaskStatus {
  status?: string;
  in_progress?: boolean;
  cancelled?: boolean;
  mode?: string;
  phase?: string;
  scanned_files?: number;
  checked_files?: number;
  verified_files?: number;
  partial_files?: number;
  incomplete_files?: number;
  untracked_files?: number;
  unverifiable_files?: number;
  issues_count?: number;
  error?: string;
  report?: RawDownloadIntegrityReport | null;
}

interface RawDownloadIntegrityIssue {
  path?: string;
  relative_path?: string;
  reason?: string;
  local_size?: number;
  remote_size?: number;
  url?: string;
}

interface RawDownloadIntegrityReport {
  mode?: string;
  download_path?: string;
  scanned_files?: number;
  checked_files?: number;
  complete_files?: number;
  partial_files?: number;
  incomplete_files?: number;
  untracked_files?: number;
  unverifiable_files?: number;
  issues?: RawDownloadIntegrityIssue[];
}

export function selectDownloadFolder(currentPath: string) {
  return SelectFolder(currentPath);
}

export function checkFFmpegInstalled() {
  return IsFFmpegInstalled();
}

export function downloadFFmpegBinary() {
  return DownloadFFmpeg();
}

export function checkExifToolInstalled() {
  return IsExifToolInstalled();
}

export function downloadExifToolBinary() {
  return DownloadExifTool();
}

export function runDownloadIntegrityCheck(
  downloadPath: string,
  proxy: string,
  mode: DownloadIntegrityMode
) {
  return CheckDownloadIntegrity({
    download_path: downloadPath,
    proxy,
    mode,
  }) as Promise<DownloadIntegrityReport>;
}

export function openSettingsFolder(path: string) {
  return OpenFolder(path);
}

function normalizeIntegrityTaskStatus(
  data: RawIntegrityTaskStatus | null | undefined
): DownloadIntegrityTaskStatus {
  let status: TaskLifecycleStatus = "completed";
  switch (data?.status) {
    case "running":
    case "cancelling":
    case "completed":
    case "failed":
    case "cancelled":
      status = data.status;
      break;
    default:
      if (data?.cancelled) {
        status = "cancelled";
      } else if (data?.in_progress) {
        status = "running";
      } else if (data?.error) {
        status = "failed";
      } else {
        status = "completed";
      }
  }

  const mode =
    data?.mode === "quick" || data?.mode === "deep" ? data.mode : "";

  return {
    status,
    in_progress: Boolean(data?.in_progress),
    cancelled: Boolean(data?.cancelled),
    mode,
    phase: data?.phase || "",
    scanned_files: data?.scanned_files ?? 0,
    checked_files: data?.checked_files ?? 0,
    verified_files: data?.verified_files ?? 0,
    partial_files: data?.partial_files ?? 0,
    incomplete_files: data?.incomplete_files ?? 0,
    untracked_files: data?.untracked_files ?? 0,
    unverifiable_files: data?.unverifiable_files ?? 0,
    issues_count: data?.issues_count ?? 0,
    error: data?.error || "",
    report: data?.report ? normalizeIntegrityReport(data.report) : null,
  };
}

function normalizeIntegrityReport(
  report: RawDownloadIntegrityReport
): DownloadIntegrityReport {
  return {
    mode: report.mode === "deep" ? "deep" : "quick",
    download_path: report.download_path ?? "",
    scanned_files: report.scanned_files ?? 0,
    checked_files: report.checked_files ?? 0,
    complete_files: report.complete_files ?? 0,
    partial_files: report.partial_files ?? 0,
    incomplete_files: report.incomplete_files ?? 0,
    untracked_files: report.untracked_files ?? 0,
    unverifiable_files: report.unverifiable_files ?? 0,
    issues: (report.issues ?? []).map((issue) => ({
      path: issue.path ?? "",
      relative_path: issue.relative_path ?? "",
      reason: issue.reason ?? "",
      local_size: issue.local_size ?? 0,
      remote_size: issue.remote_size ?? 0,
      url: issue.url,
    })),
  };
}

export async function startDownloadIntegrityTask(
  downloadPath: string,
  proxy: string,
  mode: DownloadIntegrityMode
): Promise<DownloadIntegrityTaskStatus> {
  return normalizeIntegrityTaskStatus(
    await StartDownloadIntegrityTask({
      download_path: downloadPath,
      proxy,
      mode,
    })
  );
}

export async function getDownloadIntegrityTaskStatus(): Promise<DownloadIntegrityTaskStatus> {
  return normalizeIntegrityTaskStatus(await GetDownloadIntegrityTaskStatus());
}

export function cancelDownloadIntegrityTask() {
  return CancelDownloadIntegrityTask();
}
