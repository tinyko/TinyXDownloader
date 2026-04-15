import type { DateRangeRequest, TimelineRequest } from "@/types/api";

export type ExtractorEngineMode = "python" | "go" | "auto";
export type ExtractorValidationScope = "public" | "private";
export type ExtractorValidationGate = "ready" | "blocked" | "incomplete";
export type ExtractorRequestFamily = "media" | "timeline" | "date_range" | "likes" | "bookmarks";
export type ExtractorRuntimeValidationStatus = "success" | "failed" | "skipped";

export interface ExtractorMetricsSnapshot {
  total_requests: number;
  python_mode_requests: number;
  go_mode_requests: number;
  auto_mode_requests: number;
  python_engine_selected: number;
  go_engine_selected: number;
  fallback_count: number;
  unsupported_count: number;
  fallback_required_count: number;
  parity_comparisons: number;
  parity_mismatches: number;
  rollout_trial_requests: number;
  rollout_trial_python_bypass: number;
  rollout_trial_go_selected: number;
}

export interface ExtractorResponseSummary {
  total_urls: number;
  timeline_items: number;
  cursor?: string;
  completed: boolean;
  account_name?: string;
  account_nick?: string;
  entry_types?: Record<string, number>;
}

export interface ExtractorParityReport {
  request_kind: string;
  python_engine: string;
  go_engine: string;
  go_supported: boolean;
  support_reason?: string;
  python_success: boolean;
  go_success: boolean;
  equal: boolean;
  differences?: string[];
  python_summary?: ExtractorResponseSummary | null;
  go_summary?: ExtractorResponseSummary | null;
  python_error?: string;
  go_error?: string;
}

export interface ExtractorSupportMatrixSummary {
  public_media_types: string[];
  public_timeline_types: string[];
  public_timeline_media_types: string[];
  public_date_range_media_filters: string[];
  private_explicit_go_timeline_types: string[];
  private_explicit_go_media_types: string[];
  private_auto_pinned_timeline_types: string[];
  raw_search_timeline_supported: boolean;
}

export interface ExtractorFamilyGateSummary {
  gate: ExtractorValidationGate;
  enabled_cases: number;
  passed_cases: number;
  mismatch_cases: number;
  failed_cases: number;
  invalid_cases: number;
}

export interface ExtractorPublicFamilyGates {
  media: ExtractorFamilyGateSummary;
  timeline: ExtractorFamilyGateSummary;
  date_range: ExtractorFamilyGateSummary;
}

export interface ExtractorPrivateFamilyGates {
  likes: ExtractorFamilyGateSummary;
  bookmarks: ExtractorFamilyGateSummary;
}

export type ExtractorLiveFamilyGates = ExtractorPublicFamilyGates;
export type ExtractorPromotionFamilyGates = ExtractorPublicFamilyGates;

export interface ExtractorPublicTrialPolicyState {
  armed: boolean;
  armed_at?: string;
  updated_at?: string;
}

export interface ExtractorPublicPromotionPolicyState {
  promoted: boolean;
  promoted_at?: string;
  updated_at?: string;
  baseline_captured_at?: string;
  baseline_config_updated_at?: string;
  baseline_validation_report_id?: string;
  baseline_live_report_id?: string;
  baseline_promotion_gate?: ExtractorValidationGate;
}

export interface ExtractorPublicTrialState extends ExtractorPublicTrialPolicyState {
  gate: ExtractorValidationGate;
  active: boolean;
  inactive_reason?: string;
}

export interface ExtractorPublicPromotionState extends ExtractorPublicPromotionPolicyState {
  gate: ExtractorValidationGate;
  current_promotion_gate?: ExtractorValidationGate;
  current_config_matches_baseline: boolean;
  latest_evidence_drifted: boolean;
  active: boolean;
  inactive_reason?: string;
}

export interface ExtractorRolloutPolicy {
  updated_at?: string;
  public_trials: {
    media: ExtractorPublicTrialPolicyState;
    timeline: ExtractorPublicTrialPolicyState;
    date_range: ExtractorPublicTrialPolicyState;
  };
  public_promotions: {
    media: ExtractorPublicPromotionPolicyState;
    timeline: ExtractorPublicPromotionPolicyState;
    date_range: ExtractorPublicPromotionPolicyState;
  };
  private_trials: {
    likes: ExtractorPublicTrialPolicyState;
    bookmarks: ExtractorPublicTrialPolicyState;
  };
  private_promotions: {
    likes: ExtractorPublicPromotionPolicyState;
    bookmarks: ExtractorPublicPromotionPolicyState;
  };
}

export interface ExtractorPublicTrialStates {
  media: ExtractorPublicTrialState;
  timeline: ExtractorPublicTrialState;
  date_range: ExtractorPublicTrialState;
}

export interface ExtractorPublicPromotionStates {
  media: ExtractorPublicPromotionState;
  timeline: ExtractorPublicPromotionState;
  date_range: ExtractorPublicPromotionState;
}

