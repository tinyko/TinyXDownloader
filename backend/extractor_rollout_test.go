package backend

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func readyPublicMediaValidationReport(configUpdatedAt string) *ExtractorValidationReport {
	return &ExtractorValidationReport{
		ReportID:        "report-media-ready",
		CreatedAt:       "2026-04-15T06:12:00Z",
		ConfigUpdatedAt: configUpdatedAt,
		Cases: []ExtractorValidationCaseReport{
			{
				PresetID:      "public-media",
				PresetLabel:   "Public media",
				RequestKind:   "timeline",
				Scope:         ExtractorValidationScopePublic,
				RequestFamily: ExtractorRequestFamilyMedia,
				Target:        "@nasa media [all]",
				Valid:         true,
				GoSupported:   true,
				PythonSuccess: true,
				GoSuccess:     true,
				Equal:         true,
			},
		},
	}
}

func readyPublicMediaLiveReport(configUpdatedAt string) *ExtractorLiveValidationReport {
	return &ExtractorLiveValidationReport{
		ReportID:        "live-media-ready",
		CreatedAt:       "2026-04-15T06:13:00Z",
		ConfigUpdatedAt: configUpdatedAt,
		Cases: []ExtractorLiveValidationCaseReport{
			{
				PresetID:      "public-media",
				PresetLabel:   "Public media",
				RequestKind:   "timeline",
				Scope:         ExtractorValidationScopePublic,
				RequestFamily: ExtractorRequestFamilyMedia,
				Target:        "@nasa media [all]",
				Valid:         true,
				Runtime: ExtractorRuntimeValidationSummary{
					Status:         ExtractorRuntimeValidationStatusSuccess,
					ConfiguredMode: ExtractorEngineModePython,
					EffectiveMode:  ExtractorEngineModeAuto,
					ModeSource:     "live_validation",
					SelectedEngine: "go-twitter",
				},
				GoSupported:   true,
				PythonSuccess: true,
				GoSuccess:     true,
				Equal:         true,
			},
		},
	}
}

func TestSaveExtractorRolloutPolicyRequiresReadyGate(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		_, err = SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicTrials: ExtractorRolloutPolicyPublicTrials{
				Media: ExtractorPublicTrialPolicyState{Armed: true},
			},
		})
		if err == nil {
			t.Fatal("expected media arm to fail while family gate is incomplete")
		}

		report := readyPublicMediaValidationReport(savedConfig.UpdatedAt)
		applyExtractorValidationSummary(report)
		if err := saveExtractorValidationReport(report); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		savedPolicy, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicTrials: ExtractorRolloutPolicyPublicTrials{
				Media: ExtractorPublicTrialPolicyState{Armed: true},
			},
		})
		if err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}
		if !savedPolicy.PublicTrials.Media.Armed {
			t.Fatal("expected media trial to be armed")
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if snapshot.PublicTrialStates.Media.Gate != ExtractorValidationGateReady {
			t.Fatalf("expected media family gate ready, got %q", snapshot.PublicTrialStates.Media.Gate)
		}
		if !snapshot.PublicTrialStates.Media.Active {
			t.Fatal("expected armed media trial to be active when gate is ready")
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeIgnoresArmedMediaTrialInGoOnlyRuntime(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		report := readyPublicMediaValidationReport(savedConfig.UpdatedAt)
		applyExtractorValidationSummary(report)
		if err := saveExtractorValidationReport(report); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		if _, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicTrials: ExtractorRolloutPolicyPublicTrials{
				Media: ExtractorPublicTrialPolicyState{Armed: true},
			},
		}); err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}

		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-trial"
		pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
		goEngine := &stubExtractorEngine{
			name:              "go-twitter",
			timelineSupported: true,
			timelineResponse:  goResponse,
		}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, goResponse) {
			t.Fatalf("expected go response in go-only runtime, got %#v", response)
		}
		if goEngine.timelineCalls != 1 || pythonEngine.timelineCalls != 0 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}
		metrics := GetExtractorMetricsSnapshot()
		if metrics.RolloutTrialRequests != 0 {
			t.Fatalf("expected no rollout trial runtime requests after cutover, got %d", metrics.RolloutTrialRequests)
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeKeepsHistoricalTrialInactiveWhenGateStopsMatching(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		report := &ExtractorValidationReport{
			ReportID:        "report-media-ready",
			CreatedAt:       "2026-04-15T06:12:00Z",
			ConfigUpdatedAt: savedConfig.UpdatedAt,
			Cases: []ExtractorValidationCaseReport{
				{
					PresetID:      "public-media",
					PresetLabel:   "Public media",
					RequestKind:   "timeline",
					Scope:         ExtractorValidationScopePublic,
					RequestFamily: ExtractorRequestFamilyMedia,
					Target:        "@nasa media [all]",
					Valid:         true,
					GoSupported:   true,
					PythonSuccess: true,
					GoSuccess:     true,
					Equal:         true,
				},
			},
		}
		applyExtractorValidationSummary(report)
		if err := saveExtractorValidationReport(report); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		if _, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicTrials: ExtractorRolloutPolicyPublicTrials{
				Media: ExtractorPublicTrialPolicyState{Armed: true},
			},
		}); err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}

		if _, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
				{
					ID:           "public-timeline",
					Label:        "Public timeline",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "timeline",
					MediaType:    "all",
				},
			},
		}); err != nil {
			t.Fatalf("update runbook config: %v", err)
		}

		pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-default"
		goEngine := &stubExtractorEngine{name: "go-twitter", timelineSupported: true, timelineResponse: goResponse}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, goResponse) {
			t.Fatalf("expected go response while trial state is historical only, got %#v", response)
		}
		if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if !snapshot.PublicTrialStates.Media.Armed {
			t.Fatal("expected media trial to remain armed")
		}
		if snapshot.PublicTrialStates.Media.Active {
			t.Fatal("expected media trial to become inactive when gate no longer matches config")
		}
		if snapshot.PublicTrialStates.Media.InactiveReason == "" {
			t.Fatal("expected inactive reason for armed media trial")
		}
	})
}

