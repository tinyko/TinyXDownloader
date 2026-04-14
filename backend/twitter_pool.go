package backend

import (
	"fmt"
	"sync"
)

var (
	extractorPoolMu sync.Mutex
	extractorPool   *extractorWorkerPool
)

const extractorWorkerPoolSize = 2

type extractorWorkerPool struct {
	exePath string
	maxSize int

	available chan *extractorWorker

	mu           sync.Mutex
	active       int
	shuttingDown bool
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
				p.decrementActive()
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
				p.decrementActive()
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
			p.decrementActive()
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
		p.decrementActive()
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
				p.decrementActive()
			}
		default:
			return
		}
	}
}

func (p *extractorWorkerPool) decrementActive() {
	p.mu.Lock()
	if p.active > 0 {
		p.active--
	}
	p.mu.Unlock()
}
