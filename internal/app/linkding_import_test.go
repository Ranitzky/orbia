package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

type handlerTransport struct{ handler http.Handler }

func (client handlerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	client.handler.ServeHTTP(w, r)
	return w.Result(), nil
}

func TestLinkdingImportPaginatesAndPreservesLocalBookmarks(t *testing.T) {
	source, handler := fixture(t)
	destination, _ := fixture(t)
	client := &http.Client{Transport: handlerTransport{handler}}
	local, err := destination.Save(0, BookmarkInput{URL: ptr("https://local.test")}, false)
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 103; n++ {
		_, err = source.Save(0, BookmarkInput{URL: ptr(fmt.Sprintf("https://remote.test/%d", n)), Archived: ptr(n == 102), Tags: ptr([]string{"games"})}, false)
		if err != nil {
			t.Fatal(err)
		}
	}
	runImport := func() importResult {
		t.Helper()
		result, err := destination.importLinkding(context.Background(), client, &url.URL{Scheme: "http", Host: "source.test"}, testToken)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	if got := runImport(); got != (importResult{Changed: 103}) {
		t.Fatal(got)
	}
	if got := runImport(); got != (importResult{Unchanged: 103}) {
		t.Fatal(got)
	}
	_, err = source.Save(1, BookmarkInput{Title: ptr("Updated"), Archived: ptr(true)}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := runImport(); got != (importResult{Changed: 1, Unchanged: 102}) {
		t.Fatal(got)
	}
	books, count, err := destination.List(Search{Archived: true, Query: "Updated #games", Limit: 10})
	if err != nil || count != 1 || books[0].Title != "Updated" {
		t.Fatalf("missing archived update: %v %d", err, count)
	}
	if _, err := destination.Get(local.ID); err != nil {
		t.Fatal(err)
	}
}
