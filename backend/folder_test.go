package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCheckFoldersExist(t *testing.T) {
	basePath := t.TempDir()

	if err := os.Mkdir(filepath.Join(basePath, "tarojob"), 0o755); err != nil {
		t.Fatalf("create tarojob dir: %v", err)
	}
	if err := os.Mkdir(filepath.Join(basePath, "My Bookmarks"), 0o755); err != nil {
		t.Fatalf("create bookmarks dir: %v", err)
	}

	results := CheckFoldersExist(basePath, []string{"tarojob", "My Bookmarks", "My Likes", "tarojob"})

	if !results["tarojob"] {
		t.Fatalf("expected tarojob folder to exist")
	}
	if !results["My Bookmarks"] {
		t.Fatalf("expected My Bookmarks folder to exist")
	}
	if results["My Likes"] {
		t.Fatalf("expected My Likes folder to be missing")
	}
	if len(results) != 3 {
		t.Fatalf("expected deduplicated results for 3 folders, got %d", len(results))
	}
}

func TestGetDownloadDirectorySnapshot(t *testing.T) {
	basePath := t.TempDir()

	if err := os.Mkdir(filepath.Join(basePath, "alpha"), 0o755); err != nil {
		t.Fatalf("create alpha dir: %v", err)
	}
	if err := os.Mkdir(filepath.Join(basePath, "beta"), 0o755); err != nil {
		t.Fatalf("create beta dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(basePath, "not-a-dir.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("create file: %v", err)
	}

	snapshot, err := GetDownloadDirectorySnapshot(basePath)
	if err != nil {
		t.Fatalf("get directory snapshot: %v", err)
	}
	if len(snapshot) != 2 {
		t.Fatalf("expected 2 directories, got %d (%v)", len(snapshot), snapshot)
	}
}
