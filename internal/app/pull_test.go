package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type handlerTransport struct{ handler http.Handler }

func (client handlerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	client.handler.ServeHTTP(w, r)
	return w.Result(), nil
}

func TestPullPaginatesAndPreservesLocalBookmarks(t *testing.T) {
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
	pull := func(since string) PullResult {
		t.Helper()
		result, err := destination.Pull(context.Background(), client, "http://source.test", testToken, since)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	if got := pull(""); got != (PullResult{Changed: 103}) {
		t.Fatal(got)
	}
	if got := pull(""); got != (PullResult{Unchanged: 103}) {
		t.Fatal(got)
	}
	cutoff := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = source.Save(1, BookmarkInput{Title: ptr("Updated"), Archived: ptr(true)}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := pull(cutoff); got != (PullResult{Changed: 1}) {
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
