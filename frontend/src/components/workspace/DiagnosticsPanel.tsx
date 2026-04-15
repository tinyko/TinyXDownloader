import { useState, useEffect, useRef } from "react";
import { Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createDatabaseBackup,
  exportSupportBundle,
  openAppDataFolder,
  restoreDatabaseBackup,
} from "@/lib/diagnostics-client";
import { logger, type LogEntry } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

interface DiagnosticsPanelProps {
  embedded?: boolean;
  fillHeight?: boolean;
}

const levelColors: Record<string, string> = {
  info: "text-blue-500",
  success: "text-green-500",
  warning: "text-yellow-500",
  error: "text-red-500",
  debug: "text-gray-500",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DiagnosticsPanel({
  embedded = false,
  fillHeight = false,
}: DiagnosticsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>(() => logger.getLogs());
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = logger.subscribe(() => {
      setLogs(logger.getLogs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClear = () => {
    logger.clear();
  };

  const handleCopy = async () => {
    const logText = logs
      .map((log) => `[${formatTime(log.timestamp)}] [${log.level}] ${log.message}`)
      .join("\n");
    
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 500);
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  const runAsyncAction = async (
    action: string,
    run: () => Promise<void>
  ) => {
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

  return (
    <div
      className={
        embedded
          ? fillHeight
            ? "flex h-full min-h-0 flex-col gap-4"
            : "space-y-4"
          : "space-y-6"
      }
    >
      <div className={`flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded ? <h1 className="text-2xl font-bold">Debug Logs</h1> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={logs.length === 0}
            className="gap-1.5"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={embedded
          ? fillHeight
            ? "min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
            : "h-72 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
          : "h-[calc(100vh-220px)] overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs"}
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground lowercase">no logs yet...</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-muted-foreground shrink-0">
                [{formatTime(log.timestamp)}]
              </span>
              <span className={`shrink-0 w-16 ${levelColors[log.level]}`}>
                [{log.level}]
              </span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
