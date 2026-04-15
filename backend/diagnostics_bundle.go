package backend

import (
	"archive/zip"
	"bufio"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"slices"
	"strings"
	"time"
)

const supportBundleFormatVersion = 1

var supportBundleMaxLogBytesPerFile int64 = 256 * 1024

type DatabaseBackupManifest struct {
	FormatVersion         int    `json:"format_version"`
	AppVersion            string `json:"app_version"`
	DatabaseSchemaVersion int    `json:"database_schema_version"`
	CreatedAt             string `json:"created_at"`
	SHA256                string `json:"sha256"`
}

type SupportBundleTaskSummary struct {
	Download  SupportBundleDownloadSummary  `json:"download"`
	Integrity SupportBundleIntegritySummary `json:"integrity"`
}

type SupportBundleDownloadSummary struct {
	Status     string `json:"status"`
	InProgress bool   `json:"in_progress"`
	Current    int    `json:"current"`
	Total      int    `json:"total"`
	Percent    int    `json:"percent"`
}

type SupportBundleIntegritySummary struct {
	Status      string `json:"status"`
	InProgress  bool   `json:"in_progress"`
	Phase       string `json:"phase"`
	Mode        string `json:"mode"`
	IssuesCount int    `json:"issues_count"`
}

type SupportBundleOptions struct {
	AppName     string                   `json:"app_name"`
	AppVersion  string                   `json:"app_version"`
	TaskSummary SupportBundleTaskSummary `json:"task_summary"`
}

type supportBundleManifest struct {
	FormatVersion         int                      `json:"format_version"`
	AppName               string                   `json:"app_name"`
	AppVersion            string                   `json:"app_version"`
	WailsVersion          string                   `json:"wails_version"`
	OS                    string                   `json:"os"`
	GoVersion             string                   `json:"go_version"`
	CreatedAt             string                   `json:"created_at"`
	DatabaseSchemaVersion int                      `json:"database_schema_version"`
	Counts                supportBundleDBSummary   `json:"counts"`
	Tasks                 SupportBundleTaskSummary `json:"tasks"`
}

type supportBundleDBSummary struct {
	Accounts      int `json:"accounts"`
	PublicCount   int `json:"public_count"`
	PrivateCount  int `json:"private_count"`
	GroupsCount   int `json:"groups_count"`
	SnapshotItems int `json:"snapshot_items"`
}

func GetSettingsSnapshotPath() string {
	return ResolveAppDataPath("settings.json")
}

func WriteSettingsSnapshot(raw string) error {
	if err := EnsureAppDataDir(); err != nil {
		return err
	}

	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		if err := os.Remove(GetSettingsSnapshotPath()); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return err
	}

	pretty, err := json.MarshalIndent(parsed, "", "  ")
	if err != nil {
		return err
	}
	pretty = append(pretty, '\n')

	return os.WriteFile(GetSettingsSnapshotPath(), pretty, 0o600)
}

func CreateDatabaseBackup(outputPath, appVersion string) error {
	snapshotPath, err := createDatabaseSnapshotFile()
	if err != nil {
		return err
	}
	defer os.Remove(snapshotPath)

	digest, err := sha256File(snapshotPath)
	if err != nil {
		return err
	}

	manifest := DatabaseBackupManifest{
		FormatVersion:         supportBundleFormatVersion,
		AppVersion:            appVersion,
		DatabaseSchemaVersion: GetDatabaseSchemaVersion(),
		CreatedAt:             time.Now().UTC().Format(time.RFC3339),
		SHA256:                digest,
	}

	if err := writeBundleZip(outputPath, func(writer *zip.Writer) error {
		if err := writeJSONZipEntry(writer, "manifest.json", manifest); err != nil {
			return err
		}
		return writeFileZipEntry(writer, "db/accounts.db", snapshotPath)
	}); err != nil {
		return err
	}

	return AppendBackendDiagnosticLog("info", fmt.Sprintf("database backup created: %s", outputPath))
}

