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
	ExtractorRequestFamilyLikes     ExtractorRequestFamily = "likes"
	ExtractorRequestFamilyBookmarks ExtractorRequestFamily = "bookmarks"
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

type ExtractorPrivateFamilyGates struct {
	Likes     ExtractorFamilyGateSummary `json:"likes"`
	Bookmarks ExtractorFamilyGateSummary `json:"bookmarks"`
}

type ExtractorPublicTrialPolicyState struct {
	Armed     bool   `json:"armed"`
	ArmedAt   string `json:"armed_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type ExtractorPublicPromotionPolicyState struct {
	Promoted                   bool                    `json:"promoted"`
	PromotedAt                 string                  `json:"promoted_at,omitempty"`
	UpdatedAt                  string                  `json:"updated_at,omitempty"`
	BaselineCapturedAt         string                  `json:"baseline_captured_at,omitempty"`
	BaselineConfigUpdatedAt    string                  `json:"baseline_config_updated_at,omitempty"`
	BaselineValidationReportID string                  `json:"baseline_validation_report_id,omitempty"`
	BaselineLiveReportID       string                  `json:"baseline_live_report_id,omitempty"`
	BaselinePromotionGate      ExtractorValidationGate `json:"baseline_promotion_gate,omitempty"`
}

type ExtractorRolloutPolicyPublicTrials struct {
	Media     ExtractorPublicTrialPolicyState `json:"media"`
	Timeline  ExtractorPublicTrialPolicyState `json:"timeline"`
	DateRange ExtractorPublicTrialPolicyState `json:"date_range"`
}

type ExtractorRolloutPolicyPublicPromotions struct {
	Media     ExtractorPublicPromotionPolicyState `json:"media"`
	Timeline  ExtractorPublicPromotionPolicyState `json:"timeline"`
	DateRange ExtractorPublicPromotionPolicyState `json:"date_range"`
}

type ExtractorRolloutPolicyPrivateTrials struct {
	Likes     ExtractorPublicTrialPolicyState `json:"likes"`
	Bookmarks ExtractorPublicTrialPolicyState `json:"bookmarks"`
}

type ExtractorRolloutPolicyPrivatePromotions struct {
	Likes     ExtractorPublicPromotionPolicyState `json:"likes"`
	Bookmarks ExtractorPublicPromotionPolicyState `json:"bookmarks"`
}

type ExtractorRolloutPolicy struct {
	UpdatedAt         string                                  `json:"updated_at,omitempty"`
	PublicTrials      ExtractorRolloutPolicyPublicTrials      `json:"public_trials"`
	PublicPromotions  ExtractorRolloutPolicyPublicPromotions  `json:"public_promotions"`
	PrivateTrials     ExtractorRolloutPolicyPrivateTrials     `json:"private_trials"`
	PrivatePromotions ExtractorRolloutPolicyPrivatePromotions `json:"private_promotions"`
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

type ExtractorPublicPromotionState struct {
	Promoted                     bool                    `json:"promoted"`
	PromotedAt                   string                  `json:"promoted_at,omitempty"`
	UpdatedAt                    string                  `json:"updated_at,omitempty"`
	BaselineCapturedAt           string                  `json:"baseline_captured_at,omitempty"`
	BaselineConfigUpdatedAt      string                  `json:"baseline_config_updated_at,omitempty"`
	BaselineValidationReportID   string                  `json:"baseline_validation_report_id,omitempty"`
	BaselineLiveReportID         string                  `json:"baseline_live_report_id,omitempty"`
	BaselinePromotionGate        ExtractorValidationGate `json:"baseline_promotion_gate,omitempty"`
	Gate                         ExtractorValidationGate `json:"gate"`
	CurrentPromotionGate         ExtractorValidationGate `json:"current_promotion_gate,omitempty"`
	CurrentConfigMatchesBaseline bool                    `json:"current_config_matches_baseline"`
	LatestEvidenceDrifted        bool                    `json:"latest_evidence_drifted"`
	Active                       bool                    `json:"active"`
	InactiveReason               string                  `json:"inactive_reason,omitempty"`
}

type ExtractorPublicPromotionStates struct {
	Media     ExtractorPublicPromotionState `json:"media"`
	Timeline  ExtractorPublicPromotionState `json:"timeline"`
	DateRange ExtractorPublicPromotionState `json:"date_range"`
}

type ExtractorPrivateTrialStates struct {
	Likes     ExtractorPublicTrialState `json:"likes"`
	Bookmarks ExtractorPublicTrialState `json:"bookmarks"`
}

type ExtractorPrivatePromotionStates struct {
	Likes     ExtractorPublicPromotionState `json:"likes"`
	Bookmarks ExtractorPublicPromotionState `json:"bookmarks"`
}

type extractorModeResolution struct {
	ConfiguredMode          ExtractorEngineMode
	EffectiveMode           ExtractorEngineMode
	ModeSource              string
	RequestFamily           ExtractorRequestFamily
	AllowPrivateAuto        bool
	TrialArmed              bool
	TrialActive             bool
	TrialInactiveReason     string
	PromotionEnabled        bool
	PromotionActive         bool
	PromotionInactiveReason string
}

type extractorExecutionOverride struct {
	CandidateFamily ExtractorRequestFamily
}

type extractorPromotionBaselineEvidence struct {
	ConfigUpdatedAt    string
	ValidationReportID string
	LiveReportID       string
	PromotionGate      ExtractorValidationGate
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

func defaultExtractorPrivateFamilyGates() ExtractorPrivateFamilyGates {
	return ExtractorPrivateFamilyGates{
		Likes:     defaultExtractorFamilyGateSummary(),
		Bookmarks: defaultExtractorFamilyGateSummary(),
	}
}

func defaultExtractorRolloutPolicy() ExtractorRolloutPolicy {
	return ExtractorRolloutPolicy{
		PublicTrials:      ExtractorRolloutPolicyPublicTrials{},
		PublicPromotions:  ExtractorRolloutPolicyPublicPromotions{},
		PrivateTrials:     ExtractorRolloutPolicyPrivateTrials{},
		PrivatePromotions: ExtractorRolloutPolicyPrivatePromotions{},
	}
}

func defaultExtractorPublicTrialStates() ExtractorPublicTrialStates {
	return ExtractorPublicTrialStates{
		Media:     ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
		Timeline:  ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
		DateRange: ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
	}
}

func defaultExtractorPublicPromotionStates() ExtractorPublicPromotionStates {
	return ExtractorPublicPromotionStates{
		Media:     ExtractorPublicPromotionState{Gate: ExtractorValidationGateIncomplete},
		Timeline:  ExtractorPublicPromotionState{Gate: ExtractorValidationGateIncomplete},
		DateRange: ExtractorPublicPromotionState{Gate: ExtractorValidationGateIncomplete},
	}
}

func defaultExtractorPrivateTrialStates() ExtractorPrivateTrialStates {
	return ExtractorPrivateTrialStates{
		Likes:     ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
		Bookmarks: ExtractorPublicTrialState{Gate: ExtractorValidationGateIncomplete},
	}
}

func defaultExtractorPrivatePromotionStates() ExtractorPrivatePromotionStates {
	return ExtractorPrivatePromotionStates{
		Likes:     ExtractorPublicPromotionState{Gate: ExtractorValidationGateIncomplete},
		Bookmarks: ExtractorPublicPromotionState{Gate: ExtractorValidationGateIncomplete},
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
	runbookConfig, err := loadExtractorRunbookConfig()
	if err != nil {
		runbookConfig = ExtractorRunbookConfig{Presets: []ExtractorRunbookPreset{}}
	}
	validationSummaries, err := loadExtractorValidationReportSummaries(extractorValidationReportSnapshotSummaryLimit)
	if err != nil {
		validationSummaries = []ExtractorValidationReportSummary{}
	}
	liveSummaries, err := loadExtractorLiveValidationReportSummaries(extractorLiveValidationReportSnapshotSummaryLimit)
	if err != nil {
		liveSummaries = []ExtractorLiveValidationReportSummary{}
	}
	_, _, familyGates, privateFamilyGates := resolveExtractorValidationGates(runbookConfig, validationSummaries)
	_, promotionFamilyGates, _, privatePromotionFamilyGates := resolveExtractorLiveValidationGates(runbookConfig, liveSummaries)
	promotionEvidence := resolveExtractorPromotionBaselineEvidenceSet(
		runbookConfig,
		validationSummaries,
		liveSummaries,
		promotionFamilyGates,
		privatePromotionFamilyGates,
	)

	if err := validateExtractorRolloutPolicyTransition(
		current,
		policy,
		familyGates,
		privateFamilyGates,
		promotionFamilyGates,
		privatePromotionFamilyGates,
		promotionEvidence,
	); err != nil {
		return ExtractorRolloutPolicy{}, err
	}

	now := formatExtractorRunbookTimestamp(extractorRunbookNow())
	policy = stampExtractorRolloutPolicy(current, policy, now, promotionEvidence)
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
	policy.PublicPromotions.Media = sanitizeExtractorPublicPromotionPolicyState(policy.PublicPromotions.Media)
	policy.PublicPromotions.Timeline = sanitizeExtractorPublicPromotionPolicyState(policy.PublicPromotions.Timeline)
	policy.PublicPromotions.DateRange = sanitizeExtractorPublicPromotionPolicyState(policy.PublicPromotions.DateRange)
	policy.PrivateTrials.Likes = sanitizeExtractorPublicTrialPolicyState(policy.PrivateTrials.Likes)
	policy.PrivateTrials.Bookmarks = sanitizeExtractorPublicTrialPolicyState(policy.PrivateTrials.Bookmarks)
	policy.PrivatePromotions.Likes = sanitizeExtractorPublicPromotionPolicyState(policy.PrivatePromotions.Likes)
	policy.PrivatePromotions.Bookmarks = sanitizeExtractorPublicPromotionPolicyState(policy.PrivatePromotions.Bookmarks)
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

func sanitizeExtractorPublicPromotionPolicyState(state ExtractorPublicPromotionPolicyState) ExtractorPublicPromotionPolicyState {
	state.PromotedAt = strings.TrimSpace(state.PromotedAt)
	state.UpdatedAt = strings.TrimSpace(state.UpdatedAt)
	state.BaselineCapturedAt = strings.TrimSpace(state.BaselineCapturedAt)
	state.BaselineConfigUpdatedAt = strings.TrimSpace(state.BaselineConfigUpdatedAt)
	state.BaselineValidationReportID = strings.TrimSpace(state.BaselineValidationReportID)
	state.BaselineLiveReportID = strings.TrimSpace(state.BaselineLiveReportID)
	state.BaselinePromotionGate = ExtractorValidationGate(trimLower(string(state.BaselinePromotionGate)))
	return state
}

func stampExtractorRolloutPolicy(
	current ExtractorRolloutPolicy,
	next ExtractorRolloutPolicy,
	now string,
	promotionEvidence map[ExtractorRequestFamily]extractorPromotionBaselineEvidence,
) ExtractorRolloutPolicy {
	next.PublicTrials.Media = stampExtractorPublicTrialPolicyState(current.PublicTrials.Media, next.PublicTrials.Media, now)
	next.PublicTrials.Timeline = stampExtractorPublicTrialPolicyState(current.PublicTrials.Timeline, next.PublicTrials.Timeline, now)
	next.PublicTrials.DateRange = stampExtractorPublicTrialPolicyState(current.PublicTrials.DateRange, next.PublicTrials.DateRange, now)
	next.PrivateTrials.Likes = stampExtractorPublicTrialPolicyState(current.PrivateTrials.Likes, next.PrivateTrials.Likes, now)
	next.PrivateTrials.Bookmarks = stampExtractorPublicTrialPolicyState(current.PrivateTrials.Bookmarks, next.PrivateTrials.Bookmarks, now)
	next.PublicPromotions.Media = stampExtractorPublicPromotionPolicyState(
		current.PublicPromotions.Media,
		next.PublicPromotions.Media,
		now,
		promotionEvidence[ExtractorRequestFamilyMedia],
	)
	next.PublicPromotions.Timeline = stampExtractorPublicPromotionPolicyState(
		current.PublicPromotions.Timeline,
		next.PublicPromotions.Timeline,
		now,
		promotionEvidence[ExtractorRequestFamilyTimeline],
	)
	next.PublicPromotions.DateRange = stampExtractorPublicPromotionPolicyState(
		current.PublicPromotions.DateRange,
		next.PublicPromotions.DateRange,
		now,
		promotionEvidence[ExtractorRequestFamilyDateRange],
	)
	next.PrivatePromotions.Likes = stampExtractorPublicPromotionPolicyState(
		current.PrivatePromotions.Likes,
		next.PrivatePromotions.Likes,
		now,
		promotionEvidence[ExtractorRequestFamilyLikes],
	)
	next.PrivatePromotions.Bookmarks = stampExtractorPublicPromotionPolicyState(
		current.PrivatePromotions.Bookmarks,
		next.PrivatePromotions.Bookmarks,
		now,
		promotionEvidence[ExtractorRequestFamilyBookmarks],
	)
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

func stampExtractorPublicPromotionPolicyState(
	current ExtractorPublicPromotionPolicyState,
	next ExtractorPublicPromotionPolicyState,
	now string,
	evidence extractorPromotionBaselineEvidence,
) ExtractorPublicPromotionPolicyState {
	next = sanitizeExtractorPublicPromotionPolicyState(next)
	if next.Promoted {
		if !current.Promoted || next.PromotedAt == "" {
			next.PromotedAt = now
		} else if next.PromotedAt == "" {
			next.PromotedAt = current.PromotedAt
		}
		if !current.Promoted {
			next.BaselineCapturedAt = now
			next.BaselineConfigUpdatedAt = evidence.ConfigUpdatedAt
			next.BaselineValidationReportID = evidence.ValidationReportID
			next.BaselineLiveReportID = evidence.LiveReportID
			next.BaselinePromotionGate = evidence.PromotionGate
		} else {
			next.BaselineCapturedAt = current.BaselineCapturedAt
			next.BaselineConfigUpdatedAt = current.BaselineConfigUpdatedAt
			next.BaselineValidationReportID = current.BaselineValidationReportID
			next.BaselineLiveReportID = current.BaselineLiveReportID
			next.BaselinePromotionGate = current.BaselinePromotionGate
		}
	} else {
		next.PromotedAt = ""
		next.BaselineCapturedAt = ""
		next.BaselineConfigUpdatedAt = ""
		next.BaselineValidationReportID = ""
		next.BaselineLiveReportID = ""
		next.BaselinePromotionGate = ""
	}

	if current.Promoted != next.Promoted || current.PromotedAt != next.PromotedAt {
		next.UpdatedAt = now
	} else if next.UpdatedAt == "" {
		next.UpdatedAt = current.UpdatedAt
	}
	return next
}

func validateExtractorRolloutPolicyTransition(
	current ExtractorRolloutPolicy,
	next ExtractorRolloutPolicy,
	familyGates ExtractorPublicFamilyGates,
	privateFamilyGates ExtractorPrivateFamilyGates,
	promotionFamilyGates ExtractorPromotionFamilyGates,
	privatePromotionFamilyGates ExtractorPrivateFamilyGates,
	promotionEvidence map[ExtractorRequestFamily]extractorPromotionBaselineEvidence,
) error {
	checkTrial := func(
		family ExtractorRequestFamily,
		currentState ExtractorPublicTrialPolicyState,
		nextState ExtractorPublicTrialPolicyState,
		familyGate ExtractorFamilyGateSummary,
	) error {
		if !nextState.Armed || currentState.Armed {
			return nil
		}
		if familyGate.Gate != ExtractorValidationGateReady {
			return fmt.Errorf("%s public trial can only be armed when its family gate is ready", family)
		}
		return nil
	}

	checkPromotion := func(
		family ExtractorRequestFamily,
		currentState ExtractorPublicPromotionPolicyState,
		nextState ExtractorPublicPromotionPolicyState,
		familyGate ExtractorFamilyGateSummary,
	) error {
		if !nextState.Promoted || currentState.Promoted {
			return nil
		}
		if familyGate.Gate != ExtractorValidationGateReady {
			return fmt.Errorf("%s public promotion can only be enabled when its promotion gate is ready", family)
		}
		evidence := promotionEvidence[family]
		if strings.TrimSpace(evidence.ConfigUpdatedAt) == "" ||
			strings.TrimSpace(evidence.ValidationReportID) == "" ||
			strings.TrimSpace(evidence.LiveReportID) == "" ||
			evidence.PromotionGate != ExtractorValidationGateReady {
			return fmt.Errorf("%s public promotion requires a matching validation and live baseline", family)
		}
		return nil
	}

	if err := checkTrial(ExtractorRequestFamilyMedia, current.PublicTrials.Media, next.PublicTrials.Media, familyGates.Media); err != nil {
		return err
	}
	if err := checkTrial(ExtractorRequestFamilyTimeline, current.PublicTrials.Timeline, next.PublicTrials.Timeline, familyGates.Timeline); err != nil {
		return err
	}
	if err := checkTrial(ExtractorRequestFamilyDateRange, current.PublicTrials.DateRange, next.PublicTrials.DateRange, familyGates.DateRange); err != nil {
		return err
	}
	if err := checkTrial(ExtractorRequestFamilyLikes, current.PrivateTrials.Likes, next.PrivateTrials.Likes, privateFamilyGates.Likes); err != nil {
		return err
	}
	if err := checkTrial(ExtractorRequestFamilyBookmarks, current.PrivateTrials.Bookmarks, next.PrivateTrials.Bookmarks, privateFamilyGates.Bookmarks); err != nil {
		return err
	}
	if err := checkPromotion(ExtractorRequestFamilyMedia, current.PublicPromotions.Media, next.PublicPromotions.Media, promotionFamilyGates.Media); err != nil {
		return err
	}
	if err := checkPromotion(ExtractorRequestFamilyTimeline, current.PublicPromotions.Timeline, next.PublicPromotions.Timeline, promotionFamilyGates.Timeline); err != nil {
		return err
	}
	if err := checkPromotion(ExtractorRequestFamilyDateRange, current.PublicPromotions.DateRange, next.PublicPromotions.DateRange, promotionFamilyGates.DateRange); err != nil {
		return err
	}
	if err := checkPromotion(ExtractorRequestFamilyLikes, current.PrivatePromotions.Likes, next.PrivatePromotions.Likes, privatePromotionFamilyGates.Likes); err != nil {
		return err
	}
	if err := checkPromotion(ExtractorRequestFamilyBookmarks, current.PrivatePromotions.Bookmarks, next.PrivatePromotions.Bookmarks, privatePromotionFamilyGates.Bookmarks); err != nil {
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

func buildExtractorPublicPromotionStates(
	policy ExtractorRolloutPolicy,
	familyGates ExtractorPromotionFamilyGates,
	currentConfigUpdatedAt string,
) ExtractorPublicPromotionStates {
	return ExtractorPublicPromotionStates{
		Media:     buildExtractorPublicPromotionState(policy.PublicPromotions.Media, familyGates.Media, currentConfigUpdatedAt),
		Timeline:  buildExtractorPublicPromotionState(policy.PublicPromotions.Timeline, familyGates.Timeline, currentConfigUpdatedAt),
		DateRange: buildExtractorPublicPromotionState(policy.PublicPromotions.DateRange, familyGates.DateRange, currentConfigUpdatedAt),
	}
}

func buildExtractorPrivateTrialStates(
	policy ExtractorRolloutPolicy,
	familyGates ExtractorPrivateFamilyGates,
) ExtractorPrivateTrialStates {
	return ExtractorPrivateTrialStates{
		Likes:     buildExtractorPublicTrialState(policy.PrivateTrials.Likes, familyGates.Likes),
		Bookmarks: buildExtractorPublicTrialState(policy.PrivateTrials.Bookmarks, familyGates.Bookmarks),
	}
}

func buildExtractorPrivatePromotionStates(
	policy ExtractorRolloutPolicy,
	familyGates ExtractorPrivateFamilyGates,
	currentConfigUpdatedAt string,
) ExtractorPrivatePromotionStates {
	return ExtractorPrivatePromotionStates{
		Likes:     buildExtractorPublicPromotionState(policy.PrivatePromotions.Likes, familyGates.Likes, currentConfigUpdatedAt),
		Bookmarks: buildExtractorPublicPromotionState(policy.PrivatePromotions.Bookmarks, familyGates.Bookmarks, currentConfigUpdatedAt),
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

func buildExtractorPublicPromotionState(
	policyState ExtractorPublicPromotionPolicyState,
	familyGate ExtractorFamilyGateSummary,
	currentConfigUpdatedAt string,
) ExtractorPublicPromotionState {
	state := ExtractorPublicPromotionState{
		Promoted:                   policyState.Promoted,
		PromotedAt:                 policyState.PromotedAt,
		UpdatedAt:                  policyState.UpdatedAt,
		BaselineCapturedAt:         policyState.BaselineCapturedAt,
		BaselineConfigUpdatedAt:    policyState.BaselineConfigUpdatedAt,
		BaselineValidationReportID: policyState.BaselineValidationReportID,
		BaselineLiveReportID:       policyState.BaselineLiveReportID,
		BaselinePromotionGate:      policyState.BaselinePromotionGate,
		Gate:                       familyGate.Gate,
		CurrentPromotionGate:       familyGate.Gate,
		CurrentConfigMatchesBaseline: strings.TrimSpace(policyState.BaselineConfigUpdatedAt) != "" &&
			strings.TrimSpace(policyState.BaselineConfigUpdatedAt) == strings.TrimSpace(currentConfigUpdatedAt),
	}
	if !state.Promoted {
		return state
	}
	if extractorPublicPromotionBaselineValid(policyState) {
		state.Active = true
		state.LatestEvidenceDrifted =
			!state.CurrentConfigMatchesBaseline || familyGate.Gate != ExtractorValidationGateReady
		return state
	}
	state.InactiveReason = "promoted but inactive because baseline is missing or invalid"
	return state
}

func loadExtractorValidationGates() (ExtractorValidationGate, ExtractorValidationGate, ExtractorPublicFamilyGates, ExtractorPrivateFamilyGates) {
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

func loadExtractorPromotionGates() (ExtractorPromotionFamilyGates, ExtractorPrivateFamilyGates) {
	runbookConfig, err := loadExtractorRunbookConfig()
	if err != nil {
		runbookConfig = ExtractorRunbookConfig{Presets: []ExtractorRunbookPreset{}}
	}
	recentLiveReports, err := loadExtractorLiveValidationReportSummaries(extractorLiveValidationReportSnapshotSummaryLimit)
	if err != nil {
		recentLiveReports = []ExtractorLiveValidationReportSummary{}
	}
	_, promotionFamilyGates, _, privatePromotionFamilyGates := resolveExtractorLiveValidationGates(runbookConfig, recentLiveReports)
	return promotionFamilyGates, privatePromotionFamilyGates
}

func loadExtractorPromotionContext() (
	ExtractorRunbookConfig,
	[]ExtractorValidationReportSummary,
	[]ExtractorLiveValidationReportSummary,
	ExtractorPromotionFamilyGates,
) {
	runbookConfig, err := loadExtractorRunbookConfig()
	if err != nil {
		runbookConfig = ExtractorRunbookConfig{Presets: []ExtractorRunbookPreset{}}
	}
	validationSummaries, err := loadExtractorValidationReportSummaries(extractorValidationReportSnapshotSummaryLimit)
	if err != nil {
		validationSummaries = []ExtractorValidationReportSummary{}
	}
	liveSummaries, err := loadExtractorLiveValidationReportSummaries(extractorLiveValidationReportSnapshotSummaryLimit)
	if err != nil {
		liveSummaries = []ExtractorLiveValidationReportSummary{}
	}
	_, promotionFamilyGates, _, _ := resolveExtractorLiveValidationGates(runbookConfig, liveSummaries)
	return runbookConfig, validationSummaries, liveSummaries, promotionFamilyGates
}

func extractorPublicPromotionBaselineValid(state ExtractorPublicPromotionPolicyState) bool {
	return state.Promoted &&
		strings.TrimSpace(state.BaselineCapturedAt) != "" &&
		strings.TrimSpace(state.BaselineConfigUpdatedAt) != "" &&
		strings.TrimSpace(state.BaselineValidationReportID) != "" &&
		strings.TrimSpace(state.BaselineLiveReportID) != "" &&
		state.BaselinePromotionGate == ExtractorValidationGateReady
}

func resolveMatchingValidationReportSummary(
	config ExtractorRunbookConfig,
	summaries []ExtractorValidationReportSummary,
) (ExtractorValidationReportSummary, bool) {
	configUpdatedAt := strings.TrimSpace(config.UpdatedAt)
	if configUpdatedAt == "" {
		return ExtractorValidationReportSummary{}, false
	}
	for _, summary := range summaries {
		if strings.TrimSpace(summary.ConfigUpdatedAt) == configUpdatedAt {
			return summary, true
		}
	}
	return ExtractorValidationReportSummary{}, false
}

func resolveMatchingLiveValidationReportSummary(
	config ExtractorRunbookConfig,
	summaries []ExtractorLiveValidationReportSummary,
) (ExtractorLiveValidationReportSummary, bool) {
	configUpdatedAt := strings.TrimSpace(config.UpdatedAt)
	if configUpdatedAt == "" {
		return ExtractorLiveValidationReportSummary{}, false
	}
	for _, summary := range summaries {
		if strings.TrimSpace(summary.ConfigUpdatedAt) == configUpdatedAt {
			return summary, true
		}
	}
	return ExtractorLiveValidationReportSummary{}, false
}

func resolveExtractorPromotionBaselineEvidenceSet(
	config ExtractorRunbookConfig,
	validationSummaries []ExtractorValidationReportSummary,
	liveSummaries []ExtractorLiveValidationReportSummary,
	promotionFamilyGates ExtractorPromotionFamilyGates,
	privatePromotionFamilyGates ExtractorPrivateFamilyGates,
) map[ExtractorRequestFamily]extractorPromotionBaselineEvidence {
	evidence := map[ExtractorRequestFamily]extractorPromotionBaselineEvidence{
		ExtractorRequestFamilyMedia:     {},
		ExtractorRequestFamilyTimeline:  {},
		ExtractorRequestFamilyDateRange: {},
		ExtractorRequestFamilyLikes:     {},
		ExtractorRequestFamilyBookmarks: {},
	}
	validationSummary, hasValidation := resolveMatchingValidationReportSummary(config, validationSummaries)
	liveSummary, hasLive := resolveMatchingLiveValidationReportSummary(config, liveSummaries)
	if !hasValidation || !hasLive {
		return evidence
	}
	configUpdatedAt := strings.TrimSpace(config.UpdatedAt)
	evidence[ExtractorRequestFamilyMedia] = extractorPromotionBaselineEvidence{
		ConfigUpdatedAt:    configUpdatedAt,
		ValidationReportID: strings.TrimSpace(validationSummary.ReportID),
		LiveReportID:       strings.TrimSpace(liveSummary.ReportID),
		PromotionGate:      promotionFamilyGates.Media.Gate,
	}
	evidence[ExtractorRequestFamilyTimeline] = extractorPromotionBaselineEvidence{
		ConfigUpdatedAt:    configUpdatedAt,
		ValidationReportID: strings.TrimSpace(validationSummary.ReportID),
		LiveReportID:       strings.TrimSpace(liveSummary.ReportID),
		PromotionGate:      promotionFamilyGates.Timeline.Gate,
	}
	evidence[ExtractorRequestFamilyDateRange] = extractorPromotionBaselineEvidence{
		ConfigUpdatedAt:    configUpdatedAt,
		ValidationReportID: strings.TrimSpace(validationSummary.ReportID),
		LiveReportID:       strings.TrimSpace(liveSummary.ReportID),
		PromotionGate:      promotionFamilyGates.DateRange.Gate,
	}
	evidence[ExtractorRequestFamilyLikes] = extractorPromotionBaselineEvidence{
		ConfigUpdatedAt:    configUpdatedAt,
		ValidationReportID: strings.TrimSpace(validationSummary.ReportID),
		LiveReportID:       strings.TrimSpace(liveSummary.ReportID),
		PromotionGate:      privatePromotionFamilyGates.Likes.Gate,
	}
	evidence[ExtractorRequestFamilyBookmarks] = extractorPromotionBaselineEvidence{
		ConfigUpdatedAt:    configUpdatedAt,
		ValidationReportID: strings.TrimSpace(validationSummary.ReportID),
		LiveReportID:       strings.TrimSpace(liveSummary.ReportID),
		PromotionGate:      privatePromotionFamilyGates.Bookmarks.Gate,
	}
	return evidence
}

func extractorValidationFamilyForPreset(preset ExtractorRunbookPreset) (ExtractorRequestFamily, bool) {
	if preset.RequestKind == "date_range" {
		if preset.Scope != ExtractorValidationScopePublic {
			return "", false
		}
		return ExtractorRequestFamilyDateRange, true
	}
	switch preset.Scope {
	case ExtractorValidationScopePublic:
		switch trimLower(preset.TimelineType) {
		case "media":
			return ExtractorRequestFamilyMedia, true
		case "timeline", "tweets", "with_replies":
			return ExtractorRequestFamilyTimeline, true
		}
	case ExtractorValidationScopePrivate:
		switch trimLower(preset.TimelineType) {
		case "likes":
			return ExtractorRequestFamilyLikes, true
		case "bookmarks":
			return ExtractorRequestFamilyBookmarks, true
		}
	}
	return "", false
}

func extractorValidationFamilyForCase(caseReport ExtractorValidationCaseReport) (ExtractorRequestFamily, bool) {
	switch caseReport.RequestFamily {
	case ExtractorRequestFamilyMedia, ExtractorRequestFamilyTimeline, ExtractorRequestFamilyDateRange,
		ExtractorRequestFamilyLikes, ExtractorRequestFamilyBookmarks:
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
	case "likes":
		return ExtractorRequestFamilyLikes, true
	case "bookmarks":
		return ExtractorRequestFamilyBookmarks, true
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

func extractorPrivateFamilyGateByName(gates ExtractorPrivateFamilyGates, family ExtractorRequestFamily) ExtractorFamilyGateSummary {
	switch family {
	case ExtractorRequestFamilyLikes:
		return gates.Likes
	case ExtractorRequestFamilyBookmarks:
		return gates.Bookmarks
	default:
		return defaultExtractorFamilyGateSummary()
	}
}

func extractorFamilyIsPrivate(family ExtractorRequestFamily) bool {
	switch family {
	case ExtractorRequestFamilyLikes, ExtractorRequestFamilyBookmarks:
		return true
	default:
		return false
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
	case ExtractorRequestFamilyLikes:
		return policy.PrivateTrials.Likes
	case ExtractorRequestFamilyBookmarks:
		return policy.PrivateTrials.Bookmarks
	default:
		return ExtractorPublicTrialPolicyState{}
	}
}

func extractorPromotionPolicyStateByFamily(
	policy ExtractorRolloutPolicy,
	family ExtractorRequestFamily,
) ExtractorPublicPromotionPolicyState {
	switch family {
	case ExtractorRequestFamilyMedia:
		return policy.PublicPromotions.Media
	case ExtractorRequestFamilyTimeline:
		return policy.PublicPromotions.Timeline
	case ExtractorRequestFamilyDateRange:
		return policy.PublicPromotions.DateRange
	case ExtractorRequestFamilyLikes:
		return policy.PrivatePromotions.Likes
	case ExtractorRequestFamilyBookmarks:
		return policy.PrivatePromotions.Bookmarks
	default:
		return ExtractorPublicPromotionPolicyState{}
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
		EffectiveMode:  ExtractorEngineModeGo,
		ModeSource:     "env",
	}
	family, ok := extractorTimelineRequestFamily(req)
	if !ok {
		return resolution
	}
	resolution.RequestFamily = family
	if mode == ExtractorEngineModePython {
		resolution.ModeSource = "deprecated_python_mode"
	}
	return resolution
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
		EffectiveMode:  ExtractorEngineModeGo,
		ModeSource:     "env",
	}
	family, ok := extractorDateRangeRequestFamily(req)
	if !ok {
		return resolution
	}
	resolution.RequestFamily = family
	if mode == ExtractorEngineModePython {
		resolution.ModeSource = "deprecated_python_mode"
	}
	return resolution
}

func applyExtractorExecutionOverride(
	resolution *extractorModeResolution,
	family ExtractorRequestFamily,
	override *extractorExecutionOverride,
) bool {
	return false
}

func resolveRolloutTrialMode(
	resolution extractorModeResolution,
	family ExtractorRequestFamily,
) extractorModeResolution {
	policy, err := loadExtractorRolloutPolicy()
	if err != nil {
		return resolution
	}
	_, _, familyGates, privateFamilyGates := loadExtractorValidationGates()
	var state ExtractorPublicTrialState
	if extractorFamilyIsPrivate(family) {
		trialState := buildExtractorPrivateTrialStates(policy, privateFamilyGates)
		switch family {
		case ExtractorRequestFamilyLikes:
			state = trialState.Likes
		case ExtractorRequestFamilyBookmarks:
			state = trialState.Bookmarks
		default:
			return resolution
		}
	} else {
		trialState := buildExtractorPublicTrialStates(policy, familyGates)
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
	}

	if !state.Armed {
		return resolution
	}

	resolution.ModeSource = "rollout_policy"
	resolution.TrialArmed = true
	resolution.TrialActive = state.Active
	resolution.TrialInactiveReason = strings.TrimSpace(state.InactiveReason)
	resolution.AllowPrivateAuto = extractorFamilyIsPrivate(family) && state.Active
	if state.Active {
		resolution.EffectiveMode = ExtractorEngineModeAuto
	}
	return resolution
}

func resolvePromotionMode(
	resolution extractorModeResolution,
	family ExtractorRequestFamily,
) extractorModeResolution {
	policy, err := loadExtractorRolloutPolicy()
	if err != nil {
		return resolution
	}
	policyState := extractorPromotionPolicyStateByFamily(policy, family)
	if !policyState.Promoted {
		return resolution
	}

	resolution.ModeSource = "promotion_policy"
	resolution.PromotionEnabled = true
	resolution.PromotionActive = extractorPublicPromotionBaselineValid(policyState)
	resolution.AllowPrivateAuto = extractorFamilyIsPrivate(family) && resolution.PromotionActive
	if resolution.PromotionActive {
		resolution.EffectiveMode = ExtractorEngineModeAuto
		resolution.PromotionInactiveReason = ""
		return resolution
	}
	resolution.PromotionInactiveReason = "promoted but inactive because baseline is missing or invalid"
	return resolution
}
