package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type ExtractorRequestFamily string

const (
	ExtractorRequestFamilyMedia     ExtractorRequestFamily = "media"
	ExtractorRequestFamilyTimeline  ExtractorRequestFamily = "timeline"
	ExtractorRequestFamilyDateRange ExtractorRequestFamily = "date_range"
)

type ExtractorFamilyGateSummary struct {
	Gate          ExtractorValidationGate `json:"gate"`
	EnabledCases  int                     `json:"enabled_cases"`
	PassedCases   int                     `json:"passed_cases"`
	MismatchCases int                     `json:"mismatch_cases"`
	FailedCases   int                     `json:"failed_cases"`
	InvalidCases  int                     `json:"invalid_cases"`
}

type ExtractorPublicFamilyGates struct {
	Media     ExtractorFamilyGateSummary `json:"media"`
	Timeline  ExtractorFamilyGateSummary `json:"timeline"`
	DateRange ExtractorFamilyGateSummary `json:"date_range"`
}

type ExtractorLiveFamilyGates struct {
	Media     ExtractorFamilyGateSummary `json:"media"`
	Timeline  ExtractorFamilyGateSummary `json:"timeline"`
	DateRange ExtractorFamilyGateSummary `json:"date_range"`
}

type ExtractorPromotionFamilyGates struct {
	Media     ExtractorFamilyGateSummary `json:"media"`
	Timeline  ExtractorFamilyGateSummary `json:"timeline"`
	DateRange ExtractorFamilyGateSummary `json:"date_range"`
}