func ExportSupportBundle(outputPath string, options SupportBundleOptions) error {
	snapshotPath, err := createDatabaseSnapshotFile()
	if err != nil {
		return err
	}
	defer os.Remove(snapshotPath)

	settingsJSON, err := buildRedactedSettingsSnapshot()
	if err != nil {
		return err
	}

	manifest := supportBundleManifest{
		FormatVersion:         supportBundleFormatVersion,
		AppName:               options.AppName,
		AppVersion:            options.AppVersion,
		WailsVersion:          currentWailsVersion(),
		OS:                    runtime.GOOS + "/" + runtime.GOARCH,
		GoVersion:             runtime.Version(),
		CreatedAt:             time.Now().UTC().Format(time.RFC3339),
		DatabaseSchemaVersion: GetDatabaseSchemaVersion(),
		Counts:                buildSupportBundleDBSummary(),
		Tasks:                 options.TaskSummary,
	}

	logFiles, err := collectSupportBundleLogFiles()
	if err != nil {
		return err
	}

	if err := writeBundleZip(outputPath, func(writer *zip.Writer) error {
		if err := writeJSONZipEntry(writer, "manifest.json", manifest); err != nil {
			return err
		}
		if err := writeBytesZipEntry(writer, "settings.redacted.json", settingsJSON); err != nil {
			return err
		}
		if err := writeFileZipEntry(writer, "db/accounts.db", snapshotPath); err != nil {
			return err
		}
		for _, logFile := range logFiles {
			if err := writeTailFileZipEntry(
				writer,
				filepath.Join("logs", filepath.Base(logFile)),
				logFile,
				supportBundleMaxLogBytesPerFile,
			); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	return AppendBackendDiagnosticLog("info", fmt.Sprintf("support bundle exported: %s", outputPath))
}

func RestoreDatabaseBackup(inputPath string) error {
	reader, err := zip.OpenReader(inputPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	var (
		manifest   DatabaseBackupManifest
		manifestOK bool
		dbEntry    *zip.File
	)

	for i := range reader.File {
		entry := reader.File[i]
		switch entry.Name {
		case "manifest.json":
			if err := decodeZipJSONEntry(entry, &manifest); err != nil {
				return err
			}
			manifestOK = true
		case "db/accounts.db":
			dbEntry = entry
		}
	}

	if !manifestOK {
		return fmt.Errorf("backup is missing manifest.json")
	}
	if dbEntry == nil {
		return fmt.Errorf("backup is missing db/accounts.db")
	}
	if manifest.DatabaseSchemaVersion > GetDatabaseSchemaVersion() {
		return fmt.Errorf(
			"backup schema version %d is newer than this app supports (%d)",
			manifest.DatabaseSchemaVersion,
			GetDatabaseSchemaVersion(),
		)
	}

	extractedDB, err := os.CreateTemp("", "xdownloader-restore-*.db")
	if err != nil {
		return err
	}
	extractedDBPath := extractedDB.Name()
	extractedDB.Close()
	defer os.Remove(extractedDBPath)

	if err := extractZipEntryToPath(dbEntry, extractedDBPath); err != nil {
		return err
	}

	if manifest.SHA256 != "" {
		digest, err := sha256File(extractedDBPath)
		if err != nil {
			return err
		}
		if !strings.EqualFold(digest, manifest.SHA256) {
			return fmt.Errorf("backup checksum mismatch")
		}
	}

	dbPath := GetDBPath()
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return err
	}

	previousDBPath := dbPath + ".restore-backup"
	_ = os.Remove(previousDBPath)
	CloseDB()

	if _, err := os.Stat(dbPath); err == nil {
		if err := os.Rename(dbPath, previousDBPath); err != nil {
			return err
		}
	}

	restored := false
	defer func() {
		if restored {
			_ = os.Remove(previousDBPath)
			return
		}
		_ = os.Remove(dbPath)
		if _, err := os.Stat(previousDBPath); err == nil {
			_ = os.Rename(previousDBPath, dbPath)
		}
	}()

	if err := copyFileContents(extractedDBPath, dbPath, 0o600); err != nil {
		return err
	}

	if err := InitDB(); err != nil {
		return err
	}

	restored = true
	return AppendBackendDiagnosticLog("info", fmt.Sprintf("database backup restored from: %s", inputPath))
}

func createDatabaseSnapshotFile() (string, error) {
	if db == nil {
		if err := InitDB(); err != nil {
			return "", err
		}
	}

	snapshot, err := os.CreateTemp("", "xdownloader-snapshot-*.db")
	if err != nil {
		return "", err
	}
	snapshotPath := snapshot.Name()
	snapshot.Close()
	_ = os.Remove(snapshotPath)

	vacuumSQL := "VACUUM INTO " + sqliteQuoteLiteral(snapshotPath)
	if _, err := db.Exec(vacuumSQL); err == nil {
		return snapshotPath, nil
	}

	if err := copyFileContents(GetDBPath(), snapshotPath, 0o600); err != nil {
		return "", err
	}
	return snapshotPath, nil
}

func sqliteQuoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func sha256File(path string) (string, error) {
	handle, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer handle.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, handle); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeBundleZip(outputPath string, writeEntries func(writer *zip.Writer) error) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o700); err != nil {
		return err
	}

	outputFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer outputFile.Close()

	zipWriter := zip.NewWriter(outputFile)
	if err := writeEntries(zipWriter); err != nil {
		_ = zipWriter.Close()
		return err
	}
	return zipWriter.Close()
}

func writeJSONZipEntry(writer *zip.Writer, entryName string, payload any) error {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return writeBytesZipEntry(writer, entryName, data)
}

func writeBytesZipEntry(writer *zip.Writer, entryName string, data []byte) error {
	entry, err := writer.Create(entryName)
	if err != nil {
		return err
	}
	_, err = entry.Write(data)
	return err
}

func writeFileZipEntry(writer *zip.Writer, entryName, sourcePath string) error {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	entry, err := writer.Create(entryName)
	if err != nil {
		return err
	}

	_, err = io.Copy(entry, sourceFile)
	return err
}

func writeTailFileZipEntry(writer *zip.Writer, entryName, sourcePath string, maxBytes int64) error {
	data, err := readTailFileBytes(sourcePath, maxBytes)
	if err != nil {
		return err
	}
	return writeBytesZipEntry(writer, entryName, data)
}

func decodeZipJSONEntry(entry *zip.File, target any) error {
	handle, err := entry.Open()
	if err != nil {
		return err
	}
	defer handle.Close()
	return json.NewDecoder(handle).Decode(target)
}

func extractZipEntryToPath(entry *zip.File, outputPath string) error {
	handle, err := entry.Open()
	if err != nil {
		return err
	}
	defer handle.Close()

	outputFile, err := os.OpenFile(outputPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer outputFile.Close()

	_, err = io.Copy(outputFile, handle)
	return err
}

func copyFileContents(sourcePath, destinationPath string, mode os.FileMode) error {
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer output.Close()

	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Chmod(mode)
}

func collectSupportBundleLogFiles() ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(GetLogsDir(), "*.log"))
	if err != nil {
		return nil, err
	}

	files := make([]string, 0, len(matches))
	for _, match := range matches {
		info, err := os.Stat(match)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		if info.Mode().IsRegular() {
			files = append(files, match)
		}
	}

	slices.SortFunc(files, func(left, right string) int {
		leftInfo, leftErr := os.Stat(left)
		rightInfo, rightErr := os.Stat(right)
		if leftErr == nil && rightErr == nil {
			if leftInfo.ModTime().After(rightInfo.ModTime()) {
				return -1
			}
			if leftInfo.ModTime().Before(rightInfo.ModTime()) {
				return 1
			}
		}
		return strings.Compare(filepath.Base(left), filepath.Base(right))
	})

	return files, nil
}

