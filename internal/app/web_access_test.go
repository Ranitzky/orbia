package app

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestPasswordSetupAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store, Config{})
	status := request(server, "GET", "/auth/status", "", false)
	if object(t, status)["mode"] != "setup" {
		t.Fatal("unexpected public setup status")
	}
	expectStatus(t, request(server, "POST", "/auth/login", "{}", false), 409)
	expectStatus(t, request(server, "POST", "/auth/setup", `{"mode":"open"}`, true), 403)
	setup := func(password string) string {
		return fmt.Sprintf(`{"mode":"password","password":%q}`, password)
	}
	expectStatus(t, request(server, "POST", "/auth/setup", setup("short"), false), 400)
	expectStatus(t, request(server, "POST", "/auth/setup", setup(testPassword), false), 200)
	expectStatus(t, request(server, "POST", "/auth/setup", setup(testPassword), false), 409)
	store.DB.Close()
	store, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	server = NewServer(store, Config{})
	if object(t, request(server, "GET", "/auth/status", "", false))["mode"] != "password" {
		t.Fatal("password mode did not survive restart")
	}
	expectStatus(t, request(server, "POST", "/auth/password", `{"mode":"open"}`, false), 401)
	expectStatus(t, request(server, "POST", "/auth/login", `{}`, false), 401)
	expectStatus(t, request(server, "POST", "/auth/login", fmt.Sprintf(`{"password":%q}`, testPassword), false), 200)
}

func TestFirstSetupWins(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "setup.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	server := NewServer(store, Config{})
	start := make(chan struct{})
	results := make(chan int, 2)
	for _, mode := range []string{`{"mode":"open"}`, `{"mode":"password","password":"a-long-test-password"}`} {
		go func() {
			<-start
			results <- request(server, "POST", "/auth/setup", mode, false).Code
		}()
	}
	close(start)
	first, second := <-results, <-results
	if !(first == 200 && second == 409 || first == 409 && second == 200) {
		t.Fatalf("expected one successful setup and one conflict, got %d and %d", first, second)
	}
}
