import type { DownloadSessionResultSummary } from "@/types/download";

interface DownloadResultLike {
  downloaded?: number;
  skipped?: number;
  failed?: number;
  message?: string;
}

function hasNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

function hasPositiveNumber(value: number | undefined): value is number {
  return hasNumber(value) && value > 0;
}

function formatResultCount(value: number, label: string) {
  return `${value.toLocaleString()} ${label}`;
}

export function hasDownloadResultSummary(
  summary: DownloadSessionResultSummary | null | undefined
) {
  return Boolean(
    summary &&
      (hasPositiveNumber(summary.downloaded) ||
        hasPositiveNumber(summary.skipped) ||
        hasPositiveNumber(summary.failed) ||
        summary.message)
  );
}

export function formatDownloadResultSummary(
  summary: DownloadSessionResultSummary | null | undefined
) {
  if (!summary) {
    return "";
  }

  const parts: string[] = [];
  if (hasPositiveNumber(summary.downloaded)) {
    parts.push(formatResultCount(summary.downloaded, "downloaded"));
  }
  if (hasPositiveNumber(summary.skipped)) {
    parts.push(formatResultCount(summary.skipped, "skipped"));
  }
  if (hasPositiveNumber(summary.failed)) {
    parts.push(formatResultCount(summary.failed, "failed"));
  }

  return parts.join(" • ");
}

export function buildDownloadResultSummary(
  response: DownloadResultLike,
  message?: string
): DownloadSessionResultSummary {
  return {
    downloaded: response.downloaded ?? 0,
    skipped: response.skipped ?? 0,
    failed: response.failed ?? 0,
    message: message || response.message,
  };
}