export interface ExtractorPrivateTrialStates {
  likes: ExtractorPublicTrialState;
  bookmarks: ExtractorPublicTrialState;
}

export interface ExtractorPrivatePromotionStates {
  likes: ExtractorPublicPromotionState;
  bookmarks: ExtractorPublicPromotionState;
}

export interface ExtractorSoakFamilyState {
  total_requests: number;
  go_selected_successes: number;
  python_fallbacks: number;
  fallback_required_count: number;
  runtime_failures: number;
  cursor_semantic_failures: number;
  last_success_at?: string;
  last_failure_at?: string;
  last_failure_reason?: string;
  blocker_open: boolean;
}

export interface ExtractorSoakFamilyStates {
  media: ExtractorSoakFamilyState;
  timeline: ExtractorSoakFamilyState;
  date_range: ExtractorSoakFamilyState;
  likes: ExtractorSoakFamilyState;
  bookmarks: ExtractorSoakFamilyState;
}

export interface ExtractorDefaultRouteState {
  promoted: boolean;
  baseline_active: boolean;
  default_served_by_go: boolean;
  fallback_served_by_python: boolean;
  inactive_reason?: string;
  last_failure_reason?: string;
  depythonization_ready: boolean;
}

export interface ExtractorDefaultRouteStates {
  media: ExtractorDefaultRouteState;
  timeline: ExtractorDefaultRouteState;
  date_range: ExtractorDefaultRouteState;
  likes: ExtractorDefaultRouteState;
  bookmarks: ExtractorDefaultRouteState;
}

export interface ExtractorRecentEvent {
  timestamp: string;
  event: string;
  request_kind?: string;
  request_family?: ExtractorRequestFamily;
  request_target?: string;
  username?: string;
  timeline_type?: string;
  media_type?: string;
  mode?: ExtractorEngineMode;
  configured_mode?: ExtractorEngineMode;
  effective_mode?: ExtractorEngineMode;
  mode_source?: string;
  selected_engine?: string;
  success: boolean;
  fallback_reason?: string;
  fallback_code?: string;
  auth_mode?: string;
  cursor_present?: boolean;
  page_item_count?: number;
  media_item_count?: number;
  text_item_count?: number;
  metadata_count?: number;
  page_count?: number;
  tweet_count?: number;
  partial_parse?: boolean;
  stage?: string;
  cursor_stage?: number;
  trial_armed?: boolean;
  trial_active?: boolean;
  elapsed_ms?: number;
  error?: string;
}

export interface ExtractorParityHistoryEntry {
  timestamp: string;
  request_kind: string;
  target: string;
  go_supported: boolean;
  support_reason?: string;
  python_success: boolean;
  go_success: boolean;
  equal: boolean;
  diff_count: number;
  first_difference?: string;
  python_summary?: ExtractorResponseSummary | null;
  go_summary?: ExtractorResponseSummary | null;
  python_error?: string;
  go_error?: string;
}

export interface ExtractorDiagnosticsSnapshot {
  current_mode: ExtractorEngineMode;
  go_only_runtime: boolean;
  historical_evidence_only: boolean;
  phase7_cutover_version?: string;
  private_auto_pinned: boolean;
  private_auto_pinned_reason?: string;
  python_fallback_available: boolean;
  python_fallback_build_flavor?: string;
  ad_hoc_parity_available: boolean;
  ad_hoc_parity_unavailable_reason?: string;
  python_deprecated_notice?: string;
  support_matrix: ExtractorSupportMatrixSummary;
  metrics: ExtractorMetricsSnapshot;
  runbook_config: ExtractorRunbookConfig;
  rollout_policy: ExtractorRolloutPolicy;
  recent_validation_reports: ExtractorValidationReportSummary[];
  recent_live_reports: ExtractorLiveValidationReportSummary[];
  public_gate: ExtractorValidationGate;
  private_gate: ExtractorValidationGate;
  public_family_gates: ExtractorPublicFamilyGates;
  private_family_gates: ExtractorPrivateFamilyGates;
  live_family_gates: ExtractorLiveFamilyGates;
  private_live_family_gates: ExtractorPrivateFamilyGates;
  promotion_family_gates: ExtractorPromotionFamilyGates;
  private_promotion_family_gates: ExtractorPrivateFamilyGates;
  public_trial_states: ExtractorPublicTrialStates;
  private_trial_states: ExtractorPrivateTrialStates;
  public_promotion_states: ExtractorPublicPromotionStates;
  private_promotion_states: ExtractorPrivatePromotionStates;
  default_route_states: ExtractorDefaultRouteStates;
  soak_family_states: ExtractorSoakFamilyStates;
  soak_release_version?: string;
  phase7_ready: boolean;
  recent_events: ExtractorRecentEvent[];
  recent_parity: ExtractorParityHistoryEntry[];
}

