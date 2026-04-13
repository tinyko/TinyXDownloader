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
