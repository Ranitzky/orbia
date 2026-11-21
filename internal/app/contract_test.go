package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"orbia/internal/sqlite"
)

const testToken = "test-token-with-at-least-32-characters"
const testPassword = "a-long-test-password"

func fixture(t *testing.T) (*Store, *Server) {
	t.Helper()
	s, e := NewStore(filepath.Join(t.TempDir(), "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.DB.Close() })
	return s, NewServer(s, Config{Password: testPassword, Token: testToken})
}
func request(s *Server, method, path, body string, authorized bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if authorized {
		r.Header.Set("Authorization", "Token "+testToken)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func expectStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d, want %d: %s", w.Code, status, w.Body.String())
	}
}
func object(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func decodeBookmark(t *testing.T, w *httptest.ResponseRecorder) Bookmark {
	t.Helper()
	var b Bookmark
	if e := json.Unmarshal(w.Body.Bytes(), &b); e != nil {
		t.Fatal(e)
	}
	return b
}

func TestExtensionContract(t *testing.T) {
	_, s := fixture(t)
	for _, path := range []string{"/api/bookmarks/", "/api/tags/", "/api/user/profile/", "/api/orbia/dashboard"} {
		expectStatus(t, request(s, "GET", path, "", false), 401)
	}
	w := request(s, "GET", "/api/bookmarks/check/?url=https%3A%2F%2Fexample.org", "", true)
	expectStatus(t, w, 200)
	if object(t, w)["bookmark"] != nil {
		t.Fatal("check must return null before create")
	}
	payload := `{"url":"https://example.org","title":"Grüße aus Köln","notes":"Loot & Wissen","tag_names":["Games","arpg","DIABLO","games"]}`
	w = request(s, "POST", "/api/bookmarks/?disable_scraping&disable_html_snapshot", payload, true)
	expectStatus(t, w, 201)
	b := decodeBookmark(t, w)
	if b.ID == 0 || b.Title != "Grüße aus Köln" || len(b.Tags) != 3 {
		t.Fatalf("unexpected bookmark %#v", b)
	}
	for _, key := range []string{"favicon_url", "preview_image_url", "website_title", "website_description", "web_archive_snapshot_url"} {
		if value, ok := object(t, w)[key]; !ok || value != nil {
			t.Errorf("%s must exist and be null", key)
		}
	}
	w = request(s, "POST", "/api/bookmarks/", `{"url":"https://example.org/","title":"Updated"}`, true)
	expectStatus(t, w, 201)
	updated := decodeBookmark(t, w)
	if updated.ID != b.ID || updated.Notes != b.Notes || len(updated.Tags) != 3 {
		t.Fatal("extension POST upsert must preserve omitted fields")
	}
	w = request(s, "GET", "/api/bookmarks/check/?url=https%3A%2F%2Fexample.org%2F", "", true)
	expectStatus(t, w, 200)
	if object(t, w)["bookmark"] == nil || object(t, w)["metadata"] == nil || object(t, w)["auto_tags"] == nil {
		t.Fatal("incomplete check response")
	}
	w = request(s, "GET", "/api/tags/?limit=5000", "", true)
	expectStatus(t, w, 200)
	if object(t, w)["count"].(float64) != 3 {
		t.Fatal(w.Body.String())
	}
	expectStatus(t, request(s, "GET", "/api/user/profile/", "", true), 200)
	path := fmt.Sprintf("/api/bookmarks/%d/", b.ID)
	expectStatus(t, request(s, "POST", path+"archive/", "", true), 204)
	w = request(s, "GET", "/api/bookmarks/", "", true)
	if object(t, w)["count"].(float64) != 0 {
		t.Fatal("archive leaked into active list")
	}
	w = request(s, "GET", "/api/bookmarks/archived/", "", true)
	if object(t, w)["count"].(float64) != 1 {
		t.Fatal("archive missing")
	}
	expectStatus(t, request(s, "POST", path+"unarchive/", "", true), 204)
	expectStatus(t, request(s, "DELETE", path, "", true), 204)
	expectStatus(t, request(s, "GET", path, "", true), 404)
}

func TestPaginationSearchAndPartialUpdates(t *testing.T) {
	_, s := fixture(t)
	for i, p := range []string{
		`{"url":"https://one.test","title":"Diablo Loot","tag_names":["games","arpg","diablo"]}`,
		`{"url":"https://two.test","title":"Path of Exile","notes":"Loot finden","tag_names":["games","arpg","poe"]}`,
		`{"url":"https://three.test","title":"Andere Spiele","tag_names":["games"]}`,
	} {
		w := request(s, "POST", "/api/bookmarks/", p, true)
		expectStatus(t, w, 201)
		if decodeBookmark(t, w).ID != int64(i+1) {
			t.Fatal("unexpected ID")
		}
	}
	for _, tc := range []struct {
		q     string
		count int
	}{
		{"%23games", 3}, {"%23games+%23arpg", 2}, {"%23games+%23arpg+%23diablo", 1}, {"Loot", 2}, {"loot+%23diablo", 1}, {"%22Diablo+Loot%22", 1}, {"%23missing", 0}, {"%22%3B+DROP+TABLE+bookmarks%3B%22", 0},
	} {
		t.Run(tc.q, func(t *testing.T) {
			w := request(s, "GET", "/api/bookmarks/?q="+tc.q, "", true)
			expectStatus(t, w, 200)
			if object(t, w)["count"] != float64(tc.count) {
				t.Fatal(w.Body.String())
			}
		})
	}
	w := request(s, "GET", "/api/bookmarks/?limit=1&offset=1&q=%23games", "", true)
	expectStatus(t, w, 200)
	v := object(t, w)
	if v["next"] == nil || v["previous"] == nil || !strings.HasPrefix(v["next"].(string), "http://example.com/") {
		t.Fatal(w.Body.String())
	}
	w = request(s, "GET", "/api/orbia/facets?q=%23diablo", "", true)
	expectStatus(t, w, 200)
	if len(object(t, w)["results"].([]any)) != 3 {
		t.Fatal(w.Body.String())
	}
	expectStatus(t, request(s, "PATCH", "/api/bookmarks/1/", `{"title":"New"}`, true), 200)
	w = request(s, "GET", "/api/bookmarks/1/", "", true)
	if len(decodeBookmark(t, w).Tags) != 3 {
		t.Fatal("PATCH lost tags")
	}
	expectStatus(t, request(s, "PATCH", "/api/bookmarks/1/", `{"tag_names":[]}`, true), 200)
	w = request(s, "GET", "/api/bookmarks/1/", "", true)
	if len(decodeBookmark(t, w).Tags) != 0 {
		t.Fatal("explicit empty tags not applied")
	}
	expectStatus(t, request(s, "PUT", "/api/bookmarks/1/", `{"title":"Missing URL"}`, true), 400)
	expectStatus(t, request(s, "PATCH", "/api/bookmarks/1/", `{"url":"https://two.test"}`, true), 400)
	for _, payload := range []string{`{"url":"javascript:alert(1)"}`, `{"url":"https://user:secret@example.org"}`, `{"url":null}`, `{"url":"https://valid.test","tag_names":["bad,tag"]}`, `{"url":"https://valid.test","is_archived":"yes"}`, `{"url":"https://valid.test"} {}`} {
		expectStatus(t, request(s, "POST", "/api/bookmarks/", payload, true), 400)
	}
	expectStatus(t, request(s, "GET", "/api/bookmarks/?q=%23games+or+%23dev", "", true), 400)
	expectStatus(t, request(s, "GET", "/api/bundles/", "", true), 501)
}

func TestSessionSecurity(t *testing.T) {
	_, s := fixture(t)
	w := request(s, "POST", "/auth/login", `{"password":"wrong"}`, false)
	expectStatus(t, w, 401)
	r := httptest.NewRequest("POST", "/auth/login", strings.NewReader(`{"password":"`+testPassword+`"}`))
	r.Header.Set("Origin", "https://evil.example")
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	expectStatus(t, w, 403)
	w = request(s, "POST", "/auth/login", `{"password":"`+testPassword+`"}`, false)
	expectStatus(t, w, 200)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}
	send := func(method, path, origin, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.AddCookie(cookies[0])
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if token != "" {
			r.Header.Set("Authorization", token)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	expectStatus(t, send("GET", "/api/bookmarks/", "", ""), 200)
	expectStatus(t, send("GET", "/api/bookmarks/", "", "Token wrong"), 401)
	expectStatus(t, send("POST", "/auth/logout", "https://evil.example", ""), 403)
	expectStatus(t, send("POST", "/auth/logout", "", ""), 204)
	expectStatus(t, send("GET", "/api/bookmarks/", "", ""), 401)
	r = httptest.NewRequest("GET", "/api/bookmarks/", nil)
	r.Header.Set("Authorization", "Bearer "+testToken)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	expectStatus(t, w, 200)
	for i := 0; i < 10; i++ {
		request(s, "POST", "/auth/login", `{"password":"wrong"}`, false)
	}
	expectStatus(t, request(s, "POST", "/auth/login", `{"password":"wrong"}`, false), 429)
}

func TestDashboardValidationAndRevision(t *testing.T) {
	store, s := fixture(t)
	original, e := store.Dashboard()
	if e != nil {
		t.Fatal(e)
	}
	if len(original.Pages[0].Groups) != 6 {
		t.Fatal("default dashboard must match six-group reference")
	}
	changed := original
	changed.Pages = append(changed.Pages, Page{ID: "work", Name: "Arbeit", Groups: []Group{}})
	data, _ := json.Marshal(changed)
	w := request(s, "PUT", "/api/orbia/dashboard", string(data), true)
	expectStatus(t, w, 200)
	w = request(s, "PUT", "/api/orbia/dashboard", string(data), true)
	expectStatus(t, w, 409)
	d, _ := store.Dashboard()
	d.Pages[0].Groups[0].Links[0].Code = "IMM"
	data, _ = json.Marshal(d)
	expectStatus(t, request(s, "PUT", "/api/orbia/dashboard", string(data), true), 400)
	d, _ = store.Dashboard()
	d.Pages[0].Groups[0].Links[0].URL = "javascript:alert(1)"
	data, _ = json.Marshal(d)
	expectStatus(t, request(s, "PUT", "/api/orbia/dashboard", string(data), true), 400)
	d, _ = store.Dashboard()
	if d.Revision != 2 {
		t.Fatal("invalid change incremented revision")
	}
}

func TestImportExportAndAtomicRollback(t *testing.T) {
	store, s := fixture(t)
	html := `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF='https://example.org/?q=a&amp;b=c' ADD_DATE="1700000000" LAST_MODIFIED="1700000100" TAGS="games,arpg,linkding:bookmarks.archived" TOREAD="1" PRIVATE="0">Grüße &amp; Loot</A><DD>Beschreibung[linkding-notes]Meine &lt;Notiz&gt;[/linkding-notes]</DL><p>`
	w := request(s, "POST", "/api/orbia/import", html, true)
	expectStatus(t, w, 200)
	books, count, e := store.List(Search{Archived: true, Limit: 100})
	if e != nil || count != 1 {
		t.Fatalf("%d %v", count, e)
	}
	b := books[0]
	if b.Notes != "Meine <Notiz>" || b.Description != "Beschreibung" || !b.Shared || !b.Unread || len(b.Tags) != 2 || b.Title != "Grüße & Loot" {
		t.Fatalf("import mismatch %#v", b)
	}
	out := request(s, "GET", "/api/orbia/export?format=html", "", true)
	expectStatus(t, out, 200)
	parsed, e := parseHTML(out.Body.Bytes())
	if e != nil || len(parsed) != 1 || parsed[0].Notes != b.Notes || !parsed[0].Archived {
		t.Fatalf("HTML roundtrip: %#v %v", parsed, e)
	}
	jsonBackup := request(s, "GET", "/api/orbia/export", "", true)
	expectStatus(t, jsonBackup, 200)
	second, secondServer := fixture(t)
	expectStatus(t, request(secondServer, "POST", "/api/orbia/import", jsonBackup.Body.String(), true), 200)
	restored, _, e := second.List(Search{Archived: true, Limit: 100})
	if e != nil || len(restored) != 1 || restored[0].Notes != b.Notes {
		t.Fatal("JSON restore failed")
	}
	w = request(s, "POST", "/api/orbia/import", `{"version":1,"bookmarks":[{"url":"https://would-be-valid.test","title":"valid"},{"url":"javascript:alert(1)"}]}`, true)
	expectStatus(t, w, 400)
	_, count, e = store.List(Search{Limit: 100})
	if e != nil || count != 0 {
		t.Fatal("partial import was not rolled back")
	}
	expectStatus(t, request(s, "POST", "/api/orbia/import", `{"version":99}`, true), 400)
}

func TestFTSUpdatesDeletesAndTimestampPrecision(t *testing.T) {
	store, _ := fixture(t)
	b, e := store.Save(0, BookmarkInput{URL: ptr("https://precision.test"), Title: ptr("Änderungen Loot"), Modified: ptr("2026-01-01T00:00:00.000000001Z")}, false)
	if e != nil {
		t.Fatal(e)
	}
	_, n, e := store.List(Search{Query: "ander", Limit: 10, ModifiedSince: "2026-01-01T00:00:00Z"})
	if e != nil || n != 1 {
		t.Fatalf("unicode prefix and nanosecond cutoff: %d %v", n, e)
	}
	_, n, e = store.List(Search{Limit: 10, ModifiedSince: b.Modified})
	if e != nil || n != 0 {
		t.Fatal("modified_since must be strictly greater")
	}
	_, e = store.Save(b.ID, BookmarkInput{Title: ptr("Changed")}, false)
	if e != nil {
		t.Fatal(e)
	}
	_, n, e = store.List(Search{Query: "Loot", Limit: 10})
	if e != nil || n != 0 {
		t.Fatal("FTS retained old text")
	}
	if e = store.Delete(b.ID); e != nil {
		t.Fatal(e)
	}
	_, n, e = store.List(Search{Query: "Changed", Limit: 10})
	if e != nil || n != 0 {
		t.Fatal("FTS retained deleted bookmark")
	}
}

func TestTenThousandBookmarks(t *testing.T) {
	store, _ := fixture(t)
	start := time.Now()
	e := store.DB.Write(func(c *sqlite.Conn) error {
		for i := 0; i < 10000; i++ {
			url := fmt.Sprintf("https://scale.test/%d", i)
			title := fmt.Sprintf("Bookmark %d", i)
			tags := []string{"games"}
			if i%10 == 0 {
				tags = append(tags, "arpg")
			}
			if i%100 == 0 {
				tags = append(tags, "diablo")
				title += " Loot"
			}
			if _, e := saveBookmark(c, 0, BookmarkInput{URL: &url, Title: &title, Tags: &tags}, false); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("10,000 bookmarks inserted in %s", time.Since(start))
	start = time.Now()
	for i := 0; i < 20; i++ {
		books, n, e := store.List(Search{Query: "Loot #games #arpg #diablo", Limit: 36})
		if e != nil || n != 100 || len(books) != 36 {
			t.Fatalf("scale query: %d / %d %v", len(books), n, e)
		}
		tags, e := store.Tags(Search{Query: "#games #arpg #diablo"}, true)
		if e != nil || len(tags) != 3 {
			t.Fatalf("facets: %d %v", len(tags), e)
		}
	}
	t.Logf("20 combined search + facet rounds: %s (mean %s)", time.Since(start), time.Since(start)/20)
}

func TestPersistenceAndConcurrentUpsert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "persistent.db")
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.DB.Close() }()
	var wg sync.WaitGroup
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.Save(0, BookmarkInput{URL: ptr("https://concurrent.test"), Title: ptr(fmt.Sprintf("Title %d", i))}, false)
			if err != nil {
				failures <- err
			}
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if err = s.DB.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	books, count, err := s.List(Search{Limit: 10, Query: "Title"})
	if err != nil || count != 1 || len(books) != 1 {
		t.Fatalf("persistence/upsert: %d %d %v", len(books), count, err)
	}
}

func TestStaticAssetsAndPaginationBounds(t *testing.T) {
	_, server := fixture(t)
	for _, file := range []string{"/", "/app.js", "/style.css", "/bookmarks?q=%23games", "/bookmarks/123/edit", "/fonts/JetBrainsMono-Regular.woff2", "/fonts/OFL.txt"} {
		w := request(server, "GET", file, "", false)
		expectStatus(t, w, 200)
		if w.Body.Len() == 0 {
			t.Fatalf("empty asset %s", file)
		}
		if w.Header().Get("Content-Security-Policy") == "" {
			t.Fatal("missing CSP")
		}
	}
	for _, endpoint := range []string{"/api/bookmarks/?offset=9223372036854775807", "/api/tags/?offset=9223372036854775807"} {
		expectStatus(t, request(server, "GET", endpoint, "", true), 200)
	}
	for _, body := range []string{`null`, `{"url":"https://example.test","tag_names":null}`, `{"url":"https://example.test","title":null}`} {
		expectStatus(t, request(server, "POST", "/api/bookmarks/", body, true), 400)
	}
}

func TestRaycastContract(t *testing.T) {
	_, s := fixture(t)
	created := request(s, "POST", "/api/bookmarks/", `{"url":"https://loot.test","title":"Loot","description":"Guide","notes":"","unread":true,"tag_names":["games"]}`, true)
	expectStatus(t, created, 201)
	list := request(s, "GET", "/api/bookmarks/?q=Loot&limit=101", "", true)
	expectStatus(t, list, 200)
	items := object(t, list)["results"].([]any)
	if len(items) != 1 {
		t.Fatalf("unexpected results %v", items)
	}
	item := items[0].(map[string]any)
	if item["title"] != "Loot" || item["id"] != float64(1) || len(item["tag_names"].([]any)) != 1 {
		t.Fatal(item)
	}
	expectStatus(t, request(s, "POST", "/api/bookmarks/1/archive/", "", true), 204)
	expectStatus(t, request(s, "DELETE", "/api/bookmarks/1", "", true), 204)
	expectStatus(t, request(s, "GET", "/api/bookmarks/1/", "", true), 404)
}
