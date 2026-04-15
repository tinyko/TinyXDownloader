package backend

import (
	"fmt"
	"testing"
	"time"
)

func TestGetExtractorDiagnosticsSnapshotIncludesRecentEventsAndParity(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()
		SetExtractorAppVersion("1.2.3")

		appendExtractorLog(extractorRequestLogEntry{
			Event:          "extractor_request",
			RequestKind:    "timeline",
			ConfiguredMode: ExtractorEngineModeGo,
			EffectiveMode:  ExtractorEngineModeGo,
			ModeSource:     "env",
			RequestFamily:  ExtractorRequestFamilyMedia,
			Mode:           ExtractorEngineModeGo,
			SelectedEngine: "go-twitter",
			Username:       "example_user",
			TimelineType:   "media",
			MediaType:      "all",
			Success:        true,
			ElapsedMS:      12,
			ResponseSummary: &ExtractorResponseSummary{
				TimelineItems: 3,
				Cursor:        "cursor-1",
				Completed:     false,
			},
		})

		appendXPrivateBookmarksDiagnosticLog(xPrivateBookmarksDiagnosticLogEntry{
			Event:          "x_private_bookmarks_request",
			MediaType:      "text",
			AuthMode:       "auth",
			Stage:          "normalize",
			FallbackCode:   "missing_cursor",
			CursorPresent:  false,
			PageItemCount:  50,
			MediaItemCount: 0,
			TextItemCount:  12,
			PartialParse:   true,
			Success:        false,
			ElapsedMS:      35,
			Error:          "missing cursor",
		})

		appendExtractorParityLog(extractorParityLogEntry{
			Event:        "extractor_parity",
			RequestKind:  "timeline",
			GoSupported:  true,
			Username:     "",
			TimelineType: "bookmarks",
			MediaType:    "text",
			Equal:        false,
			Differences:  []string{"go engine error: missing cursor"},
			PythonSummary: &ExtractorResponseSummary{
				TimelineItems: 12,
				Completed:     true,
				AccountName:   "bookmarks",
			},
			GoError: "go engine error: missing cursor",
		})

		snapshot := GetExtractorDiagnosticsSnapshot()
		if snapshot.CurrentMode != ExtractorEngineModeGo {
			t.Fatalf("expected go mode by default, got %q", snapshot.CurrentMode)
		}
		if !snapshot.GoOnlyRuntime {
			t.Fatal("expected go-only runtime to be active")
		}
		if !snapshot.HistoricalEvidenceOnly {
			t.Fatal("expected historical evidence only mode")
		}
		if len(snapshot.RecentEvents) != 2 {
			t.Fatalf("expected 2 recent events, got %d", len(snapshot.RecentEvents))
		}
		if snapshot.RecentEvents[0].Event != "x_private_bookmarks_request" {
			t.Fatalf("expected most recent event to be bookmarks diagnostic, got %q", snapshot.RecentEvents[0].Event)
		}
		if snapshot.RecentEvents[0].TimelineType != "bookmarks" {
			t.Fatalf("expected bookmarks timeline type, got %q", snapshot.RecentEvents[0].TimelineType)
		}
		if snapshot.RecentEvents[0].FallbackCode != "missing_cursor" {
			t.Fatalf("expected missing_cursor fallback code, got %q", snapshot.RecentEvents[0].FallbackCode)
		}
		if len(snapshot.RecentParity) != 1 {
			t.Fatalf("expected 1 parity history entry, got %d", len(snapshot.RecentParity))
		}
		if snapshot.RecentParity[0].Target != "private bookmarks [text]" {
			t.Fatalf("unexpected parity target: %q", snapshot.RecentParity[0].Target)
		}
		if snapshot.RecentParity[0].DiffCount != 1 {
			t.Fatalf("expected 1 parity diff, got %d", snapshot.RecentParity[0].DiffCount)
		}
		if snapshot.RecentParity[0].FirstDifference == "" {
			t.Fatal("expected first parity difference to be populated")
		}
		if snapshot.PythonDeprecatedNotice != "" {
			t.Fatalf("expected no python deprecated notice in go mode, got %q", snapshot.PythonDeprecatedNotice)
		}
		if snapshot.PythonFallbackAvailable {
			t.Fatal("expected python fallback to be unavailable in go-only runtime")
		}
		if snapshot.PythonFallbackBuildFlavor != PythonFallbackBuildFlavorGoOnly {
			t.Fatalf("expected go-only build flavor, got %q", snapshot.PythonFallbackBuildFlavor)
		}
		if snapshot.AdHocParityAvailable {
			t.Fatal("expected ad hoc parity to be unavailable in go-only runtime")
		}
		if snapshot.AdHocParityUnavailableReason == "" {
			t.Fatal("expected ad hoc parity unavailable reason")
		}
		if snapshot.SoakReleaseVersion != "1.2.3" {
			t.Fatalf("expected soak release version 1.2.3, got %q", snapshot.SoakReleaseVersion)
		}
		if snapshot.SoakFamilyStates.Media.TotalRequests != 1 {
			t.Fatalf("expected one soak media request, got %d", snapshot.SoakFamilyStates.Media.TotalRequests)
		}
		if snapshot.DefaultRouteStates.Media.DepythonizationReady {
			t.Fatal("expected depythonization-ready to remain false without promotion baseline")
		}
		if snapshot.Phase7Ready {
			t.Fatal("expected phase 7 gate to remain false with incomplete families")
		}
	})
}

