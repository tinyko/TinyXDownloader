package backend

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withTempAppData(t *testing.T, fn func(root string)) {
	t.Helper()

	CloseDB()
	root := t.TempDir()
	t.Setenv(AppDataDirEnv, root)

	fn(root)

	CloseDB()
}

func insertTestAccountRecord(t *testing.T, username string) {
	t.Helper()

	if _, err := db.Exec(`
		INSERT INTO accounts (
			username, name, profile_image, total_media, last_fetched, response_json,
			group_name, group_color, media_type, timeline_type, retweets, query_key,
			followers_count, statuses_count, fetch_key, cursor, completed
		)
		VALUES (?, ?, '', ?, datetime('now'), '{}', '', '', 'all', 'media', 0, '', ?, ?, ?, '', 1)
	`,
		username,
		strings.ToUpper(username),
		12,
		100,
		200,
		buildFetchKey(username, "all", "media", false, ""),
	); err != nil {
		t.Fatalf("insert test account %q: %v", username, err)
	}
}

func readZipEntries(t *testing.T, path string) map[string]string {
	t.Helper()

	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatalf("open zip %s: %v", path, err)
	}
	defer reader.Close()

	entries := make(map[string]string, len(reader.File))
	for _, file := range reader.File {
		handle, err := file.Open()
		if err != nil {
			t.Fatalf("open zip entry %s: %v", file.Name, err)
		}

		content, err := io.ReadAll(handle)
		_ = handle.Close()
		if err != nil {
			t.Fatalf("read zip entry %s: %v", file.Name, err)
		}
		entries[file.Name] = string(content)
	}
	return entries
}

func assertPathUnderRoot(t *testing.T, root string, path string) {
	t.Helper()

	relative, err := filepath.Rel(root, path)
	if err != nil {
		t.Fatalf("relate path %s to root %s: %v", path, root, err)
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		t.Fatalf("expected %s to stay under %s", path, root)
	}
}

func TestAppDataOverridePaths(t *testing.T) {
	withTempAppData(t, func(root string) {
		for _, path := range []string{
			GetAppDataDir(),
			GetDBPath(),
			authTokensPath(),
			GetLogsDir(),
			GetFFmpegPath(),
			GetExifToolPath(),
			getExtractorPath(),
			getHashFilePath(),
		} {
			assertPathUnderRoot(t, root, path)
		}
	})
}

func TestExportSupportBundleRedactsSensitiveSettingsAndExcludesSecrets(t *testing.T) {
	withTempAppData(t, func(root string) {
		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "bundle_user")

		if err := WriteSettingsSnapshot(`{
			"downloadPath": "/tmp/xdownloader-downloads",
			"proxy": "http://alice:super-secret@proxy.example.com:8080",
			"rememberPublicToken": true,
			"rememberPrivateToken": false
		}`); err != nil {
			t.Fatalf("write settings snapshot: %v", err)
		}
		if err := os.WriteFile(authTokensPath(), []byte(`{"public_token":"pub","private_token":"priv"}`), 0o600); err != nil {
			t.Fatalf("seed auth tokens: %v", err)
		}
		if err := AppendDiagnosticLog("info", "frontend ready"); err != nil {
			t.Fatalf("append frontend log: %v", err)
		}
		if err := AppendBackendDiagnosticLog("warning", "backend ready"); err != nil {
			t.Fatalf("append backend log: %v", err)
		}

		outputPath := filepath.Join(root, "support.zip")
		if err := ExportSupportBundle(outputPath, SupportBundleOptions{
			AppName:    "TinyXDownloader",
			AppVersion: "1.2.2",
			TaskSummary: SupportBundleTaskSummary{
				Download:  SupportBundleDownloadSummary{Status: "running", InProgress: true, Current: 2, Total: 4, Percent: 50},
				Integrity: SupportBundleIntegritySummary{Status: "completed", InProgress: false, Mode: "quick", IssuesCount: 1},
			},
		}); err != nil {
			t.Fatalf("export support bundle: %v", err)
		}

		entries := readZipEntries(t, outputPath)

		settingsJSON, ok := entries["settings.redacted.json"]
		if !ok {
			t.Fatal("expected settings.redacted.json entry")
		}
		if strings.Contains(settingsJSON, "super-secret") {
			t.Fatalf("expected proxy password to be redacted, got %s", settingsJSON)
		}
		if !strings.Contains(settingsJSON, "proxy.example.com") {
			t.Fatalf("expected redacted settings to preserve proxy host, got %s", settingsJSON)
		}
		if !strings.Contains(settingsJSON, `"rememberPublicToken": true`) {
			t.Fatalf("expected token remember flag to remain visible, got %s", settingsJSON)
		}

		if _, ok := entries["auth_tokens.json"]; ok {
			t.Fatal("support bundle must not include auth_tokens.json")
		}
		if _, ok := entries["logs/frontend.log"]; !ok {
			t.Fatal("expected logs/frontend.log entry")
		}
		if _, ok := entries["logs/backend.log"]; !ok {
			t.Fatal("expected logs/backend.log entry")
		}
		if _, ok := entries["db/accounts.db"]; !ok {
			t.Fatal("expected db/accounts.db entry")
		}

		manifestJSON, ok := entries["manifest.json"]
		if !ok {
			t.Fatal("expected manifest.json entry")
		}

		var manifest supportBundleManifest
		if err := json.Unmarshal([]byte(manifestJSON), &manifest); err != nil {
			t.Fatalf("decode support bundle manifest: %v", err)
		}
		if manifest.AppVersion != "1.2.2" {
			t.Fatalf("expected app version 1.2.2, got %q", manifest.AppVersion)
		}
		if manifest.DatabaseSchemaVersion != GetDatabaseSchemaVersion() {
			t.Fatalf(
				"expected schema version %d, got %d",
				GetDatabaseSchemaVersion(),
				manifest.DatabaseSchemaVersion,
			)
		}
		if manifest.Counts.Accounts != 1 || manifest.Counts.PublicCount != 1 {
			t.Fatalf("unexpected db counts in manifest: %+v", manifest.Counts)
		}
	})
}

