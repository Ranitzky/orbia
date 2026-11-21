package app

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"orbia/internal/sqlite"
	"orbia/internal/web"
)

type Config struct {
	Password, Token, Origin string
	SecureCookie            bool
}
type Server struct {
	store  *Store
	auth   *auth
	static http.Handler
}

func NewServer(s *Store, c Config) *Server {
	assets, _ := fs.Sub(web.Files, "static")
	return &Server{store: s, auth: newAuth(c.Password, c.Token, c.SecureCookie, c.Origin), static: http.FileServer(http.FS(assets))}
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		json.NewEncoder(w).Encode(v)
	}
}
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"detail": msg})
}
func respondError(w http.ResponseWriter, e error) {
	var v ValidationError
	switch {
	case errors.As(e, &v):
		writeJSON(w, 400, map[string][]string{v.Field: {v.Message}})
	case errors.Is(e, ErrNotFound):
		writeError(w, 404, "Not found.")
	case errors.Is(e, ErrConflict):
		writeError(w, 409, "Dashboard changed in another tab. Reload before editing.")
	default:
		slog.Error("request failed", "error", e)
		writeError(w, 500, "Internal server error.")
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	if e := d.Decode(v); e != nil {
		return e
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}

var bookmarkEditPath = regexp.MustCompile(`^/bookmarks/[1-9][0-9]*/edit/?$`)

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
	path := r.URL.Path
	if path == "/healthz" {
		writeJSON(w, 200, map[string]string{"status": "ok"})
		return
	}
	if path == "/auth/login" {
		w.Header().Set("Cache-Control", "no-store")
		s.auth.login(w, r)
		return
	}
	if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/auth/") {
		w.Header().Set("Cache-Control", "no-store")
		token := s.auth.apiToken(r)
		if r.Method == "OPTIONS" {
			origin := r.Header.Get("Origin")
			if strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://") {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.WriteHeader(204)
				return
			}
			writeError(w, 403, "Origin is not allowed.")
			return
		}
		// An explicit invalid token must not fall back to an ambient browser session.
		if !token && (r.Header.Get("Authorization") != "" || !s.auth.session(r)) {
			w.Header().Set("WWW-Authenticate", "Token")
			writeError(w, 401, "Authentication credentials were not provided or are invalid.")
			return
		}
		if token {
			origin := r.Header.Get("Origin")
			if strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://") {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
		}
		if !token && r.Method != "GET" && r.Method != "HEAD" && !s.auth.sameOrigin(r) {
			writeError(w, 403, "Cross-origin request rejected.")
			return
		}
		if path == "/auth/logout" && r.Method == "POST" {
			s.auth.revoke(r)
			http.SetCookie(w, &http.Cookie{Name: "orbia_session", Value: "", Path: "/", HttpOnly: true, Secure: s.auth.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
			w.WriteHeader(204)
			return
		}
		s.api(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(405)
		return
	}
	// External clients open these HTML routes in the browser.
	if path == "/bookmarks" || path == "/bookmarks/" || bookmarkEditPath.MatchString(path) {
		r = r.Clone(r.Context())
		r.URL.Path = "/"
		path = "/"
	}
	if path == "/" || path == "/index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	s.static.ServeHTTP(w, r)
}
func pageParams(r *http.Request) (int, int) {
	limit, e := strconv.Atoi(r.URL.Query().Get("limit"))
	if e != nil || limit <= 0 {
		limit = 100
	}
	if limit > 5000 {
		limit = 5000
	}
	offset, e := strconv.Atoi(r.URL.Query().Get("offset"))
	if e != nil || offset < 0 {
		offset = 0
	}
	// Leave room for adding the maximum page size without integer overflow.
	if ceiling := int(^uint(0)>>1) - 5000; offset > ceiling {
		offset = ceiling
	}
	return limit, offset
}
func (s *Server) paginated(r *http.Request, results any, count int64, limit, offset int) map[string]any {
	link := func(o int) string {
		u := *r.URL
		q := u.Query()
		q.Set("limit", strconv.Itoa(limit))
		q.Set("offset", strconv.Itoa(o))
		u.RawQuery = q.Encode()
		origin := s.auth.origin
		if origin == "" {
			scheme := "http"
			if r.TLS != nil {
				scheme = "https"
			}
			origin = scheme + "://" + r.Host
		}
		return origin + u.RequestURI()
	}
	var next, prev any
	if int64(offset+limit) < count {
		next = link(offset + limit)
	}
	if offset > 0 {
		n := offset - limit
		if n < 0 {
			n = 0
		}
		prev = link(n)
	}
	return map[string]any{"count": count, "next": next, "previous": prev, "results": results}
}
func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	method := r.Method
	switch path {
	case "api/orbia/session":
		if method != "GET" {
			w.WriteHeader(405)
			return
		}
		writeJSON(w, 200, map[string]any{"user": "Du", "version": "0.1.0", "api_base": "/api/"})
		return
	case "api/orbia/dashboard":
		switch method {
		case "GET":
			d, e := s.store.Dashboard()
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 200, d)
		case "PUT":
			var d Dashboard
			if e := decode(w, r, &d, 2<<20); e != nil {
				writeError(w, 400, "Invalid dashboard JSON.")
				return
			}
			d, e := s.store.SaveDashboard(d)
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 200, d)
		default:
			w.WriteHeader(405)
		}
		return
	case "api/orbia/facets":
		if method != "GET" {
			w.WriteHeader(405)
			return
		}
		tags, e := s.store.Tags(r.URL.Query().Get("q"), r.URL.Query().Get("archived") == "true", true)
		if e != nil {
			respondError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"results": tags})
		return
	case "api/orbia/export":
		if method != "GET" {
			w.WriteHeader(405)
			return
		}
		s.export(w, r)
		return
	case "api/orbia/import":
		if method != "POST" {
			w.WriteHeader(405)
			return
		}
		s.importBookmarks(w, r)
		return
	case "api/user/profile":
		if method != "GET" {
			w.WriteHeader(405)
			return
		}
		writeJSON(w, 200, map[string]any{"theme": "dark", "bookmark_date_display": "hidden", "bookmark_link_target": "_self", "web_archive_integration": "disabled", "tag_search": "strict", "enable_sharing": false, "enable_public_sharing": false, "enable_favicons": false, "display_url": true, "permanent_notes": false, "version": "orbia-0.1.0", "search_preferences": map[string]string{"sort": "added_desc", "shared": "off", "unread": "off"}})
		return
	case "api/bookmarks/check":
		if method != "GET" {
			w.WriteHeader(405)
			return
		}
		u, e := validURL(r.URL.Query().Get("url"))
		if e != nil {
			respondError(w, e)
			return
		}
		var b any
		e = s.store.DB.Read(func(c *sqlite.Conn) error {
			rows, e := c.Query("SELECT id FROM bookmarks WHERE url=?", u)
			if e != nil {
				return e
			}
			if len(rows) > 0 {
				found, e := readBookmark(c, rows[0].Int("id"))
				b = found
				return e
			}
			return nil
		})
		if e != nil {
			respondError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"bookmark": b, "metadata": map[string]any{"url": u, "title": "", "description": "", "preview_image": nil}, "auto_tags": []string{}})
		return
	case "api/bookmarks", "api/bookmarks/archived":
		if method == "GET" {
			limit, offset := pageParams(r)
			p := Search{Query: r.URL.Query().Get("q"), Archived: strings.HasSuffix(path, "archived"), Limit: limit, Offset: offset, ModifiedSince: r.URL.Query().Get("modified_since"), AddedSince: r.URL.Query().Get("added_since")}
			if r.URL.Query().Get("bundle") != "" {
				writeError(w, 501, "Bundles are not implemented.")
				return
			}
			books, count, e := s.store.List(p)
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 200, s.paginated(r, books, count, limit, offset))
			return
		}
		if method == "POST" && path == "api/bookmarks" {
			var in BookmarkInput
			if e := decode(w, r, &in, 2<<20); e != nil {
				writeError(w, 400, "Invalid bookmark JSON.")
				return
			}
			b, e := s.store.Save(0, in, false)
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 201, b)
			return
		}
		w.WriteHeader(405)
		return
	case "api/tags":
		if method == "GET" {
			tags, e := s.store.Tags("", false, false)
			if e != nil {
				respondError(w, e)
				return
			}
			limit, offset := pageParams(r)
			end := min(offset+limit, len(tags))
			start := min(offset, len(tags))
			writeJSON(w, 200, s.paginated(r, tags[start:end], int64(len(tags)), limit, offset))
			return
		}
		if method == "POST" {
			var in struct {
				Name string `json:"name"`
			}
			if e := decode(w, r, &in, 4096); e != nil {
				writeError(w, 400, "Invalid tag JSON.")
				return
			}
			t, e := s.store.AddTag(in.Name)
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 201, t)
			return
		}
		w.WriteHeader(405)
		return
	case "api/bundles":
		writeError(w, 501, "Linkding bundles are not implemented. Orbia dashboard pages are independent.")
		return
	}
	if len(parts) >= 3 && parts[1] == "bookmarks" {
		id, e := strconv.ParseInt(parts[2], 10, 64)
		if e != nil || id < 1 {
			writeError(w, 404, "Not found.")
			return
		}
		if len(parts) == 4 && (parts[3] == "archive" || parts[3] == "unarchive") {
			if method != "POST" {
				w.WriteHeader(405)
				return
			}
			_, e = s.store.Save(id, BookmarkInput{Archived: ptr(parts[3] == "archive")}, false)
			if e != nil {
				respondError(w, e)
				return
			}
			w.WriteHeader(204)
			return
		}
		if len(parts) > 3 {
			writeError(w, 501, "Assets and snapshots are not implemented.")
			return
		}
		switch method {
		case "GET":
			b, e := s.store.Get(id)
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 200, b)
		case "PATCH", "PUT":
			var in BookmarkInput
			if e := decode(w, r, &in, 2<<20); e != nil {
				writeError(w, 400, "Invalid bookmark JSON.")
				return
			}
			b, e := s.store.Save(id, in, method == "PUT")
			if e != nil {
				respondError(w, e)
				return
			}
			writeJSON(w, 200, b)
		case "DELETE":
			if e := s.store.Delete(id); e != nil {
				respondError(w, e)
				return
			}
			w.WriteHeader(204)
		default:
			w.WriteHeader(405)
		}
		return
	}
	if len(parts) == 3 && parts[1] == "tags" {
		id, e := strconv.ParseInt(parts[2], 10, 64)
		if e != nil {
			writeError(w, 404, "Not found.")
			return
		}
		if method == "DELETE" {
			tags, e := s.store.Tags("", false, false)
			if e != nil {
				respondError(w, e)
				return
			}
			exists := false
			for _, t := range tags {
				if t.ID == id {
					exists = true
				}
			}
			if !exists {
				writeError(w, 404, "Not found.")
				return
			}
			if e = s.store.DeleteTag(id); e != nil {
				respondError(w, e)
				return
			}
			w.WriteHeader(204)
			return
		}
		if method == "GET" {
			tags, e := s.store.Tags("", false, false)
			if e != nil {
				respondError(w, e)
				return
			}
			for _, t := range tags {
				if t.ID == id {
					writeJSON(w, 200, t)
					return
				}
			}
			writeError(w, 404, "Not found.")
			return
		}
		w.WriteHeader(405)
		return
	}
	writeError(w, 404, "Not found.")
}
