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

var diagnosticsLogMu sync.Mutex

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
	handle, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer handle.Close()

	_, err = handle.WriteString(line)
	return err
}
