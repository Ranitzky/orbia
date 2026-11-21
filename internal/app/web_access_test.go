package app

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestPasswordSetupAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store, Config{})
	code := server.auth.setupCode
	status := request(server, "GET", "/auth/status", "", false)
	if object(t, status)["mode"] != "setup" || strings.Contains(status.Body.String(), code) {
		t.Fatal("unexpected public setup status")
	}
	expectStatus(t, request(server, "POST", "/auth/login", "{}", false), 409)
	expectStatus(t, request(server, "POST", "/auth/setup", `{"code":"wrong","mode":"open"}`, false), 403)
	setup := func(password string) string {
		return fmt.Sprintf(`{"code":%q,"mode":"password","password":%q}`, code, password)
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
