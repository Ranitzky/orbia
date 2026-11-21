# Orbia

Orbia is a self-hosted keyboard launcher and bookmark library for one person. The dashboard opens quicklinks by three-character code. The library searches saved titles, URLs, descriptions and notes, with exact tag filters. Both use the same Go process and SQLite database. The browser loads HTML, CSS, JavaScript and JetBrains Mono from your server.

![Orbia quick dashboard with color-coded quicklink groups](docs/dashboard.png)

## Run on Unraid

1. Copy the project to your server and copy `.env.example` to `.env`.
2. Set `ORBIA_PASSWORD` (at least 12 characters) for web login and `ORBIA_API_TOKEN` (at least 32 characters) for clients. Generate each separately, for example with `openssl rand -hex 32`.
3. Create `/mnt/user/appdata/orbia` and give the configured UID/GID write access. The example uses Unraid's `99:100`. Use local storage with SQLite locking support.
4. Start the service from the project directory.

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

Open `http://<unraid-host>:8080`. New databases start with a **Home** dashboard linking to Amazon, eBay, Gmail, GitHub, Booking.com, Figma, and Notion. Use **Cmd/Ctrl+E** to edit the quicklinks. The bookmark library starts empty. Set `ORBIA_SEED_DEMO=true` to populate an empty library with six English-language example bookmarks, then switch it off to keep an emptied library empty on restart. Upgrades preserve your saved dashboard and bookmarks.

For a local Docker installation, use `ORBIA_DATA_DIR=./data`, set `PUID` and `PGID` to the owner of that directory, and bind to `127.0.0.1`. The container runs as that user with a read-only root filesystem. Compose persists the database under `/data`. The HTTP healthcheck uses `/healthz`.

| Setting | Purpose |
| --- | --- |
| `ORBIA_PORT`, `ORBIA_BIND` | Published host port and interface. Defaults are 8080 and 0.0.0.0. |
| `ORBIA_DATA_DIR`, `PUID`, `PGID` | Host bind mount and numeric process identity. |
| `ORBIA_ORIGIN` | Exact external origin behind a reverse proxy, e.g. `https://orbia.example.com`. Used for origin checks and pagination links. |
| `ORBIA_SECURE_COOKIE` | Set to `true` when serving over HTTPS. |
| `ORBIA_DB`, `ORBIA_ADDR` | Native process database path and listen address. Compose supplies `/data/orbia.db` and `:8080`. |

Serve Orbia at the root of its own domain. Preserve the Host header and pass `/api/` token requests through the proxy. Browser sessions expire after 24 hours or on server restart. The web password and API token can be rotated by changing the environment and recreating the container.

## Interface language

Orbia opens in English by default. Choose **Settings → Language → Deutsch** to switch to German. Orbia remembers your choice in this browser and applies it to the sign-in screen, dashboard, library, editors and commands. Saved names, tags, notes and quicklink codes keep their original spelling.

The English catalog loads from the Orbia server on demand and the browser can cache it. Switching languages updates the current view in place. Search uses the same API, SQLite indexes and debounce settings in both languages.

## Keyboard and touch

| Action | How |
| --- | --- |
| Launch an app | Type a code prefix on the dashboard. Other links dim. As soon as one code matches, the preview shows the name and destination. Enter opens it, Backspace corrects the prefix and Escape clears it. |
| Change dashboard | Press 1–9 or choose a page in the command palette. Each page has its own groups and codes. The touch input also accepts codes that begin with a digit. |
| Edit the dashboard | Cmd/Ctrl+E opens edit mode. Select a link to change its name, code, group or URL. Edit group names, colors and order using their controls. |
| Add a quicklink or bookmark | Press **+** outside a text field to add a quicklink on the dashboard or a bookmark in the library. The header and mobile bar also offer an add button. |
| Create or switch lists | Cmd/Ctrl+K opens the command palette. Choose a dashboard page, create one or change the theme. Arrow keys select a command and Enter runs it. |
| Browse bookmarks | Choose **Tags** on desktop or **Bookmarks** on mobile. Switch between cards and rows, edit notes and tags, and open the archive. |
| Search from either mode | Cmd/Ctrl+P or **Suche** opens a panel in the lower third on desktop. Type `#games #arpg #diablo Loot`. Every tag and text term must match. While typing a final hashtag such as `#d`, the panel and library suggest matching tag names and show bookmarks with any of those tags. Click a suggestion or type a space after the full tag to apply it as an exact filter. Earlier tags and text constrain both results and suggestions. Use the arrows and Enter, or tap a result. |

