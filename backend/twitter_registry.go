package backend

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

var (
	ErrExtractorCanceled = errExtractorCanceled
	errExtractorWorker   = errExtractorWorkerFailure

	extractorRequestsMu sync.Mutex
	extractorCancels    = make(map[string]func())
	extractorCanceled   = make(map[string]struct{})
)

func registerExtractorRequest(requestID string, cancel func()) func() {
	if strings.TrimSpace(requestID) == "" {
		return func() {}
	}

	extractorRequestsMu.Lock()
	delete(extractorCanceled, requestID)
	extractorCancels[requestID] = cancel
	extractorRequestsMu.Unlock()

	return func() {
		extractorRequestsMu.Lock()
		if _, ok := extractorCancels[requestID]; ok {
			delete(extractorCancels, requestID)
		}
		extractorRequestsMu.Unlock()
	}
}

func consumeExtractorRequestCanceled(requestID string) bool {
	if strings.TrimSpace(requestID) == "" {
		return false
	}

	extractorRequestsMu.Lock()
	_, ok := extractorCanceled[requestID]
	if ok {
		delete(extractorCanceled, requestID)
	}
	extractorRequestsMu.Unlock()

	return ok
}

func cancelRegisteredExtractorRequests() {
	extractorRequestsMu.Lock()
	cancels := make([]func(), 0, len(extractorCancels))
	for requestID, cancel := range extractorCancels {
		cancels = append(cancels, cancel)
		extractorCanceled[requestID] = struct{}{}
		delete(extractorCancels, requestID)
	}
	extractorRequestsMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}

// CancelExtractorRequest cancels a specific in-flight extractor request.
func CancelExtractorRequest(requestID string) bool {
	if strings.TrimSpace(requestID) == "" {
		return false
	}

	extractorRequestsMu.Lock()
	cancel, ok := extractorCancels[requestID]
	if ok {
		delete(extractorCancels, requestID)
		extractorCanceled[requestID] = struct{}{}
	}
	extractorRequestsMu.Unlock()

	if ok {
		cancel()
	}

	return ok
}

// KillAllExtractorProcesses kills all running extractor processes.
func KillAllExtractorProcesses() {
	cancelRegisteredExtractorRequests()
	shutdownExtractorWorkerPool()

	exeName := getExecutableName()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("taskkill", "/F", "/IM", exeName)
	} else {
		cmd = exec.Command("pkill", "-f", exeName)
	}

	hideWindow(cmd)
	cmd.CombinedOutput()
}