func TestAppendDiagnosticLogRotatesAndCapsArchives(t *testing.T) {
	withTempAppData(t, func(root string) {
		previousMaxBytes := diagnosticsLogMaxBytes
		previousArchives := diagnosticsLogArchives
		diagnosticsLogMaxBytes = 120
		diagnosticsLogArchives = 2
		t.Cleanup(func() {
			diagnosticsLogMaxBytes = previousMaxBytes
			diagnosticsLogArchives = previousArchives
		})

		for index := 0; index < 5; index++ {
			message := fmt.Sprintf("frontend-log-%d-%s", index, strings.Repeat("x", 70))
			if err := AppendDiagnosticLog("info", message); err != nil {
				t.Fatalf("append rotated log %d: %v", index, err)
			}
		}

		currentPath := filepath.Join(root, "logs", frontendDiagnosticsLogName)
		archiveOne := filepath.Join(root, "logs", "frontend.1.log")
		archiveTwo := filepath.Join(root, "logs", "frontend.2.log")
		archiveThree := filepath.Join(root, "logs", "frontend.3.log")

		currentContent, err := os.ReadFile(currentPath)
		if err != nil {
			t.Fatalf("read current log: %v", err)
		}
		archiveOneContent, err := os.ReadFile(archiveOne)
		if err != nil {
			t.Fatalf("read archive one: %v", err)
		}
		archiveTwoContent, err := os.ReadFile(archiveTwo)
		if err != nil {
			t.Fatalf("read archive two: %v", err)
		}

		if strings.Contains(string(currentContent), "frontend-log-0-") {
			t.Fatal("current log should not keep the oldest rotated entries")
		}
		if !strings.Contains(string(currentContent), "frontend-log-4-") {
			t.Fatal("current log should contain the newest entry")
		}
		if !strings.Contains(string(archiveOneContent), "frontend-log-3-") {
			t.Fatal("first archive should contain the previously current entry")
		}
		if !strings.Contains(string(archiveTwoContent), "frontend-log-2-") {
			t.Fatal("second archive should contain the older rotated entry")
		}
		if _, err := os.Stat(archiveThree); !os.IsNotExist(err) {
			t.Fatalf("expected archive cap to remove %s, err=%v", archiveThree, err)
		}
	})
}

