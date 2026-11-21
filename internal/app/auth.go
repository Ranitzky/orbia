package app

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type auth struct {
	passwordHash []byte
	salt         []byte
	key          []byte
	tokenHash    [32]byte
	secure       bool
	origin       string
	mu           sync.Mutex
	failures     int
	window       time.Time
	sessions     map[string]int64
}

func newAuth(password, token string, secure bool, origin string) *auth {
	salt := make([]byte, 32)
	key := make([]byte, 32)
	rand.Read(salt)
	rand.Read(key)
	hash, _ := pbkdf2.Key(sha256.New, password, salt, 210000, 32)
	return &auth{passwordHash: hash, salt: salt, key: key, tokenHash: sha256.Sum256([]byte(token)), secure: secure, origin: strings.TrimRight(origin, "/"), sessions: map[string]int64{}}
}
func (a *auth) apiToken(r *http.Request) bool {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || (!strings.EqualFold(parts[0], "Token") && !strings.EqualFold(parts[0], "Bearer")) {
		return false
	}
	sum := sha256.Sum256([]byte(parts[1]))
	return subtle.ConstantTimeCompare(sum[:], a.tokenHash[:]) == 1
}
func (a *auth) signature(v string) string {
	h := hmac.New(sha256.New, a.key)
	h.Write([]byte(v))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func (a *auth) session(r *http.Request) bool {
	cookie, e := r.Cookie("orbia_session")
	if e != nil {
		return false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 3 {
		return false
	}
	exp, e := strconv.ParseInt(parts[0], 10, 64)
	if e != nil || time.Now().Unix() > exp {
		return false
	}
	if !hmac.Equal([]byte(parts[2]), []byte(a.signature(parts[0]+"."+parts[1]))) {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[parts[1]] == exp
}
func (a *auth) revoke(r *http.Request) {
	if c, e := r.Cookie("orbia_session"); e == nil {
		parts := strings.Split(c.Value, ".")
		if len(parts) == 3 {
			a.mu.Lock()
			delete(a.sessions, parts[1])
			a.mu.Unlock()
		}
	}
}
func (a *auth) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	if a.origin != "" {
		return origin == a.origin
	}
	u, e := url.Parse(origin)
	return e == nil && u.Host == r.Host && (u.Scheme == "http" || u.Scheme == "https")
}
func (a *auth) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	if !a.sameOrigin(r) {
		writeError(w, 403, "Cross-origin request rejected.")
		return
	}
	// A global bucket avoids trusting spoofable proxy headers or growing an IP map.
	a.mu.Lock()
	if time.Since(a.window) > time.Minute {
		a.window = time.Now()
		a.failures = 0
	}
	if a.failures >= 10 {
		a.mu.Unlock()
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "Too many attempts. Try again in one minute.")
		return
	}
	a.failures++
	a.mu.Unlock()
	var in struct {
		Password string `json:"password"`
	}
	if e := decode(w, r, &in, 4096); e != nil {
		writeError(w, 400, "Invalid request.")
		return
	}
	hash, _ := pbkdf2.Key(sha256.New, in.Password, a.salt, 210000, 32)
	if subtle.ConstantTimeCompare(hash, a.passwordHash) != 1 {
		writeError(w, 401, "Incorrect password.")
		return
	}
	a.mu.Lock()
	a.failures = 0
	a.mu.Unlock()
	nonce := make([]byte, 24)
	rand.Read(nonce)
	nonceText := base64.RawURLEncoding.EncodeToString(nonce)
	expiry := time.Now().Add(24 * time.Hour).Unix()
	value := fmt.Sprintf("%d.%s", expiry, nonceText)
	value += "." + a.signature(value)
	a.mu.Lock()
	for n, exp := range a.sessions {
		if exp < time.Now().Unix() {
			delete(a.sessions, n)
		}
	}
	if len(a.sessions) >= 32 {
		var oldest string
		var oldestExpiry int64 = 1<<63 - 1
		for n, exp := range a.sessions {
			if exp < oldestExpiry {
				oldest, oldestExpiry = n, exp
			}
		}
		delete(a.sessions, oldest)
	}
	a.sessions[nonceText] = expiry
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "orbia_session", Value: value, Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: 86400})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
