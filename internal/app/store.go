package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"orbia/internal/sqlite"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("revision conflict")

type ValidationError struct{ Field, Message string }

func (e ValidationError) Error() string { return e.Field + ": " + e.Message }

type Store struct{ DB *sqlite.DB }
type Bookmark struct {
	ID                 int64    `json:"id"`
	URL                string   `json:"url"`
	Title              string   `json:"title"`
	Description        string   `json:"description"`
	Notes              string   `json:"notes"`
	Archived           bool     `json:"is_archived"`
	Unread             bool     `json:"unread"`
	Shared             bool     `json:"shared"`
	Tags               []string `json:"tag_names"`
	Added              string   `json:"date_added"`
	Modified           string   `json:"date_modified"`
	WebArchive         *string  `json:"web_archive_snapshot_url"`
	Favicon            *string  `json:"favicon_url"`
	Preview            *string  `json:"preview_image_url"`
	WebsiteTitle       *string  `json:"website_title"`
	WebsiteDescription *string  `json:"website_description"`
}
type BookmarkInput struct {
	URL         *string   `json:"url"`
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	Notes       *string   `json:"notes"`
	Archived    *bool     `json:"is_archived"`
	Unread      *bool     `json:"unread"`
	Shared      *bool     `json:"shared"`
	Tags        *[]string `json:"tag_names"`
	Added       *string   `json:"date_added"`
	Modified    *string   `json:"date_modified"`
}

// Reject explicit nulls while keeping omitted fields available for partial updates.
func (in *BookmarkInput) UnmarshalJSON(raw []byte) error {
	type plain BookmarkInput
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if fields == nil {
		return errors.New("bookmark must be an object")
	}
	for _, name := range []string{"url", "title", "description", "notes", "is_archived", "unread", "shared", "tag_names", "date_added", "date_modified"} {
		if value, ok := fields[name]; ok && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New(name + " must not be null")
		}
	}
	return json.Unmarshal(raw, (*plain)(in))
}

type Tag struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Added string `json:"date_added"`
	Count int64  `json:"count,omitempty"`
}

const timestampLayout = "2006-01-02T15:04:05.000000000Z"

