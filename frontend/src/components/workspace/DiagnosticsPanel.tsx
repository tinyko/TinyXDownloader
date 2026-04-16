import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createDatabaseBackup,
  exportSupportBundle,
  getExtractorDiagnosticsSnapshot,
  openAppDataFolder,
  restoreDatabaseBackup,
} from "@/lib/diagnostics-client";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type {
  DiagnosticsParityContext,
  ExtractorDiagnosticsSnapshot,
  ExtractorValidationRunRequest,
} from "@/types/diagnostics";

interface DiagnosticsPanelProps {
  embedded?: boolean;
  fillHeight?: boolean;
  parityContext?: DiagnosticsParityContext;
  runbookTokens?: ExtractorValidationRunRequest;
}

function formatCompactList(values?: string[] | null): string {
  const resolvedValues = values ?? [];
  return resolvedValues.length > 0 ? resolvedValues.join(", ") : "none";
}

export function DiagnosticsPanel({
  embedded = false,
  fillHeight = false,
}: DiagnosticsPanelProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [extractorSnapshot, setExtractorSnapshot] = useState<ExtractorDiagnosticsSnapshot | null>(null);
  const [extractorLoadError, setExtractorLoadError] = useState<string | null>(null);

  const loadExtractorDiagnostics = useCallback(async (quiet = false) => {
    try {
      const snapshot = await getExtractorDiagnosticsSnapshot();
      setExtractorSnapshot(snapshot);
      setExtractorLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExtractorLoadError(message);
      if (!quiet) {
        toast.error(message || "Failed to load diagnostics");
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async (quiet = false) => {
      try {
        const snapshot = await getExtractorDiagnosticsSnapshot();
        if (!active) {
          return;
        }
        setExtractorSnapshot(snapshot);
        setExtractorLoadError(null);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setExtractorLoadError(message);
        if (!quiet) {
          toast.error(message || "Failed to load diagnostics");
        }
      }
    };

    void refresh(true);
    const intervalId = window.setInterval(() => {
      void refresh(true);
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const runAsyncAction = async (action: string, run: () => Promise<void>) => {
    setBusyAction(action);
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || "Action failed");
    } finally {
      setBusyAction((current) => (current === action ? null : current));
    }
  };

  const handleExportSupportBundle = async () => {
    await runAsyncAction("support-bundle", async () => {
      const outputPath = await exportSupportBundle();
      if (!outputPath) {
        return;
      }
      toast.success(`Support bundle exported to ${outputPath}`);
    });
  };

  const handleCreateDatabaseBackup = async () => {
    await runAsyncAction("backup", async () => {
      const outputPath = await createDatabaseBackup();
      if (!outputPath) {
        return;
      }
      toast.success(`Database backup created at ${outputPath}`);
    });
  };

  const handleRestoreDatabaseBackup = async () => {
    await runAsyncAction("restore", async () => {
      const result = await restoreDatabaseBackup();
      if (!result.success) {
        if (result.message && result.message !== "Cancelled") {
          toast.error(result.message);
        }
        return;
      }

      if (result.requires_restart) {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    });
  };

  const handleOpenAppDataFolder = async () => {
    await runAsyncAction("open-app-data", async () => {
      await openAppDataFolder();
    });
  };

  const snapshot = extractorSnapshot;

  return (
    <div
      className={
        embedded
          ? fillHeight
            ? "flex min-h-full flex-col gap-4"
            : "space-y-4"
          : "space-y-6"
      }
    >
      <div className={`flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded ? <h1 className="text-2xl font-bold">Support &amp; Health</h1> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadExtractorDiagnostics()}
            disabled={busyAction !== null}
            className="gap-1.5"
            data-testid="diagnostics-refresh-extractor"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportSupportBundle()}
            disabled={busyAction !== null}
            className="gap-1.5"
            data-testid="diagnostics-export-support-bundle"
          >
            Export Support Bundle
          </Button>
        </div>
      </div>

      <section
        className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm"
        data-testid="diagnostics-extractor-panel"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Support &amp; Health</h2>
          <p className="text-xs text-muted-foreground">
            Current extractor support and local maintenance tools.
          </p>
        </div>

        {extractorLoadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {extractorLoadError}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div
            className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1"
            data-testid="diagnostics-support-summary-panel"
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Supported Today
            </h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Public media:</span>{" "}
                {formatCompactList(snapshot?.support_matrix?.public_media_types)}
              </p>
              <p>
                <span className="font-medium text-foreground">Public timeline:</span>{" "}
                {formatCompactList(snapshot?.support_matrix?.public_timeline_types)}
              </p>
              <p>
                <span className="font-medium text-foreground">Date range:</span>{" "}
                {formatCompactList(snapshot?.support_matrix?.public_date_range_media_filters)}
              </p>
              <p>
                <span className="font-medium text-foreground">Private explicit-go:</span>{" "}
                {formatCompactList(snapshot?.support_matrix?.private_explicit_go_timeline_types)}
              </p>
              <p>
                <span className="font-medium text-foreground">Private auto pinned:</span>{" "}
                {formatCompactList(snapshot?.support_matrix?.private_auto_pinned_timeline_types)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Export a support bundle when deeper troubleshooting needs the full local diagnostic history.
            </p>
          </div>

          <div
            className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1"
            data-testid="diagnostics-maintenance-panel"
          >
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Maintenance
              </h3>
              <p className="text-xs text-muted-foreground">
                Local support utilities for backups and app data access.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCreateDatabaseBackup()}
                disabled={busyAction !== null}
                className="gap-1.5"
                data-testid="diagnostics-create-backup"
              >
                Create Database Backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRestoreDatabaseBackup()}
                disabled={busyAction !== null}
                className="gap-1.5"
                data-testid="diagnostics-restore-backup"
              >
                Restore Database Backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleOpenAppDataFolder()}
                disabled={busyAction !== null}
                className="gap-1.5"
                data-testid="diagnostics-open-app-data"
              >
                Open App Data Folder
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
