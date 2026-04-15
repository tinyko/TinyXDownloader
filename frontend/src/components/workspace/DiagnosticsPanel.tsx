import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Copy, Check, RefreshCw, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  compareDateRangeExtractorParity,
  compareTimelineExtractorParity,
  createDatabaseBackup,
  exportSupportBundle,
  getExtractorDiagnosticsSnapshot,
  openAppDataFolder,
  restoreDatabaseBackup,
  saveExtractorRolloutPolicy,
  runExtractorLiveValidationSession,
  runExtractorValidationRunbook,
  saveExtractorRunbookConfig,
} from "@/lib/diagnostics-client";
import { logger, type LogEntry } from "@/lib/logger";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type {
  DiagnosticsParityContext,
  ExtractorDiagnosticsSnapshot,
  ExtractorFamilyGateSummary,
  ExtractorLiveValidationReportSummary,
  ExtractorPublicTrialState,
  ExtractorRecentEvent,
  ExtractorRequestFamily,
  ExtractorRolloutPolicy,
  ExtractorRunbookConfig,
  ExtractorRunbookPreset,
  ExtractorValidationGate,
  ExtractorValidationReportSummary,
  ExtractorValidationRunRequest,
} from "@/types/diagnostics";

interface DiagnosticsPanelProps {
  embedded?: boolean;
  fillHeight?: boolean;
  parityContext?: DiagnosticsParityContext;
  runbookTokens?: ExtractorValidationRunRequest;
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

function createPresetID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}`;
}

function buildRunbookPresetFromParityContext(parityContext: DiagnosticsParityContext): ExtractorRunbookPreset | null {
  if (!parityContext.enabled || !parityContext.request_kind) {
    return null;
  }

  if (parityContext.request_kind === "date_range" && parityContext.date_range_request) {
    return {
      id: createPresetID(),
      label: parityContext.summary_label,
      enabled: true,
      request_kind: "date_range",
      scope: "public",
      username: parityContext.date_range_request.username,
      media_type: parityContext.date_range_request.media_filter,
      retweets: Boolean(parityContext.date_range_request.retweets),
      start_date: parityContext.date_range_request.start_date,
      end_date: parityContext.date_range_request.end_date,
    };
  }

  if (parityContext.request_kind === "timeline" && parityContext.timeline_request) {
    const inferredScope =
      parityContext.scope ||
      (["likes", "bookmarks"].includes(parityContext.timeline_request.timeline_type) ? "private" : "public");

    return {
      id: createPresetID(),
      label: parityContext.summary_label,
      enabled: true,
      request_kind: "timeline",
      scope: inferredScope,
      username: parityContext.timeline_request.username,
      timeline_type: parityContext.timeline_request.timeline_type,
      media_type: parityContext.timeline_request.media_type,
      retweets: Boolean(parityContext.timeline_request.retweets),
    };
  }

  return null;
}

function formatPresetTarget(preset: ExtractorRunbookPreset): string {
  if (preset.request_kind === "date_range") {
    const username = preset.username ? `@${preset.username}` : "date-range";
    if (preset.start_date && preset.end_date) {
      return `${username} ${preset.start_date}..${preset.end_date} [${preset.media_type || "all"}]`;
    }
    return `${username} [${preset.media_type || "all"}]`;
  }

  if (preset.timeline_type === "bookmarks") {
    return `private bookmarks [${preset.media_type || "all"}]`;
  }
  if (preset.timeline_type === "likes") {
    return preset.username
      ? `private likes @${preset.username} [${preset.media_type || "all"}]`
      : `private likes [${preset.media_type || "all"}]`;
  }

  if (preset.username) {
    return `@${preset.username} ${preset.timeline_type || "timeline"} [${preset.media_type || "all"}]`;
  }
  return `${preset.timeline_type || preset.request_kind} [${preset.media_type || "all"}]`;
}

function gateTone(gate: ExtractorValidationGate): string {
  switch (gate) {
    case "ready":
      return "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300";
    case "blocked":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
  }
}

const publicTrialFamilies: Array<{ family: ExtractorRequestFamily; label: string }> = [
  { family: "media", label: "Media" },
  { family: "timeline", label: "Timeline" },
  { family: "date_range", label: "Date Range" },
];

function getFamilyGateSummary(
  gates:
    | ExtractorDiagnosticsSnapshot["public_family_gates"]
    | ExtractorDiagnosticsSnapshot["live_family_gates"]
    | ExtractorDiagnosticsSnapshot["promotion_family_gates"]
    | null,
  family: ExtractorRequestFamily
): ExtractorFamilyGateSummary {
  if (!gates) {
    return {
      gate: "incomplete",
      enabled_cases: 0,
      passed_cases: 0,
      mismatch_cases: 0,
      failed_cases: 0,
      invalid_cases: 0,
    };
  }
  return gates[family];
}

function getPublicTrialState(
  snapshot: ExtractorDiagnosticsSnapshot | null,
  family: ExtractorRequestFamily
): ExtractorPublicTrialState {
  if (!snapshot) {
    return { armed: false, gate: "incomplete", active: false };
  }
  return snapshot.public_trial_states[family];
}

export function DiagnosticsPanel({
  embedded = false,
  fillHeight = false,
  parityContext,
  runbookTokens,
}: DiagnosticsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>(() => logger.getLogs());
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [extractorSnapshot, setExtractorSnapshot] = useState<ExtractorDiagnosticsSnapshot | null>(null);
  const [extractorLoadError, setExtractorLoadError] = useState<string | null>(null);
  const [presetLabelDrafts, setPresetLabelDrafts] = useState<Record<string, string>>({});
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

  const loadExtractorDiagnostics = useCallback(async (quiet = false) => {
    try {
      const snapshot = await getExtractorDiagnosticsSnapshot();
      setExtractorSnapshot(snapshot);
      setExtractorLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExtractorLoadError(message);
      if (!quiet) {
        toast.error(message || "Failed to load extractor diagnostics");
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
          toast.error(message || "Failed to load extractor diagnostics");
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

  useEffect(() => {
    const presets = extractorSnapshot?.runbook_config?.presets || [];
    setPresetLabelDrafts((current) => {
      const next: Record<string, string> = {};
      for (const preset of presets) {
        next[preset.id] = current[preset.id] ?? preset.label;
      }
      return next;
    });
  }, [extractorSnapshot?.runbook_config]);

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

  const persistRunbookConfig = useCallback(
    async (nextConfig: ExtractorRunbookConfig, successMessage?: string) => {
      const savedConfig = await saveExtractorRunbookConfig(nextConfig);
      setExtractorSnapshot((current) =>
        current ? { ...current, runbook_config: savedConfig } : current
      );
      await loadExtractorDiagnostics(true);
      if (successMessage) {
        toast.success(successMessage);
      }
    },
    [loadExtractorDiagnostics]
  );

  const persistRolloutPolicy = useCallback(
    async (nextPolicy: ExtractorRolloutPolicy, successMessage?: string) => {
      const savedPolicy = await saveExtractorRolloutPolicy(nextPolicy);
      setExtractorSnapshot((current) =>
        current ? { ...current, rollout_policy: savedPolicy } : current
      );
      await loadExtractorDiagnostics(true);
      if (successMessage) {
        toast.success(successMessage);
      }
    },
    [loadExtractorDiagnostics]
  );

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

  const handleRunParity = async () => {
    if (!parityContext?.enabled || !parityContext.request_kind) {
      return;
    }

    setBusyAction("parity");
    try {
      const report =
        parityContext.request_kind === "date_range"
          ? await compareDateRangeExtractorParity(parityContext.date_range_request!)
          : await compareTimelineExtractorParity(parityContext.timeline_request!);

      if (report.equal) {
        toast.success("Extractor parity matched for the current context");
      } else {
        const diffCount = report.differences?.length ?? 0;
        toast.warning(
          diffCount > 0
            ? `Extractor parity found ${diffCount} difference(s)`
            : "Extractor parity found a mismatch"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || "Extractor parity failed");
    } finally {
      await loadExtractorDiagnostics(true);
      setBusyAction((current) => (current === "parity" ? null : current));
    }
  };

  const handleAddCurrentContext = async () => {
    const nextPreset = buildRunbookPresetFromParityContext(parityContext ?? { enabled: false, request_kind: null, summary_label: "Unavailable" });
    if (!nextPreset) {
      return;
    }

    const currentConfig = extractorSnapshot?.runbook_config ?? { presets: [] };
    await runAsyncAction("runbook-add", async () => {
      await persistRunbookConfig(
        {
          ...currentConfig,
          presets: [...currentConfig.presets, nextPreset],
        },
        "Added current context to the validation runbook"
      );
    });
  };

  const handleTogglePreset = async (presetID: string, enabled: boolean) => {
    const currentConfig = extractorSnapshot?.runbook_config;
    if (!currentConfig) {
      return;
    }

    await runAsyncAction(`runbook-toggle-${presetID}`, async () => {
      await persistRunbookConfig(
        {
          ...currentConfig,
          presets: currentConfig.presets.map((preset) =>
            preset.id === presetID ? { ...preset, enabled } : preset
          ),
        },
        enabled ? "Validation preset enabled" : "Validation preset disabled"
      );
    });
  };

  const handleDeletePreset = async (presetID: string) => {
    const currentConfig = extractorSnapshot?.runbook_config;
    if (!currentConfig) {
      return;
    }

    await runAsyncAction(`runbook-delete-${presetID}`, async () => {
      await persistRunbookConfig(
        {
          ...currentConfig,
          presets: currentConfig.presets.filter((preset) => preset.id !== presetID),
        },
        "Validation preset removed"
      );
    });
  };

  const handleSavePresetLabel = async (presetID: string) => {
    const currentConfig = extractorSnapshot?.runbook_config;
    if (!currentConfig) {
      return;
    }
    const preset = currentConfig.presets.find((candidate) => candidate.id === presetID);
    if (!preset) {
      return;
    }

    const nextLabel = (presetLabelDrafts[presetID] ?? preset.label).trim();
    const resolvedLabel = nextLabel || preset.label;
    if (resolvedLabel === preset.label) {
      setPresetLabelDrafts((current) => ({ ...current, [presetID]: resolvedLabel }));
      return;
    }

    await runAsyncAction(`runbook-rename-${presetID}`, async () => {
      await persistRunbookConfig(
        {
          ...currentConfig,
          presets: currentConfig.presets.map((candidate) =>
            candidate.id === presetID ? { ...candidate, label: resolvedLabel } : candidate
          ),
        },
        "Validation preset renamed"
      );
    });
  };

  const handleRunValidation = async () => {
    await runAsyncAction("runbook-validate", async () => {
      const report = await runExtractorValidationRunbook({
        public_auth_token: runbookTokens?.public_auth_token || "",
        private_auth_token: runbookTokens?.private_auth_token || "",
      });

      const issueCount = report.mismatch_cases + report.failed_cases + report.invalid_cases;
      if (issueCount === 0) {
        toast.success(`Validation run saved with ${report.passed_cases} passing case(s)`);
      } else {
        toast.warning(
          `Validation run saved: ${report.passed_cases} passed, ${report.mismatch_cases} mismatches, ${report.failed_cases} failed, ${report.invalid_cases} invalid`
        );
      }
      await loadExtractorDiagnostics(true);
    });
  };

  const handleRunLiveValidation = async () => {
    await runAsyncAction("runbook-live-validate", async () => {
      const report = await runExtractorLiveValidationSession({
        public_auth_token: runbookTokens?.public_auth_token || "",
        private_auth_token: runbookTokens?.private_auth_token || "",
      });

      const issueCount = report.runtime_failed_cases + report.runtime_skipped_cases;
      if (issueCount === 0) {
        toast.success(`Live validation saved with ${report.runtime_passed_cases} ready runtime case(s)`);
      } else {
        toast.warning(
          `Live validation saved: ${report.runtime_passed_cases} ready, ${report.runtime_failed_cases} blocked, ${report.runtime_skipped_cases} incomplete`
        );
      }
      await loadExtractorDiagnostics(true);
    });
  };

  const handleTogglePublicTrial = async (family: ExtractorRequestFamily, armed: boolean) => {
    const currentPolicy = extractorSnapshot?.rollout_policy;
    const currentState = extractorSnapshot ? getPublicTrialState(extractorSnapshot, family) : null;
    if (!currentPolicy || !currentState) {
      return;
    }
    if (armed && !currentState.armed && currentState.gate !== "ready") {
      toast.warning("This public family can only be armed when its gate is ready");
      return;
    }

    const nextPolicy: ExtractorRolloutPolicy = {
      ...currentPolicy,
      public_trials: {
        ...currentPolicy.public_trials,
        [family]: {
          ...currentPolicy.public_trials[family],
          armed,
        },
      },
    };

    await runAsyncAction(`public-trial-${family}`, async () => {
      await persistRolloutPolicy(
        nextPolicy,
        armed ? `${family} public trial armed` : `${family} public trial disarmed`
      );
    });
  };

  const snapshot = extractorSnapshot;
  const metrics = snapshot?.metrics;
  const recentEvents = snapshot?.recent_events || [];
  const recentParity = snapshot?.recent_parity || [];
  const runbookConfig = snapshot?.runbook_config || { presets: [] };
  const runbookPresets = runbookConfig.presets || [];
  const recentValidationReports = snapshot?.recent_validation_reports || [];
  const recentLiveReports = snapshot?.recent_live_reports || [];
  const canAddCurrentContext = Boolean(parityContext?.enabled && parityContext.request_kind);
  const canRunValidation = runbookPresets.length > 0;
  const canRunLiveValidation = runbookPresets.some(
    (preset) => preset.enabled && preset.scope === "public"
  );

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
            onClick={() => void loadExtractorDiagnostics()}
            disabled={busyAction !== null}
            className="gap-1.5"
            data-testid="diagnostics-refresh-extractor"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Extractor
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRunParity()}
            disabled={busyAction !== null || !parityContext?.enabled || !parityContext?.request_kind}
            className="gap-1.5"
            data-testid="diagnostics-run-parity"
          >
            Run Parity
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
          <Button variant="outline" size="sm" onClick={handleClear} className="gap-1.5">
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <section
        className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm"
        data-testid="diagnostics-extractor-panel"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Extractor</h2>
            <p className="text-xs text-muted-foreground">
              Current Go rollout readiness, parity, fallback diagnostics, and validation runbook.
            </p>
          </div>
          <div className="space-y-1 text-left lg:max-w-md lg:text-right">
            <p className="text-xs font-medium text-foreground" data-testid="diagnostics-parity-context">
              Current parity context: {parityContext?.summary_label || "Unavailable"}
            </p>
            {!parityContext?.enabled && parityContext?.disabled_reason ? (
              <p className="text-xs text-muted-foreground">{parityContext.disabled_reason}</p>
            ) : null}
          </div>
        </div>

        {extractorLoadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {extractorLoadError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="diagnostics-extractor-mode">
            Mode: {snapshot?.current_mode || "loading"}
          </Badge>
          {snapshot?.private_auto_pinned ? (
            <Badge
              variant="outline"
              className="border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
            >
              Private auto pinned
            </Badge>
          ) : null}
          {metrics?.parity_mismatches ? (
            <Badge
              variant="outline"
              className="border-destructive/40 bg-destructive/10 text-destructive"
            >
              Parity mismatches: {metrics.parity_mismatches.toLocaleString()}
            </Badge>
          ) : null}
          {metrics ? (
            <Badge variant="outline">Fallbacks: {metrics.fallback_count.toLocaleString()}</Badge>
          ) : null}
          {metrics ? (
            <Badge variant="outline">
              Fallback required: {metrics.fallback_required_count.toLocaleString()}
            </Badge>
          ) : null}
          {metrics?.rollout_trial_requests ? (
            <Badge variant="outline">
              Trial requests: {metrics.rollout_trial_requests.toLocaleString()}
            </Badge>
          ) : null}
        </div>

        {snapshot ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Total requests" value={metrics?.total_requests || 0} />
              <MetricCard label="Go selected" value={metrics?.go_engine_selected || 0} />
              <MetricCard label="Python selected" value={metrics?.python_engine_selected || 0} />
              <MetricCard label="Parity runs" value={metrics?.parity_comparisons || 0} />
              <MetricCard label="Trial requests" value={metrics?.rollout_trial_requests || 0} />
              <MetricCard label="Trial bypass" value={metrics?.rollout_trial_python_bypass || 0} />
              <MetricCard label="Trial go selected" value={metrics?.rollout_trial_go_selected || 0} />
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3" data-testid="diagnostics-runbook-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Validation Runbook
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Capture parity-eligible contexts into a reusable rollout matrix and save validation reports.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <GateBadge scope="Public" gate={snapshot.public_gate} />
                  <GateBadge scope="Private" gate={snapshot.private_gate} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddCurrentContext()}
                    disabled={busyAction !== null || !canAddCurrentContext}
                    className="gap-1.5"
                    data-testid="diagnostics-add-current-context"
                  >
                    <Plus className="h-4 w-4" />
                    Add Current Context
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleRunValidation()}
                    disabled={busyAction !== null || !canRunValidation}
                    className="gap-1.5"
                    data-testid="diagnostics-run-validation"
                  >
                    Run Validation
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">
                      Presets ({runbookPresets.length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Stored in app data and included in support bundles.
                    </p>
                  </div>
                  <div className="space-y-2" data-testid="diagnostics-runbook-presets">
                    {runbookPresets.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                        No validation presets yet. Add the current parity context to start building a rollout matrix.
                      </p>
                    ) : (
                      runbookPresets.map((preset) => {
                        const labelDraft = presetLabelDrafts[preset.id] ?? preset.label;
                        const labelChanged = labelDraft.trim() !== preset.label;
                        return (
                          <div
                            key={preset.id}
                            className="rounded-lg border border-border/60 bg-background/70 p-3"
                            data-testid={`diagnostics-runbook-preset-${preset.id}`}
                          >
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0 flex-1 space-y-2">
                                  <Input
                                    value={labelDraft}
                                    onChange={(event) =>
                                      setPresetLabelDrafts((current) => ({
                                        ...current,
                                        [preset.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Preset label"
                                    className="h-8 text-sm"
                                    data-testid={`diagnostics-runbook-label-${preset.id}`}
                                  />
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="outline">{preset.scope}</Badge>
                                    <Badge variant="outline">{preset.request_kind}</Badge>
                                    {preset.timeline_type ? (
                                      <Badge variant="outline">{preset.timeline_type}</Badge>
                                    ) : null}
                                    {preset.media_type ? (
                                      <Badge variant="outline">{preset.media_type}</Badge>
                                    ) : null}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {formatPresetTarget(preset)}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={preset.enabled}
                                      onCheckedChange={(value) =>
                                        void handleTogglePreset(preset.id, Boolean(value))
                                      }
                                      disabled={busyAction !== null}
                                      data-testid={`diagnostics-runbook-toggle-${preset.id}`}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      {preset.enabled ? "Enabled" : "Disabled"}
                                    </span>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleSavePresetLabel(preset.id)}
                                    disabled={busyAction !== null || !labelChanged}
                                    data-testid={`diagnostics-runbook-save-${preset.id}`}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleDeletePreset(preset.id)}
                                    disabled={busyAction !== null}
                                    data-testid={`diagnostics-runbook-delete-${preset.id}`}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">Recent Validation Reports</p>
                    <p className="text-xs text-muted-foreground">
                      Latest saved rollout evidence from app data.
                    </p>
                  </div>
                  <div className="space-y-2" data-testid="diagnostics-validation-reports">
                    {recentValidationReports.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                        No saved validation runs yet.
                      </p>
                    ) : (
                      recentValidationReports.slice(0, 6).map((report) => (
                        <ValidationReportRow key={report.report_id} report={report} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3" data-testid="diagnostics-live-validation-panel">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Live Validation
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Run release-grade runtime plus parity validation against the enabled public runbook presets.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <GateBadge scope="Media live" gate={snapshot.live_family_gates.media.gate} />
                  <GateBadge scope="Timeline live" gate={snapshot.live_family_gates.timeline.gate} />
                  <GateBadge scope="Date Range live" gate={snapshot.live_family_gates.date_range.gate} />
                  <Button
                    size="sm"
                    onClick={() => void handleRunLiveValidation()}
                    disabled={busyAction !== null || !canRunLiveValidation}
                    className="gap-1.5"
                    data-testid="diagnostics-run-live-validation"
                  >
                    Run Live Validation
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3">
                  <div className="grid gap-3 xl:grid-cols-3">
                    {publicTrialFamilies.map(({ family, label }) => {
                      const parityGate = getFamilyGateSummary(snapshot.public_family_gates, family);
                      const liveGate = getFamilyGateSummary(snapshot.live_family_gates, family);
                      const promotionGate = getFamilyGateSummary(snapshot.promotion_family_gates, family);

                      return (
                        <div
                          key={`live-family-${family}`}
                          className="rounded-lg border border-border/60 bg-background/70 p-3"
                          data-testid={`diagnostics-live-family-${family}`}
                        >
                          <p className="text-sm font-medium">{label}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <GateBadge scope={`${label} parity`} gate={parityGate.gate} />
                            <GateBadge scope={`${label} live`} gate={liveGate.gate} />
                            <GateBadge scope={`${label} promotion`} gate={promotionGate.gate} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
                            <Badge variant="outline">enabled {promotionGate.enabled_cases}</Badge>
                            <Badge variant="outline">live pass {liveGate.passed_cases}</Badge>
                            <Badge variant="outline">live blocked {liveGate.failed_cases}</Badge>
                            <Badge variant="outline">live skipped {liveGate.invalid_cases}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">Recent Live Sessions</p>
                    <p className="text-xs text-muted-foreground">
                      Latest saved runtime evidence from app data.
                    </p>
                  </div>
                  <div className="space-y-2" data-testid="diagnostics-live-reports">
                    {recentLiveReports.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
                        No saved live validation sessions yet.
                      </p>
                    ) : (
                      recentLiveReports.slice(0, 6).map((report) => (
                        <LiveValidationReportRow key={report.report_id} report={report} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3" data-testid="diagnostics-public-trial-panel">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Public Trial
                </h3>
                <p className="text-xs text-muted-foreground">
                  Arm request-family trials only when rollout evidence is ready. Private requests remain pinned to Python.
                </p>
              </div>
              <div className="grid gap-3 xl:grid-cols-3">
                {publicTrialFamilies.map(({ family, label }) => {
                  const familyGate = getFamilyGateSummary(snapshot.public_family_gates, family);
                  const promotionGate = getFamilyGateSummary(snapshot.promotion_family_gates, family);
                  const trialState = getPublicTrialState(snapshot, family);
                  const canArm = trialState.armed || familyGate.gate === "ready";
                  const statusBadges = [
                    <Badge key={`${family}-armed`} variant="outline">
                      {trialState.armed ? "armed" : "disarmed"}
                    </Badge>,
                    <Badge key={`${family}-active`} variant="outline">
                      {trialState.active ? "trial active" : "trial inactive"}
                    </Badge>,
                    <Badge key={`${family}-promotion`} variant="outline">
                      promotion {promotionGate.gate}
                    </Badge>,
                  ];

                  return (
                    <div
                      key={family}
                      className="rounded-lg border border-border/60 bg-background/70 p-3"
                      data-testid={`diagnostics-public-trial-${family}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{label}</p>
                          <GateBadge scope={label} gate={familyGate.gate} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={trialState.armed}
                            onCheckedChange={(value) =>
                              void handleTogglePublicTrial(family, Boolean(value))
                            }
                            disabled={busyAction !== null || (!trialState.armed && !canArm)}
                            data-testid={`diagnostics-public-trial-toggle-${family}`}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">{statusBadges}</div>

                      <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
                        <Badge variant="outline">enabled {familyGate.enabled_cases}</Badge>
                        <Badge variant="outline">pass {familyGate.passed_cases}</Badge>
                        <Badge variant="outline">mismatch {familyGate.mismatch_cases}</Badge>
                        <Badge variant="outline">failed {familyGate.failed_cases}</Badge>
                        <Badge variant="outline">invalid {familyGate.invalid_cases}</Badge>
                      </div>

                      {trialState.inactive_reason ? (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          data-testid={`diagnostics-public-trial-status-${family}`}
                        >
                          {trialState.inactive_reason}
                        </p>
                      ) : trialState.active ? (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          data-testid={`diagnostics-public-trial-status-${family}`}
                        >
                          This family is currently active for python-default runtime requests.
                        </p>
                      ) : promotionGate.gate === "ready" ? (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          data-testid={`diagnostics-public-trial-status-${family}`}
                        >
                          Promotion ready. You can arm this family when you want to trial the public auto path.
                        </p>
                      ) : (
                        <p
                          className="mt-2 text-xs text-muted-foreground"
                          data-testid={`diagnostics-public-trial-status-${family}`}
                        >
                          Promotion not ready yet. Keep using parity and live validation until this family is clear.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Support Matrix
                </h3>
                <SupportRow label="Public media" values={snapshot.support_matrix.public_media_types} />
                <SupportRow label="Public timeline" values={snapshot.support_matrix.public_timeline_types} />
                <SupportRow label="Timeline media" values={snapshot.support_matrix.public_timeline_media_types} />
                <SupportRow label="Date range" values={snapshot.support_matrix.public_date_range_media_filters} />
                <SupportRow label="Private explicit-go" values={snapshot.support_matrix.private_explicit_go_timeline_types} />
                <SupportRow label="Private auto pinned" values={snapshot.support_matrix.private_auto_pinned_timeline_types} />
                <p className="text-xs text-muted-foreground">
                  {snapshot.private_auto_pinned_reason || "Private auto rollout remains informational in this phase."}
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Recent Events
                </h3>
                <div className="space-y-2" data-testid="diagnostics-recent-events">
                  {recentEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No extractor events yet.</p>
                  ) : (
                    recentEvents.slice(0, 6).map((event, index) => (
                      <EventRow key={`${event.timestamp}-${event.event}-${index}`} event={event} />
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Recent Parity
                </h3>
                <div className="space-y-2" data-testid="diagnostics-recent-parity">
                  {recentParity.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No parity reports yet.</p>
                  ) : (
                    recentParity.slice(0, 6).map((entry, index) => (
                      <div
                        key={`${entry.timestamp}-${entry.target}-${index}`}
                        className="rounded-lg border border-border/60 bg-background/70 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{entry.target}</p>
                          <Badge variant={entry.equal ? "secondary" : "outline"}>
                            {entry.equal ? "match" : "diff"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {formatTimestamp(entry.timestamp)} · {entry.request_kind} · diffs {entry.diff_count}
                        </p>
                        {entry.first_difference ? (
                          <p className="mt-1 break-words text-muted-foreground">{entry.first_difference}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Loading extractor diagnostics...
          </div>
        )}
      </section>

      <div
        ref={scrollRef}
        className={
          embedded
            ? fillHeight
              ? "min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
              : "h-72 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs"
            : "h-[calc(100vh-220px)] overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-xs"
        }
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground lowercase">no logs yet...</p>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-muted-foreground">[{formatTime(log.timestamp)}]</span>
              <span className={`shrink-0 w-16 ${levelColors[log.level]}`}>[{log.level}]</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function SupportRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 ? (
          <Badge variant="outline">none</Badge>
        ) : (
          values.map((value) => (
            <Badge key={`${label}-${value}`} variant="outline">
              {value}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: ExtractorRecentEvent }) {
  const hasCursorPresence = Object.prototype.hasOwnProperty.call(event, "cursor_present");
  const secondaryParts = [
    event.request_kind,
    event.request_family,
    event.timeline_type,
    event.effective_mode ? `effective ${event.effective_mode}` : "",
    event.configured_mode && event.configured_mode !== event.effective_mode
      ? `configured ${event.configured_mode}`
      : "",
    event.mode_source,
    event.selected_engine,
    event.auth_mode,
  ].filter(Boolean);

  const detailParts = [
    event.fallback_code ? `fallback ${event.fallback_code}` : "",
    event.fallback_reason || "",
    hasCursorPresence ? `cursor ${event.cursor_present ? "yes" : "no"}` : "",
    event.page_count ? `pages ${event.page_count}` : "",
    event.tweet_count ? `tweets ${event.tweet_count}` : "",
    event.page_item_count ? `page ${event.page_item_count}` : "",
    event.media_item_count ? `media ${event.media_item_count}` : "",
    event.text_item_count ? `text ${event.text_item_count}` : "",
    event.trial_armed ? `trial ${event.trial_active ? "active" : "armed"}` : "",
    event.partial_parse ? "partial parse" : "",
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium">{event.request_target || event.event}</p>
        <Badge variant={event.success ? "secondary" : "outline"}>
          {event.success ? "ok" : "issue"}
        </Badge>
      </div>
      <p className="mt-1 text-muted-foreground">
        {formatTimestamp(event.timestamp)}
        {secondaryParts.length > 0 ? ` · ${secondaryParts.join(" · ")}` : ""}
      </p>
      {detailParts.length > 0 ? (
        <p className="mt-1 break-words text-muted-foreground">{detailParts.join(" · ")}</p>
      ) : null}
      {!event.success && event.error ? (
        <p className="mt-1 break-words text-destructive/90">{event.error}</p>
      ) : null}
    </div>
  );
}

function GateBadge({
  scope,
  gate,
}: {
  scope: string;
  gate: ExtractorValidationGate;
}) {
  return (
    <Badge
      variant="outline"
      className={gateTone(gate)}
      data-testid={`diagnostics-${scope.toLowerCase().replace(/\s+/g, "-")}-gate`}
    >
      {scope} gate: {gate}
    </Badge>
  );
}

function ValidationReportRow({ report }: { report: ExtractorValidationReportSummary }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-medium">{report.report_id}</p>
          <p className="text-muted-foreground">{formatTimestamp(report.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GateBadge scope="Public" gate={report.public_gate} />
          <GateBadge scope="Private" gate={report.private_gate} />
          <GateBadge scope="Media" gate={report.public_family_gates.media.gate} />
          <GateBadge scope="Timeline" gate={report.public_family_gates.timeline.gate} />
          <GateBadge scope="Date Range" gate={report.public_family_gates.date_range.gate} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
        <Badge variant="outline">pass {report.passed_cases}</Badge>
        <Badge variant="outline">mismatch {report.mismatch_cases}</Badge>
        <Badge variant="outline">failed {report.failed_cases}</Badge>
        <Badge variant="outline">invalid {report.invalid_cases}</Badge>
        <Badge variant="outline">total {report.total_cases}</Badge>
      </div>
    </div>
  );
}

function LiveValidationReportRow({ report }: { report: ExtractorLiveValidationReportSummary }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-medium">{report.report_id}</p>
          <p className="text-muted-foreground">{formatTimestamp(report.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GateBadge scope="Media live" gate={report.live_family_gates.media.gate} />
          <GateBadge scope="Timeline live" gate={report.live_family_gates.timeline.gate} />
          <GateBadge scope="Date Range live" gate={report.live_family_gates.date_range.gate} />
          <GateBadge scope="Media promotion" gate={report.promotion_family_gates.media.gate} />
          <GateBadge scope="Timeline promotion" gate={report.promotion_family_gates.timeline.gate} />
          <GateBadge scope="Date Range promotion" gate={report.promotion_family_gates.date_range.gate} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
        <Badge variant="outline">runtime ready {report.runtime_passed_cases}</Badge>
        <Badge variant="outline">runtime blocked {report.runtime_failed_cases}</Badge>
        <Badge variant="outline">runtime skipped {report.runtime_skipped_cases}</Badge>
        <Badge variant="outline">total {report.total_cases}</Badge>
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatTime(parsed);
}
