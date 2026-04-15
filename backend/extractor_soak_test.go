package backend

import (
	"encoding/json"
	"os"
	"testing"
)

func writeExtractorSoakTestPromotionPolicy(t *testing.T, family ExtractorRequestFamily) {
	t.Helper()

	if err := EnsureAppDataDir(); err != nil {
		t.Fatalf("ensure app data dir: %v", err)
	}

	policy := defaultExtractorRolloutPolicy()
	baseline := ExtractorPublicPromotionPolicyState{
		Promoted:                   true,
		PromotedAt:                 "2026-04-15T06:13:00Z",
		UpdatedAt:                  "2026-04-15T06:13:00Z",
		BaselineCapturedAt:         "2026-04-15T06:13:00Z",
		BaselineConfigUpdatedAt:    "2026-04-15T06:05:00Z",
		BaselineValidationReportID: "report-baseline",
		BaselineLiveReportID:       "live-baseline",
		BaselinePromotionGate:      ExtractorValidationGateReady,
	}

	switch family {
	case ExtractorRequestFamilyMedia:
		policy.PublicPromotions.Media = baseline
	case ExtractorRequestFamilyTimeline:
		policy.PublicPromotions.Timeline = baseline
	case ExtractorRequestFamilyDateRange:
		policy.PublicPromotions.DateRange = baseline
	case ExtractorRequestFamilyLikes:
		policy.PrivatePromotions.Likes = baseline
	case ExtractorRequestFamilyBookmarks:
		policy.PrivatePromotions.Bookmarks = baseline
	default:
		t.Fatalf("unsupported soak test family %q", family)
	}

	data, err := json.MarshalIndent(policy, "", "  ")
	if err != nil {
		t.Fatalf("marshal rollout policy: %v", err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(extractorRolloutPolicyPath(), data, 0o600); err != nil {
		t.Fatalf("write rollout policy: %v", err)
	}
}

func TestRecordExtractorSoakRequestPersistsCurrentReleaseCounters(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()
		SetExtractorAppVersion("1.2.3")
		writeExtractorSoakTestPromotionPolicy(t, ExtractorRequestFamilyMedia)

		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "default_runtime",
			RequestFamily:  ExtractorRequestFamilyMedia,
			SelectedEngine: "go-twitter",
			Username:       "nasa",
			TimelineType:   "media",
			MediaType:      "all",
			Success:        true,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 1,
				Cursor:        "cursor-1",
				Completed:     false,
			},
		})

		release, err := currentExtractorSoakReleaseState()
		if err != nil {
			t.Fatalf("currentExtractorSoakReleaseState returned error: %v", err)
		}
		if release.ReleaseVersion != "1.2.3" {
			t.Fatalf("expected release version 1.2.3, got %q", release.ReleaseVersion)
		}
		if release.Families.Media.TotalRequests != 1 {
			t.Fatalf("expected one media request, got %d", release.Families.Media.TotalRequests)
		}
		if release.Families.Media.GoSelectedSuccesses != 1 {
			t.Fatalf("expected one successful go selection, got %d", release.Families.Media.GoSelectedSuccesses)
		}
		if release.Families.Media.BlockerOpen {
			t.Fatal("expected no blocker after successful go request")
		}
	})
}

func TestRecordExtractorSoakRequestTracksFallbacksAcrossReleaseVersions(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()
		SetExtractorAppVersion("1.2.3")
		writeExtractorSoakTestPromotionPolicy(t, ExtractorRequestFamilyBookmarks)

		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "default_runtime",
			RequestFamily:  ExtractorRequestFamilyBookmarks,
			SelectedEngine: "python-gallery-dl",
			FallbackReason: "go runtime required fallback",
			FallbackCode:   "fallback_required",
			TimelineType:   "bookmarks",
			MediaType:      "text",
			Success:        true,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 3,
				Cursor:        "cursor-1",
				Completed:     false,
			},
		})

		SetExtractorAppVersion("1.2.4")
		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "default_runtime",
			RequestFamily:  ExtractorRequestFamilyBookmarks,
			SelectedEngine: "go-twitter",
			TimelineType:   "bookmarks",
			MediaType:      "text",
			Success:        true,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 2,
				Cursor:        "cursor-2",
				Completed:     false,
			},
		})

		state, err := loadExtractorSoakState()
		if err != nil {
			t.Fatalf("loadExtractorSoakState returned error: %v", err)
		}
		if state.CurrentReleaseVersion != "1.2.4" {
			t.Fatalf("expected current release version 1.2.4, got %q", state.CurrentReleaseVersion)
		}
		if len(state.Releases) != 2 {
			t.Fatalf("expected two soak release entries, got %d", len(state.Releases))
		}
		if state.Releases[0].ReleaseVersion != "1.2.4" {
			t.Fatalf("expected newest release first, got %q", state.Releases[0].ReleaseVersion)
		}
		if state.Releases[1].ReleaseVersion != "1.2.3" {
			t.Fatalf("expected previous release second, got %q", state.Releases[1].ReleaseVersion)
		}
		if state.Releases[1].Families.Bookmarks.PythonFallbacks != 1 {
			t.Fatalf("expected one python fallback in older release, got %d", state.Releases[1].Families.Bookmarks.PythonFallbacks)
		}
		if state.Releases[1].Families.Bookmarks.FallbackRequiredCount != 1 {
			t.Fatalf("expected one fallback-required count, got %d", state.Releases[1].Families.Bookmarks.FallbackRequiredCount)
		}
		if !state.Releases[1].Families.Bookmarks.BlockerOpen {
			t.Fatal("expected blocker to remain open for fallback-required release")
		}
		if len(state.Releases[1].RecentBlockers) != 1 {
			t.Fatalf("expected one blocker event, got %d", len(state.Releases[1].RecentBlockers))
		}
	})
}

func TestRecordExtractorSoakRequestIgnoresExplicitGoAndLiveValidationTraffic(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()
		SetExtractorAppVersion("1.2.3")
		writeExtractorSoakTestPromotionPolicy(t, ExtractorRequestFamilyMedia)

		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "env",
			RequestFamily:  ExtractorRequestFamilyMedia,
			SelectedEngine: "go-twitter",
			TimelineType:   "media",
			MediaType:      "all",
			Success:        true,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 1,
				Cursor:        "cursor-explicit",
				Completed:     false,
			},
		})

		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "live_validation",
			RequestFamily:  ExtractorRequestFamilyMedia,
			SelectedEngine: "go-twitter",
			TimelineType:   "media",
			MediaType:      "all",
			Success:        true,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 1,
				Cursor:        "cursor-live",
				Completed:     false,
			},
		})

		release, err := currentExtractorSoakReleaseState()
		if err != nil {
			t.Fatalf("currentExtractorSoakReleaseState returned error: %v", err)
		}
		if release.Families.Media.TotalRequests != 0 {
			t.Fatalf("expected non-default traffic to be ignored, got %d requests", release.Families.Media.TotalRequests)
		}
	})
}
