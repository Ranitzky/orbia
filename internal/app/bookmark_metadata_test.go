package app

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"
)

type metadataDNSErrorTransport struct{ err *net.DNSError }

func (transport metadataDNSErrorTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, transport.err
}

func TestBookmarkMetadataLookup(t *testing.T) {
	_, server := fixture(t)
	server.metadataClient = &http.Client{Transport: handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Host != "example.com" || r.Header.Get("Authorization") != "" {
			t.Fatalf("unexpected metadata fetch: %s %s", r.Method, r.URL)
		}
		switch r.URL.Path {
		case "/article":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, `<title>Browser title</title><meta content=" Grüner &amp; blauer Himmel " property="og:title" />
				<meta NAME="description" content='Eine Seite über Dresden.'><body><meta property="og:description" content="Ignore body">`)
		case "/legacy":
			w.Header().Set("Content-Type", "text/html; charset=iso-8859-1")
			fmt.Fprint(w, "<title>Gr\xfc\xdfe &amp; mehr</title><meta property=og:description content='Aus K\xf6ln'>")
		default:
			w.WriteHeader(404)
		}
	})}}
	const endpoint = "/api/orbia/bookmark-metadata"
	const origin = "http://example.com"
	session := signedIn(t, server)
	expectStatus(t, request(server, "POST", endpoint, `{}`, false), 401)
	expectStatus(t, request(server, "POST", endpoint, `{}`, true), 401)
	expectStatus(t, session("POST", endpoint, `{}`, "https://other.test"), 403)
	expectStatus(t, session("GET", endpoint, ``, origin), 405)
	expectStatus(t, session("POST", endpoint, `{"url":"file:///example"}`, origin), 400)
	for _, tc := range []struct {
		path, title, description string
	}{
		{"/article", "Grüner & blauer Himmel", "Eine Seite über Dresden."},
		{"/legacy", "Grüße & mehr", "Aus Köln"},
		{"/missing", "", ""},
	} {
		w := session("POST", endpoint, fmt.Sprintf(`{"url":%q}`, "https://example.com"+tc.path), origin)
		expectStatus(t, w, 200)
		metadata := object(t, w)
		if metadata["title"] != tc.title || metadata["description"] != tc.description {
			t.Errorf("lookup for %s returned %v", tc.path, metadata)
		}
	}
	for _, host := range []string{"www.goo", "orbia.ran"} {
		server.metadataClient.Transport = metadataDNSErrorTransport{&net.DNSError{Name: host, Err: "no such host", IsNotFound: true}}
		w := session("POST", endpoint, fmt.Sprintf(`{"url":%q}`, "https://"+host), origin)
		expectStatus(t, w, http.StatusNoContent)
		if w.Header().Get("X-Orbia-Metadata-Fetching") != "" {
			t.Errorf("unresolved host %s reported outbound HTTP progress", host)
		}
	}
	server.metadataClient.Transport = metadataDNSErrorTransport{&net.DNSError{Name: "example.com", Err: "timeout", IsTimeout: true}}
	expectStatus(t, session("POST", endpoint, `{"url":"https://example.com"}`, origin), http.StatusOK)

	page := `<title>` + strings.Repeat("ä", 513) + `</title>`
	if got := readBookmarkMetadata(strings.NewReader(page)); got.Title != strings.Repeat("ä", 512) {
		t.Error("title should be limited to the bookmark's maximum length")
	}
}

func TestBookmarkMetadataFlushesProgressBeforeReadingPage(t *testing.T) {
	releasePage := make(chan struct{})
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-releasePage:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, "<title>Test page</title>")
		case <-r.Context().Done():
		}
	}))
	defer site.Close()
	server := &Server{metadataClient: site.Client()}
	endpoint := httptest.NewServer(http.HandlerFunc(server.lookupBookmarkMetadata))
	defer endpoint.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	body := strings.NewReader(fmt.Sprintf(`{"url":%q}`, site.URL))
	resp, err := client.Post(endpoint.URL, "application/json", body)
	close(releasePage)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("X-Orbia-Metadata-Fetching") != "1" {
		t.Fatalf("unexpected progress response: %d %v", resp.StatusCode, resp.Header)
	}
	var metadata bookmarkMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil || metadata.Title != "Test page" {
		t.Fatalf("metadata = %+v, error = %v", metadata, err)
	}
}

func TestBookmarkMetadataPublicAddresses(t *testing.T) {
	for _, ip := range []string{"8.8.8.8", "2606:4700::1111"} {
		if !publicBookmarkIP(netip.MustParseAddr(ip)) {
			t.Errorf("expected public address %s to be allowed", ip)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.200", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::a00:1"} {
		if publicBookmarkIP(netip.MustParseAddr(ip)) {
			t.Errorf("expected address %s to be blocked", ip)
		}
	}
}
