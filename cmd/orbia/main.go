package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"orbia/internal/app"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	if e := run(); e != nil {
		slog.Error("Orbia stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	// Keep database, WAL and shared-memory files private to the process user.
	syscall.Umask(0077)
	if len(os.Args) != 1 {
		return errors.New("usage: orbia")
	}
	path := env("ORBIA_DB", "./data/orbia.db")
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	store, e := app.NewStore(path)
	if e != nil {
		return e
	}
	defer store.DB.Close()
	if e = os.Chmod(path, 0600); e != nil {
		return e
	}
	if os.Getenv("ORBIA_SEED_DEMO") == "true" {
		if e = store.SeedBookmarks(); e != nil {
			return e
		}
	}
	origin := os.Getenv("ORBIA_ORIGIN")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || strings.Trim(u.Path, "/") != "" || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("ORBIA_ORIGIN must be an http(s) origin without a path, credentials, query or fragment")
		}
	}
	handler := app.NewServer(store, app.Config{Origin: origin, SecureCookie: os.Getenv("ORBIA_SECURE_COOKIE") == "true"})
	server := &http.Server{Addr: env("ORBIA_ADDR", ":8080"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { slog.Info("Orbia listening", "address", server.Addr); done <- server.ListenAndServe() }()
	select {
	case e = <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
