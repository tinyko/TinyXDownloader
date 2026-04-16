import { ExtractTimelineStructured } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

const TRANSIENT_TIMELINE_ERROR_PATTERNS = [
  "unable to retrieve tweets from this timeline",
  "rate limit",
  "429",
  "502",
  "503",
  "504",
  "temporarily unavailable",
  "x api returned media timeline errors",
  "x api returned timeline errors",
  "x api returned search timeline errors",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isTransientTimelineFetchError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return TRANSIENT_TIMELINE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

interface ExtractTimelineStructuredWithRetryOptions {
  buildRequest: (requestId: string) => main.TimelineRequest;
  onAttemptStart?: (requestId: string) => void;
  onAttemptFinish?: (requestId: string) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export async function extractTimelineStructuredWithRetry({
  buildRequest,
  onAttemptStart,
  onAttemptFinish,
  maxAttempts = 2,
  retryDelayMs = 1200,
}: ExtractTimelineStructuredWithRetryOptions) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestId = crypto.randomUUID();
    onAttemptStart?.(requestId);

    try {
      return await ExtractTimelineStructured(buildRequest(requestId));
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientTimelineFetchError(error)) {
        throw error;
      }
      await sleep(retryDelayMs);
    } finally {
      onAttemptFinish?.(requestId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
