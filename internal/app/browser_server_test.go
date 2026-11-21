package app

import (
	"fmt"
	"io"
	"net/http/httptest"
	"os"
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
	server := httptest.NewServer(handler)
	defer server.Close()
	fmt.Println(server.URL)
	_, _ = io.Copy(io.Discard, os.Stdin)
}
