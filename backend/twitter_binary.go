package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// getExecutableName returns the appropriate executable name for the current OS
func getExecutableName() string {
	if runtime.GOOS == "windows" {
		return "extractor.exe"
	}
	return "extractor"
}

// getExtractorPath returns the path to extractor binary.
func getExtractorPath() string {
	return ResolveAppDataPath(getExecutableName())
}

// getHashFilePath returns the path to the hash file for version checking
func getHashFilePath() string {
	return ResolveAppDataPath("extractor.sha256")
}

// calculateHash calculates SHA256 hash of data
func calculateHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// ensureExtractor ensures the extractor binary exists
// Extracts from embedded binary if not present or if hash differs (update)
func ensureExtractor() (string, error) {
	exePath := getExtractorPath()
	hashPath := getHashFilePath()
	baseDir := filepath.Dir(exePath)

	// Create directory if not exists
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %v", err)
	}

	// Calculate hash of embedded binary
	embeddedHash := calculateHash(extractorBin)

	// Check if binary and hash file exist
	if _, err := os.Stat(exePath); err == nil {
		// Binary exists - check hash
		if storedHash, err := os.ReadFile(hashPath); err == nil {
			if string(storedHash) == embeddedHash {
				return exePath, nil // Already extracted and up to date
			}
		}
		// Hash differs or missing - need to update
		os.Remove(exePath)
	}

	// Extract binary
	if err := os.WriteFile(exePath, extractorBin, 0755); err != nil {
		return "", fmt.Errorf("failed to write extractor: %v", err)
	}

	// Save hash for future comparison
	if err := os.WriteFile(hashPath, []byte(embeddedHash), 0644); err != nil {
		// Non-fatal - binary still works, just won't skip next time
		fmt.Printf("Warning: failed to save hash file: %v\n", err)
	}

	return exePath, nil
}
