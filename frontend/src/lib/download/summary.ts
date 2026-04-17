import type { DownloadSessionResultSummary } from "@/types/download";

interface DownloadResultLike {
  downloaded?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  failures?: DownloadSessionResultSummary["failures"];
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

function normalizeSummaryText(value: string) {
  return value
    .toLowerCase()
    .replace(/[,\u2022]/g, " ")
    .replace(/\bfiles?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRedundantResultMessage(
  summary: DownloadSessionResultSummary,
  message: string
) {
  const formattedSummary = formatDownloadResultSummary(summary);
  if (formattedSummary && normalizeSummaryText(message) === normalizeSummaryText(formattedSummary)) {
    return true;
  }

  const downloaded = summary.downloaded ?? 0;
  const skipped = summary.skipped ?? 0;
  const failed = summary.failed ?? 0;
  const backendSummary = `Downloaded ${downloaded} files, ${skipped} skipped, ${failed} failed`;
  const plainSummary = `${downloaded} downloaded, ${skipped} skipped, ${failed} failed`;
  const normalizedMessage = normalizeSummaryText(message);

  return (
    normalizedMessage === normalizeSummaryText(backendSummary) ||
    normalizedMessage === normalizeSummaryText(plainSummary)
  );
}

export function getDownloadResultMessage(
  summary: DownloadSessionResultSummary | null | undefined
) {
  const message = summary?.message?.trim();
  if (!summary || !message || isRedundantResultMessage(summary, message)) {
    return "";
  }

  return message;
}

export function hasDownloadResultSummary(
  summary: DownloadSessionResultSummary | null | undefined
) {
  return Boolean(
    summary &&
      (hasPositiveNumber(summary.downloaded) ||
        hasPositiveNumber(summary.skipped) ||
        hasPositiveNumber(summary.failed) ||
        getDownloadResultMessage(summary) ||
        (summary.failures?.length ?? 0) > 0)
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
    failures: response.failures ?? [],
  };
}
