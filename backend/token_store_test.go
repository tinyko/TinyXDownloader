package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoredAuthTokensRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth_tokens.json")
	expected := StoredAuthTokens{
		PublicToken:  "public-token",
		PrivateToken: "private-token",
	}

	if err := saveStoredAuthTokensToPath(path, expected); err != nil {
		t.Fatalf("failed to save tokens: %v", err)
	}

	actual, err := loadStoredAuthTokensFromPath(path)
	if err != nil {
		t.Fatalf("failed to load tokens: %v", err)
	}

	if actual != expected {
		t.Fatalf("unexpected tokens: got %#v want %#v", actual, expected)
	}
}

func TestStoredAuthTokensRemovesFileWhenEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth_tokens.json")
	if err := os.WriteFile(path, []byte(`{"public_token":"x"}`), 0600); err != nil {
		t.Fatalf("failed to seed token file: %v", err)
	}

	if err := saveStoredAuthTokensToPath(path, StoredAuthTokens{}); err != nil {
		t.Fatalf("failed to clear tokens: %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected token file to be removed, got err=%v", err)
	}
}
