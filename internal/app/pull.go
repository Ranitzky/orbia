package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"orbia/internal/sqlite"
)

// PullResult counts committed changes, including pages committed before a later error.
type PullResult struct {
	Changed   int
	Unchanged int
}

// Pull imports active and archived bookmarks from a Linkding server. The source owns
// the saved fields for matching URLs. Local-only bookmarks and dashboard pages survive.
func (s *Store) Pull(ctx context.Context, client *http.Client, base, token, since string) (PullResult, error) {
	var total PullResult
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" {
		return total, fmt.Errorf("use the HTTP(S) server root without credentials or a query")
	}
	if token == "" {
		return total, fmt.Errorf("set LINKDING_TOKEN to the source API token")
	}
	if since != "" {
		if _, err = time.Parse(time.RFC3339Nano, since); err != nil {
			return total, fmt.Errorf("since must be an RFC 3339 timestamp")
		}
	}
	for _, path := range []string{"api/bookmarks/", "api/bookmarks/archived/"} {
		endpoint := *u
		endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/" + path
		for offset := 0; ; {
			query := url.Values{"limit": {"100"}, "offset": {strconv.Itoa(offset)}}
			if since != "" {
				query.Set("modified_since", since)
			}
			endpoint.RawQuery = query.Encode()
			page, more, err := fetchPage(ctx, client, endpoint.String(), token)
			if err != nil {
				return total, fmt.Errorf("%s offset %d: %w", path, offset, err)
			}
			var batch PullResult
			err = s.DB.Write(func(c *sqlite.Conn) error {
				for _, b := range page {
					if err := ctx.Err(); err != nil {
						return err
					}
					changed, err := mergeSourceBookmark(c, b)
					if err != nil {
						return fmt.Errorf("source bookmark %d: %w", b.ID, err)
					}
					if changed {
						batch.Changed++
					} else {
						batch.Unchanged++
					}
				}
				return nil
			})
			if err != nil {
				return total, err
			}
			total.Changed += batch.Changed
			total.Unchanged += batch.Unchanged
			if !more {
				break
			}
			offset += len(page)
		}
	}
	return total, nil
}

func fetchPage(ctx context.Context, client *http.Client, endpoint, token string) ([]Bookmark, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Authorization", "Token "+token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("source returned HTTP %d", resp.StatusCode)
	}
	var page struct {
		Next    *string    `json:"next"`
		Results []Bookmark `json:"results"`
	}
	// A hundred records can contain large notes. Limit one response without buffering it twice.
	if err := json.NewDecoder(io.LimitReader(resp.Body, 80<<20)).Decode(&page); err != nil {
		return nil, false, err
	}
	if page.Results == nil || (page.Next != nil && len(page.Results) == 0) {
		return nil, false, fmt.Errorf("invalid paginated bookmark response")
	}
	return page.Results, page.Next != nil, nil
}

func mergeSourceBookmark(c *sqlite.Conn, b Bookmark) (bool, error) {
	address, err := validURL(b.URL)
	if err != nil {
		return false, err
	}
	if b.Title == "" && b.WebsiteTitle != nil {
		b.Title = *b.WebsiteTitle
	}
	if b.Description == "" && b.WebsiteDescription != nil {
		b.Description = *b.WebsiteDescription
	}
	for i, name := range b.Tags {
		b.Tags[i], err = normalizeTag(name)
		if err != nil {
			return false, err
		}
	}
	slices.Sort(b.Tags)
	b.Tags = slices.Compact(b.Tags)
	rows, err := c.Query("SELECT id FROM bookmarks WHERE url=?", address)
	if err != nil {
		return false, err
	}
	added, err := time.Parse(time.RFC3339Nano, b.Added)
	if err != nil {
		return false, fmt.Errorf("invalid date_added")
	}
	if len(rows) != 0 {
		local, err := readBookmark(c, rows[0].Int("id"))
		if err != nil {
			return false, err
		}
		if local.Title == b.Title && local.Description == b.Description && local.Notes == b.Notes &&
			local.Unread == b.Unread && local.Archived == b.Archived && local.Shared == b.Shared &&
			local.Added == added.UTC().Format(timestampLayout) && slices.Equal(local.Tags, b.Tags) {
			return false, nil
		}
	}
	_, err = saveBookmark(c, 0, BookmarkInput{
		URL: &address, Title: &b.Title, Description: &b.Description, Notes: &b.Notes,
		Tags: &b.Tags, Archived: &b.Archived, Unread: &b.Unread, Shared: &b.Shared, Added: &b.Added,
	}, false)
	return err == nil, err
}
