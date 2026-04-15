import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "@/components/workspace/DiagnosticsPanel";
import type {
  DiagnosticsParityContext,
  ExtractorDiagnosticsSnapshot,
  ExtractorLiveValidationReport,
  ExtractorParityReport,
  ExtractorRolloutPolicy,
  ExtractorRunbookConfig,
  ExtractorValidationReport,
} from "@/types/diagnostics";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createBaseSnapshot(): ExtractorDiagnosticsSnapshot {
  return {
    current_mode: "auto",
    private_auto_pinned: true,
    private_auto_pinned_reason: "go private timeline extraction remains pinned to python in auto mode",
    support_matrix: {
      public_media_types: ["all", "image", "video", "gif"],
      public_timeline_types: ["timeline", "tweets", "with_replies"],
      public_timeline_media_types: ["all", "image", "video", "gif", "text"],
      public_date_range_media_filters: ["all", "image", "video", "gif", "text"],
      private_explicit_go_timeline_types: ["likes", "bookmarks"],
      private_explicit_go_media_types: ["all", "image", "video", "gif", "text"],
      private_auto_pinned_timeline_types: ["likes", "bookmarks"],
      raw_search_timeline_supported: false,
    },
    metrics: {
      total_requests: 12,
      python_mode_requests: 5,
      go_mode_requests: 4,
      auto_mode_requests: 3,
      python_engine_selected: 7,
      go_engine_selected: 5,
      fallback_count: 2,
      unsupported_count: 1,
      fallback_required_count: 1,
      parity_comparisons: 3,
      parity_mismatches: 1,
      rollout_trial_requests: 2,
      rollout_trial_python_bypass: 1,
      rollout_trial_go_selected: 1,
    },
    runbook_config: {
      updated_at: "2026-04-15T06:09:00Z",
      presets: [
        {
          id: "preset-bookmarks",
          label: "Private bookmarks · text",
          enabled: true,
          request_kind: "timeline",
          scope: "private",
          username: "",
          timeline_type: "bookmarks",
          media_type: "text",
          retweets: false,
        },
      ],
    },
    rollout_policy: {
      updated_at: "2026-04-15T06:11:00Z",
      public_trials: {
        media: { armed: false },
        timeline: { armed: true, armed_at: "2026-04-15T06:11:00Z", updated_at: "2026-04-15T06:11:00Z" },
        date_range: { armed: false },
      },
    },
    recent_validation_reports: [
      {
        report_id: "report-001",
        created_at: "2026-04-15T06:10:00Z",
        config_updated_at: "2026-04-15T06:09:00Z",
        total_cases: 1,
        passed_cases: 1,
        mismatch_cases: 0,
        failed_cases: 0,
        invalid_cases: 0,
        public_gate: "incomplete",
        private_gate: "ready",
        public_family_gates: {
          media: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 0, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
      },
    ],
    recent_live_reports: [
      {
        report_id: "live-001",
        created_at: "2026-04-15T06:12:00Z",
        config_updated_at: "2026-04-15T06:09:00Z",
        total_cases: 1,
        runtime_passed_cases: 0,
        runtime_failed_cases: 1,
        runtime_skipped_cases: 0,
        parity_family_gates: {
          media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 0, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        live_family_gates: {
          media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 0, failed_cases: 1, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        promotion_family_gates: {
          media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 1, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
      },
    ],
    public_gate: "incomplete",
    private_gate: "ready",
    public_family_gates: {
      media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 0, invalid_cases: 0 },
      date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    live_family_gates: {
      media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 0, failed_cases: 1, invalid_cases: 0 },
      date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    promotion_family_gates: {
      media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 1, invalid_cases: 0 },
      date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    public_trial_states: {
      media: { armed: false, gate: "ready", active: false },
      timeline: {
        armed: true,
        armed_at: "2026-04-15T06:11:00Z",
        updated_at: "2026-04-15T06:11:00Z",
        gate: "blocked",
        active: false,
        inactive_reason: "armed but inactive because the family gate is blocked",
      },
      date_range: { armed: false, gate: "incomplete", active: false },
    },
    recent_events: [
      {
        timestamp: "2026-04-15T06:07:08Z",
        event: "x_private_bookmarks_request",
        request_kind: "timeline",
        request_target: "private bookmarks [text]",
        timeline_type: "bookmarks",
        media_type: "text",
        configured_mode: "python",
        effective_mode: "python",
        mode_source: "env",
        success: false,
        fallback_code: "missing_cursor",
        auth_mode: "auth",
        text_item_count: 12,
      },
    ],
    recent_parity: [
      {
        timestamp: "2026-04-15T06:08:09Z",
        request_kind: "timeline",
        target: "private bookmarks [text]",
        go_supported: true,
        python_success: true,
        go_success: false,
        equal: false,
        diff_count: 1,
        first_difference: "go engine error: missing cursor",
      },
    ],
  };
}

const diagnosticsClientMocks = vi.hoisted(() => {
  const matchingReport: ExtractorParityReport = {
    request_kind: "timeline",
    python_engine: "python-gallery-dl",
    go_engine: "go-twitter",
    go_supported: true,
    python_success: true,
    go_success: true,
    equal: true,
    differences: [],
  };

  let currentSnapshot = createBaseSnapshot();

  return {
    resetSnapshot: () => {
      currentSnapshot = createBaseSnapshot();
    },
    setSnapshot: (snapshot: ExtractorDiagnosticsSnapshot) => {
      currentSnapshot = clone(snapshot);
    },
    getSnapshot: () => clone(currentSnapshot),
    getExtractorDiagnosticsSnapshot: vi.fn(async () => clone(currentSnapshot)),
    compareTimelineExtractorParity: vi.fn(async () => clone(matchingReport)),
    compareDateRangeExtractorParity: vi.fn(async () =>
      clone({ ...matchingReport, request_kind: "date_range" })
    ),
    saveExtractorRunbookConfig: vi.fn(async (config: ExtractorRunbookConfig) => {
      currentSnapshot = {
        ...currentSnapshot,
        runbook_config: {
          ...clone(config),
          updated_at: "2026-04-15T06:20:00Z",
        },
      };
      return clone(currentSnapshot.runbook_config);
    }),
    saveExtractorRolloutPolicy: vi.fn(async (policy: ExtractorRolloutPolicy) => {
      const nextPolicy = clone(policy);
      currentSnapshot = {
        ...currentSnapshot,
        rollout_policy: {
          ...nextPolicy,
          updated_at: "2026-04-15T06:20:30Z",
        },
        public_trial_states: {
          media: {
            ...currentSnapshot.public_trial_states.media,
            ...nextPolicy.public_trials.media,
            gate: currentSnapshot.public_family_gates.media.gate,
            active: Boolean(nextPolicy.public_trials.media.armed) && currentSnapshot.public_family_gates.media.gate === "ready",
            inactive_reason:
              nextPolicy.public_trials.media.armed && currentSnapshot.public_family_gates.media.gate !== "ready"
                ? "armed but inactive because the family gate is not ready"
                : undefined,
          },
          timeline: {
            ...currentSnapshot.public_trial_states.timeline,
            ...nextPolicy.public_trials.timeline,
            gate: currentSnapshot.public_family_gates.timeline.gate,
            active: Boolean(nextPolicy.public_trials.timeline.armed) && currentSnapshot.public_family_gates.timeline.gate === "ready",
            inactive_reason:
              nextPolicy.public_trials.timeline.armed && currentSnapshot.public_family_gates.timeline.gate !== "ready"
                ? "armed but inactive because the family gate is blocked"
                : undefined,
          },
          date_range: {
            ...currentSnapshot.public_trial_states.date_range,
            ...nextPolicy.public_trials.date_range,
            gate: currentSnapshot.public_family_gates.date_range.gate,
            active: Boolean(nextPolicy.public_trials.date_range.armed) && currentSnapshot.public_family_gates.date_range.gate === "ready",
            inactive_reason:
              nextPolicy.public_trials.date_range.armed && currentSnapshot.public_family_gates.date_range.gate !== "ready"
                ? "armed but inactive because the family gate is not ready"
                : undefined,
          },
        },
      };
      return clone(currentSnapshot.rollout_policy);
    }),
    runExtractorValidationRunbook: vi.fn(async () => {
      const report: ExtractorValidationReport = {
        report_id: "report-002",
        created_at: "2026-04-15T06:21:00Z",
        config_updated_at: currentSnapshot.runbook_config.updated_at,
        total_cases: currentSnapshot.runbook_config.presets.length,
        passed_cases: currentSnapshot.runbook_config.presets.length,
        mismatch_cases: 0,
        failed_cases: 0,
        invalid_cases: 0,
        public_gate: currentSnapshot.runbook_config.presets.some((preset) => preset.scope === "public")
          ? "ready"
          : "incomplete",
        private_gate: currentSnapshot.runbook_config.presets.some((preset) => preset.scope === "private")
          ? "ready"
          : "incomplete",
        public_family_gates: {
          media: {
            gate: currentSnapshot.runbook_config.presets.some(
              (preset) => preset.scope === "public" && preset.request_kind === "timeline" && preset.timeline_type === "media"
            )
              ? "ready"
              : "incomplete",
            enabled_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) => preset.scope === "public" && preset.request_kind === "timeline" && preset.timeline_type === "media"
            ).length,
            passed_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) => preset.scope === "public" && preset.request_kind === "timeline" && preset.timeline_type === "media"
            ).length,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          timeline: {
            gate: currentSnapshot.runbook_config.presets.some(
              (preset) =>
                preset.scope === "public" &&
                preset.request_kind === "timeline" &&
                ["timeline", "tweets", "with_replies"].includes(preset.timeline_type || "")
            )
              ? "ready"
              : "incomplete",
            enabled_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) =>
                preset.scope === "public" &&
                preset.request_kind === "timeline" &&
                ["timeline", "tweets", "with_replies"].includes(preset.timeline_type || "")
            ).length,
            passed_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) =>
                preset.scope === "public" &&
                preset.request_kind === "timeline" &&
                ["timeline", "tweets", "with_replies"].includes(preset.timeline_type || "")
            ).length,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          date_range: {
            gate: currentSnapshot.runbook_config.presets.some(
              (preset) => preset.scope === "public" && preset.request_kind === "date_range"
            )
              ? "ready"
              : "incomplete",
            enabled_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) => preset.scope === "public" && preset.request_kind === "date_range"
            ).length,
            passed_cases: currentSnapshot.runbook_config.presets.filter(
              (preset) => preset.scope === "public" && preset.request_kind === "date_range"
            ).length,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
        },
        app_version: "1.2.3",
        engine_mode: "auto",
        diagnostics: {
          current_mode: "auto",
          private_auto_pinned: true,
          private_auto_pinned_reason: "go private timeline extraction remains pinned to python in auto mode",
          support_matrix: currentSnapshot.support_matrix,
          metrics: currentSnapshot.metrics,
        },
        cases: [],
      };

      currentSnapshot = {
        ...currentSnapshot,
        public_gate: report.public_gate,
        private_gate: report.private_gate,
        recent_validation_reports: [
          {
            report_id: report.report_id,
            created_at: report.created_at,
            config_updated_at: report.config_updated_at,
            total_cases: report.total_cases,
            passed_cases: report.passed_cases,
            mismatch_cases: report.mismatch_cases,
            failed_cases: report.failed_cases,
            invalid_cases: report.invalid_cases,
            public_gate: report.public_gate,
            private_gate: report.private_gate,
            public_family_gates: report.public_family_gates,
          },
          ...currentSnapshot.recent_validation_reports,
        ].slice(0, 10),
      };
      return clone(report);
    }),
    runExtractorLiveValidationSession: vi.fn(async () => {
      const publicMediaEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) =>
          preset.enabled &&
          preset.scope === "public" &&
          preset.request_kind === "timeline" &&
          preset.timeline_type === "media"
      ).length;
      const publicTimelineEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) =>
          preset.enabled &&
          preset.scope === "public" &&
          preset.request_kind === "timeline" &&
          ["timeline", "tweets", "with_replies"].includes(preset.timeline_type || "")
      ).length;
      const publicDateRangeEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) => preset.enabled && preset.scope === "public" && preset.request_kind === "date_range"
      ).length;

      const report: ExtractorLiveValidationReport = {
        report_id: "live-002",
        created_at: "2026-04-15T06:22:00Z",
        config_updated_at: currentSnapshot.runbook_config.updated_at,
        total_cases: currentSnapshot.runbook_config.presets.filter((preset) => preset.enabled).length,
        runtime_passed_cases: publicMediaEnabled + publicTimelineEnabled + publicDateRangeEnabled,
        runtime_failed_cases: 0,
        runtime_skipped_cases: currentSnapshot.runbook_config.presets.filter(
          (preset) => preset.enabled && preset.scope !== "public"
        ).length,
        parity_family_gates: currentSnapshot.public_family_gates,
        live_family_gates: {
          media: {
            gate: publicMediaEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: publicMediaEnabled,
            passed_cases: publicMediaEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          timeline: {
            gate: publicTimelineEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: publicTimelineEnabled,
            passed_cases: publicTimelineEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          date_range: {
            gate: publicDateRangeEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: publicDateRangeEnabled,
            passed_cases: publicDateRangeEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
        },
        promotion_family_gates: {
          media: {
            gate: publicMediaEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: publicMediaEnabled,
            passed_cases: publicMediaEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          timeline: {
            gate:
              publicTimelineEnabled > 0 && currentSnapshot.public_family_gates.timeline.gate === "ready"
                ? "ready"
                : publicTimelineEnabled > 0
                  ? "blocked"
                  : "incomplete",
            enabled_cases: publicTimelineEnabled,
            passed_cases:
              publicTimelineEnabled > 0 && currentSnapshot.public_family_gates.timeline.gate === "ready"
                ? publicTimelineEnabled
                : 0,
            mismatch_cases:
              publicTimelineEnabled > 0 && currentSnapshot.public_family_gates.timeline.gate !== "ready"
                ? 1
                : 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          date_range: {
            gate:
              publicDateRangeEnabled > 0 && currentSnapshot.public_family_gates.date_range.gate === "ready"
                ? "ready"
                : publicDateRangeEnabled > 0
                  ? "blocked"
                  : "incomplete",
            enabled_cases: publicDateRangeEnabled,
            passed_cases:
              publicDateRangeEnabled > 0 && currentSnapshot.public_family_gates.date_range.gate === "ready"
                ? publicDateRangeEnabled
                : 0,
            mismatch_cases:
              publicDateRangeEnabled > 0 && currentSnapshot.public_family_gates.date_range.gate !== "ready"
                ? 1
                : 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
        },
        app_version: "1.2.3",
        engine_mode: "auto",
        diagnostics: {
          current_mode: "auto",
          private_auto_pinned: true,
          private_auto_pinned_reason: "go private timeline extraction remains pinned to python in auto mode",
          support_matrix: currentSnapshot.support_matrix,
          metrics: currentSnapshot.metrics,
        },
        cases: [],
      };

      currentSnapshot = {
        ...currentSnapshot,
        live_family_gates: report.live_family_gates,
        promotion_family_gates: report.promotion_family_gates,
        recent_live_reports: [
          {
            report_id: report.report_id,
            created_at: report.created_at,
            config_updated_at: report.config_updated_at,
            total_cases: report.total_cases,
            runtime_passed_cases: report.runtime_passed_cases,
            runtime_failed_cases: report.runtime_failed_cases,
            runtime_skipped_cases: report.runtime_skipped_cases,
            parity_family_gates: report.parity_family_gates,
            live_family_gates: report.live_family_gates,
            promotion_family_gates: report.promotion_family_gates,
          },
          ...currentSnapshot.recent_live_reports,
        ].slice(0, 10),
      };
      return clone(report);
    }),
    createDatabaseBackup: vi.fn(async () => ""),
    exportSupportBundle: vi.fn(async () => ""),
    openAppDataFolder: vi.fn(async () => {}),
    restoreDatabaseBackup: vi.fn(async () => ({
      success: false,
      requires_restart: false,
      message: "Cancelled",
    })),
  };
});

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@/lib/diagnostics-client", () => ({
  getExtractorDiagnosticsSnapshot: diagnosticsClientMocks.getExtractorDiagnosticsSnapshot,
  compareTimelineExtractorParity: diagnosticsClientMocks.compareTimelineExtractorParity,
  compareDateRangeExtractorParity: diagnosticsClientMocks.compareDateRangeExtractorParity,
  saveExtractorRunbookConfig: diagnosticsClientMocks.saveExtractorRunbookConfig,
  saveExtractorRolloutPolicy: diagnosticsClientMocks.saveExtractorRolloutPolicy,
  runExtractorValidationRunbook: diagnosticsClientMocks.runExtractorValidationRunbook,
  runExtractorLiveValidationSession: diagnosticsClientMocks.runExtractorLiveValidationSession,
  createDatabaseBackup: diagnosticsClientMocks.createDatabaseBackup,
  exportSupportBundle: diagnosticsClientMocks.exportSupportBundle,
  openAppDataFolder: diagnosticsClientMocks.openAppDataFolder,
  restoreDatabaseBackup: diagnosticsClientMocks.restoreDatabaseBackup,
}));

