import type { DateRangeRequest, TimelineRequest } from "@/types/api";

export type ExtractorEngineMode = "python" | "go" | "auto";
export type ExtractorValidationScope = "public" | "private";
export type ExtractorValidationGate = "ready" | "blocked" | "incomplete";
export type ExtractorRequestFamily = "media" | "timeline" | "date_range";
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

export type ExtractorLiveFamilyGates = ExtractorPublicFamilyGates;
export type ExtractorPromotionFamilyGates = ExtractorPublicFamilyGates;

export interface ExtractorPublicTrialPolicyState {
  armed: boolean;
  armed_at?: string;
  updated_at?: string;
}

export interface ExtractorPublicTrialState extends ExtractorPublicTrialPolicyState {
  gate: ExtractorValidationGate;
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
}

export interface ExtractorPublicTrialStates {
  media: ExtractorPublicTrialState;
  timeline: ExtractorPublicTrialState;
  date_range: ExtractorPublicTrialState;
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
  private_auto_pinned: boolean;
  private_auto_pinned_reason?: string;
  support_matrix: ExtractorSupportMatrixSummary;
  metrics: ExtractorMetricsSnapshot;
  runbook_config: ExtractorRunbookConfig;
  rollout_policy: ExtractorRolloutPolicy;
  recent_validation_reports: ExtractorValidationReportSummary[];
  recent_live_reports: ExtractorLiveValidationReportSummary[];
  public_gate: ExtractorValidationGate;
  private_gate: ExtractorValidationGate;
  public_family_gates: ExtractorPublicFamilyGates;
  live_family_gates: ExtractorLiveFamilyGates;
  promotion_family_gates: ExtractorPromotionFamilyGates;
  public_trial_states: ExtractorPublicTrialStates;
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
  live_family_gates: ExtractorLiveFamilyGates;
  promotion_family_gates: ExtractorPromotionFamilyGates;
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