func TestExportSupportBundleTruncatesLargeLogFiles(t *testing.T) {
	withTempAppData(t, func(root string) {
		previousMaxLogBytes := supportBundleMaxLogBytesPerFile
		supportBundleMaxLogBytesPerFile = 80
		t.Cleanup(func() {
			supportBundleMaxLogBytesPerFile = previousMaxLogBytes
		})

		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "log_bundle_user")

		largeLogBody := strings.Repeat("0123456789", 40)
		if err := os.MkdirAll(GetLogsDir(), 0o700); err != nil {
			t.Fatalf("create logs dir: %v", err)
		}
		if err := os.WriteFile(
			filepath.Join(GetLogsDir(), backendDiagnosticsLogName),
			[]byte(largeLogBody),
			0o600,
		); err != nil {
			t.Fatalf("write oversized log: %v", err)
		}

		outputPath := filepath.Join(root, "support-truncated.zip")
		if err := ExportSupportBundle(outputPath, SupportBundleOptions{
			AppName:    "TinyXDownloader",
			AppVersion: "1.2.3",
		}); err != nil {
			t.Fatalf("export support bundle: %v", err)
		}

		entries := readZipEntries(t, outputPath)
		logBody, ok := entries["logs/backend.log"]
		if !ok {
			t.Fatal("expected logs/backend.log entry")
		}
		if !strings.HasPrefix(logBody, "[truncated to last 80 bytes]") {
			t.Fatalf("expected truncated prefix, got %q", logBody)
		}
		if strings.Contains(logBody, largeLogBody[:120]) {
			t.Fatal("expected support bundle log entry to omit the full oversized body")
		}
	})
}

func TestRestoreDatabaseBackupRejectsFutureSchema(t *testing.T) {
	withTempAppData(t, func(root string) {
		backupPath := filepath.Join(root, "future-schema.zip")
		if err := writeBundleZip(backupPath, func(writer *zip.Writer) error {
			if err := writeJSONZipEntry(writer, "manifest.json", DatabaseBackupManifest{
				FormatVersion:         supportBundleFormatVersion,
				AppVersion:            "1.2.2",
				DatabaseSchemaVersion: GetDatabaseSchemaVersion() + 1,
				CreatedAt:             "2026-04-15T00:00:00Z",
			}); err != nil {
				return err
			}
			return writeBytesZipEntry(writer, "db/accounts.db", []byte("not-a-real-db"))
		}); err != nil {
			t.Fatalf("write backup zip: %v", err)
		}

		err := RestoreDatabaseBackup(backupPath)
		if err == nil {
			t.Fatal("expected future schema restore to fail")
		}
		if !strings.Contains(err.Error(), "newer than this app supports") {
			t.Fatalf("unexpected restore error: %v", err)
		}
	})
}

func TestRestoreDatabaseBackupRejectsChecksumMismatch(t *testing.T) {
	withTempAppData(t, func(root string) {
		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "checksum_user")

		snapshotPath, err := createDatabaseSnapshotFile()
		if err != nil {
			t.Fatalf("create snapshot: %v", err)
		}
		defer os.Remove(snapshotPath)

		backupPath := filepath.Join(root, "checksum-mismatch.zip")
		if err := writeBundleZip(backupPath, func(writer *zip.Writer) error {
			if err := writeJSONZipEntry(writer, "manifest.json", DatabaseBackupManifest{
				FormatVersion:         supportBundleFormatVersion,
				AppVersion:            "1.2.3",
				DatabaseSchemaVersion: GetDatabaseSchemaVersion(),
				CreatedAt:             "2026-04-15T00:00:00Z",
				SHA256:                strings.Repeat("0", 64),
			}); err != nil {
				return err
			}
			return writeFileZipEntry(writer, "db/accounts.db", snapshotPath)
		}); err != nil {
			t.Fatalf("write backup zip: %v", err)
		}

		err = RestoreDatabaseBackup(backupPath)
		if err == nil {
			t.Fatal("expected checksum mismatch restore to fail")
		}
		if !strings.Contains(err.Error(), "checksum mismatch") {
			t.Fatalf("unexpected restore error: %v", err)
		}
	})
}

func TestCreateAndRestoreDatabaseBackupRoundTrip(t *testing.T) {
	withTempAppData(t, func(root string) {
		if err := InitDB(); err != nil {
			t.Fatalf("init db: %v", err)
		}
		insertTestAccountRecord(t, "backup_source")

		backupPath := filepath.Join(root, "backup.zip")
		if err := CreateDatabaseBackup(backupPath, "1.2.2"); err != nil {
			t.Fatalf("create backup: %v", err)
		}

		if _, err := db.Exec(`DELETE FROM accounts`); err != nil {
			t.Fatalf("delete seeded accounts: %v", err)
		}
		insertTestAccountRecord(t, "mutated_user")

		if err := RestoreDatabaseBackup(backupPath); err != nil {
			t.Fatalf("restore backup: %v", err)
		}

		accounts, err := GetAllAccounts()
		if err != nil {
			t.Fatalf("get accounts after restore: %v", err)
		}
		if len(accounts) != 1 {
			t.Fatalf("expected 1 restored account, got %d", len(accounts))
		}
		if accounts[0].Username != "backup_source" {
			t.Fatalf("expected restored username backup_source, got %q", accounts[0].Username)
		}
	})
}
