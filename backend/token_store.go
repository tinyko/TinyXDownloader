package backend

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type StoredAuthTokens struct {
	PublicToken  string `json:"public_token"`
	PrivateToken string `json:"private_token"`
}

func authTokensPath() string {
	return ResolveAppDataPath("auth_tokens.json")
}

func LoadStoredAuthTokens() (StoredAuthTokens, error) {
	return loadStoredAuthTokensFromPath(authTokensPath())
}

func SaveStoredAuthTokens(tokens StoredAuthTokens) error {
	return saveStoredAuthTokensToPath(authTokensPath(), tokens)
}

func loadStoredAuthTokensFromPath(path string) (StoredAuthTokens, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return StoredAuthTokens{}, nil
		}
		return StoredAuthTokens{}, err
	}

	if len(content) == 0 {
		return StoredAuthTokens{}, nil
	}

	var tokens StoredAuthTokens
	if err := json.Unmarshal(content, &tokens); err != nil {
		return StoredAuthTokens{}, err
	}

	return tokens, nil
}

func saveStoredAuthTokensToPath(path string, tokens StoredAuthTokens) error {
	if tokens.PublicToken == "" && tokens.PrivateToken == "" {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	content, err := json.Marshal(tokens)
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, content, 0600); err != nil {
		return err
	}

	return os.Chmod(path, 0600)
}
