import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  ExtractorDefaultRouteState,
  ExtractorDiagnosticsSnapshot,
  ExtractorRequestFamily,
  ExtractorSoakFamilyState,
  ExtractorValidationGate,
  ExtractorValidationRunRequest,
} from "@/types/diagnostics";

interface DiagnosticsPanelProps {
  embedded?: boolean;
  fillHeight?: boolean;
  parityContext?: DiagnosticsParityContext;
  runbookTokens?: ExtractorValidationRunRequest;
}

const soakFamilies: Array<{ family: ExtractorRequestFamily; label: string }> = [
  { family: "media", label: "Media" },
  { family: "timeline", label: "Timeline" },
  { family: "date_range", label: "Date Range" },
  { family: "likes", label: "Likes" },
  { family: "bookmarks", label: "Bookmarks" },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatTime(parsed);
}

function formatEvidenceValue(value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "n/a";
}

function formatCompactList(values?: string[] | null): string {
  const resolvedValues = values ?? [];
  return resolvedValues.length > 0 ? resolvedValues.join(", ") : "none";
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

function emptyDefaultRouteState(): ExtractorDefaultRouteState {
  return {
    promoted: false,
    baseline_active: false,
    default_served_by_go: false,
    fallback_served_by_python: false,
    depythonization_ready: false,
  };
}

function emptySoakState(): ExtractorSoakFamilyState {
  return {
    total_requests: 0,
    go_selected_successes: 0,
    python_fallbacks: 0,
    fallback_required_count: 0,
    runtime_failures: 0,
    cursor_semantic_failures: 0,
    blocker_open: false,
  };
}

function getDefaultRouteState(
  snapshot: ExtractorDiagnosticsSnapshot | null,
  family: ExtractorRequestFamily
): ExtractorDefaultRouteState {
  return snapshot?.default_route_states?.[family] ?? emptyDefaultRouteState();
}

function getSoakFamilyState(
  snapshot: ExtractorDiagnosticsSnapshot | null,
  family: ExtractorRequestFamily
): ExtractorSoakFamilyState {
  return snapshot?.soak_family_states?.[family] ?? emptySoakState();
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
  const metrics = snapshot?.metrics;
  const recentValidationReports = snapshot?.recent_validation_reports ?? [];
  const recentLiveReports = snapshot?.recent_live_reports ?? [];
  const latestValidationReport = recentValidationReports[0];
  const latestLiveReport = recentLiveReports[0];

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
            Go-only runtime health, default-route soak evidence, and historical extractor audit records.
          </p>
        </div>

        {extractorLoadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {extractorLoadError}
          </div>
        ) : null}

        {snapshot && !snapshot.python_fallback_available ? (
          <div
            className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300"
            data-testid="diagnostics-python-fallback-status"
          >
            This is a {snapshot.python_fallback_build_flavor || "go-only"} build. Python fallback is unavailable and
            retained history is audit-only.
          </div>
        ) : null}

        {snapshot?.go_only_runtime ? (
          <div
            className="rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-700 dark:text-green-300"
            data-testid="diagnostics-go-only-runtime"
          >
            Go-only runtime is active for all supported extractor families.
          </div>
        ) : null}

        {snapshot?.python_deprecated_notice ? (
          <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-200">
            {snapshot.python_deprecated_notice}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="diagnostics-extractor-mode">
            Mode: {snapshot?.current_mode || "loading"}
          </Badge>
          {snapshot?.python_fallback_build_flavor ? (
            <Badge variant="outline" data-testid="diagnostics-build-flavor">
              Build: {snapshot.python_fallback_build_flavor}
            </Badge>
          ) : null}
          {snapshot ? (
            <Badge
              variant="outline"
              data-testid="diagnostics-python-fallback-availability"
              className={
                snapshot.python_fallback_available
                  ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
                  : "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
              }
            >
              {snapshot.python_fallback_available ? "Python fallback available" : "Python fallback unavailable"}
            </Badge>
          ) : null}
          {snapshot ? (
            <Badge variant="outline" data-testid="diagnostics-phase7-ready">
              Phase 7: {snapshot.phase7_ready ? "ready" : "not ready"}
            </Badge>
          ) : null}
          {snapshot?.phase7_cutover_version ? (
            <Badge variant="outline">Cutover: {snapshot.phase7_cutover_version}</Badge>
          ) : null}
          {snapshot?.soak_release_version ? (
            <Badge variant="outline">Soak release: {snapshot.soak_release_version}</Badge>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total requests" value={metrics?.total_requests || 0} />
          <MetricCard label="Go selected" value={metrics?.go_engine_selected || 0} />
          <MetricCard label="Fallbacks" value={metrics?.fallback_count || 0} />
          <MetricCard label="Fallback required" value={metrics?.fallback_required_count || 0} />
        </div>

        <div
          className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3"
          data-testid="diagnostics-default-soak-panel"
        >
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Default Soak
            </h3>
            <p className="text-xs text-muted-foreground">
              Real default-route traffic served by promoted Go families for release {snapshot?.soak_release_version || "dev"}.
            </p>
          </div>

          <div className="space-y-2">
            {soakFamilies.map(({ family, label }) => {
              const routeState = getDefaultRouteState(snapshot, family);
              const soakState = getSoakFamilyState(snapshot, family);
              const routeLabel = routeState.default_served_by_go
                ? "Default Go"
                : routeState.fallback_served_by_python
                  ? "Python fallback"
                  : "Not on Go";
              const note =
                routeState.last_failure_reason ||
                routeState.inactive_reason ||
                (routeState.default_served_by_go
                  ? "Serving Go by default with the current baseline."
                  : "Awaiting a valid promoted baseline for default Go.");
              const healthGate: ExtractorValidationGate = soakState.blocker_open
                ? "blocked"
                : routeState.default_served_by_go
                  ? "ready"
                  : "incomplete";
              const healthLabel = soakState.blocker_open
                ? "Blocker open"
                : routeState.default_served_by_go
                  ? "Healthy"
                  : "Pending";
              const routeTone = routeState.default_served_by_go
                ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
                : routeState.fallback_served_by_python
                  ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
                  : "border-border/60 bg-background/60 text-muted-foreground";

              return (
                <div
                  key={`default-soak-${family}`}
                  className="space-y-3 rounded-lg border border-border/60 bg-background/70 p-3"
                  data-testid={`diagnostics-default-soak-${family}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {routeState.baseline_active ? "baseline active" : "baseline inactive"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={gateTone(healthGate)}
                    >
                      {healthLabel}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={routeTone}>
                      {routeLabel}
                    </Badge>
                    <Badge variant="outline">
                      Requests {soakState.total_requests}
                    </Badge>
                    <Badge variant="outline">
                      Go ok {soakState.go_selected_successes}
                    </Badge>
                    {soakState.python_fallbacks > 0 ? (
                      <Badge variant="outline">
                        Py fallback {soakState.python_fallbacks}
                      </Badge>
                    ) : null}
                    {soakState.fallback_required_count > 0 ? (
                      <Badge variant="outline">
                        Fallback req {soakState.fallback_required_count}
                      </Badge>
                    ) : null}
                    {soakState.runtime_failures > 0 ? (
                      <Badge variant="outline">
                        Runtime fail {soakState.runtime_failures}
                      </Badge>
                    ) : null}
                    {soakState.cursor_semantic_failures > 0 ? (
                      <Badge variant="outline">
                        Cursor fail {soakState.cursor_semantic_failures}
                      </Badge>
                    ) : null}
                    <Badge variant="outline">
                      {routeState.depythonization_ready ? "depythonization ready" : "depythonization pending"}
                    </Badge>
                  </div>

                  <p
                    className="text-xs leading-relaxed text-muted-foreground"
                    data-testid={`diagnostics-default-soak-status-${family}`}
                  >
                    {note}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
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
              Historical support claims are retained for audit. Runtime is now Go-only.
            </p>
          </div>

          <div
            className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 xl:col-span-1"
            data-testid="diagnostics-history-panel"
          >
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Historical Evidence
              </h3>
              <p className="text-xs text-muted-foreground">
                Saved rollout evidence is retained for audit and support bundles. This page shows the latest summaries.
              </p>
            </div>
            <div className="space-y-2">
              <HistorySummaryCard
                title="Latest validation"
                emptyText="No saved validation runs yet."
                reportId={latestValidationReport?.report_id}
                timestamp={latestValidationReport?.created_at}
                summary={
                  latestValidationReport
                    ? `Public ${latestValidationReport.public_gate} · Private ${latestValidationReport.private_gate} · Passed ${latestValidationReport.passed_cases}/${latestValidationReport.total_cases}`
                    : undefined
                }
                configLabel={latestValidationReport?.config_updated_at}
              />
              <HistorySummaryCard
                title="Latest live validation"
                emptyText="No saved live validation sessions yet."
                reportId={latestLiveReport?.report_id}
                timestamp={latestLiveReport?.created_at}
                summary={
                  latestLiveReport
                    ? `Runtime ready ${latestLiveReport.runtime_passed_cases} · Runtime blocked ${latestLiveReport.runtime_failed_cases} · Total ${latestLiveReport.total_cases}`
                    : undefined
                }
                configLabel={latestLiveReport?.config_updated_at}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Export the support bundle to include the full rollout, soak, validation, and live evidence trail.
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function HistorySummaryCard({
  title,
  emptyText,
  reportId,
  timestamp,
  summary,
  configLabel,
}: {
  title: string;
  emptyText: string;
  reportId?: string;
  timestamp?: string;
  summary?: string;
  configLabel?: string;
}) {
  if (!reportId) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-background/60 px-3 py-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-2">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{timestamp ? formatTimestamp(timestamp) : "n/a"}</p>
      </div>
      <p className="mt-2 font-medium">{reportId}</p>
      {summary ? <p className="mt-1 text-muted-foreground">{summary}</p> : null}
      <p className="mt-2 text-muted-foreground">Config: {formatEvidenceValue(configLabel)}</p>
    </div>
  );
}
