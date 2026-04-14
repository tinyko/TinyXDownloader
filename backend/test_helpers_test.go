package backend

import (
	"database/sql"
	"testing"
)

func withTestDB(t *testing.T, fn func()) {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	testDB.SetMaxOpenConns(1)
	db = testDB

	t.Cleanup(func() {
		if db != nil {
			_ = db.Close()
		}
		db = previousDB
	})

	fn()
}