func TestSaveExtractorRolloutPolicyRequiresReadyPromotionGate(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		_, err = SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicPromotions: ExtractorRolloutPolicyPublicPromotions{
				Media: ExtractorPublicPromotionPolicyState{Promoted: true},
			},
		})
		if err == nil {
			t.Fatal("expected media promotion to fail while promotion gate is incomplete")
		}

		validationReport := readyPublicMediaValidationReport(savedConfig.UpdatedAt)
		applyExtractorValidationSummary(validationReport)
		if err := saveExtractorValidationReport(validationReport); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		report := readyPublicMediaLiveReport(savedConfig.UpdatedAt)
		applyExtractorLiveValidationSummary(report)
		if err := saveExtractorLiveValidationReport(report); err != nil {
			t.Fatalf("save live validation report: %v", err)
		}

		savedPolicy, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicPromotions: ExtractorRolloutPolicyPublicPromotions{
				Media: ExtractorPublicPromotionPolicyState{Promoted: true},
			},
		})
		if err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}
		if !savedPolicy.PublicPromotions.Media.Promoted {
			t.Fatal("expected media promotion to be enabled")
		}
		if savedPolicy.PublicPromotions.Media.BaselineConfigUpdatedAt != savedConfig.UpdatedAt {
			t.Fatalf("expected promotion baseline config %q, got %q", savedConfig.UpdatedAt, savedPolicy.PublicPromotions.Media.BaselineConfigUpdatedAt)
		}
		if savedPolicy.PublicPromotions.Media.BaselineValidationReportID != validationReport.ReportID {
			t.Fatalf("expected validation report baseline %q, got %q", validationReport.ReportID, savedPolicy.PublicPromotions.Media.BaselineValidationReportID)
		}
		if savedPolicy.PublicPromotions.Media.BaselineLiveReportID != report.ReportID {
			t.Fatalf("expected live report baseline %q, got %q", report.ReportID, savedPolicy.PublicPromotions.Media.BaselineLiveReportID)
		}
		if savedPolicy.PublicPromotions.Media.BaselinePromotionGate != ExtractorValidationGateReady {
			t.Fatalf("expected ready promotion baseline gate, got %q", savedPolicy.PublicPromotions.Media.BaselinePromotionGate)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if snapshot.PublicPromotionStates.Media.CurrentPromotionGate != ExtractorValidationGateReady {
			t.Fatalf("expected media current promotion gate ready, got %q", snapshot.PublicPromotionStates.Media.CurrentPromotionGate)
		}
		if !snapshot.PublicPromotionStates.Media.Active {
			t.Fatal("expected promoted media family to be active when promotion gate is ready")
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeUsesGoForPromotedMediaFamily(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		validationReport := readyPublicMediaValidationReport(savedConfig.UpdatedAt)
		applyExtractorValidationSummary(validationReport)
		if err := saveExtractorValidationReport(validationReport); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		report := readyPublicMediaLiveReport(savedConfig.UpdatedAt)
		applyExtractorLiveValidationSummary(report)
		if err := saveExtractorLiveValidationReport(report); err != nil {
			t.Fatalf("save live validation report: %v", err)
		}

		if _, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicPromotions: ExtractorRolloutPolicyPublicPromotions{
				Media: ExtractorPublicPromotionPolicyState{Promoted: true},
			},
		}); err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}

		pythonResponse := sampleTwitterResponse()
		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-promoted"
		pythonEngine := &stubExtractorEngine{
			name:              "python-gallery-dl",
			timelineSupported: true,
			timelineResponse:  pythonResponse,
		}
		goEngine := &stubExtractorEngine{
			name:              "go-twitter",
			timelineSupported: true,
			timelineResponse:  goResponse,
		}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, goResponse) {
			t.Fatalf("expected go response during promoted public family, got %#v", response)
		}
		if goEngine.timelineCalls != 1 || pythonEngine.timelineCalls != 0 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeKeepsPromotedFamilyActiveOnFrozenBaseline(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		savedConfig, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
			},
		})
		if err != nil {
			t.Fatalf("save runbook config: %v", err)
		}

		validationReport := readyPublicMediaValidationReport(savedConfig.UpdatedAt)
		applyExtractorValidationSummary(validationReport)
		if err := saveExtractorValidationReport(validationReport); err != nil {
			t.Fatalf("save validation report: %v", err)
		}

		report := readyPublicMediaLiveReport(savedConfig.UpdatedAt)
		applyExtractorLiveValidationSummary(report)
		if err := saveExtractorLiveValidationReport(report); err != nil {
			t.Fatalf("save live validation report: %v", err)
		}

		if _, err := SaveExtractorRolloutPolicy(ExtractorRolloutPolicy{
			PublicPromotions: ExtractorRolloutPolicyPublicPromotions{
				Media: ExtractorPublicPromotionPolicyState{Promoted: true},
			},
		}); err != nil {
			t.Fatalf("save rollout policy: %v", err)
		}

		if _, err := SaveExtractorRunbookConfig(ExtractorRunbookConfig{
			Presets: []ExtractorRunbookPreset{
				{
					ID:           "public-media",
					Label:        "Public media",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "media",
					MediaType:    "all",
				},
				{
					ID:           "public-timeline",
					Label:        "Public timeline",
					Enabled:      true,
					RequestKind:  "timeline",
					Scope:        ExtractorValidationScopePublic,
					Username:     "nasa",
					TimelineType: "timeline",
					MediaType:    "all",
				},
			},
		}); err != nil {
			t.Fatalf("update runbook config: %v", err)
		}

		pythonResponse := sampleTwitterResponse()
		pythonResponse.AccountInfo.Nick = "python-default"
		pythonEngine := &stubExtractorEngine{
			name:              "python-gallery-dl",
			timelineSupported: true,
			timelineResponse:  pythonResponse,
		}
		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-frozen-baseline"
		goEngine := &stubExtractorEngine{
			name:              "go-twitter",
			timelineSupported: true,
			timelineResponse:  goResponse,
		}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, goResponse) {
			t.Fatalf("expected go response while promoted family remains active on frozen baseline, got %#v", response)
		}
		if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if !snapshot.PublicPromotionStates.Media.Promoted {
			t.Fatal("expected media promotion to remain enabled")
		}
		if !snapshot.PublicPromotionStates.Media.Active {
			t.Fatal("expected promoted media family to remain active on its frozen baseline")
		}
		if !snapshot.PublicPromotionStates.Media.LatestEvidenceDrifted {
			t.Fatal("expected drift flag when latest evidence no longer matches baseline")
		}
		if snapshot.PublicPromotionStates.Media.CurrentConfigMatchesBaseline {
			t.Fatal("expected current config to differ from captured promotion baseline")
		}
		if snapshot.PublicPromotionStates.Media.InactiveReason != "" {
			t.Fatalf("expected no inactive reason for active frozen baseline promotion, got %q", snapshot.PublicPromotionStates.Media.InactiveReason)
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeKeepsGoRoutingWhenPromotionBaselineIsInvalid(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()

		policy := ExtractorRolloutPolicy{
			UpdatedAt: "2026-04-15T06:30:00Z",
			PublicPromotions: ExtractorRolloutPolicyPublicPromotions{
				Media: ExtractorPublicPromotionPolicyState{
					Promoted:   true,
					PromotedAt: "2026-04-15T06:29:00Z",
					UpdatedAt:  "2026-04-15T06:29:00Z",
				},
			},
		}
		data, err := json.MarshalIndent(policy, "", "  ")
		if err != nil {
			t.Fatalf("marshal rollout policy: %v", err)
		}
		data = append(data, '\n')
		if err := os.WriteFile(extractorRolloutPolicyPath(), data, 0o600); err != nil {
			t.Fatalf("write rollout policy: %v", err)
		}

		pythonEngine := &stubExtractorEngine{name: "python-gallery-dl"}
		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-invalid-baseline"
		goEngine := &stubExtractorEngine{name: "go-twitter", timelineSupported: true, timelineResponse: goResponse}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, goResponse) {
			t.Fatalf("expected go response when promotion baseline is invalid, got %#v", response)
		}
		if pythonEngine.timelineCalls != 0 || goEngine.timelineCalls != 1 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}

		snapshot := GetExtractorDiagnosticsSnapshot()
		if !snapshot.PublicPromotionStates.Media.Promoted {
			t.Fatal("expected media promotion flag to remain set")
		}
		if snapshot.PublicPromotionStates.Media.Active {
			t.Fatal("expected invalid baseline promotion to stay inactive")
		}
		if snapshot.PublicPromotionStates.Media.InactiveReason != "promoted but inactive because baseline is missing or invalid" {
			t.Fatalf("unexpected inactive reason: %q", snapshot.PublicPromotionStates.Media.InactiveReason)
		}
	})
}
