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
    current_mode: "go",
    go_only_runtime: true,
    historical_evidence_only: true,
    phase7_cutover_version: "1.2.3",
    private_auto_pinned: false,
    private_auto_pinned_reason: undefined,
    python_fallback_available: false,
    python_fallback_build_flavor: "go-only",
    ad_hoc_parity_available: false,
    ad_hoc_parity_unavailable_reason: "python fallback unavailable in this go-only build",
    python_deprecated_notice: "python extractor is retired; the python mode alias now runs the go-only runtime",
    support_matrix: {
      public_media_types: ["all", "image", "video", "gif"],
      public_timeline_types: ["timeline", "tweets", "with_replies"],
      public_timeline_media_types: ["all", "image", "video", "gif", "text"],
      public_date_range_media_filters: ["all", "image", "video", "gif", "text"],
      private_explicit_go_timeline_types: ["likes", "bookmarks"],
      private_explicit_go_media_types: ["all", "image", "video", "gif", "text"],
      private_auto_pinned_timeline_types: [],
      raw_search_timeline_supported: false,
    },
    metrics: {
      total_requests: 12,
      python_mode_requests: 0,
      go_mode_requests: 12,
      auto_mode_requests: 0,
      python_engine_selected: 0,
      go_engine_selected: 12,
      fallback_count: 2,
      unsupported_count: 1,
      fallback_required_count: 1,
      parity_comparisons: 0,
      parity_mismatches: 0,
      rollout_trial_requests: 0,
      rollout_trial_python_bypass: 0,
      rollout_trial_go_selected: 0,
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
      public_promotions: {
        media: { promoted: false },
        timeline: {
          promoted: true,
          promoted_at: "2026-04-15T06:13:00Z",
          updated_at: "2026-04-15T06:13:00Z",
          baseline_captured_at: "2026-04-15T06:13:00Z",
          baseline_config_updated_at: "2026-04-15T06:05:00Z",
          baseline_validation_report_id: "report-baseline-timeline",
          baseline_live_report_id: "live-baseline-timeline",
          baseline_promotion_gate: "ready",
        },
        date_range: { promoted: false },
      },
      private_trials: {
        likes: { armed: false },
        bookmarks: { armed: false },
      },
      private_promotions: {
        likes: { promoted: false },
        bookmarks: { promoted: false },
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
        private_family_gates: {
          likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
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
        private_parity_family_gates: {
          likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        live_family_gates: {
          media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 0, failed_cases: 1, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        private_live_family_gates: {
          likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        promotion_family_gates: {
          media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 1, invalid_cases: 0 },
          date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
        },
        private_promotion_family_gates: {
          likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
          bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
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
    private_family_gates: {
      likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    live_family_gates: {
      media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 0, failed_cases: 1, invalid_cases: 0 },
      date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    private_live_family_gates: {
      likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    promotion_family_gates: {
      media: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      timeline: { gate: "blocked", enabled_cases: 1, passed_cases: 0, mismatch_cases: 1, failed_cases: 1, invalid_cases: 0 },
      date_range: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
    },
    private_promotion_family_gates: {
      likes: { gate: "incomplete", enabled_cases: 0, passed_cases: 0, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
      bookmarks: { gate: "ready", enabled_cases: 1, passed_cases: 1, mismatch_cases: 0, failed_cases: 0, invalid_cases: 0 },
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
    private_trial_states: {
      likes: { armed: false, gate: "incomplete", active: false },
      bookmarks: { armed: false, gate: "ready", active: false },
    },
    public_promotion_states: {
      media: {
        promoted: false,
        gate: "ready",
        active: false,
        current_config_matches_baseline: false,
        latest_evidence_drifted: false,
      },
      timeline: {
        promoted: true,
        promoted_at: "2026-04-15T06:13:00Z",
        updated_at: "2026-04-15T06:13:00Z",
        baseline_captured_at: "2026-04-15T06:13:00Z",
        baseline_config_updated_at: "2026-04-15T06:05:00Z",
        baseline_validation_report_id: "report-baseline-timeline",
        baseline_live_report_id: "live-baseline-timeline",
        baseline_promotion_gate: "ready",
        gate: "blocked",
        current_promotion_gate: "blocked",
        current_config_matches_baseline: false,
        latest_evidence_drifted: true,
        active: true,
      },
      date_range: {
        promoted: false,
        gate: "incomplete",
        active: false,
        current_config_matches_baseline: false,
        latest_evidence_drifted: false,
      },
    },
    private_promotion_states: {
      likes: {
        promoted: false,
        gate: "incomplete",
        active: false,
        current_config_matches_baseline: false,
        latest_evidence_drifted: false,
      },
      bookmarks: {
        promoted: false,
        gate: "ready",
        active: false,
        current_config_matches_baseline: false,
        latest_evidence_drifted: false,
      },
    },
    default_route_states: {
      media: {
        promoted: true,
        baseline_active: true,
        default_served_by_go: true,
        fallback_served_by_python: false,
        depythonization_ready: true,
      },
      timeline: {
        promoted: true,
        baseline_active: true,
        default_served_by_go: true,
        fallback_served_by_python: true,
        inactive_reason: "go runtime fell back to python after a blocker",
        last_failure_reason: "go runtime fell back to python after a blocker",
        depythonization_ready: false,
      },
      date_range: {
        promoted: false,
        baseline_active: false,
        default_served_by_go: false,
        fallback_served_by_python: false,
        depythonization_ready: false,
      },
      likes: {
        promoted: true,
        baseline_active: true,
        default_served_by_go: true,
        fallback_served_by_python: false,
        depythonization_ready: true,
      },
      bookmarks: {
        promoted: false,
        baseline_active: false,
        default_served_by_go: false,
        fallback_served_by_python: true,
        inactive_reason: "default route recently fell back to python",
        last_failure_reason: "default route recently fell back to python",
        depythonization_ready: false,
      },
    },
    soak_family_states: {
      media: {
        total_requests: 8,
        go_selected_successes: 8,
        python_fallbacks: 0,
        fallback_required_count: 0,
        runtime_failures: 0,
        cursor_semantic_failures: 0,
        last_success_at: "2026-04-15T06:20:00Z",
        blocker_open: false,
      },
      timeline: {
        total_requests: 3,
        go_selected_successes: 1,
        python_fallbacks: 2,
        fallback_required_count: 1,
        runtime_failures: 0,
        cursor_semantic_failures: 0,
        last_success_at: "2026-04-15T06:22:00Z",
        last_failure_at: "2026-04-15T06:23:00Z",
        last_failure_reason: "go runtime fell back to python after a blocker",
        blocker_open: true,
      },
      date_range: {
        total_requests: 0,
        go_selected_successes: 0,
        python_fallbacks: 0,
        fallback_required_count: 0,
        runtime_failures: 0,
        cursor_semantic_failures: 0,
        blocker_open: false,
      },
      likes: {
        total_requests: 4,
        go_selected_successes: 4,
        python_fallbacks: 0,
        fallback_required_count: 0,
        runtime_failures: 0,
        cursor_semantic_failures: 0,
        last_success_at: "2026-04-15T06:24:00Z",
        blocker_open: false,
      },
      bookmarks: {
        total_requests: 1,
        go_selected_successes: 0,
        python_fallbacks: 1,
        fallback_required_count: 1,
        runtime_failures: 0,
        cursor_semantic_failures: 0,
        last_failure_at: "2026-04-15T06:25:00Z",
        last_failure_reason: "default route recently fell back to python",
        blocker_open: true,
      },
    },
    soak_release_version: "1.2.3",
    phase7_ready: false,
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
      const resolvePromotionState = (family: "media" | "timeline" | "date_range") => {
        const nextPromotionPolicy = nextPolicy.public_promotions[family];
        const currentPromotionPolicy = currentSnapshot.rollout_policy.public_promotions[family];
        const baseline =
          nextPromotionPolicy.promoted && !currentPromotionPolicy.promoted
            ? {
                baseline_captured_at: "2026-04-15T06:20:30Z",
                baseline_config_updated_at: currentSnapshot.runbook_config.updated_at,
                baseline_validation_report_id: currentSnapshot.recent_validation_reports[0]?.report_id,
                baseline_live_report_id: currentSnapshot.recent_live_reports[0]?.report_id,
                baseline_promotion_gate: currentSnapshot.promotion_family_gates[family].gate,
              }
            : nextPromotionPolicy.promoted
              ? {
                  baseline_captured_at: nextPromotionPolicy.baseline_captured_at || currentPromotionPolicy.baseline_captured_at,
                  baseline_config_updated_at:
                    nextPromotionPolicy.baseline_config_updated_at ||
                    currentPromotionPolicy.baseline_config_updated_at,
                  baseline_validation_report_id:
                    nextPromotionPolicy.baseline_validation_report_id ||
                    currentPromotionPolicy.baseline_validation_report_id,
                  baseline_live_report_id:
                    nextPromotionPolicy.baseline_live_report_id ||
                    currentPromotionPolicy.baseline_live_report_id,
                  baseline_promotion_gate:
                    nextPromotionPolicy.baseline_promotion_gate ||
                    currentPromotionPolicy.baseline_promotion_gate,
                }
              : {
                  baseline_captured_at: undefined,
                  baseline_config_updated_at: undefined,
                  baseline_validation_report_id: undefined,
                  baseline_live_report_id: undefined,
                  baseline_promotion_gate: undefined,
                };
        const baselineValid = Boolean(
          nextPromotionPolicy.promoted &&
            baseline.baseline_captured_at &&
            baseline.baseline_config_updated_at &&
            baseline.baseline_validation_report_id &&
            baseline.baseline_live_report_id &&
            baseline.baseline_promotion_gate === "ready"
        );
        const currentConfigMatchesBaseline =
          Boolean(baseline.baseline_config_updated_at) &&
          baseline.baseline_config_updated_at === currentSnapshot.runbook_config.updated_at;
        return {
          ...currentSnapshot.public_promotion_states[family],
          ...nextPromotionPolicy,
          ...baseline,
          gate: currentSnapshot.promotion_family_gates[family].gate,
          current_promotion_gate: currentSnapshot.promotion_family_gates[family].gate,
          current_config_matches_baseline: currentConfigMatchesBaseline,
          latest_evidence_drifted:
            baselineValid &&
            (!currentConfigMatchesBaseline ||
              currentSnapshot.promotion_family_gates[family].gate !== "ready"),
          active: baselineValid,
          inactive_reason:
            nextPromotionPolicy.promoted && !baselineValid
              ? "promoted but inactive because baseline is missing or invalid"
              : undefined,
        };
      };
      const resolvePrivatePromotionState = (family: "likes" | "bookmarks") => {
        const nextPromotionPolicy = nextPolicy.private_promotions[family];
        const currentPromotionPolicy = currentSnapshot.rollout_policy.private_promotions[family];
        const baseline =
          nextPromotionPolicy.promoted && !currentPromotionPolicy.promoted
            ? {
                baseline_captured_at: "2026-04-15T06:20:30Z",
                baseline_config_updated_at: currentSnapshot.runbook_config.updated_at,
                baseline_validation_report_id: currentSnapshot.recent_validation_reports[0]?.report_id,
                baseline_live_report_id: currentSnapshot.recent_live_reports[0]?.report_id,
                baseline_promotion_gate: currentSnapshot.private_promotion_family_gates[family].gate,
              }
            : nextPromotionPolicy.promoted
              ? {
                  baseline_captured_at:
                    nextPromotionPolicy.baseline_captured_at || currentPromotionPolicy.baseline_captured_at,
                  baseline_config_updated_at:
                    nextPromotionPolicy.baseline_config_updated_at ||
                    currentPromotionPolicy.baseline_config_updated_at,
                  baseline_validation_report_id:
                    nextPromotionPolicy.baseline_validation_report_id ||
                    currentPromotionPolicy.baseline_validation_report_id,
                  baseline_live_report_id:
                    nextPromotionPolicy.baseline_live_report_id ||
                    currentPromotionPolicy.baseline_live_report_id,
                  baseline_promotion_gate:
                    nextPromotionPolicy.baseline_promotion_gate ||
                    currentPromotionPolicy.baseline_promotion_gate,
                }
              : {
                  baseline_captured_at: undefined,
                  baseline_config_updated_at: undefined,
                  baseline_validation_report_id: undefined,
                  baseline_live_report_id: undefined,
                  baseline_promotion_gate: undefined,
                };
        const baselineValid = Boolean(
          nextPromotionPolicy.promoted &&
            baseline.baseline_captured_at &&
            baseline.baseline_config_updated_at &&
            baseline.baseline_validation_report_id &&
            baseline.baseline_live_report_id &&
            baseline.baseline_promotion_gate === "ready"
        );
        const currentConfigMatchesBaseline =
          Boolean(baseline.baseline_config_updated_at) &&
          baseline.baseline_config_updated_at === currentSnapshot.runbook_config.updated_at;
        return {
          ...currentSnapshot.private_promotion_states[family],
          ...nextPromotionPolicy,
          ...baseline,
          gate: currentSnapshot.private_promotion_family_gates[family].gate,
          current_promotion_gate: currentSnapshot.private_promotion_family_gates[family].gate,
          current_config_matches_baseline: currentConfigMatchesBaseline,
          latest_evidence_drifted:
            baselineValid &&
            (!currentConfigMatchesBaseline ||
              currentSnapshot.private_promotion_family_gates[family].gate !== "ready"),
          active: baselineValid,
          inactive_reason:
            nextPromotionPolicy.promoted && !baselineValid
              ? "promoted but inactive because baseline is missing or invalid"
              : undefined,
        };
      };
      currentSnapshot = {
        ...currentSnapshot,
        rollout_policy: {
          ...nextPolicy,
          updated_at: "2026-04-15T06:20:30Z",
          public_promotions: {
            media: {
              ...nextPolicy.public_promotions.media,
              baseline_captured_at: resolvePromotionState("media").baseline_captured_at,
              baseline_config_updated_at: resolvePromotionState("media").baseline_config_updated_at,
              baseline_validation_report_id: resolvePromotionState("media").baseline_validation_report_id,
              baseline_live_report_id: resolvePromotionState("media").baseline_live_report_id,
              baseline_promotion_gate: resolvePromotionState("media").baseline_promotion_gate,
            },
            timeline: {
              ...nextPolicy.public_promotions.timeline,
              baseline_captured_at: resolvePromotionState("timeline").baseline_captured_at,
              baseline_config_updated_at: resolvePromotionState("timeline").baseline_config_updated_at,
              baseline_validation_report_id: resolvePromotionState("timeline").baseline_validation_report_id,
              baseline_live_report_id: resolvePromotionState("timeline").baseline_live_report_id,
              baseline_promotion_gate: resolvePromotionState("timeline").baseline_promotion_gate,
            },
            date_range: {
              ...nextPolicy.public_promotions.date_range,
              baseline_captured_at: resolvePromotionState("date_range").baseline_captured_at,
              baseline_config_updated_at: resolvePromotionState("date_range").baseline_config_updated_at,
              baseline_validation_report_id: resolvePromotionState("date_range").baseline_validation_report_id,
              baseline_live_report_id: resolvePromotionState("date_range").baseline_live_report_id,
              baseline_promotion_gate: resolvePromotionState("date_range").baseline_promotion_gate,
            },
          },
          private_promotions: {
            likes: {
              ...nextPolicy.private_promotions.likes,
              baseline_captured_at: resolvePrivatePromotionState("likes").baseline_captured_at,
              baseline_config_updated_at: resolvePrivatePromotionState("likes").baseline_config_updated_at,
              baseline_validation_report_id: resolvePrivatePromotionState("likes").baseline_validation_report_id,
              baseline_live_report_id: resolvePrivatePromotionState("likes").baseline_live_report_id,
              baseline_promotion_gate: resolvePrivatePromotionState("likes").baseline_promotion_gate,
            },
            bookmarks: {
              ...nextPolicy.private_promotions.bookmarks,
              baseline_captured_at: resolvePrivatePromotionState("bookmarks").baseline_captured_at,
              baseline_config_updated_at: resolvePrivatePromotionState("bookmarks").baseline_config_updated_at,
              baseline_validation_report_id: resolvePrivatePromotionState("bookmarks").baseline_validation_report_id,
              baseline_live_report_id: resolvePrivatePromotionState("bookmarks").baseline_live_report_id,
              baseline_promotion_gate: resolvePrivatePromotionState("bookmarks").baseline_promotion_gate,
            },
          },
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
        private_trial_states: {
          likes: {
            ...currentSnapshot.private_trial_states.likes,
            ...nextPolicy.private_trials.likes,
            gate: currentSnapshot.private_family_gates.likes.gate,
            active: Boolean(nextPolicy.private_trials.likes.armed) && currentSnapshot.private_family_gates.likes.gate === "ready",
            inactive_reason:
              nextPolicy.private_trials.likes.armed && currentSnapshot.private_family_gates.likes.gate !== "ready"
                ? "armed but inactive because the family gate is not ready"
                : undefined,
          },
          bookmarks: {
            ...currentSnapshot.private_trial_states.bookmarks,
            ...nextPolicy.private_trials.bookmarks,
            gate: currentSnapshot.private_family_gates.bookmarks.gate,
            active:
              Boolean(nextPolicy.private_trials.bookmarks.armed) &&
              currentSnapshot.private_family_gates.bookmarks.gate === "ready",
            inactive_reason:
              nextPolicy.private_trials.bookmarks.armed &&
              currentSnapshot.private_family_gates.bookmarks.gate !== "ready"
                ? "armed but inactive because the family gate is not ready"
                : undefined,
          },
        },
        public_promotion_states: {
          media: resolvePromotionState("media"),
          timeline: resolvePromotionState("timeline"),
          date_range: resolvePromotionState("date_range"),
        },
        private_promotion_states: {
          likes: resolvePrivatePromotionState("likes"),
          bookmarks: resolvePrivatePromotionState("bookmarks"),
        },
      };
      return clone(currentSnapshot.rollout_policy);
    }),
    runExtractorValidationRunbook: vi.fn(async () => {
      const privateLikesEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) => preset.scope === "private" && preset.request_kind === "timeline" && preset.timeline_type === "likes"
      ).length;
      const privateBookmarksEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) => preset.scope === "private" && preset.request_kind === "timeline" && preset.timeline_type === "bookmarks"
      ).length;
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
        private_family_gates: {
          likes: {
            gate: privateLikesEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: privateLikesEnabled,
            passed_cases: privateLikesEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          bookmarks: {
            gate: privateBookmarksEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: privateBookmarksEnabled,
            passed_cases: privateBookmarksEnabled,
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
            private_family_gates: report.private_family_gates,
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
      const privateLikesEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) =>
          preset.enabled &&
          preset.scope === "private" &&
          preset.request_kind === "timeline" &&
          preset.timeline_type === "likes"
      ).length;
      const privateBookmarksEnabled = currentSnapshot.runbook_config.presets.filter(
        (preset) =>
          preset.enabled &&
          preset.scope === "private" &&
          preset.request_kind === "timeline" &&
          preset.timeline_type === "bookmarks"
      ).length;

      const report: ExtractorLiveValidationReport = {
        report_id: "live-002",
        created_at: "2026-04-15T06:22:00Z",
        config_updated_at: currentSnapshot.runbook_config.updated_at,
        total_cases: currentSnapshot.runbook_config.presets.filter((preset) => preset.enabled).length,
        runtime_passed_cases:
          publicMediaEnabled +
          publicTimelineEnabled +
          publicDateRangeEnabled +
          privateLikesEnabled +
          privateBookmarksEnabled,
        runtime_failed_cases: 0,
        runtime_skipped_cases: 0,
        parity_family_gates: currentSnapshot.public_family_gates,
        private_parity_family_gates: currentSnapshot.private_family_gates,
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
        private_live_family_gates: {
          likes: {
            gate: privateLikesEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: privateLikesEnabled,
            passed_cases: privateLikesEnabled,
            mismatch_cases: 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          bookmarks: {
            gate: privateBookmarksEnabled > 0 ? "ready" : "incomplete",
            enabled_cases: privateBookmarksEnabled,
            passed_cases: privateBookmarksEnabled,
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
        private_promotion_family_gates: {
          likes: {
            gate:
              privateLikesEnabled > 0 && currentSnapshot.private_family_gates.likes.gate === "ready"
                ? "ready"
                : privateLikesEnabled > 0
                  ? "blocked"
                  : "incomplete",
            enabled_cases: privateLikesEnabled,
            passed_cases:
              privateLikesEnabled > 0 && currentSnapshot.private_family_gates.likes.gate === "ready"
                ? privateLikesEnabled
                : 0,
            mismatch_cases:
              privateLikesEnabled > 0 && currentSnapshot.private_family_gates.likes.gate !== "ready"
                ? 1
                : 0,
            failed_cases: 0,
            invalid_cases: 0,
          },
          bookmarks: {
            gate:
              privateBookmarksEnabled > 0 && currentSnapshot.private_family_gates.bookmarks.gate === "ready"
                ? "ready"
                : privateBookmarksEnabled > 0
                  ? "blocked"
                  : "incomplete",
            enabled_cases: privateBookmarksEnabled,
            passed_cases:
              privateBookmarksEnabled > 0 && currentSnapshot.private_family_gates.bookmarks.gate === "ready"
                ? privateBookmarksEnabled
                : 0,
            mismatch_cases:
              privateBookmarksEnabled > 0 && currentSnapshot.private_family_gates.bookmarks.gate !== "ready"
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
        private_live_family_gates: report.private_live_family_gates,
        promotion_family_gates: report.promotion_family_gates,
        private_promotion_family_gates: report.private_promotion_family_gates,
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
            private_parity_family_gates: report.private_parity_family_gates,
            live_family_gates: report.live_family_gates,
            private_live_family_gates: report.private_live_family_gates,
            promotion_family_gates: report.promotion_family_gates,
            private_promotion_family_gates: report.private_promotion_family_gates,
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
    diagnosticsClientMocks.createDatabaseBackup.mockClear();
    diagnosticsClientMocks.exportSupportBundle.mockClear();
    diagnosticsClientMocks.openAppDataFolder.mockClear();
    diagnosticsClientMocks.restoreDatabaseBackup.mockClear();
    toastMocks.success.mockClear();
    toastMocks.warning.mockClear();
    toastMocks.error.mockClear();
  });

  it("renders the support and health summary with soak and audit evidence", async () => {
    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-extractor-mode").textContent).toContain("Mode: go");
    });

    expect(screen.getByTestId("diagnostics-go-only-runtime").textContent).toContain("Go-only runtime is active");
    expect(screen.getByTestId("diagnostics-build-flavor").textContent).toContain("go-only");
    expect(screen.getByTestId("diagnostics-support-summary-panel").textContent).toContain("Private auto pinned: none");
    expect(screen.getByTestId("diagnostics-history-panel").textContent).toContain("report-001");
    expect(screen.getByTestId("diagnostics-history-panel").textContent).toContain("live-001");
    expect(screen.getByTestId("diagnostics-default-soak-media").textContent).toContain("Default Go");
    expect(screen.getByTestId("diagnostics-default-soak-status-timeline").textContent).toContain(
      "go runtime fell back to python after a blocker"
    );
    expect(screen.getByTestId("diagnostics-phase7-ready").textContent).toContain("not ready");
    expect(screen.queryByText("Debug Logs")).toBeNull();
    expect(screen.queryByTestId("diagnostics-run-parity")).toBeNull();
    expect(screen.queryByTestId("diagnostics-run-validation")).toBeNull();
    expect(screen.queryByTestId("diagnostics-run-live-validation")).toBeNull();
  });

  it("shows the python deprecated notice and soak fallback state", async () => {
    diagnosticsClientMocks.setSnapshot({
      ...createBaseSnapshot(),
      current_mode: "python",
      python_deprecated_notice: "python extractor is retired; the python mode alias now runs the go-only runtime",
    });

    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(
        screen.getByText("python extractor is retired; the python mode alias now runs the go-only runtime")
      ).toBeTruthy();
    });

    expect(screen.getByTestId("diagnostics-default-soak-bookmarks").textContent).toContain("Python fallback");
  });

  it("shows go-only fallback status in the health summary", async () => {
    diagnosticsClientMocks.setSnapshot({
      ...createBaseSnapshot(),
      current_mode: "python",
      python_fallback_available: false,
      python_fallback_build_flavor: "go-only",
      ad_hoc_parity_available: false,
      ad_hoc_parity_unavailable_reason: "python fallback unavailable in this go-only build",
      python_deprecated_notice: "python extractor is retired; the python mode alias now runs the go-only runtime",
    });

    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-python-fallback-status").textContent).toContain(
        "go-only build"
      );
    });

    expect(screen.getByTestId("diagnostics-build-flavor").textContent).toContain("go-only");
    expect(screen.getByTestId("diagnostics-python-fallback-availability").textContent).toContain(
      "Python fallback unavailable"
    );
    expect(screen.getByTestId("diagnostics-python-fallback-status").textContent).toContain(
      "Python fallback is unavailable"
    );
  });

  it("renders support matrix safely when legacy snapshots omit private auto pinned arrays", async () => {
    const snapshot = createBaseSnapshot();
    diagnosticsClientMocks.setSnapshot({
      ...snapshot,
      support_matrix: {
        ...snapshot.support_matrix,
        private_auto_pinned_timeline_types: undefined,
      },
    });

    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-extractor-mode").textContent).toContain("Mode: go");
    });

    expect(screen.getByTestId("diagnostics-support-summary-panel").textContent).toContain("Private auto pinned");
    expect(screen.getByTestId("diagnostics-extractor-panel").textContent).toContain("none");
  });

  it("runs support actions from the simplified panel", async () => {
    render(<DiagnosticsPanel embedded fillHeight parityContext={createTimelineParityContext()} />);

    await waitFor(() => {
      expect(screen.getByTestId("diagnostics-export-support-bundle")).toBeTruthy();
    });

    diagnosticsClientMocks.exportSupportBundle.mockResolvedValue("/tmp/support.zip");
    diagnosticsClientMocks.createDatabaseBackup.mockResolvedValue("/tmp/backup.db");
    diagnosticsClientMocks.restoreDatabaseBackup.mockResolvedValue({
      success: true,
      message: "Restore complete",
      requires_restart: false,
    });

    fireEvent.click(screen.getByTestId("diagnostics-export-support-bundle"));

    await waitFor(() => {
      expect(diagnosticsClientMocks.exportSupportBundle).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("diagnostics-create-backup"));

    await waitFor(() => {
      expect(diagnosticsClientMocks.createDatabaseBackup).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("diagnostics-restore-backup"));

    await waitFor(() => {
      expect(diagnosticsClientMocks.restoreDatabaseBackup).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("diagnostics-open-app-data"));

    await waitFor(() => {
      expect(diagnosticsClientMocks.openAppDataFolder).toHaveBeenCalled();
    });
  });
});
