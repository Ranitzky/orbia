package app

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"orbia/internal/sqlite"
)

type Quicklink struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
	URL  string `json:"url"`
}
type Group struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Color string      `json:"color"`
	Links []Quicklink `json:"links"`
}
type Page struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Groups []Group `json:"groups"`
}
type Dashboard struct {
	Revision int64  `json:"revision"`
	Pages    []Page `json:"pages"`
}

var codePattern = regexp.MustCompile(`^[A-Z0-9]{3}$`)
var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateDashboard(d Dashboard) error {
	if len(d.Pages) < 1 || len(d.Pages) > 9 {
		return ValidationError{"pages", "Between 1 and 9 dashboard pages are required."}
	}
	ids := map[string]bool{}
	checkID := func(id string) error {
		if id == "" || len(id) > 80 || ids[id] {
			return ValidationError{"id", "IDs must be present and globally unique."}
		}
		ids[id] = true
		return nil
	}
	for _, p := range d.Pages {
		if e := checkID(p.ID); e != nil {
			return e
		}
		if strings.TrimSpace(p.Name) == "" || len(p.Name) > 80 {
			return ValidationError{"name", "A page needs a name of at most 80 bytes."}
		}
		if p.Groups == nil {
			return ValidationError{"groups", "Groups must be an array."}
		}
		if len(p.Groups) > 6 {
			return ValidationError{"groups", "At most six groups per page."}
		}
		codes := map[string]bool{}
		for _, g := range p.Groups {
			if e := checkID(g.ID); e != nil {
				return e
			}
			if strings.TrimSpace(g.Name) == "" || len(g.Name) > 80 || !colorPattern.MatchString(g.Color) {
				return ValidationError{"groups", "A group needs a name and a hex color."}
			}
			if g.Links == nil {
				return ValidationError{"links", "Links must be an array."}
			}
			if len(g.Links) > 100 {
				return ValidationError{"links", "At most 100 links per group."}
			}
			for _, l := range g.Links {
				if e := checkID(l.ID); e != nil {
					return e
				}
				if !codePattern.MatchString(l.Code) || codes[l.Code] {
					return ValidationError{"code", "Use a unique three-character A–Z / 0–9 code per page."}
				}
				codes[l.Code] = true
				if strings.TrimSpace(l.Name) == "" || len(l.Name) > 200 {
					return ValidationError{"name", "A link needs a name of at most 200 bytes."}
				}
				if _, e := validURL(l.URL); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
func (s *Store) Dashboard() (d Dashboard, err error) {
	err = s.DB.Read(func(c *sqlite.Conn) error {
		r, e := c.Query("SELECT revision,payload FROM dashboard WHERE id=1")
		if e != nil {
			return e
		}
		if len(r) == 0 {
			return errors.New("missing dashboard")
		}
		if e = json.Unmarshal([]byte(r[0].Text("payload")), &d); e != nil {
			return e
		}
		d.Revision = r[0].Int("revision")
		return nil
	})
	return
}
func (s *Store) SaveDashboard(d Dashboard) (Dashboard, error) {
	if e := validateDashboard(d); e != nil {
		return d, e
	}
	e := s.DB.Write(func(c *sqlite.Conn) error {
		r, e := c.Query("SELECT revision FROM dashboard WHERE id=1")
		if e != nil {
			return e
		}
		if d.Revision != r[0].Int("revision") {
			return ErrConflict
		}
		d.Revision++
		raw, e := json.Marshal(d)
		if e != nil {
			return e
		}
		_, e = c.Exec("UPDATE dashboard SET revision=?,payload=? WHERE id=1", d.Revision, string(raw))
		return e
	})
	return d, e
}
func defaultDashboard() Dashboard {
	groups := []Group{}
	for i, v := range []struct {
		name, color string
		links       []Quicklink
	}{
		{"Infra", "#36d8d3", []Quicklink{{"unr", "Unraid", "UNR", "http://tower/"}, {"nxc", "Nextcloud", "NXC", "http://nextcloud.local/"}, {"jlf", "Jellyfin", "JLF", "http://jellyfin.local/"}, {"imm", "Immich", "IMM", "http://immich.local/"}}},
		{"Automation", "#88d9ae", []Quicklink{{"hom", "Home Assistant", "HOM", "http://homeassistant.local:8123/"}, {"n8n", "n8n", "N8N", "http://n8n.local/"}, {"ppr", "Paperless", "PPR", "http://paperless.local/"}, {"bpd", "BentoPDF", "BPD", "https://bentopdf.com/"}}},
		{"Media", "#8abcf4", []Quicklink{{"snr", "Sonarr", "SNR", "http://sonarr.local/"}, {"rdr", "Radarr", "RDR", "http://radarr.local/"}, {"wsp", "Whisparr", "WSP", "http://whisparr.local/"}, {"nzb", "NZBGet", "NZB", "http://nzbget.local/"}}},
		{"Dev", "#bb9ae9", []Quicklink{{"git", "GitHub", "GIT", "https://github.com/"}, {"glb", "GitLab", "GLB", "https://gitlab.com/"}, {"tmo", "Testmo", "TMO", "https://www.testmo.com/"}, {"cnf", "Confluence", "CNF", "https://www.atlassian.com/software/confluence"}}},
		{"Persönlich", "#e9cf81", []Quicklink{{"mal", "Mail", "MAL", "https://mail.google.com/"}, {"kal", "Kalender", "KAL", "https://calendar.google.com/"}, {"not", "Notizen", "NOT", "https://www.notion.so/"}, {"fin", "Finanzen", "FIN", "https://banking.example.com/"}}},
		{"Bookmarks", "#ec91b7", []Quicklink{{"new", "News", "NEW", "https://news.ycombinator.com/"}, {"tec", "Tech Blogs", "TEC", "https://lobste.rs/"}, {"tls", "Tools", "TLS", "https://www.privacytools.io/"}, {"prj", "Projekte", "PRJ", "https://github.com/dashboard"}}},
	} {
		groups = append(groups, Group{ID: []string{"infra", "automation", "media", "dev", "personal", "bookmarks"}[i], Name: v.name, Color: v.color, Links: v.links})
	}
	return Dashboard{Revision: 1, Pages: []Page{{ID: "home", Name: "Zuhause", Groups: groups}}}
}
