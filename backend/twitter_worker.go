package backend

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

var (
	errExtractorCanceled      = errors.New("extractor canceled")
	errExtractorWorkerFailure = errors.New("extractor worker failure")
)

type extractorWorker struct {
	exePath string

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	dead   bool
}

func newExtractorWorker(exePath string) (*extractorWorker, error) {
	cmd := exec.Command(exePath, "--worker")
	cmd.Env = append(os.Environ(),
		"PYTHONIOENCODING=utf-8",
		"PYTHONUTF8=1",
	)
	hideWindow(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stdin: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stdout: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open worker stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start extractor worker: %w", err)
	}

	go func() {
		_, _ = io.Copy(io.Discard, stderr)
	}()

	return &extractorWorker{
		exePath: exePath,
		cmd:     cmd,
		stdin:   stdin,
		stdout:  bufio.NewReader(stdout),
	}, nil
}

func (w *extractorWorker) markDead() {
	w.mu.Lock()
	w.dead = true
	w.mu.Unlock()
}

func (w *extractorWorker) isDead() bool {
	w.mu.Lock()
	dead := w.dead
	w.mu.Unlock()
	return dead
}

func (w *extractorWorker) stop() {
	w.mu.Lock()
	if w.dead {
		w.mu.Unlock()
		return
	}
	w.dead = true
	cmd := w.cmd
	stdin := w.stdin
	w.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if cmd != nil {
		_, _ = cmd.Process.Wait()
	}
}

func (w *extractorWorker) execute(requestID string, payload extractorWorkerPayload) ([]byte, error) {
	request := extractorWorkerRequest{
		ID:      requestID,
		Request: payload,
	}

	requestLine, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("%w: failed to encode worker request: %v", errExtractorWorker, err)
	}

	cleanup := registerExtractorRequest(requestID, func() {
		w.stop()
	})
	defer cleanup()

	w.mu.Lock()
	if w.dead || w.stdin == nil || w.stdout == nil {
		w.mu.Unlock()
		return nil, fmt.Errorf("%w: worker unavailable", errExtractorWorker)
	}
	stdin := w.stdin
	stdout := w.stdout
	w.mu.Unlock()

	requestLine = append(requestLine, '\n')
	if _, err := stdin.Write(requestLine); err != nil {
		w.markDead()
		if consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}
		return nil, fmt.Errorf("%w: failed to write worker request: %v", errExtractorWorker, err)
	}

	responseLine, err := stdout.ReadBytes('\n')
	if err != nil {
		w.markDead()
		if consumeExtractorRequestCanceled(requestID) {
			return nil, ErrExtractorCanceled
		}
		return nil, fmt.Errorf("%w: failed to read worker response: %v", errExtractorWorker, err)
	}

	var response extractorWorkerResponse
	if err := json.Unmarshal(bytes.TrimSpace(responseLine), &response); err != nil {
		w.markDead()
		return nil, fmt.Errorf("%w: invalid worker response: %v", errExtractorWorker, err)
	}

	if response.ID != "" && response.ID != requestID {
		w.markDead()
		return nil, fmt.Errorf("%w: mismatched worker response id %q", errExtractorWorker, response.ID)
	}

	if !response.OK {
		if response.Error == "" {
			response.Error = "extractor worker returned an unknown error"
		}
		return nil, fmt.Errorf("%s", response.Error)
	}

	return response.Result, nil
}
