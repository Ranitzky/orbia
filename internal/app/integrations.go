package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"orbia/internal/sqlite"
)

func tokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Store) apiToken(r *http.Request) bool {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !(strings.EqualFold(parts[0], "Token") || strings.EqualFold(parts[0], "Bearer")) {
		return false
	}
	path := strings.TrimSuffix(r.URL.Path, "/") + "/"
	if !strings.HasPrefix(path, "/api/bookmarks/") && !strings.HasPrefix(path, "/api/tags/") &&
		path != "/api/user/profile/" && path != "/api/bundles/" {
		return false
	}
	var found bool
	err := s.DB.Read(func(c *sqlite.Conn) error {
		rows, err := c.Query("SELECT 1 FROM api_tokens WHERE digest=?", tokenDigest(parts[1]))
		found = len(rows) == 1
		return err
	})
	return err == nil && found
}

func (s *Server) manageTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		type entry struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		}
		entries := []entry{}
		err := s.store.DB.Read(func(c *sqlite.Conn) error {
			rows, err := c.Query("SELECT id,name FROM api_tokens ORDER BY id DESC")
			for _, row := range rows {
				entries = append(entries, entry{row.Int("id"), row.Text("name")})
			}
			return err
		})
		if err != nil {
			respondError(w, err)
			return
		}
		writeJSON(w, 200, entries)
	case "POST":
		var input struct{ Name string }
		if decode(w, r, &input, 2048) != nil || strings.TrimSpace(input.Name) == "" || len(input.Name) > 120 {
			respondError(w, ValidationError{"name", "Enter a token name (up to 120 bytes)."})
			return
		}
		var raw [32]byte
		rand.Read(raw[:])
		token := hex.EncodeToString(raw[:])
		err := s.store.DB.Write(func(c *sqlite.Conn) error {
			_, err := c.Exec("INSERT INTO api_tokens(name,digest) VALUES(?,?)", strings.TrimSpace(input.Name), tokenDigest(token))
			return err
		})
		if err != nil {
			respondError(w, err)
			return
		}
		writeJSON(w, 201, map[string]string{"token": token})
	case "DELETE":
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeError(w, 400, "Invalid token ID.")
			return
		}
		err = s.store.DB.Write(func(c *sqlite.Conn) error {
			_, err := c.Exec("DELETE FROM api_tokens WHERE id=?", id)
			return err
		})
		if err != nil {
			respondError(w, err)
			return
		}
		w.WriteHeader(204)
	default:
		w.WriteHeader(405)
	}
}

func (s *Server) importLinkding(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var input struct{ URL, Token string }
	if decode(w, r, &input, 8192) != nil {
		writeError(w, 400, "Invalid import request.")
		return
	}
	u, err := url.Parse(input.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.TrimSpace(input.Token) == "" {
		writeError(w, 400, "Enter an HTTP(S) Linkding URL and a source token.")
		return
	}
	if !s.importActive.CompareAndSwap(false, true) {
		writeError(w, 409, "An import is already running.")
		return
	}
	defer s.importActive.Store(false)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	// Allow large libraries to finish inside the bounded import window.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(11 * time.Minute))
	result, err := s.store.importLinkding(ctx, s.sourceClient, u, input.Token)
	// Return committed counts on partial failure. Upstream errors may contain private data.
	status := http.StatusOK
	if err != nil {
		status = http.StatusBadGateway
		if errors.Is(err, errPublicHTTP) {
			status = http.StatusUnprocessableEntity
		}
	}
	writeJSON(w, status, map[string]int{"changed": result.Changed, "unchanged": result.Unchanged})
}
