package backend

import (
	"strings"
	"sync"
)

const (
	PythonFallbackBuildFlavorFallbackCompatible = "fallback-compatible"
	PythonFallbackBuildFlavorGoOnly = "go-only"
)

var ErrPythonFallbackUnavailable = ErrExtractorControlRetired

type PythonFallbackStatus struct {
	Available            bool   `json:"available"`
	BuildFlavor          string `json:"build_flavor"`
	AdHocParityAvailable bool   `json:"ad_hoc_parity_available"`
	UnavailableReason    string `json:"unavailable_reason,omitempty"`
}

var (
	pythonFallbackStatusOnce sync.Once
	pythonFallbackStatus     PythonFallbackStatus

	pythonFallbackTestMu       sync.RWMutex
	pythonFallbackTestOverride *PythonFallbackStatus
)

func currentPythonFallbackStatus() PythonFallbackStatus {
	pythonFallbackTestMu.RLock()
	if pythonFallbackTestOverride != nil {
		override := *pythonFallbackTestOverride
		pythonFallbackTestMu.RUnlock()
		return sanitizePythonFallbackStatus(override)
	}
	pythonFallbackTestMu.RUnlock()

	pythonFallbackStatusOnce.Do(func() {
		pythonFallbackStatus = sanitizePythonFallbackStatus(PythonFallbackStatus{
			Available:            false,
			BuildFlavor:          PythonFallbackBuildFlavorGoOnly,
			AdHocParityAvailable: false,
			UnavailableReason:    retiredExtractorControlReason("python fallback"),
		})
	})
	return pythonFallbackStatus
}

func sanitizePythonFallbackStatus(status PythonFallbackStatus) PythonFallbackStatus {
	status.BuildFlavor = strings.TrimSpace(status.BuildFlavor)
	if status.BuildFlavor == "" {
		status.BuildFlavor = PythonFallbackBuildFlavorGoOnly
	}
	status.UnavailableReason = strings.TrimSpace(status.UnavailableReason)
	status.Available = false
	status.AdHocParityAvailable = false
	if status.UnavailableReason == "" {
		status.UnavailableReason = retiredExtractorControlReason("python fallback")
	}
	return status
}

func setPythonFallbackStatusForTests(status PythonFallbackStatus) {
	pythonFallbackTestMu.Lock()
	defer pythonFallbackTestMu.Unlock()
	sanitized := sanitizePythonFallbackStatus(status)
	pythonFallbackTestOverride = &sanitized
}

func resetPythonFallbackStatusForTests() {
	pythonFallbackTestMu.Lock()
	defer pythonFallbackTestMu.Unlock()
	pythonFallbackTestOverride = nil
}
