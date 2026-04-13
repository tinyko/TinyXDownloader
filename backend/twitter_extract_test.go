package backend

import (
	"errors"
	"reflect"
	"testing"
)

func TestShouldRetryAsGuest(t *testing.T) {
	csrfErr := errors.New("403 forbidden (this request requires a matching csrf cookie and header.)")

	if !shouldRetryAsGuest("token123", "media", csrfErr) {
		t.Fatal("expected public media fetch to retry as guest on csrf error")
	}

	if shouldRetryAsGuest("", "media", csrfErr) {
		t.Fatal("did not expect guest retry when no auth token was provided")
	}

	if shouldRetryAsGuest("token123", "likes", csrfErr) {
		t.Fatal("did not expect likes fetch to retry as guest")
	}

	if shouldRetryAsGuest("token123", "bookmarks", csrfErr) {
		t.Fatal("did not expect bookmarks fetch to retry as guest")
	}

	if shouldRetryAsGuest("token123", "media", errors.New("401 unauthorized")) {
		t.Fatal("did not expect unrelated errors to trigger guest retry")
	}
}

func TestBuildGuestExtractorArgs(t *testing.T) {
	args := []string{
		"https://x.com/example/media",
		"--auth-token",
		"abc123",
		"--json",
		"--metadata",
		"--limit",
		"200",
	}

	got := buildGuestExtractorArgs(args)
	want := []string{
		"https://x.com/example/media",
		"--json",
		"--metadata",
		"--limit",
		"200",
		"--guest",
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected guest args:\n got: %#v\nwant: %#v", got, want)
	}
}
