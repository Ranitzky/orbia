package app

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestUpdateChecks(t *testing.T) {
	const token = "public-registry-token"
	revision := strings.Repeat("a", 40)
	installed := "sha256:" + strings.Repeat("1", 64)
	var latest atomic.Value
	latest.Store(installed)
	var checks atomic.Int32
	s := &Server{}
	client := &http.Client{Transport: handlerTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Scheme != "https" || r.URL.Host != "ghcr.io" {
			t.Errorf("unexpected registry URL %s", r.URL)
		}
		if r.URL.Path == "/token" {
			checks.Add(1)
			if r.Method != http.MethodGet || r.URL.Query().Get("scope") != "repository:ranitzky/orbia:pull" {
				t.Errorf("unexpected token request: %s %s", r.Method, r.URL)
			}
			_, _ = w.Write([]byte(`{"token":"` + token + `"}`))
			return
		}
		if r.Method != http.MethodHead || r.Header.Get("Authorization") != "Bearer "+token || r.Header.Get("Accept") == "" {
			t.Errorf("unexpected manifest request: %s %s", r.Method, r.URL)
		}
		switch r.URL.Path {
		case "/v2/ranitzky/orbia/manifests/" + revision:
			w.Header().Set("Docker-Content-Digest", installed)
		case "/v2/ranitzky/orbia/manifests/latest":
			digest := latest.Load().(string)
			if digest == "" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Docker-Content-Digest", digest)
		default:
			t.Errorf("unexpected manifest path %s", r.URL.Path)
		}
	})}}
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go s.checkForUpdates(ctx, client, revision)
		synctest.Wait()
		if checks.Load() != 1 || s.updateAvailable.Load() {
			t.Fatal("the first check should find the installed image at latest")
		}
		latest.Store("sha256:" + strings.Repeat("2", 64))
		time.Sleep(6*time.Hour - time.Second)
		synctest.Wait()
		if checks.Load() != 1 {
			t.Fatal("the next check ran before six hours elapsed")
		}
		time.Sleep(time.Second)
		synctest.Wait()
		if checks.Load() != 2 || !s.updateAvailable.Load() {
			t.Fatal("the second check should find an update")
		}
		latest.Store("")
		time.Sleep(6 * time.Hour)
		synctest.Wait()
		if checks.Load() != 3 || !s.updateAvailable.Load() {
			t.Fatal("a failed check should keep the last known status")
		}
		latest.Store(installed)
		time.Sleep(6 * time.Hour)
		synctest.Wait()
		if checks.Load() != 4 || s.updateAvailable.Load() {
			t.Fatal("matching digests should clear the update status")
		}
	})
}