type ExtractorPublicTrialPolicyState struct {
	Armed     bool   `json:"armed"`
	ArmedAt   string `json:"armed_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type ExtractorRolloutPolicyPublicTrials struct {
	Media     ExtractorPublicTrialPolicyState `json:"media"`
	Timeline  ExtractorPublicTrialPolicyState `json:"timeline"`
	DateRange ExtractorPublicTrialPolicyState `json:"date_range"`
}

type ExtractorRolloutPolicy struct {
	UpdatedAt    string                             `json:"updated_at,omitempty"`
	PublicTrials ExtractorRolloutPolicyPublicTrials `json:"public_trials"`
}

type ExtractorPublicTrialState struct {
	Armed          bool                    `json:"armed"`
	ArmedAt        string                  `json:"armed_at,omitempty"`
	UpdatedAt      string                  `json:"updated_at,omitempty"`
	Gate           ExtractorValidationGate `json:"gate"`
	Active         bool                    `json:"active"`
	InactiveReason string                  `json:"inactive_reason,omitempty"`
}

type ExtractorPublicTrialStates struct {
	Media     ExtractorPublicTrialState `json:"media"`
	Timeline  ExtractorPublicTrialState `json:"timeline"`
	DateRange ExtractorPublicTrialState `json:"date_range"`
}

type extractorModeResolution struct {
	ConfiguredMode      ExtractorEngineMode
	EffectiveMode       ExtractorEngineMode
	ModeSource          string
	RequestFamily       ExtractorRequestFamily
	TrialArmed          bool
	TrialActive         bool
	TrialInactiveReason string
}

type extractorExecutionOverride struct {
	CandidatePublicFamily ExtractorRequestFamily
}

func defaultExtractorFamilyGateSummary() ExtractorFamilyGateSummary {
	return ExtractorFamilyGateSummary{Gate: ExtractorValidationGateIncomplete}
}

func defaultExtractorPublicFamilyGates() ExtractorPublicFamilyGates {
	return ExtractorPublicFamilyGates{
		Media:     defaultExtractorFamilyGateSummary(),
		Timeline:  defaultExtractorFamilyGateSummary(),
		DateRange: defaultExtractorFamilyGateSummary(),
	}
}

func defaultExtractorLiveFamilyGates() ExtractorLiveFamilyGates {
	return ExtractorLiveFamilyGates{
		Media:     defaultExtractorFamilyGateSummary(),
		Timeline:  defaultExtractorFamilyGateSummary(),
		DateRange: defaultExtractorFamilyGateSummary(),
	}
}

func defaultExtractorPromotionFamilyGates() ExtractorPromotionFamilyGates {
	return ExtractorPromotionFamilyGates{
		Media:     defaultExtractorFamilyGateSummary(),
		Timeline:  defaultExtractorFamilyGateSummary(),
		DateRange: defaultExtractorFamilyGateSummary(),
	}
}

func defaultExtractorRolloutPolicy() ExtractorRolloutPolicy {
	return ExtractorRolloutPolicy{
		PublicTrials: ExtractorRolloutPolicyPublicTrials{},
	}
}

func defaultExtractorPublicTrialStates() ExtractorPublicTrialStates {
	return ExtractorPublicTrialStates{
		Media:     ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
		Timeline:  ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
		DateRange: ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
	}
}

func extractorRolloutPolicyPath() string {
	return ResolveAppDataPath("extractor_rollout_policy.json")
}

func loadExtractorRolloutPolicy() (ExtractorRolloutPolicy, error) {
	policy := defaultExtractorRolloutPolicy()
	raw, err := os.ReadFile(extractorRolloutPolicyPath())
	if err != nil {
		if os.IsNotExist(err) {
			return policy, nil
		}
		return policy, err
	}
	if err := json.Unmarshal(raw, &policy); err != nil {
		return defaultExtractorRolloutPolicy(), err
	}
	return sanitizeExtractorRolloutPolicy(policy, false), nil
}

func SaveExtractorRolloutPolicy(policy ExtractorRolloutPolicy) (ExtractorRolloutPolicy, error) {
	if err := EnsureAppDataDir(); err != nil {
		return ExtractorRolloutPolicy{}, err
	}

	current, err := loadExtractorRolloutPolicy()
	if err != nil {
		return ExtractorRolloutPolicy{}, err
	}

	policy = sanitizeExtractorRolloutPolicy(policy, false)
	publicGate, _, familyGates := loadExtractorValidationGates()

	if err := validateExtractorRolloutPolicyTransition(current, policy, publicGate, familyGates); err != nil {
		return ExtractorRolloutPolicy{}, err
	}

	now := formatExtractorRunbookTimestamp(extractorRunbookNow())
	policy = stampExtractorRolloutPolicy(current, policy, now)
	data, err := json.MarshalIndent(policy, "", "  ")
	if err != nil {
		return ExtractorRolloutPolicy{}, err
	}
	data = append(data, '\n')
	if err := os.WriteFile(extractorRolloutPolicyPath(), data, 0o600); err != nil {
		return ExtractorRolloutPolicy{}, err
	}
	return policy, nil
}

func sanitizeExtractorRolloutPolicy(policy ExtractorRolloutPolicy, assignUpdatedAt bool) ExtractorRolloutPolicy {
	policy.UpdatedAt = strings.TrimSpace(policy.UpdatedAt)
	policy.PublicTrials.Media = sanitizeExtractorPublicTrialPolicyState(policy.PublicTrials.Media)
	policy.PublicTrials.Timeline = sanitizeExtractorPublicTrialPolicyState(policy.PublicTrials.Timeline)
	policy.PublicTrials.DateRange = sanitizeExtractorPublicTrialPolicyState(policy.PublicTrials.DateRange)
	if assignUpdatedAt && policy.UpdatedAt == "" {
		policy.UpdatedAt = formatExtractorRunbookTimestamp(extractorRunbookNow())
	}
	return policy
}

func sanitizeExtractorPublicTrialPolicyState(state ExtractorPublicTrialPolicyState) ExtractorPublicTrialPolicyState {
	state.ArmedAt = strings.TrimSpace(state.ArmedAt)
	state.UpdatedAt = strings.TrimSpace(state.UpdatedAt)
	return state
}

func stampExtractorRolloutPolicy(
	current ExtractorRolloutPolicy,
	next ExtractorRolloutPolicy,
	now string,
) ExtractorRolloutPolicy {
	next.PublicTrials.Media = stampExtractorPublicTrialPolicyState(current.PublicTrials.Media, next.PublicTrials.Media, now)
	next.PublicTrials.Timeline = stampExtractorPublicTrialPolicyState(current.PublicTrials.Timeline, next.PublicTrials.Timeline, now)
	next.PublicTrials.DateRange = stampExtractorPublicTrialPolicyState(current.PublicTrials.DateRange, next.PublicTrials.DateRange, now)
	next.UpdatedAt = now
	return next
}

func stampExtractorPublicTrialPolicyState(
	current ExtractorPublicTrialPolicyState,
	next ExtractorPublicTrialPolicyState,
	now string,
) ExtractorPublicTrialPolicyState {
	next = sanitizeExtractorPublicTrialPolicyState(next)
	if next.Armed {
		if !current.Armed || next.ArmedAt == "" {
			next.ArmedAt = now
		} else if next.ArmedAt == "" {
			next.ArmedAt = current.ArmedAt
		}
	} else {
		next.ArmedAt = ""
	}

	if current.Armed != next.Armed || current.ArmedAt != next.ArmedAt {
		next.UpdatedAt = now
	} else if next.UpdatedAt == "" {
		next.UpdatedAt = current.UpdatedAt
	}
	return next
}

func validateExtractorRolloutPolicyTransition(
	current ExtractorRolloutPolicy,
	next ExtractorRolloutPolicy,
	publicGate ExtractorValidationGate,
	familyGates ExtractorPublicFamilyGates,
) error {
	check := func(
		family ExtractorRequestFamily,
		currentState ExtractorPublicTrialPolicyState,
		nextState ExtractorPublicTrialPolicyState,
		familyGate ExtractorFamilyGateSummary,
	) error {
		if !nextState.Armed || currentState.Armed {
			return nil
		}
		if publicGate != ExtractorValidationGateReady && familyGate.Gate != ExtractorValidationGateReady {
			return fmt.Errorf("%s public trial can only be armed when its family gate is ready", family)
		}
		if familyGate.Gate != ExtractorValidationGateReady {
			return fmt.Errorf("%s public trial can only be armed when its family gate is ready", family)
		}
		return nil
	}

	if err := check(ExtractorRequestFamilyMedia, current.PublicTrials.Media, next.PublicTrials.Media, familyGates.Media); err != nil {
		return err
	}
	if err := check(ExtractorRequestFamilyTimeline, current.PublicTrials.Timeline, next.PublicTrials.Timeline, familyGates.Timeline); err != nil {
		return err
	}
	if err := check(ExtractorRequestFamilyDateRange, current.PublicTrials.DateRange, next.PublicTrials.DateRange, familyGates.DateRange); err != nil {
		return err
	}
	return nil
}

func buildExtractorPublicTrialStates(
	policy ExtractorRolloutPolicy,
	familyGates ExtractorPublicFamilyGates,
) ExtractorPublicTrialStates {
	return ExtractorPublicTrialStates{
		Media:     buildExtractorPublicTrialState(policy.PublicTrials.Media, familyGates.Media),
		Timeline:  buildExtractorPublicTrialState(policy.PublicTrials.Timeline, familyGates.Timeline),
		DateRange: buildExtractorPublicTrialState(policy.PublicTrials.DateRange, familyGates.DateRange),
	}
}

func buildExtractorPublicTrialState(
	policyState ExtractorPublicTrialPolicyState,
	familyGate ExtractorFamilyGateSummary,
) ExtractorPublicTrialState {
	state := ExtractorPublicTrialState{
		Armed:     policyState.Armed,
		ArmedAt:   policyState.ArmedAt,
		UpdatedAt: policyState.UpdatedAt,
		Gate:      familyGate.Gate,
	}
	if !state.Armed {
		return state
	}
	if familyGate.Gate == ExtractorValidationGateReady {
		state.Active = true
		return state
	}
	switch familyGate.Gate {
	case ExtractorValidationGateBlocked:
		state.InactiveReason = "armed but inactive because the family gate is blocked"
	default:
		state.InactiveReason = "armed but inactive because the family gate is not ready"
	}
	return state
}

func loadExtractorValidationGates() (ExtractorValidationGate, ExtractorValidationGate, ExtractorPublicFamilyGates) {
	runbookConfig, err := loadExtractorRunbookConfig()
	if err != nil {
		runbookConfig = ExtractorRunbookConfig{Presets: []ExtractorRunbookPreset{}}
	}
	recentValidationReports, err := loadExtractorValidationReportSummaries(extractorValidationReportSnapshotSummaryLimit)
	if err != nil {
		recentValidationReports = []ExtractorValidationReportSummary{}
	}
	return resolveExtractorValidationGates(runbookConfig, recentValidationReports)
}

func extractorValidationFamilyForPreset(preset ExtractorRunbookPreset) (ExtractorRequestFamily, bool) {
	if preset.Scope != ExtractorValidationScopePublic {
		return "", false
	}
	if preset.RequestKind == "date_range" {
		return ExtractorRequestFamilyDateRange, true
	}
	switch trimLower(preset.TimelineType) {
	case "media":
		return ExtractorRequestFamilyMedia, true
	case "timeline", "tweets", "with_replies":
		return ExtractorRequestFamilyTimeline, true
	default:
		return "", false
	}
}

func extractorValidationFamilyForCase(caseReport ExtractorValidationCaseReport) (ExtractorRequestFamily, bool) {
	if caseReport.Scope != ExtractorValidationScopePublic {
		return "", false
	}
	switch caseReport.RequestFamily {
	case ExtractorRequestFamilyMedia, ExtractorRequestFamilyTimeline, ExtractorRequestFamilyDateRange:
		return caseReport.RequestFamily, true
	default:
		return "", false
	}
}

func extractorTimelineRequestFamily(req TimelineRequest) (ExtractorRequestFamily, bool) {
	spec := buildTimelineExtractorSpec(req)
	switch trimLower(spec.timelineType) {
	case "media":
		return ExtractorRequestFamilyMedia, true
	case "timeline", "tweets", "with_replies":
		return ExtractorRequestFamilyTimeline, true
	default:
		return "", false
	}
}

func extractorDateRangeRequestFamily(req DateRangeRequest) (ExtractorRequestFamily, bool) {
	if cleanUsername(req.Username) == "" {
		return "", false
	}
	return ExtractorRequestFamilyDateRange, true
}

func extractorFamilyGateByName(gates ExtractorPublicFamilyGates, family ExtractorRequestFamily) ExtractorFamilyGateSummary {
	switch family {
	case ExtractorRequestFamilyMedia:
		return gates.Media
	case ExtractorRequestFamilyTimeline:
		return gates.Timeline
	case ExtractorRequestFamilyDateRange:
		return gates.DateRange
	default:
		return defaultExtractorFamilyGateSummary()
	}
}

func extractorPolicyStateByFamily(policy ExtractorRolloutPolicy, family ExtractorRequestFamily) ExtractorPublicTrialPolicyState {
	switch family {
	case ExtractorRequestFamilyMedia:
		return policy.PublicTrials.Media
	case ExtractorRequestFamilyTimeline:
		return policy.PublicTrials.Timeline
	case ExtractorRequestFamilyDateRange:
		return policy.PublicTrials.DateRange
	default:
		return ExtractorPublicTrialPolicyState{}
	}
}

func resolveTimelineExtractorMode(mode ExtractorEngineMode, req TimelineRequest) extractorModeResolution {
	return resolveTimelineExtractorModeForExecution(mode, req, nil)
}

func resolveTimelineExtractorModeForExecution(
	mode ExtractorEngineMode,
	req TimelineRequest,
	override *extractorExecutionOverride,
) extractorModeResolution {
	resolution := extractorModeResolution{
		ConfiguredMode: mode,
		EffectiveMode:  mode,
		ModeSource:     "env",
	}
	family, ok := extractorTimelineRequestFamily(req)
	if !ok {
		return resolution
	}
	resolution.RequestFamily = family
	if applyExtractorExecutionOverride(&resolution, family, override) {
		return resolution
	}
	if mode != ExtractorEngineModePython {
		return resolution
	}
	return resolvePublicTrialMode(resolution, family)
}

func resolveDateRangeExtractorMode(mode ExtractorEngineMode, req DateRangeRequest) extractorModeResolution {
	return resolveDateRangeExtractorModeForExecution(mode, req, nil)
}

func resolveDateRangeExtractorModeForExecution(
	mode ExtractorEngineMode,
	req DateRangeRequest,
	override *extractorExecutionOverride,
) extractorModeResolution {
	resolution := extractorModeResolution{
		ConfiguredMode: mode,
		EffectiveMode:  mode,
		ModeSource:     "env",
	}
	family, ok := extractorDateRangeRequestFamily(req)
	if !ok {
		return resolution
	}
	resolution.RequestFamily = family
	if applyExtractorExecutionOverride(&resolution, family, override) {
		return resolution
	}
	if mode != ExtractorEngineModePython {
		return resolution
	}
	return resolvePublicTrialMode(resolution, family)
}

func applyExtractorExecutionOverride(
	resolution *extractorModeResolution,
	family ExtractorRequestFamily,
	override *extractorExecutionOverride,
) bool {
	if resolution == nil || override == nil {
		return false
	}
	if resolution.ConfiguredMode != ExtractorEngineModePython {
		return false
	}
	if override.CandidatePublicFamily == "" || family != override.CandidatePublicFamily {
		return false
	}
	resolution.ModeSource = "live_validation"
	resolution.TrialArmed = true
	resolution.TrialActive = true
	resolution.TrialInactiveReason = ""
	resolution.EffectiveMode = ExtractorEngineModeAuto
	return true
}

func resolvePublicTrialMode(
	resolution extractorModeResolution,
	family ExtractorRequestFamily,
) extractorModeResolution {
	policy, err := loadExtractorRolloutPolicy()
	if err != nil {
		return resolution
	}
	_, _, familyGates := loadExtractorValidationGates()
	trialState := buildExtractorPublicTrialStates(policy, familyGates)

	var state ExtractorPublicTrialState
	switch family {
	case ExtractorRequestFamilyMedia:
		state = trialState.Media
	case ExtractorRequestFamilyTimeline:
		state = trialState.Timeline
	case ExtractorRequestFamilyDateRange:
		state = trialState.DateRange
	default:
		return resolution
	}

	if !state.Armed {
		return resolution
	}

	resolution.ModeSource = "rollout_policy"
	resolution.TrialArmed = true
	resolution.TrialActive = state.Active
	resolution.TrialInactiveReason = strings.TrimSpace(state.InactiveReason)
	if state.Active {
		resolution.EffectiveMode = ExtractorEngineModeAuto
	}
	return resolution
}
