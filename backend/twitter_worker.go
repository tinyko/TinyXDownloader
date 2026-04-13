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
	"runtime"
	"strings"
	"sync"
)

var (
	ErrExtractorCanceled = errors.New("extractor canceled")
	errExtractorWorker   = errors.New("extractor worker failure")

	extractorRequestsMu sync.Mutex
	extractorCancels    = make(map[string]func())
	extractorCanceled   = make(map[string]struct{})

	extractorPoolMu sync.Mutex
	extractorPool   *extractorWorkerPool
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

// KillAllExtractorProcesses kills all running extractor processes
// This is useful for cleanup when starting fresh or when user stops fetch
func KillAllExtractorProcesses() {
	cancelRegisteredExtractorRequests()
	shutdownExtractorWorkerPool()

	exeName := getExecutableName()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Use taskkill on Windows
		cmd = exec.Command("taskkill", "/F", "/IM", exeName)
	} else {
		// Use pkill on Unix
		cmd = exec.Command("pkill", "-f", exeName)
	}

	hideWindow(cmd)
	cmd.CombinedOutput() // Ignore errors - it's okay if no processes found
}

const extractorWorkerPoolSize = 2

type extractorWorkerPayload struct {
	URL        string   `json:"url"`
	AuthToken  string   `json:"auth_token,omitempty"`
	Guest      bool     `json:"guest,omitempty"`
	Retweets   string   `json:"retweets,omitempty"`
	NoVideos   bool     `json:"no_videos,omitempty"`
	Size       string   `json:"size,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Metadata   bool     `json:"metadata,omitempty"`
	TextTweets bool     `json:"text_tweets,omitempty"`
	Type       string   `json:"type,omitempty"`
	Verbose    bool     `json:"verbose,omitempty"`
	Set        []string `json:"set,omitempty"`
	Cursor     string   `json:"cursor,omitempty"`
}

type extractorWorkerRequest struct {
	ID      string                 `json:"id"`
	Request extractorWorkerPayload `json:"request"`
}

type extractorWorkerResponse struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type extractorWorker struct {
	exePath string

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	dead   bool
}

type extractorWorkerPool struct {
	exePath string
	maxSize int

	available chan *extractorWorker

	mu           sync.Mutex
	active       int
	shuttingDown bool
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

func getExtractorWorkerPool(exePath string) *extractorWorkerPool {
	extractorPoolMu.Lock()
	defer extractorPoolMu.Unlock()

	if extractorPool == nil || extractorPool.exePath != exePath {
		if extractorPool != nil {
			extractorPool.shutdown()
		}
		extractorPool = &extractorWorkerPool{
			exePath:      exePath,
			maxSize:      extractorWorkerPoolSize,
			available:    make(chan *extractorWorker, extractorWorkerPoolSize),
			shuttingDown: false,
		}
	}

	return extractorPool
}

func shutdownExtractorWorkerPool() {
	extractorPoolMu.Lock()
	pool := extractorPool
	extractorPool = nil
	extractorPoolMu.Unlock()

	if pool != nil {
		pool.shutdown()
	}
}

func (p *extractorWorkerPool) acquire() (*extractorWorker, error) {
	for {
		select {
		case worker := <-p.available:
			if worker == nil || worker.isDead() {
				if worker != nil {
					worker.stop()
				}
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
				continue
			}
			return worker, nil
		default:
		}

		p.mu.Lock()
		if p.shuttingDown {
			p.mu.Unlock()
			return nil, fmt.Errorf("%w: worker pool is shutting down", errExtractorWorker)
		}
		if p.active < p.maxSize {
			p.active++
			p.mu.Unlock()

			worker, err := newExtractorWorker(p.exePath)
			if err != nil {
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
				return nil, fmt.Errorf("%w: %v", errExtractorWorker, err)
			}
			return worker, nil
		}
		p.mu.Unlock()

		worker := <-p.available
		if worker == nil {
			continue
		}
		if worker.isDead() {
			worker.stop()
			p.mu.Lock()
			if p.active > 0 {
				p.active--
			}
			p.mu.Unlock()
			continue
		}
		return worker, nil
	}
}

func (p *extractorWorkerPool) release(worker *extractorWorker) {
	if worker == nil {
		return
	}

	p.mu.Lock()
	shuttingDown := p.shuttingDown
	p.mu.Unlock()

	if shuttingDown || worker.isDead() {
		worker.stop()
		p.mu.Lock()
		if p.active > 0 {
			p.active--
		}
		p.mu.Unlock()
		return
	}

	p.available <- worker
}

func (p *extractorWorkerPool) shutdown() {
	p.mu.Lock()
	p.shuttingDown = true
	p.mu.Unlock()

	for {
		select {
		case worker := <-p.available:
			if worker != nil {
				worker.stop()
				p.mu.Lock()
				if p.active > 0 {
					p.active--
				}
				p.mu.Unlock()
			}
		default:
			return
		}
	}
}

// parseExtractorError parses the extractor output and returns a user-friendly error message
// while preserving the original error from gallery-dl
