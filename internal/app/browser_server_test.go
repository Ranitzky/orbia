package app

import (
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Playwright starts this fixture on an ephemeral loopback port and closes stdin to stop it.
func TestBrowserServer(t *testing.T) {
	if os.Getenv("ORBIA_BROWSER_SERVER") != "1" {
		t.Skip("used by the Playwright runner")
	}
	store, handler := fixture(t)
	if err := store.SeedBookmarks(); err != nil {
		t.Fatal(err)
	}
	source, sourceAPI := fixture(t)
	if _, err := source.Save(0, BookmarkInput{URL: ptr("https://imported.test/"), Title: ptr("Imported via settings")}, false); err != nil {
		t.Fatal(err)
	}
	handler.sourceClient.Transport = handlerTransport{sourceAPI}
	server := httptest.NewServer(handler)
	defer server.Close()
	freshStore, err := NewStore(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer freshStore.DB.Close()
	fresh := NewServer(freshStore, Config{})
	onboarding := httptest.NewServer(fresh)
	defer onboarding.Close()
	fmt.Println("SETUP", onboarding.URL, fresh.auth.setupCode)
	fmt.Println(server.URL)
	_, _ = io.Copy(io.Discard, os.Stdin)
}