func now() string { return time.Now().UTC().Format(timestampLayout) }
func NewStore(path string) (*Store, error) {
	db, err := sqlite.Open(path)
	if err != nil {
		return nil, err
	}
	s := &Store{db}
	err = db.Write(func(c *sqlite.Conn) error {
		rows, e := c.Query("PRAGMA user_version")
		if e != nil {
			return e
		}
		if rows[0].Int("user_version") > 1 {
			return errors.New("database schema is newer than this application")
		}
		for _, q := range []string{
			`CREATE TABLE IF NOT EXISTS bookmarks(id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',is_archived INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,shared INTEGER NOT NULL DEFAULT 0,date_added TEXT NOT NULL,date_modified TEXT NOT NULL)`,
			`CREATE INDEX IF NOT EXISTS bookmarks_listing ON bookmarks(is_archived,date_added DESC,id DESC)`,
			`CREATE INDEX IF NOT EXISTS bookmarks_modified ON bookmarks(date_modified)`,
			`CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,date_added TEXT NOT NULL)`,
			`CREATE TABLE IF NOT EXISTS bookmark_tags(bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(bookmark_id,tag_id))`,
			`CREATE INDEX IF NOT EXISTS tags_bookmarks ON bookmark_tags(tag_id,bookmark_id)`,
			`CREATE VIRTUAL TABLE IF NOT EXISTS bookmark_search USING fts5(title,description,notes,url,content='bookmarks',content_rowid='id',tokenize='unicode61 remove_diacritics 2',prefix='2 3 4')`,
			`CREATE TRIGGER IF NOT EXISTS search_insert AFTER INSERT ON bookmarks BEGIN INSERT INTO bookmark_search(rowid,title,description,notes,url) VALUES(new.id,new.title,new.description,new.notes,new.url); END`,
			`CREATE TRIGGER IF NOT EXISTS search_delete AFTER DELETE ON bookmarks BEGIN INSERT INTO bookmark_search(bookmark_search,rowid,title,description,notes,url) VALUES('delete',old.id,old.title,old.description,old.notes,old.url); END`,
			`CREATE TRIGGER IF NOT EXISTS search_update AFTER UPDATE ON bookmarks BEGIN INSERT INTO bookmark_search(bookmark_search,rowid,title,description,notes,url) VALUES('delete',old.id,old.title,old.description,old.notes,old.url); INSERT INTO bookmark_search(rowid,title,description,notes,url) VALUES(new.id,new.title,new.description,new.notes,new.url); END`,
			`CREATE TABLE IF NOT EXISTS dashboard(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL)`,
			`PRAGMA user_version=1`,
		} {
			if _, e := c.Exec(q); e != nil {
				return e
			}
		}
		raw, _ := json.Marshal(defaultDashboard())
		_, e = c.Exec("INSERT OR IGNORE INTO dashboard(id,revision,payload) VALUES(1,1,?)", string(raw))
		return e
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func validURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || utf8.RuneCountInString(raw) > 2048 {
		return "", ValidationError{"url", "Use an http(s) URL without credentials, at most 2048 characters."}
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String(), nil
}
func normalizeTag(name string) (string, error) {
	name = strings.ToLower(strings.Join(strings.Fields(strings.TrimPrefix(strings.TrimSpace(name), "#")), "-"))
	if name == "" || strings.ContainsAny(name, ",#") || utf8.RuneCountInString(name) > 64 {
		return "", ValidationError{"tag_names", "Tags must contain 1–64 characters, without commas or #."}
	}
	return name, nil
}
func readBookmark(c *sqlite.Conn, id int64) (Bookmark, error) {
	rows, e := c.Query("SELECT * FROM bookmarks WHERE id=?", id)
	if e != nil {
		return Bookmark{}, e
	}
	if len(rows) == 0 {
		return Bookmark{}, ErrNotFound
	}
	b := bookmarkRow(rows[0])
	tags, e := c.Query("SELECT t.name FROM tags t JOIN bookmark_tags bt ON bt.tag_id=t.id WHERE bt.bookmark_id=? ORDER BY t.name", id)
	if e != nil {
		return b, e
	}
	for _, r := range tags {
		b.Tags = append(b.Tags, r.Text("name"))
	}
	return b, nil
}
func bookmarkRow(r sqlite.Row) Bookmark {
	return Bookmark{ID: r.Int("id"), URL: r.Text("url"), Title: r.Text("title"), Description: r.Text("description"), Notes: r.Text("notes"), Archived: r.Int("is_archived") == 1, Unread: r.Int("unread") == 1, Shared: r.Int("shared") == 1, Tags: []string{}, Added: r.Text("date_added"), Modified: r.Text("date_modified")}
}
func (s *Store) Get(id int64) (b Bookmark, err error) {
	err = s.DB.Read(func(c *sqlite.Conn) error { b, err = readBookmark(c, id); return err })
	return
}
func (s *Store) Save(id int64, in BookmarkInput, put bool) (b Bookmark, err error) {
	err = s.DB.Write(func(c *sqlite.Conn) error { b, err = saveBookmark(c, id, in, put); return err })
	return
}
func saveBookmark(c *sqlite.Conn, id int64, in BookmarkInput, put bool) (Bookmark, error) {
	b := Bookmark{Tags: []string{}, Added: now()}
	creating := id == 0
	if (creating || put) && in.URL == nil {
		return b, ValidationError{"url", "This field is required."}
	}
	if in.URL != nil {
		u, e := validURL(*in.URL)
		if e != nil {
			return b, e
		}
		in.URL = &u
	}
	if creating {
		rows, e := c.Query("SELECT id FROM bookmarks WHERE url=?", *in.URL)
		if e != nil {
			return b, e
		}
		if len(rows) > 0 {
			id = rows[0].Int("id")
		}
	}
	if id != 0 {
		var e error
		b, e = readBookmark(c, id)
		if e != nil {
			return b, e
		}
	}
	if in.URL != nil {
		b.URL = *in.URL
	}
	if in.Title != nil {
		b.Title = *in.Title
	}
	if in.Description != nil {
		b.Description = *in.Description
	}
	if in.Notes != nil {
		b.Notes = *in.Notes
	}
	if utf8.RuneCountInString(b.Title) > 512 {
		return b, ValidationError{"title", "Maximum length is 512 characters."}
	}
	if len(b.Description) > 100000 || len(b.Notes) > 500000 {
		return b, ValidationError{"notes", "Description or notes exceed the storage limit."}
	}
	if in.Archived != nil {
		b.Archived = *in.Archived
	}
	if in.Unread != nil {
		b.Unread = *in.Unread
	}
	if in.Shared != nil {
		b.Shared = *in.Shared
	}
	if in.Added != nil {
		t, e := time.Parse(time.RFC3339Nano, *in.Added)
		if e != nil {
			return b, ValidationError{"date_added", "Use an ISO 8601 timestamp."}
		}
		b.Added = t.UTC().Format(timestampLayout)
	}
	b.Modified = now()
	if id == 0 && in.Modified != nil {
		t, e := time.Parse(time.RFC3339Nano, *in.Modified)
		if e != nil {
			return b, ValidationError{"date_modified", "Use an ISO 8601 timestamp."}
		}
		b.Modified = t.UTC().Format(timestampLayout)
	}
	if in.Tags != nil {
		if len(*in.Tags) > 100 {
			return b, ValidationError{"tag_names", "At most 100 tags per bookmark."}
		}
		b.Tags = []string{}
		seen := map[string]bool{}
		for _, t := range *in.Tags {
			n, e := normalizeTag(t)
			if e != nil {
				return b, e
			}
			if !seen[n] {
				b.Tags = append(b.Tags, n)
				seen[n] = true
			}
		}
	}
	if id == 0 {
		n, e := c.Exec("INSERT INTO bookmarks(url,title,description,notes,is_archived,unread,shared,date_added,date_modified) VALUES(?,?,?,?,?,?,?,?,?)", b.URL, b.Title, b.Description, b.Notes, b.Archived, b.Unread, b.Shared, b.Added, b.Modified)
		if e != nil {
			return b, e
		}
		id = n
	} else {
		rows, e := c.Query("SELECT id FROM bookmarks WHERE url=? AND id!=?", b.URL, id)
		if e != nil {
			return b, e
		}
		if len(rows) > 0 {
			return b, ValidationError{"url", "A bookmark with this URL already exists."}
		}
		if _, e = c.Exec("UPDATE bookmarks SET url=?,title=?,description=?,notes=?,is_archived=?,unread=?,shared=?,date_added=?,date_modified=? WHERE id=?", b.URL, b.Title, b.Description, b.Notes, b.Archived, b.Unread, b.Shared, b.Added, b.Modified, id); e != nil {
			return b, e
		}
	}
	if _, e := c.Exec("DELETE FROM bookmark_tags WHERE bookmark_id=?", id); e != nil {
		return b, e
	}
	for _, t := range b.Tags {
		if _, e := c.Exec("INSERT OR IGNORE INTO tags(name,date_added) VALUES(?,?)", t, now()); e != nil {
			return b, e
		}
		if _, e := c.Exec("INSERT INTO bookmark_tags(bookmark_id,tag_id) SELECT ?,id FROM tags WHERE name=?", id, t); e != nil {
			return b, e
		}
	}
	return readBookmark(c, id)
}
func (s *Store) Delete(id int64) error {
	return s.DB.Write(func(c *sqlite.Conn) error {
		if _, e := readBookmark(c, id); e != nil {
			return e
		}
		_, e := c.Exec("DELETE FROM bookmarks WHERE id=?", id)
		return e
	})
}

type Search struct {
	Query                     string
	Archived                  bool
	Limit, Offset             int
	ModifiedSince, AddedSince string
}

// Search deliberately supports conjunctions and quoted phrases, not Linkding's full boolean grammar.
var termsPattern = regexp.MustCompile(`"[^"]*"|\S+`)

func searchWhere(p Search) (string, []any, error) {
	if len(p.Query) > 512 {
		return "", nil, ValidationError{"q", "Maximum query length is 512 bytes."}
	}
	where := "b.is_archived=?"
	args := []any{p.Archived}
	fts := []string{}
	for _, term := range termsPattern.FindAllString(p.Query, -1) {
		if strings.EqualFold(term, "and") {
			continue
		}
		if strings.EqualFold(term, "or") || strings.EqualFold(term, "not") || strings.ContainsAny(term, "()") {
			return "", nil, ValidationError{"q", "OR, NOT and grouping are not supported in Orbia MVP."}
		}
		if strings.HasPrefix(term, "#") {
			tag, e := normalizeTag(term)
			if e != nil {
				return "", nil, e
			}
			where += " AND b.id IN (SELECT bt.bookmark_id FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE t.name=?)"
			args = append(args, tag)
		} else {
			clean := strings.Trim(term, "\"")
			if clean != "" {
				part := "\"" + strings.ReplaceAll(clean, "\"", "\"\"") + "\""
				if !strings.HasPrefix(term, "\"") {
					part += "*"
				}
				fts = append(fts, part)
			}
		}
	}
	if len(fts) > 0 {
		where += " AND b.id IN (SELECT rowid FROM bookmark_search WHERE bookmark_search MATCH ?)"
		args = append(args, strings.Join(fts, " AND "))
	}
	for _, pair := range [][2]string{{"date_modified", p.ModifiedSince}, {"date_added", p.AddedSince}} {
		if t, e := time.Parse(time.RFC3339Nano, pair[1]); e == nil {
			where += " AND b." + pair[0] + ">?"
			args = append(args, t.UTC().Format(timestampLayout))
		}
	}
	return where, args, nil
}
func (s *Store) List(p Search) (books []Bookmark, count int64, err error) {
	where, args, err := searchWhere(p)
	if err != nil {
		return nil, 0, err
	}
	books = []Bookmark{}
	err = s.DB.Read(func(c *sqlite.Conn) error {
		totals, e := c.Query("SELECT count(*) AS n FROM bookmarks b WHERE "+where, args...)
		if e != nil {
			return e
		}
		count = totals[0].Int("n")
		a := append(append([]any{}, args...), p.Limit, p.Offset)
		rows, e := c.Query("SELECT b.* FROM bookmarks b WHERE "+where+" ORDER BY b.date_added DESC,b.id DESC LIMIT ? OFFSET ?", a...)
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return nil
		}
		ids := []any{}
		marks := []string{}
		index := map[int64]int{}
		for _, r := range rows {
			b := bookmarkRow(r)
			index[b.ID] = len(books)
			books = append(books, b)
			ids = append(ids, b.ID)
			marks = append(marks, "?")
		}
		tags, e := c.Query("SELECT bt.bookmark_id,t.name FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id IN ("+strings.Join(marks, ",")+") ORDER BY t.name", ids...)
		if e != nil {
			return e
		}
		for _, r := range tags {
			i := index[r.Int("bookmark_id")]
			books[i].Tags = append(books[i].Tags, r.Text("name"))
		}
		return nil
	})
	return
}
func (s *Store) Tags(query string, archived bool, facets bool) (tags []Tag, err error) {
	tags = []Tag{}
	where, args, e := searchWhere(Search{Query: query, Archived: archived})
	if e != nil {
		return nil, e
	}
	err = s.DB.Read(func(c *sqlite.Conn) error {
		q := "SELECT t.*,count(bt.bookmark_id) AS n FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id=t.id"
		if facets {
			q += " WHERE bt.bookmark_id IN (SELECT b.id FROM bookmarks b WHERE " + where + ")"
		} else {
			args = nil
		}
		q += " GROUP BY t.id ORDER BY t.name"
		rows, e := c.Query(q, args...)
		if e != nil {
			return e
		}
		for _, r := range rows {
			tags = append(tags, Tag{r.Int("id"), r.Text("name"), r.Text("date_added"), r.Int("n")})
		}
		return nil
	})
	return
}
func (s *Store) AddTag(name string) (tag Tag, err error) {
	name, err = normalizeTag(name)
	if err != nil {
		return
	}
	err = s.DB.Write(func(c *sqlite.Conn) error {
		if _, e := c.Exec("INSERT OR IGNORE INTO tags(name,date_added) VALUES(?,?)", name, now()); e != nil {
			return e
		}
		r, e := c.Query("SELECT * FROM tags WHERE name=?", name)
		if e != nil {
			return e
		}
		tag = Tag{ID: r[0].Int("id"), Name: name, Added: r[0].Text("date_added")}
		return nil
	})
	return
}
func (s *Store) DeleteTag(id int64) error {
	return s.DB.Write(func(c *sqlite.Conn) error {
		rows, e := c.Query("SELECT bookmark_id FROM bookmark_tags WHERE tag_id=?", id)
		if e != nil {
			return e
		}
		for _, r := range rows {
			if _, e = c.Exec("UPDATE bookmarks SET date_modified=? WHERE id=?", now(), r.Int("bookmark_id")); e != nil {
				return e
			}
		}
		_, e = c.Exec("DELETE FROM tags WHERE id=?", id)
		return e
	})
}
func ptr[T any](v T) *T { return &v }
func (s *Store) SeedBookmarks() error {
	return s.DB.Write(func(c *sqlite.Conn) error {
		r, e := c.Query("SELECT count(*) AS n FROM bookmarks")
		if e != nil {
			return e
		}
		if r[0].Int("n") > 0 {
			return nil
		}
		for i, v := range []struct{ url, title, desc, tags string }{
			{"https://go.dev/doc/", "Go documentation", "Die Werkzeuge für schnelle, einfache Software.", "dev,go,docs"},
			{"https://maxroll.gg/d4", "Diablo IV · Builds & Loot", "Builds, Loot und Guides für die nächste Season.", "games,arpg,diablo"},
			{"https://www.poewiki.net/", "Path of Exile Wiki", "Mechaniken, Loot und Wissen für Wraeclast.", "games,arpg,poe"},
			{"https://developer.mozilla.org/", "MDN Web Docs", "Das Nachschlagewerk für das offene Web.", "dev,web,docs"},
			{"https://www.figma.com/community", "Figma Community", "Ideen und Ressourcen für digitale Interfaces.", "design,inspiration"},
			{"https://linkding.link/", "Linkding", "Bookmarks behalten. Wissen wiederfinden.", "tools,selfhosted"},
		} {
			tags := strings.Split(v.tags, ",")
			if _, e = saveBookmark(c, 0, BookmarkInput{URL: &v.url, Title: &v.title, Description: &v.desc, Tags: &tags, Added: ptr(time.Now().UTC().Add(-time.Duration(i) * time.Hour).Format(time.RFC3339Nano))}, false); e != nil {
				return e
			}
		}
		return nil
	})
}
