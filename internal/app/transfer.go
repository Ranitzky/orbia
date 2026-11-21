package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"orbia/internal/sqlite"
)

type Backup struct {
	Version   int        `json:"version"`
	Dashboard *Dashboard `json:"dashboard,omitempty"`
	Bookmarks []Bookmark `json:"bookmarks"`
	Tags      []Tag      `json:"tags,omitempty"`
}

func (s *Store) Backup() (backup Backup, err error) {
	backup.Version = 1
	backup.Bookmarks = []Bookmark{}
	backup.Tags = []Tag{}
	// One lock provides a consistent snapshot of bookmarks and dashboard.
	err = s.DB.Read(func(c *sqlite.Conn) error {
		r, e := c.Query("SELECT id FROM bookmarks ORDER BY id")
		if e != nil {
			return e
		}
		for _, v := range r {
			b, e := readBookmark(c, v.Int("id"))
			if e != nil {
				return e
			}
			backup.Bookmarks = append(backup.Bookmarks, b)
		}
		r, e = c.Query("SELECT revision,payload FROM dashboard WHERE id=1")
		if e != nil {
			return e
		}
		var d Dashboard
		if e = json.Unmarshal([]byte(r[0].Text("payload")), &d); e != nil {
			return e
		}
		d.Revision = r[0].Int("revision")
		backup.Dashboard = &d
		r, e = c.Query("SELECT * FROM tags ORDER BY name")
		if e != nil {
			return e
		}
		for _, t := range r {
			backup.Tags = append(backup.Tags, Tag{ID: t.Int("id"), Name: t.Text("name"), Added: t.Text("date_added")})
		}
		return nil
	})
	return
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	backup, e := s.store.Backup()
	if e != nil {
		respondError(w, e)
		return
	}
	if r.URL.Query().Get("format") == "html" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="orbia-bookmarks.html"`)
		io.WriteString(w, exportHTML(backup.Bookmarks))
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="orbia-backup.json"`)
	writeJSON(w, 200, backup)
}
func exportHTML(books []Bookmark) string {
	var out strings.Builder
	out.WriteString("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Orbia bookmarks</TITLE>\n<H1>Orbia bookmarks</H1>\n<DL><p>\n")
	for _, b := range books {
		tags := append([]string{}, b.Tags...)
		if b.Archived {
			tags = append(tags, "linkding:bookmarks.archived")
		}
		added, _ := time.Parse(time.RFC3339Nano, b.Added)
		modified, _ := time.Parse(time.RFC3339Nano, b.Modified)
		private, unread := 1, 0
		if b.Shared {
			private = 0
		}
		if b.Unread {
			unread = 1
		}
		fmt.Fprintf(&out, "<DT><A HREF=\"%s\" ADD_DATE=\"%d\" LAST_MODIFIED=\"%d\" PRIVATE=\"%d\" TOREAD=\"%d\" TAGS=\"%s\">%s</A>\n", html.EscapeString(b.URL), added.Unix(), modified.Unix(), private, unread, html.EscapeString(strings.Join(tags, ",")), html.EscapeString(b.Title))
		desc := html.EscapeString(b.Description)
		if b.Notes != "" {
			desc += "[linkding-notes]" + html.EscapeString(b.Notes) + "[/linkding-notes]"
		}
		if desc != "" {
			fmt.Fprintf(&out, "<DD>%s\n", desc)
		}
	}
	out.WriteString("</DL><p>\n")
	return out.String()
}