func readTailFileBytes(sourcePath string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(sourcePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}

	if maxBytes <= 0 || info.Size() <= maxBytes {
		return io.ReadAll(file)
	}

	startOffset := info.Size() - maxBytes
	if _, err := file.Seek(startOffset, io.SeekStart); err != nil {
		return nil, err
	}

	reader := bufio.NewReader(file)
	if startOffset > 0 {
		if _, err := reader.ReadString('\n'); err != nil && err != io.EOF {
			return nil, err
		}
	}

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	prefix := []byte(fmt.Sprintf("[truncated to last %d bytes]\n", maxBytes))
	return append(prefix, data...), nil
}

func buildRedactedSettingsSnapshot() ([]byte, error) {
	raw, err := os.ReadFile(GetSettingsSnapshotPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []byte("{}\n"), nil
		}
		return nil, err
	}

	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}

	if proxy, ok := parsed["proxy"].(string); ok && strings.TrimSpace(proxy) != "" {
		parsed["proxy"] = redactProxyURL(proxy)
	}

	data, err := json.MarshalIndent(parsed, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func redactProxyURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "[redacted]"
	}
	if parsed.User == nil {
		return raw
	}
	username := parsed.User.Username()
	if username == "" {
		parsed.User = url.UserPassword("redacted", "***")
		return parsed.String()
	}
	parsed.User = url.UserPassword(username, "***")
	return parsed.String()
}

func buildSupportBundleDBSummary() supportBundleDBSummary {
	summary := supportBundleDBSummary{}
	if db == nil {
		if err := InitDB(); err != nil {
			return summary
		}
	}

	bootstrap, err := GetSavedAccountsBootstrap()
	if err == nil && bootstrap != nil {
		summary.Accounts = bootstrap.PublicCount + bootstrap.PrivateCount
		summary.PublicCount = bootstrap.PublicCount
		summary.PrivateCount = bootstrap.PrivateCount
		summary.GroupsCount = len(bootstrap.Groups)
	}

	if err := db.QueryRow(`SELECT COUNT(*) FROM account_timeline_items`).Scan(&summary.SnapshotItems); err != nil && err != sql.ErrNoRows {
		summary.SnapshotItems = 0
	}

	return summary
}

func currentWailsVersion() string {
	buildInfo, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}

	for _, dep := range buildInfo.Deps {
		if dep.Path == "github.com/wailsapp/wails/v2" {
			return dep.Version
		}
	}
	return ""
}
