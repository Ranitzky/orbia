package app

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"orbia/internal/sqlite"
)

// A missing row requires owner setup. An empty credential records an explicit passwordless choice.
func (a *auth) credential() (mode, credential string, err error) {
	err = a.store.DB.Read(func(c *sqlite.Conn) error {
		rows, e := c.Query("SELECT credential FROM web_access WHERE id=1")
		if e != nil {
			return e
		}
		mode = "setup"
		if len(rows) > 0 {
			credential = rows[0].Text("credential")
			mode = "password"
			if credential == "" {
				mode = "open"
			}
		}
		return nil
	})
	return
}

func (s *Server) LogSetupCode() error {
	mode, _, err := s.auth.credential()
	if err == nil && mode == "setup" {
		slog.Info("Complete first-time setup in the Orbia web UI", "setup_code", s.auth.setupCode)
	}
	return err
}

func passwordKey(password, salt string) string {
	key, _ := pbkdf2.Key(sha256.New, password, []byte(salt), 210000, 32)
	return hex.EncodeToString(key)
}

func passwordMatches(password, credential string) bool {
	salt, hash, ok := strings.Cut(credential, ":")
	return ok && subtle.ConstantTimeCompare([]byte(passwordKey(password, salt)), []byte(hash)) == 1
}

func (a *auth) webAccess(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/auth/status" {
		if r.Method != "GET" {
			w.WriteHeader(405)
			return
		}
		mode, _, err := a.credential()
		if err != nil {
			respondError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"mode": mode, "authenticated": a.session(r)})
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if !a.sameOrigin(r) || r.Header.Get("Authorization") != "" {
		writeError(w, 403, "Browser session required.")
		return
	}
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		writeError(w, 415, "Expected JSON.")
		return
	}
	var in struct{ Password, Current, Code, Mode string }
	if decode(w, r, &in, 16<<10) != nil {
		writeError(w, 400, "Invalid request.")
		return
	}
	// Serialize changes with credential checks and session issuance.
	a.accessMu.Lock()
	defer a.accessMu.Unlock()
	mode, credential, err := a.credential()
	if err != nil {
		respondError(w, err)
		return
	}
	change := r.URL.Path == "/auth/password"
	if change && !a.session(r) {
		writeError(w, 401, "Sign in first.")
		return
	}
	if (r.URL.Path == "/auth/setup") != (mode == "setup") {
		writeError(w, 409, "Access mode has changed.")
		return
	}
	if time.Since(a.window) > time.Minute {
		a.window = time.Now()
		a.failures = 0
	}
	if a.failures >= 10 {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "Too many attempts.")
		return
	}
	var verified bool
	switch mode {
	case "setup":
		verified = a.setupCode != "" && subtle.ConstantTimeCompare([]byte(in.Code), []byte(a.setupCode)) == 1
	case "open":
		verified = true
	case "password":
		password := in.Password
		if change {
			password = in.Current
		}
		verified = passwordMatches(password, credential)
	}
	if !verified {
		a.failures++
		status := http.StatusForbidden
		if r.URL.Path == "/auth/login" {
			status = http.StatusUnauthorized
		}
		writeError(w, status, "Incorrect credential.")
		return
	}
	if change || mode == "setup" {
		var next string
		switch in.Mode {
		case "password":
			if utf8.RuneCountInString(in.Password) < 12 || len(in.Password) > 1024 {
				writeError(w, 400, "Use at least 12 characters and at most 1024 bytes.")
				return
			}
			salt := rand.Text()
			next = salt + ":" + passwordKey(in.Password, salt)
		case "open":
			if in.Password != "" {
				writeError(w, 400, "Unexpected password.")
				return
			}
		default:
			writeError(w, 400, "Choose a mode.")
			return
		}
		err = a.saveCredential(mode, credential, next)
		if errors.Is(err, ErrConflict) {
			writeError(w, 409, "Access mode has changed.")
			return
		}
		if err != nil {
			respondError(w, err)
			return
		}
		a.setupCode = ""
		a.mu.Lock()
		clear(a.sessions)
		a.mu.Unlock()
	}
	a.failures = 0
	a.issueSession(w)
}

func (a *auth) saveCredential(mode, credential, next string) error {
	return a.store.DB.Write(func(c *sqlite.Conn) error {
		if mode == "setup" {
			_, err := c.Exec("INSERT INTO web_access(id,credential) VALUES(1,?) ON CONFLICT(id) DO NOTHING", next)
			if err != nil {
				return err
			}
		} else {
			_, err := c.Exec("UPDATE web_access SET credential=? WHERE id=1 AND credential=?", next, credential)
			if err != nil {
				return err
			}
		}
		rows, err := c.Query("SELECT changes() AS n")
		if err == nil && rows[0].Int("n") != 1 {
			return ErrConflict
		}
		return err
	})
}
