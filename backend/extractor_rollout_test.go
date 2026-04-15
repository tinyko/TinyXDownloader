package backend

import (
	"context"
	"reflect"
	"testing"
)

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

func TestExtractTimelineWithEnginesPythonModeUsesArmedMediaTrial(t *testing.T) {
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

		pythonResponse := sampleTwitterResponse()
		goResponse := sampleTwitterResponse()
		goResponse.AccountInfo.Nick = "go-trial"
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
			t.Fatalf("expected go response during armed public trial, got %#v", response)
		}
		if goEngine.timelineCalls != 1 || pythonEngine.timelineCalls != 0 {
			t.Fatalf("unexpected engine calls: go=%d python=%d", goEngine.timelineCalls, pythonEngine.timelineCalls)
		}
		metrics := GetExtractorMetricsSnapshot()
		if metrics.RolloutTrialRequests != 1 {
			t.Fatalf("expected 1 rollout trial request, got %d", metrics.RolloutTrialRequests)
		}
		if metrics.RolloutTrialGoSelected != 1 {
			t.Fatalf("expected 1 rollout go selection, got %d", metrics.RolloutTrialGoSelected)
		}
	})
}

func TestExtractTimelineWithEnginesPythonModeKeepsArmedTrialInactiveWhenGateStopsMatching(t *testing.T) {
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

		pythonResponse := sampleTwitterResponse()
		pythonResponse.AccountInfo.Nick = "python-default"
		pythonEngine := &stubExtractorEngine{
			name:              "python-gallery-dl",
			timelineSupported: true,
			timelineResponse:  pythonResponse,
		}
		goEngine := &stubExtractorEngine{
			name:              "go-twitter",
			timelineSupported: true,
			timelineResponse:  sampleTwitterResponse(),
		}

		response, err := extractTimelineWithEngines(context.Background(), TimelineRequest{
			Username:     "nasa",
			TimelineType: "media",
			MediaType:    "all",
		}, ExtractorEngineModePython, pythonEngine, goEngine)
		if err != nil {
			t.Fatalf("extractTimelineWithEngines returned error: %v", err)
		}
		if !reflect.DeepEqual(response, pythonResponse) {
			t.Fatalf("expected python response while armed trial is inactive, got %#v", response)
		}
		if pythonEngine.timelineCalls != 1 || goEngine.timelineCalls != 0 {
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
