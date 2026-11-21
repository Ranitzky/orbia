package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"orbia/internal/sqlite"
)

func signedIn(t *testing.T, s *Server) func(string, string, string, string) *httptest.ResponseRecorder {
	t.Helper()
	w := request(s, "POST", "/auth/login", `{"password":"a-long-test-password"}`, false)
	expectStatus(t, w, 200)
	cookie := w.Result().Cookies()[0]
	return func(method, path, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		out := httptest.NewRecorder()
		s.ServeHTTP(out, r)
		return out
	}
}
func TestSettingsTokens(t *testing.T) {
	store, s := fixture(t)
	const path = "/api/orbia/tokens"
	const origin = "http://example.com"
	session := signedIn(t, s)
	expectStatus(t, request(s, "POST", path, "{}", false), 401)
	expectStatus(t, request(s, "POST", path, "{}", true), 401)
	expectStatus(t, session("POST", path, "{}", "https://other.test"), 403)
	w := session("POST", path, `{"name":"Raycast"}`, origin)
	expectStatus(t, w, 201)
	token := object(t, w)["token"].(string)
	list := session("GET", path, "", origin)
	expectStatus(t, list, 200)
	if len(token) != 64 || strings.Contains(list.Body.String(), token) || strings.Contains(list.Body.String(), tokenDigest(token)) || !strings.Contains(list.Body.String(), "Raycast") {
		t.Fatal("invalid token creation or metadata")
	}
	check := func(s *Server, value string, status int) {
		r := httptest.NewRequest("GET", "/api/bookmarks/", nil)
		r.Header.Set("Authorization", "Token "+value)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("unexpected client status %d", w.Code)
		}
	}
	restarted := NewServer(store, Config{Password: testPassword})
	check(restarted, token, 200)
	var entries []struct {
		ID   int64
		Name string
	}
	if err := json.Unmarshal(list.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name == "Raycast" {
			expectStatus(t, session("DELETE", fmt.Sprintf("%s?id=%d", path, entry.ID), "", origin), 204)
		}
	}
	check(restarted, token, 401)
	check(restarted, testToken, 200)
}
func TestSettingsLinkdingImport(t *testing.T) {
	_, dest := fixture(t)
	src, sourceHandler := fixture(t)
	_, err := src.Save(0, BookmarkInput{URL: ptr("https://book.test/")}, false)
	if err != nil {
		t.Fatal(err)
	}
	source := httptest.NewTLSServer(sourceHandler)
	defer source.Close()

	session := signedIn(t, dest)
	const path = "/api/orbia/linkding-import"
	body := fmt.Sprintf(`{"url":%q,"token":%q}`, source.URL, testToken)
	expectStatus(t, request(dest, "POST", path, body, true), 401)
	expectStatus(t, session("POST", path, body, "https://other.test"), 403)
	post := func(body string) *httptest.ResponseRecorder { return session("POST", path, body, "http://example.com") }
	for _, address := range []string{"http://93.184.216.34", "http://169.254.169.254", "http://[2606:4700:4700::1111]"} {
		expectStatus(t, post(fmt.Sprintf(`{"url":%q,"token":%q}`, address, testToken)), 422)
	}
	lan := httptest.NewServer(sourceHandler)
	defer lan.Close()
	w := post(fmt.Sprintf(`{"url":%q,"token":%q}`, lan.URL, testToken))
	expectStatus(t, w, 200)
	if object(t, w)["changed"] != float64(1) {
		t.Fatal("local HTTP import failed")
	}
	dest.sourceClient.Transport = source.Client().Transport
	w = post(body)
	expectStatus(t, w, 200)
	if object(t, w)["unchanged"] != float64(1) {
		t.Fatal("missing imported bookmark")
	}
	expectStatus(t, post(strings.Replace(body, testToken, "wrong", 1)), 502)
	calls := 0
	dest.sourceClient.Transport = handlerTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Redirect(w, r, "https://another.test/", 302)
	})}
	expectStatus(t, post(body), 502)
	if calls != 1 {
		t.Fatal("source redirect followed")
	}
}

func TestUpgradeRetainsOnlyAppTokens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	db, err := sqlite.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	err = db.Write(func(c *sqlite.Conn) error {
		for _, query := range []string{
			"PRAGMA user_version=2",
			"CREATE TABLE api_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,digest TEXT UNIQUE)",
			"INSERT INTO api_tokens VALUES(0,'old','old-digest'),(17,'Raycast','app-digest')",
		} {
			if _, err := c.Exec(query); err != nil {
				return err
			}
		}
		return nil
	})
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	err = store.DB.Read(func(c *sqlite.Conn) error {
		rows, err := c.Query("SELECT id,digest FROM api_tokens")
		if err == nil && (len(rows) != 1 || rows[0].Int("id") != 17 || rows[0].Text("digest") != "app-digest") {
			t.Error("upgrade must preserve precisely the app-issued credential")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}
