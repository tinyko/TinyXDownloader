import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { getSettings } from "@/lib/settings";
import type { FetchScope } from "@/lib/fetch/state";
import type { TwitterResponse } from "@/types/api";
import { CancelExtractorRequest } from "../../../wailsjs/go/main/App";

const RESULT_UPDATE_THROTTLE_MS = 500;

interface UseSingleFetchRuntimeOptions {
  loading: boolean;
  onTimeout?: () => void;
}

export function useSingleFetchRuntime({
  loading,
  onTimeout,
}: UseSingleFetchRuntimeOptions) {
  const [result, setResult] = useState<TwitterResponse | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [remainingTime, setRemainingTime] = useState<number | null>(null);

  const stopFetchRef = useRef(false);
  const fetchStartTimeRef = useRef<number | null>(null);
  const timeoutIntervalRef = useRef<number | null>(null);
  const singleFetchRequestIdRef = useRef<string | null>(null);
  const pendingResultRef = useRef<TwitterResponse | null>(null);
  const pendingResultScopeRef = useRef<FetchScope | null | undefined>(undefined);
  const resultUpdateTimerRef = useRef<number | null>(null);
  const lastResultUpdateRef = useRef(0);
  const activeResultScopeRef = useRef<FetchScope | null>(null);

  const cancelActiveRequest = useCallback(async () => {
    const requestId = singleFetchRequestIdRef.current;
    if (!requestId) {
      return false;
    }

    singleFetchRequestIdRef.current = null;

    try {
      return await CancelExtractorRequest(requestId);
    } catch {
      return false;
    }
  }, []);

  const flushResultUpdate = useCallback(
    (immediateResult?: TwitterResponse | null, immediateScope?: FetchScope | null) => {
      if (resultUpdateTimerRef.current !== null) {
        window.clearTimeout(resultUpdateTimerRef.current);
        resultUpdateTimerRef.current = null;
      }

      const nextResult =
        immediateResult === undefined ? pendingResultRef.current : immediateResult;
      const nextScope =
        immediateScope === undefined ? pendingResultScopeRef.current : immediateScope;
      pendingResultRef.current = null;
      pendingResultScopeRef.current = undefined;

      if (nextResult === undefined) {
        return;
      }

      lastResultUpdateRef.current = Date.now();
      startTransition(() => {
        activeResultScopeRef.current = nextResult
          ? nextScope ?? activeResultScopeRef.current
          : null;
        setResult(nextResult ?? null);
      });
    },
    []
  );

  const scheduleResultUpdate = useCallback(
    (nextResult: TwitterResponse | null, immediate = false, nextScope?: FetchScope | null) => {
      pendingResultRef.current = nextResult;
      if (nextScope !== undefined) {
        pendingResultScopeRef.current = nextScope;
      } else if (nextResult === null) {
        pendingResultScopeRef.current = null;
      }

      if (immediate) {
        flushResultUpdate(nextResult, nextScope);
        return;
      }

      const elapsed = Date.now() - lastResultUpdateRef.current;
      if (elapsed >= RESULT_UPDATE_THROTTLE_MS) {
        flushResultUpdate(nextResult, nextScope);
        return;
      }

      if (resultUpdateTimerRef.current !== null) {
        return;
      }

      resultUpdateTimerRef.current = window.setTimeout(() => {
        flushResultUpdate();
      }, RESULT_UPDATE_THROTTLE_MS - elapsed);
    },
    [flushResultUpdate]
  );

  const clearLiveResult = useCallback(() => {
    pendingResultRef.current = null;
    pendingResultScopeRef.current = null;
    flushResultUpdate(null, null);
  }, [flushResultUpdate]);

  const beginFetchTiming = useCallback(() => {
    fetchStartTimeRef.current = Date.now();
    setElapsedTime(0);
    setRemainingTime(getSettings().fetchTimeout || 60);
  }, []);

  const resetFetchTiming = useCallback(() => {
    if (timeoutIntervalRef.current !== null) {
      window.clearInterval(timeoutIntervalRef.current);
      timeoutIntervalRef.current = null;
    }
    fetchStartTimeRef.current = null;
    setElapsedTime(0);
    setRemainingTime(null);
  }, []);

  useEffect(() => {
    if (!loading || fetchStartTimeRef.current === null) {
      if (timeoutIntervalRef.current !== null) {
        window.clearInterval(timeoutIntervalRef.current);
        timeoutIntervalRef.current = null;
      }
      return;
    }

    const timeoutSeconds = getSettings().fetchTimeout || 60;

    timeoutIntervalRef.current = window.setInterval(() => {
      if (fetchStartTimeRef.current === null) {
        return;
      }

      const elapsed = Math.floor((Date.now() - fetchStartTimeRef.current) / 1000);
      const remaining = Math.max(0, timeoutSeconds - elapsed);

      setElapsedTime(elapsed);
      setRemainingTime(remaining);

      if (remaining <= 0 && !stopFetchRef.current) {
        stopFetchRef.current = true;
        void cancelActiveRequest();
        onTimeout?.();
      }
    }, 1000);

    return () => {
      if (timeoutIntervalRef.current !== null) {
        window.clearInterval(timeoutIntervalRef.current);
        timeoutIntervalRef.current = null;
      }
    };
  }, [cancelActiveRequest, loading, onTimeout]);

  useEffect(() => {
    return () => {
      if (resultUpdateTimerRef.current !== null) {
        window.clearTimeout(resultUpdateTimerRef.current);
      }
    };
  }, []);

  return {
    result,
    elapsedTime,
    remainingTime,
    stopFetchRef,
    fetchStartTimeRef,
    singleFetchRequestIdRef,
    activeResultScopeRef,
    cancelActiveRequest,
    flushResultUpdate,
    scheduleResultUpdate,
    clearLiveResult,
    beginFetchTiming,
    resetFetchTiming,
  };
}
