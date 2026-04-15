package backend

import (
	"os"
	"path/filepath"
)

const (
	AppDataDirEnv            = "XDOWNLOADER_APPDATA_DIR"
	SmokeModeEnv             = "XDOWNLOADER_SMOKE_MODE"
	SmokeReportPathEnv       = "XDOWNLOADER_SMOKE_REPORT_PATH"
	CurrentDatabaseSchemaVer = 2
)

func GetAppDataDir() string {
	if override := os.Getenv(AppDataDirEnv); override != "" {
		return override
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "."
	}

	return filepath.Join(homeDir, ".twitterxmediabatchdownloader")
}

func ResolveAppDataPath(parts ...string) string {
	allParts := append([]string{GetAppDataDir()}, parts...)
	return filepath.Join(allParts...)
}

func EnsureAppDataDir() error {
	return os.MkdirAll(GetAppDataDir(), 0o700)
}

func GetLogsDir() string {
	return ResolveAppDataPath("logs")
}

func GetDatabaseSchemaVersion() int {
	return CurrentDatabaseSchemaVer
}

func IsSmokeMode() bool {
	return os.Getenv(SmokeModeEnv) == "1"
}

func GetSmokeReportPath() string {
	return os.Getenv(SmokeReportPathEnv)
}