The desktop header also accepts the displayed punctuation shortcuts outside text fields. The app reserves unmodified letters for quicklink codes. Theme, dashboard page and bookmark layout persist per browser. Dates are present in API records for interchange. The interface shows no clock or date.

## Linkding clients and data transfer

Set the instance URL in Raycast or the official Chrome/Firefox Linkding extension to the Orbia **server root** and supply `ORBIA_API_TOKEN`. Orbia implements the bookmark, tag and profile operations those clients use, including both trailing-slash forms and their browser search/edit links. Contract tests exercise the request sequences. The compatibility notes record the exact client source revisions and unsupported features. [Client contracts](docs/compatibility.md) · [API coverage](docs/linkding-compatibility.md) · [Upstream API](https://linkding.link/api/)

**Settings → Import & Export** accepts Netscape bookmark HTML from Linkding and browsers. HTML preserves tags, descriptions, Linkding notes, archive/unread/shared flags and second-resolution timestamps. JSON backups also include dashboard pages and unused tags. File imports merge by URL in one transaction. Restoring a dashboard from JSON replaces the current pages. Database IDs are local. The import limit is 20 MiB.

### Pull bookmarks from a running Linkding server

Set `LINKDING_TOKEN` in the shell environment to a token for the source server. The command reads the token from the environment and writes to Orbia's local database.

```sh
docker compose exec -T -e LINKDING_TOKEN orbia /app/orbia pull --from https://linkding.example.com
```

The pull reads both active and archived pages. It inserts new URLs, applies the source's title, notes, tags and flags to matching URLs, and skips unchanged records. To fetch recent changes, add `--since 2026-11-01T00:00:00Z` with your own cutoff. A failed page rolls back. Earlier pages remain committed and the command can be rerun. Refresh an open library to see changes.

This is a one-way merge. A source-side deletion or URL change leaves the old URL in Orbia. There is no automatic schedule, two-way conflict resolver or deletion feed. For a busy source, repeat the pull with overlapping cutoffs to pick up changes during offset pagination. The pull requires API access to the source from inside the container. No component retrieves the contents of bookmarked pages.

For a full backup with stable IDs, stop the container, copy its **entire** data directory, then restart it. Restore that directory with the container stopped and the correct owner. Keep a separate copy of your configuration.

## Develop and test

A native build requires Go 1.26+, a C compiler, SQLite headers and a library with FTS5. On Debian/Ubuntu install `build-essential libsqlite3-dev`. Export `ORBIA_PASSWORD` and `ORBIA_API_TOKEN` before running `go run ./cmd/orbia`. The native process reads its environment. Compose reads `.env`.

```sh
go test -race ./...
go vet ./...
npm ci
npm run check
npx playwright install chromium webkit
npm run test:e2e
ORBIA_BROWSER=webkit npm run test:e2e
```

Node and Playwright are development dependencies. The browser suite starts the real HTTP handler on a temporary loopback port with its own SQLite database. `ORBIA_SCREENSHOTS` selects an optional output directory. `PLAYWRIGHT_EXECUTABLE` can select an installed browser binary.

See the [architecture and design decisions](docs/architecture.md), [feature status](docs/status.md) and [validation report](docs/validation.md) for test evidence and deployment limits.
