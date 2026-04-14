import { useEffect, useMemo, useState } from "react";

import {
  cancelDownloadIntegrityTask,
  getDownloadIntegrityTaskStatus,
  openSettingsFolder,
  startDownloadIntegrityTask,
} from "@/lib/settings-client";
import { normalizeIntegrityTaskStatus } from "@/lib/tasks/lifecycle";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type {
  DownloadIntegrityMode,
  DownloadIntegrityReport,
  DownloadIntegrityTaskStatus,
} from "@/types/settings";

export function useGlobalIntegrityMonitor() {
  const [integrityTaskStatus, setIntegrityTaskStatus] =
    useState<DownloadIntegrityTaskStatus | null>(null);
  const [integrityReport, setIntegrityReport] = useState<DownloadIntegrityReport | null>(null);
  const [showIntegrityReport, setShowIntegrityReport] = useState(false);

  const status = useMemo(
    () => normalizeIntegrityTaskStatus(integrityTaskStatus),
    [integrityTaskStatus]
  );

  const checkingIntegrity = status === "running" || status === "cancelling";
  const checkingIntegrityMode = integrityTaskStatus?.mode || null;

  useEffect(() => {
    void getDownloadIntegrityTaskStatus()
      .then((nextStatus) => {
        setIntegrityTaskStatus(nextStatus);
        if (nextStatus.report) {
          setIntegrityReport(nextStatus.report);
        }
      })
      .catch(() => {
        // Ignore initial polling failures; the Settings panel can still start a new task.
      });
  }, []);

  useEffect(() => {
    if (!checkingIntegrity) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      void getDownloadIntegrityTaskStatus()
        .then((nextStatus) => {
          if (cancelled) {
            return;
          }

          setIntegrityTaskStatus(nextStatus);

          if (nextStatus.status === "running" || nextStatus.status === "cancelling") {
            return;
          }

          if (nextStatus.status === "cancelled") {
            toast.info(
              `${nextStatus.mode === "deep" ? "Deep" : "Quick"} integrity check cancelled`
            );
            return;
          }

          if (nextStatus.status === "failed") {
            toast.error(`Integrity check failed: ${nextStatus.error || "unknown error"}`);
            return;
          }

          if (!nextStatus.report) {
            return;
          }

          setIntegrityReport(nextStatus.report);
          setShowIntegrityReport(true);

          const issueCount =
            nextStatus.report.partial_files + nextStatus.report.incomplete_files;
          if (issueCount > 0) {
            toast.warning(
              `${nextStatus.mode === "deep" ? "Deep" : "Quick"} check found ${issueCount} incomplete item(s)`
            );
          } else {
            toast.success(
              `${nextStatus.mode === "deep" ? "Deep" : "Quick"} check completed: ${nextStatus.report.checked_files} tracked file(s), no incomplete files found`
            );
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setIntegrityTaskStatus((previous) =>
            previous
              ? {
                  ...previous,
                  status: "failed",
                  in_progress: false,
                  phase: "failed",
                  error: message,
                }
              : null
          );
          toast.error(`Integrity check failed: ${message}`);
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkingIntegrity]);

  const handleCheckIntegrity = async (
    downloadPath: string,
    proxy: string,
    mode: DownloadIntegrityMode
  ) => {
    if (!downloadPath.trim()) {
      toast.error("Download path is empty");
      return;
    }

    try {
      const nextStatus = await startDownloadIntegrityTask(downloadPath, proxy, mode);
      setIntegrityTaskStatus(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Integrity check failed: ${message}`);
    }
  };

  const handleCancelIntegrityCheck = async () => {
    try {
      const cancelled = await cancelDownloadIntegrityTask();
      if (!cancelled) {
        toast.info("No integrity check is currently running");
        return;
      }

      setIntegrityTaskStatus((previous) =>
        previous
          ? {
              ...previous,
              status: "cancelling",
              phase: "cancelling",
            }
          : previous
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not cancel integrity check: ${message}`);
    }
  };

  const handleOpenIntegrityFolder = async () => {
    if (!integrityReport?.download_path) {
      return;
    }

    try {
      await openSettingsFolder(integrityReport.download_path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not open folder: ${message}`);
    }
  };

  return {
    integrityTaskStatus,
    integrityStatus: status,
    integrityReport,
    showIntegrityReport,
    checkingIntegrity,
    checkingIntegrityMode,
    handleCheckIntegrity,
    handleCancelIntegrityCheck,
    handleOpenIntegrityFolder,
    setShowIntegrityReport,
  };
}