func TestGetExtractorDiagnosticsSnapshotReportsGoOnlyFallbackStatus(t *testing.T) {
	withTempAppData(t, func(root string) {
		_ = root
		resetExtractorDiagnosticsForTests()
		setPythonFallbackStatusForTests(PythonFallbackStatus{
			Available:            false,
			BuildFlavor:          PythonFallbackBuildFlavorGoOnly,
			AdHocParityAvailable: false,
			UnavailableReason:    "python fallback unavailable in this go-only build",
		})

		snapshot := GetExtractorDiagnosticsSnapshot()
		if snapshot.PythonFallbackAvailable {
			t.Fatal("expected python fallback to be unavailable")
		}
		if snapshot.PythonFallbackBuildFlavor != PythonFallbackBuildFlavorGoOnly {
			t.Fatalf("expected go-only build flavor, got %q", snapshot.PythonFallbackBuildFlavor)
		}
		if snapshot.AdHocParityAvailable {
			t.Fatal("expected ad hoc parity to be unavailable in go-only builds")
		}
		if snapshot.AdHocParityUnavailableReason == "" {
			t.Fatal("expected ad hoc parity unavailable reason to be populated")
		}
	})
}

func TestExtractorDiagnosticsHistoryCapsRecentItems(t *testing.T) {
	resetExtractorDiagnosticsForTests()

	for index := 0; index < extractorDiagnosticsHistoryLimit+5; index++ {
		pushExtractorRecentEvent(ExtractorRecentEvent{
			Timestamp:     time.Now().UTC().Format(time.RFC3339),
			Event:         "extractor_request",
			RequestKind:   "timeline",
			RequestTarget: fmt.Sprintf("event-%02d", index),
			Success:       true,
		})
		pushExtractorParityHistory(ExtractorParityHistoryEntry{
			Timestamp:     time.Now().UTC().Format(time.RFC3339),
			RequestKind:   "timeline",
			Target:        fmt.Sprintf("parity-%02d", index),
			GoSupported:   true,
			PythonSuccess: true,
			GoSuccess:     true,
			Equal:         true,
		})
	}

	snapshot := GetExtractorDiagnosticsSnapshot()
	if len(snapshot.RecentEvents) != extractorDiagnosticsHistoryLimit {
		t.Fatalf("expected %d recent events, got %d", extractorDiagnosticsHistoryLimit, len(snapshot.RecentEvents))
	}
	if len(snapshot.RecentParity) != extractorDiagnosticsHistoryLimit {
		t.Fatalf("expected %d recent parity entries, got %d", extractorDiagnosticsHistoryLimit, len(snapshot.RecentParity))
	}
	if snapshot.RecentEvents[0].RequestTarget != "event-24" {
		t.Fatalf("expected newest event first, got %q", snapshot.RecentEvents[0].RequestTarget)
	}
	if snapshot.RecentEvents[len(snapshot.RecentEvents)-1].RequestTarget != "event-05" {
		t.Fatalf("expected oldest retained event to be event-05, got %q", snapshot.RecentEvents[len(snapshot.RecentEvents)-1].RequestTarget)
	}
	if snapshot.RecentParity[0].Target != "parity-24" {
		t.Fatalf("expected newest parity first, got %q", snapshot.RecentParity[0].Target)
	}
	if snapshot.RecentParity[len(snapshot.RecentParity)-1].Target != "parity-05" {
		t.Fatalf("expected oldest retained parity to be parity-05, got %q", snapshot.RecentParity[len(snapshot.RecentParity)-1].Target)
	}
}