export interface ExtractorRunbookPreset {
  id: string;
  label: string;
  enabled: boolean;
  request_kind: "timeline" | "date_range";
  scope: ExtractorValidationScope;
  username?: string;
  timeline_type?: string;
  media_type?: string;
  retweets?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface ExtractorRunbookConfig {
  updated_at?: string;
  presets: ExtractorRunbookPreset[];
}

export interface ExtractorValidationCaseReport {
  preset_id: string;
  preset_label: string;
  request_kind: string;
  scope: ExtractorValidationScope;
  request_family?: ExtractorRequestFamily;
  target: string;
  valid: boolean;
  skipped_reason?: string;
  go_supported: boolean;
  support_reason?: string;
  python_success: boolean;
  go_success: boolean;
  equal: boolean;
  diff_count: number;
  first_difference?: string;
  python_summary?: ExtractorResponseSummary | null;
  go_summary?: ExtractorResponseSummary | null;
  python_error?: string;
  go_error?: string;
  duration_ms: number;
}

export interface ExtractorValidationReportSummary {
  report_id: string;
  created_at: string;
  config_updated_at?: string;
  total_cases: number;
  passed_cases: number;
  mismatch_cases: number;
  failed_cases: number;
  invalid_cases: number;
  public_gate: ExtractorValidationGate;
  private_gate: ExtractorValidationGate;
  public_family_gates: ExtractorPublicFamilyGates;
  private_family_gates: ExtractorPrivateFamilyGates;
}

export interface ExtractorValidationDiagnosticsSummary {
  current_mode: ExtractorEngineMode;
  private_auto_pinned: boolean;
  private_auto_pinned_reason?: string;
  support_matrix: ExtractorSupportMatrixSummary;
  metrics: ExtractorMetricsSnapshot;
}

export interface ExtractorValidationReport extends ExtractorValidationReportSummary {
  app_version: string;
  engine_mode: ExtractorEngineMode;
  diagnostics: ExtractorValidationDiagnosticsSummary;
  cases: ExtractorValidationCaseReport[];
}

export interface ExtractorValidationRunRequest {
  public_auth_token?: string;
  private_auth_token?: string;
}

export interface ExtractorRuntimeValidationSummary {
  status: ExtractorRuntimeValidationStatus;
  configured_mode?: ExtractorEngineMode;
  effective_mode?: ExtractorEngineMode;
  selected_engine?: string;
  mode_source?: string;
  fallback_reason?: string;
  fallback_code?: string;
  response_summary?: ExtractorResponseSummary | null;
  cursor?: string;
  completed?: boolean;
  cursor_issue?: string;
  error?: string;
}

export interface ExtractorLiveValidationCaseReport {
  preset_id: string;
  preset_label: string;
  request_kind: string;
  scope: ExtractorValidationScope;
  request_family?: ExtractorRequestFamily;
  target: string;
  valid: boolean;
  skipped_reason?: string;
  runtime: ExtractorRuntimeValidationSummary;
  go_supported: boolean;
  support_reason?: string;
  python_success: boolean;
  go_success: boolean;
  equal: boolean;
  diff_count: number;
  first_difference?: string;
  python_summary?: ExtractorResponseSummary | null;
  go_summary?: ExtractorResponseSummary | null;
  python_error?: string;
  go_error?: string;
  runtime_duration_ms: number;
  parity_duration_ms: number;
  duration_ms: number;
}

export interface ExtractorLiveValidationReportSummary {
  report_id: string;
  created_at: string;
  config_updated_at?: string;
  total_cases: number;
  runtime_passed_cases: number;
  runtime_failed_cases: number;
  runtime_skipped_cases: number;
  parity_family_gates: ExtractorPublicFamilyGates;
  private_parity_family_gates: ExtractorPrivateFamilyGates;
  live_family_gates: ExtractorLiveFamilyGates;
  private_live_family_gates: ExtractorPrivateFamilyGates;
  promotion_family_gates: ExtractorPromotionFamilyGates;
  private_promotion_family_gates: ExtractorPrivateFamilyGates;
}

export interface ExtractorLiveValidationReport extends ExtractorLiveValidationReportSummary {
  app_version: string;
  engine_mode: ExtractorEngineMode;
  diagnostics: ExtractorValidationDiagnosticsSummary;
  cases: ExtractorLiveValidationCaseReport[];
}

export interface TimelineParityRequest extends TimelineRequest {
  request_id?: string;
}

export interface DateRangeParityRequest extends DateRangeRequest {
  request_id?: string;
}

export interface DiagnosticsParityContext {
  enabled: boolean;
  disabled_reason?: string;
  request_kind: "timeline" | "date_range" | null;
  summary_label: string;
  scope?: ExtractorValidationScope;
  timeline_request?: TimelineParityRequest;
  date_range_request?: DateRangeParityRequest;
}