// This parser targets Netscape bookmark exports, not arbitrary web documents.
// RE2 expressions are bounded by the 20 MiB request limit and have no backtracking.
var anchorPattern = regexp.MustCompile(`(?is)<a\b([^>]*)>(.*?)</a>`)
var attrPattern = regexp.MustCompile(`(?i)([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
var ddPattern = regexp.MustCompile(`(?is)<dd\b[^>]*>(.*?)(?:<dt\b|<dl\b|</dl>|$)`)
var stripPattern = regexp.MustCompile(`<[^>]*>`)
var notesPattern = regexp.MustCompile(`(?s)\[linkding-notes\](.*?)\[/linkding-notes\]`)

func parseHTML(raw []byte) ([]Bookmark, error) {
	matches := anchorPattern.FindAllSubmatchIndex(raw, -1)
	books := []Bookmark{}
	for i, m := range matches {
		attrs := map[string]string{}
		for _, a := range attrPattern.FindAllStringSubmatch(string(raw[m[2]:m[3]]), -1) {
			v := a[2]
			if a[3] != "" {
				v = a[3]
			}
			if a[4] != "" {
				v = a[4]
			}
			attrs[strings.ToLower(a[1])] = html.UnescapeString(v)
		}
		b := Bookmark{URL: attrs["href"], Title: html.UnescapeString(stripPattern.ReplaceAllString(string(raw[m[4]:m[5]]), "")), Tags: []string{}, Added: now(), Modified: now(), Unread: attrs["toread"] == "1", Shared: attrs["private"] == "0"}
		for _, tag := range strings.Split(attrs["tags"], ",") {
			if tag == "linkding:bookmarks.archived" {
				b.Archived = true
			} else if strings.TrimSpace(tag) != "" {
				b.Tags = append(b.Tags, tag)
			}
		}
		for _, v := range []struct {
			attr string
			dest *string
		}{{"add_date", &b.Added}, {"last_modified", &b.Modified}} {
			if n, e := strconv.ParseInt(attrs[v.attr], 10, 64); e == nil {
				*v.dest = time.Unix(n, 0).UTC().Format(time.RFC3339Nano)
			}
		}
		end := len(raw)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		if dd := ddPattern.FindSubmatch(raw[m[1]:end]); dd != nil {
			desc := string(dd[1])
			if notes := notesPattern.FindStringSubmatch(desc); notes != nil {
				b.Notes = html.UnescapeString(notes[1])
				desc = notesPattern.ReplaceAllString(desc, "")
			}
			b.Description = html.UnescapeString(strings.TrimSpace(stripPattern.ReplaceAllString(desc, "")))
		}
		books = append(books, b)
	}
	if len(books) == 0 {
		return nil, ValidationError{"file", "No Netscape bookmark links found."}
	}
	return books, nil
}
func (s *Server) importBookmarks(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	raw, e := io.ReadAll(r.Body)
	if e != nil {
		writeError(w, 413, "Import exceeds 20 MiB.")
		return
	}
	raw = bytes.TrimSpace(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf}))
	var backup Backup
	if len(raw) == 0 {
		writeError(w, 400, "Import file is empty.")
		return
	}
	if raw[0] == '<' {
		backup.Bookmarks, e = parseHTML(raw)
	} else {
		e = json.Unmarshal(raw, &backup)
		if e == nil && backup.Version != 1 {
			e = errors.New("expected an Orbia version 1 JSON backup")
		}
	}
	if e != nil {
		writeError(w, 400, "Invalid import: "+e.Error())
		return
	}
	if len(backup.Bookmarks) > 100000 {
		writeError(w, 400, "At most 100,000 bookmarks per import.")
		return
	}
	if backup.Dashboard != nil {
		if e = validateDashboard(*backup.Dashboard); e != nil {
			respondError(w, e)
			return
		}
	}
	// Merge by normalized URL. A failed record rolls back the entire import.
	imported := 0
	e = s.store.DB.Write(func(c *sqlite.Conn) error {
		for i, b := range backup.Bookmarks {
			in := BookmarkInput{URL: &b.URL, Title: &b.Title, Description: &b.Description, Notes: &b.Notes, Tags: &b.Tags, Archived: &b.Archived, Unread: &b.Unread, Shared: &b.Shared}
			if b.Added != "" {
				in.Added = &b.Added
			}
			if b.Modified != "" {
				in.Modified = &b.Modified
			}
			if _, e := saveBookmark(c, 0, in, false); e != nil {
				return ValidationError{"file", fmt.Sprintf("Record %d: %v", i+1, e)}
			}
			imported++
		}
		for _, t := range backup.Tags {
			name, e := normalizeTag(t.Name)
			if e != nil {
				return e
			}
			if _, e = c.Exec("INSERT OR IGNORE INTO tags(name,date_added) VALUES(?,?)", name, now()); e != nil {
				return e
			}
		}
		if backup.Dashboard != nil {
			d := *backup.Dashboard
			rows, e := c.Query("SELECT revision FROM dashboard WHERE id=1")
			if e != nil {
				return e
			}
			d.Revision = rows[0].Int("revision") + 1
			data, e := json.Marshal(d)
			if e != nil {
				return e
			}
			if _, e = c.Exec("UPDATE dashboard SET revision=?,payload=? WHERE id=1", d.Revision, string(data)); e != nil {
				return e
			}
		}
		return nil
	})
	if e != nil {
		respondError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"imported": imported, "dashboard_restored": backup.Dashboard != nil})
}
