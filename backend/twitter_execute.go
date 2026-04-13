package backend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// parseExtractorError parses the extractor output and returns a user-friendly error message
// while preserving the original error from gallery-dl
func parseExtractorError(output string, username string) string {
	outputLower := strings.ToLower(output)

	// Extract the actual error line from gallery-dl output
	lines := strings.Split(output, "\n")
	var errorLine string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		lineLower := strings.ToLower(line)

		// Ignore noisy Python warnings so they don't mask the real failure reason.
		if strings.Contains(lineLower, "notopensslwarning") ||
			strings.Contains(lineLower, "urllib3 v2 only supports openssl") {
			continue
		}

		if strings.Contains(lineLower, "error:") || strings.Contains(lineLower, "exception") {
			errorLine = line
			break
		}
	}
	if errorLine == "" {
		filtered := make([]string, 0, len(lines))
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			lineLower := strings.ToLower(line)
			if strings.Contains(lineLower, "notopensslwarning") ||
				strings.Contains(lineLower, "urllib3 v2 only supports openssl") {
				continue
			}
			filtered = append(filtered, line)
		}
		errorLine = strings.Join(filtered, " ")
	}
	if strings.TrimSpace(errorLine) == "" {
		errorLine = "extractor terminated before returning data"
	}

	// Truncate if too long
	if len(errorLine) > 300 {
		errorLine = errorLine[:300] + "..."
	}

	// Add context hint based on error type, but keep original message
	var hint string
	if strings.Contains(outputLower, "unable to retrieve tweets from this timeline") {
		hint = " [Hint: End of timeline reached or rate limited - data already fetched has been saved]"
	} else if strings.Contains(outputLower, "rate limit") || strings.Contains(output, "429") {
		hint = " [Hint: Wait 5-15 minutes before retrying]"
	} else if strings.Contains(output, "401") || strings.Contains(outputLower, "unauthorized") {
		hint = " [Hint: Auth token may be invalid or expired]"
	} else if strings.Contains(output, "404") {
		hint = fmt.Sprintf(" [Hint: @%s may not exist or is suspended]", username)
	} else if strings.Contains(outputLower, "protected") || strings.Contains(output, "403") {
		hint = " [Hint: Protected account - need to follow and use auth token]"
	}

	return errorLine + hint
}

// TweetIDString is a custom type that unmarshals int64 but marshals as string

func runExtractorCommand(exePath string, args []string, username string, requestID string) ([]byte, error) {
	ctx := context.Background()
	cleanup := func() {}
	if strings.TrimSpace(requestID) != "" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(context.Background())
		cleanup = registerExtractorRequest(requestID, cancel)
	}
	defer cleanup()

	cmd := exec.CommandContext(ctx, exePath, args...)
	cmd.Env = append(os.Environ(),
		"PYTHONIOENCODING=utf-8",
		"PYTHONUTF8=1",
	)
	hideWindow(cmd)

	output, err := cmd.CombinedOutput()
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) || consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}

		outputStr := string(output)
		errorMsg := parseExtractorError(outputStr, username)
		return nil, fmt.Errorf("%s", errorMsg)
	}

	return output, nil
}

func executeExtractorRequest(
	exePath string,
	requestID string,
	payload extractorWorkerPayload,
	args []string,
	username string,
) ([]byte, error) {
	pool := getExtractorWorkerPool(exePath)
	if pool != nil {
		worker, err := pool.acquire()
		if err == nil {
			output, execErr := worker.execute(requestID, payload)
			pool.release(worker)
			if execErr == nil || errors.Is(execErr, ErrExtractorCanceled) || !errors.Is(execErr, errExtractorWorker) {
				return output, execErr
			}
		}
	}

	return runExtractorCommand(exePath, args, username, requestID)
}
