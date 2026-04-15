package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	frontendDiagnosticsLogName = "frontend.log"
	backendDiagnosticsLogName  = "backend.log"
)

var (
	diagnosticsLogMu       sync.Mutex
	diagnosticsLogMaxBytes int64 = 512 * 1024
	diagnosticsLogArchives       = 3
)

func AppendDiagnosticLog(level, message string) error {
	return appendDiagnosticLog(frontendDiagnosticsLogName, level, message)
}

func AppendBackendDiagnosticLog(level, message string) error {
	return appendDiagnosticLog(backendDiagnosticsLogName, level, message)
}

func appendDiagnosticLog(fileName, level, message string) error {
	level = strings.TrimSpace(strings.ToLower(level))
	if level == "" {
		level = "info"
	}

	line := fmt.Sprintf(
		"[%s] [%s] %s\n",
		time.Now().Format(time.RFC3339),
		level,
		strings.TrimSpace(message),
	)

	diagnosticsLogMu.Lock()
	defer diagnosticsLogMu.Unlock()

	if err := os.MkdirAll(GetLogsDir(), 0o700); err != nil {
		return err
	}

	logPath := filepath.Join(GetLogsDir(), fileName)
	if err := rotateDiagnosticsLogIfNeeded(logPath, fileName, int64(len(line))); err != nil {
		return err
	}

	handle, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer handle.Close()

	_, err = handle.WriteString(line)
	return err
}

func rotateDiagnosticsLogIfNeeded(logPath, fileName string, incomingBytes int64) error {
	if diagnosticsLogMaxBytes <= 0 {
		return nil
	}

	info, err := os.Stat(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if info.Size() == 0 || info.Size()+incomingBytes <= diagnosticsLogMaxBytes {
		return nil
	}

	if diagnosticsLogArchives <= 0 {
		return os.Remove(logPath)
	}

	for index := diagnosticsLogArchives; index >= 1; index-- {
		targetPath := diagnosticsArchivePath(fileName, index)
		if index == diagnosticsLogArchives {
			_ = os.Remove(targetPath)
		}

		sourcePath := logPath
		if index > 1 {
			sourcePath = diagnosticsArchivePath(fileName, index-1)
		}

		if _, err := os.Stat(sourcePath); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}

		if err := os.Rename(sourcePath, targetPath); err != nil {
			return err
		}
	}

	return nil
}

func diagnosticsArchivePath(fileName string, index int) string {
	extension := filepath.Ext(fileName)
	base := strings.TrimSuffix(fileName, extension)
	archiveName := fmt.Sprintf("%s.%d%s", base, index, extension)
	return filepath.Join(GetLogsDir(), archiveName)
}