vi.mock("@/lib/toast-with-sound", () => ({
  toastWithSound: toastMocks,
}));

function createTimelineParityContext(
  overrides: Partial<DiagnosticsParityContext> = {}
): DiagnosticsParityContext {
  return {
    enabled: true,
    request_kind: "timeline",
    scope: "private",
    summary_label: "Private bookmarks · text",
    timeline_request: {
      username: "",
      auth_token: "private-token",
      timeline_type: "bookmarks",
      batch_size: 0,
      page: 0,
      media_type: "text",
      retweets: false,
    },
    ...overrides,
  };
}

describe("DiagnosticsPanel", () => {
  beforeEach(() => {
    diagnosticsClientMocks.resetSnapshot();
    diagnosticsClientMocks.getExtractorDiagnosticsSnapshot.mockClear();
    diagnosticsClientMocks.compareTimelineExtractorParity.mockClear();
    diagnosticsClientMocks.compareDateRangeExtractorParity.mockClear();
    diagnosticsClientMocks.saveExtractorRunbookConfig.mockClear();
    diagnosticsClientMocks.saveExtractorRolloutPolicy.mockClear();
    diagnosticsClientMocks.runExtractorValidationRunbook.mockClear();
    diagnosticsClientMocks.runExtractorLiveValidationSession.mockClear();
    toastMocks.success.mockClear();
    toastMocks.warning.mockClear();
    toastMocks.error.mockClear();
  });

  it("renders extractor diagnostics, runbook gates, and recent reports", async () => {
    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-extractor-mode").textContent).toContain("Mode: auto");
    });

    expect(
      screen
        .getAllByTestId("diagnostics-private-gate")
        .some((element) => element.textContent?.includes("Private gate: ready"))
    ).toBe(true);
    expect(
      screen
        .getAllByTestId("diagnostics-public-gate")
        .some((element) => element.textContent?.includes("Public gate: incomplete"))
    ).toBe(true);
    expect(
      (screen.getByTestId("diagnostics-runbook-label-preset-bookmarks") as HTMLInputElement).value
    ).toBe("Private bookmarks · text");
    expect(screen.getByTestId("diagnostics-validation-reports").textContent).toContain("report-001");
    expect(screen.getByTestId("diagnostics-live-reports").textContent).toContain("live-001");
    expect(screen.getByTestId("diagnostics-recent-events").textContent).toContain("private bookmarks [text]");
    expect(screen.getByTestId("diagnostics-recent-parity").textContent).toContain(
      "go engine error: missing cursor"
    );
    expect(screen.getByTestId("diagnostics-public-trial-status-timeline").textContent).toContain(
      "armed but inactive"
    );
    expect(screen.getByTestId("diagnostics-public-trial-toggle-media")).not.toHaveProperty(
      "disabled",
      true
    );
  });

  it("arms a ready public trial family and persists rollout policy", async () => {
    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-public-trial-toggle-media")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("diagnostics-public-trial-toggle-media"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.saveExtractorRolloutPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          public_trials: expect.objectContaining({
            media: expect.objectContaining({
              armed: true,
            }),
          }),
        })
      )
    );
    expect(toastMocks.success).toHaveBeenCalledWith("media public trial armed");
  });

  it("keeps blocked public family toggles disabled until ready", async () => {
    const snapshot = createBaseSnapshot();
    snapshot.rollout_policy.public_trials.timeline = { armed: false };
    snapshot.public_trial_states.timeline = {
      armed: false,
      gate: "blocked",
      active: false,
      inactive_reason: "armed but inactive because the family gate is blocked",
    };
    diagnosticsClientMocks.setSnapshot(snapshot);

    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-public-trial-toggle-timeline")).toBeTruthy();
    });

    expect(screen.getByTestId("diagnostics-public-trial-toggle-timeline")).toHaveProperty(
      "disabled",
      true
    );
  });

  it("adds the current private bookmarks context to the runbook with empty username", async () => {
    const snapshot = createBaseSnapshot();
    snapshot.runbook_config = { updated_at: "2026-04-15T06:09:00Z", presets: [] };
    snapshot.recent_validation_reports = [];
    diagnosticsClientMocks.setSnapshot(snapshot);

    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-add-current-context")).not.toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByTestId("diagnostics-add-current-context"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.saveExtractorRunbookConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: [
            expect.objectContaining({
              request_kind: "timeline",
              scope: "private",
              username: "",
              timeline_type: "bookmarks",
              media_type: "text",
            }),
          ],
        })
      )
    );
    expect(toastMocks.success).toHaveBeenCalledWith("Added current context to the validation runbook");
  });

  it("renames, toggles, and deletes presets via saved runbook config", async () => {
    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-runbook-label-preset-bookmarks")).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("diagnostics-runbook-label-preset-bookmarks"), {
      target: { value: "Bookmarks release gate" },
    });
    fireEvent.click(screen.getByTestId("diagnostics-runbook-save-preset-bookmarks"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.saveExtractorRunbookConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: [
            expect.objectContaining({
              id: "preset-bookmarks",
              label: "Bookmarks release gate",
            }),
          ],
        })
      )
    );

    fireEvent.click(screen.getByTestId("diagnostics-runbook-toggle-preset-bookmarks"));
    await waitFor(() =>
      expect(diagnosticsClientMocks.saveExtractorRunbookConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: [
            expect.objectContaining({
              id: "preset-bookmarks",
              enabled: false,
            }),
          ],
        })
      )
    );

    fireEvent.click(screen.getByTestId("diagnostics-runbook-delete-preset-bookmarks"));
    await waitFor(() =>
      expect(diagnosticsClientMocks.saveExtractorRunbookConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: [],
        })
      )
    );
  });

  it("runs validation with runtime tokens and refreshes recent reports", async () => {
    const snapshot = createBaseSnapshot();
    snapshot.runbook_config.presets = [
      ...snapshot.runbook_config.presets,
      {
        id: "preset-public",
        label: "Public NASA date range",
        enabled: true,
        request_kind: "date_range",
        scope: "public",
        username: "nasa",
        media_type: "image",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        retweets: false,
      },
    ];
    diagnosticsClientMocks.setSnapshot(snapshot);

    render(
      <DiagnosticsPanel
        embedded
        fillHeight
        parityContext={createTimelineParityContext()}
        runbookTokens={{ public_auth_token: "public-token", private_auth_token: "private-token" }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-run-validation")).not.toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByTestId("diagnostics-run-validation"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.runExtractorValidationRunbook).toHaveBeenCalledWith({
        public_auth_token: "public-token",
        private_auth_token: "private-token",
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-validation-reports").textContent).toContain("report-002")
    );
    expect(
      screen
        .getAllByTestId("diagnostics-public-gate")
        .some((element) => element.textContent?.includes("Public gate: ready"))
    ).toBe(true);
    expect(
      screen
        .getAllByTestId("diagnostics-private-gate")
        .some((element) => element.textContent?.includes("Private gate: ready"))
    ).toBe(true);
  });

  it("runs live validation and refreshes promotion readiness", async () => {
    const snapshot = createBaseSnapshot();
    snapshot.runbook_config.presets = [
      {
        id: "preset-public-media",
        label: "Public NASA media",
        enabled: true,
        request_kind: "timeline",
        scope: "public",
        username: "nasa",
        timeline_type: "media",
        media_type: "all",
        retweets: false,
      },
    ];
    snapshot.public_family_gates.media = {
      gate: "ready",
      enabled_cases: 1,
      passed_cases: 1,
      mismatch_cases: 0,
      failed_cases: 0,
      invalid_cases: 0,
    };
    diagnosticsClientMocks.setSnapshot(snapshot);

    render(
      <DiagnosticsPanel
        embedded
        fillHeight
        parityContext={createTimelineParityContext()}
        runbookTokens={{ public_auth_token: "public-token", private_auth_token: "private-token" }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-run-live-validation")).not.toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByTestId("diagnostics-run-live-validation"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.runExtractorLiveValidationSession).toHaveBeenCalledWith({
        public_auth_token: "public-token",
        private_auth_token: "private-token",
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-live-reports").textContent).toContain("live-002")
    );
    expect(screen.getByTestId("diagnostics-public-trial-status-media").textContent).toContain(
      "Promotion ready"
    );
  });

  it("keeps single-context parity and routes date-range requests correctly", async () => {
    const parityContext: DiagnosticsParityContext = {
      enabled: true,
      request_kind: "date_range",
      scope: "public",
      summary_label: "Public @nasa · 2026-04-01..2026-04-02 · image",
      date_range_request: {
        username: "nasa",
        auth_token: "public-token",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        media_filter: "image",
        retweets: false,
      },
    };

    render(<DiagnosticsPanel embedded fillHeight parityContext={parityContext} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-run-parity")).not.toHaveProperty("disabled", true);
    });

    fireEvent.click(screen.getByTestId("diagnostics-run-parity"));

    await waitFor(() =>
      expect(diagnosticsClientMocks.compareDateRangeExtractorParity).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "nasa",
          media_filter: "image",
        })
      )
    );
    expect(toastMocks.success).toHaveBeenCalledWith("Extractor parity matched for the current context");
  });
});
