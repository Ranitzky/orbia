# [ · ] Orbia

Orbia is a self-hosted keyboard launcher and bookmark library for one person. The dashboard opens quicklinks by three-character code. The library searches saved titles, URLs, descriptions and notes, with exact tag filters. Both use the same Go process and SQLite database. The browser loads HTML, CSS, JavaScript and JetBrains Mono from your server.

![Orbia quick dashboard with color-coded quicklink groups](docs/dashboard.png)

## Run on macOS with Docker Desktop

Install and start [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/). Run these commands from any directory to start Orbia from the public image. Docker downloads the image on first run.

```sh
mkdir -p "$HOME/Orbia"

docker run -d --name orbia \
  --platform linux/amd64 \
  --restart unless-stopped \
  -p 127.0.0.1:8726:8726 \
  -e PUID="$(id -u)" \
  -e PGID="$(id -g)" \
  -v "$HOME/Orbia:/data" \
  ghcr.io/ranitzky/orbia:latest
```

Open [Orbia](http://127.0.0.1:8726) and complete setup. The port is reachable only from your Mac. The database lives at `~/Orbia/orbia.db` and stays there when you replace the container. `PUID` and `PGID` give the container process your user and group IDs so it can write to that folder. On Apple silicon, Docker Desktop runs the `linux/amd64` image through emulation.

## Run on Unraid

Save [docker-compose.yml](deploy/unraid/docker-compose.yml) on your Unraid server. The file pulls the Linux AMD64 image from GitHub Container Registry and uses port 8726 and `/mnt/user/appdata/orbia` for SQLite data.

```sh
docker compose up -d --pull always --wait
```

Run the same command to update. The `latest` tag tracks validated builds from `main`. To pin a build, replace `latest` with the full published Git commit SHA. For local development, the repository's root `compose.yaml` still builds from source.

Docker creates a missing bind-mount directory. At startup, the entrypoint prepares the dedicated directory and existing Orbia SQLite files for UID 99 and GID 100, then runs the server as that user. This also fixes a root-owned directory from an earlier attempt. SQLite needs write access to the directory for its WAL and shared-memory files. Use a writable local filesystem with SQLite locking support. If you explicitly set Compose `user:` to a non-root user, prepare the host permissions yourself.

Open `http://<unraid-host>:8726`. In **Set up Orbia**, choose a password of at least 12 characters or select **Without a password**, then save. The first visitor to save this choice configures the instance. Complete setup on a trusted network before exposing Orbia publicly. Existing installations upgrading from environment-based passwords also complete this step once.

In **Settings → Access**, enter your current password to change or remove it. You can enable password protection again there. Saving the access settings signs out other browser sessions. In passwordless mode, anyone who can reach Orbia can open a session and manage bookmarks, tokens and access settings. Use it only on a trusted network or behind an authenticated proxy.

New databases start with a **Home** dashboard linking to Amazon, eBay, Gmail, GitHub, Booking.com, Figma, and Notion. Use **Cmd/Ctrl+E** to edit the quicklinks. The bookmark library starts empty. Set `ORBIA_SEED_DEMO=true` to populate an empty library with six English-language example bookmarks, then switch it off to keep an emptied library empty on restart. Upgrades preserve your saved dashboard and bookmarks.

For a local Docker installation, use `ORBIA_DATA_DIR=./data`, set `PUID` and `PGID` to the owner of that directory, and bind to `127.0.0.1`. The server runs as that user. The included Compose file also sets a read-only root filesystem. Compose persists the database under `/data`. The HTTP healthcheck uses `/healthz`.

| Setting | Purpose |
| --- | --- |
| `ORBIA_PORT`, `ORBIA_BIND` | Published host port and interface. Defaults are `8726` and `0.0.0.0`. |
| `ORBIA_DATA_DIR`, `PUID`, `PGID` | Host bind mount and numeric process identity. |
| `ORBIA_ORIGIN` | Exact external origin behind a reverse proxy, e.g. `https://orbia.example.com`. Used for origin checks and pagination links. |
| `ORBIA_SECURE_COOKIE` | Set to `true` when serving over HTTPS. |
| `ORBIA_DB`, `ORBIA_ADDR` | Native defaults are `./data/orbia.db` and `:8726`. Inside the container, Orbia uses `/data/orbia.db` and `:8726`. |

Serve Orbia at the root of its own domain. Preserve the Host header and pass `/api/` token requests through the proxy. Browser sessions expire after 24 hours or on server restart. Use HTTPS when accessing Orbia across a network so that passwords and API tokens are encrypted in transit.

## Update Orbia

Published Orbia images check GitHub Container Registry at startup and every six hours. If `latest` points to a different build, a dot appears on the Settings icon. Open Settings to see **Update available** and a link to this guide above the general settings. The check fetches image metadata. You control when to replace the container. Source builds skip the check.

For Docker Compose, including the Unraid example, run this from the directory containing your Compose file:

```sh
docker compose up -d --pull always --wait
```

If you started Orbia with `docker run`, pull the image, then stop and remove the old container. Use your actual container name if it differs from `orbia`.

```sh
docker pull --platform linux/amd64 ghcr.io/ranitzky/orbia:latest
docker stop orbia
docker rm orbia
```

Run your original `docker run` command again, for example the [Docker Desktop command](#run-on-macos-with-docker-desktop). Keep the same `/data` mount to use your existing database.

## Interface language

The first Settings section contains language, theme and separate opening preferences for dashboard links and bookmark links. Both default to the current tab. Each choice is saved in this browser and applies to mouse and keyboard navigation, including dashboard codes and bookmark search results. Expand a section to manage access, integrations or backups, or to view keyboard shortcuts.

Orbia opens in English by default. Choose **Settings → Language → Deutsch** to switch to German. Orbia remembers your choice in this browser and applies it to the sign-in screen, dashboard, library, editors and commands. Saved names, tags, notes and quicklink codes keep their original spelling.

Unread bookmarks have a small dot beside their title in grid and list view. Choose **Unread** to filter the library, including search results, tag counts and archived bookmarks. Opening a bookmark from the library or the search panel marks it as read. You can mark it unread again in the bookmark editor.

When you enter a URL for a new bookmark, Orbia waits for a domain name that resolves in DNS or a complete IP address before fetching the page's title and description from a public HTTP or HTTPS site. Pasting a complete URL starts the lookup and the colored outlines immediately. When you type a URL, the outlines appear once Orbia sends the request to the site. The outlines fade as soon as the lookup finishes. Both fields stay editable. If the page is unavailable or has no metadata, you can still save the bookmark and enter the details yourself. Orbia's automatic lookup runs when you create a bookmark in the web interface.

Orbia loads the active language catalog on demand and switches languages in place. Search uses the same API, SQLite indexes and debounce settings in both languages.

The German and English catalogs in `internal/web/static/de.js` and `internal/web/static/en.js` share stable keys such as `settings.title`. Use `data-i18n` for static text, `data-i18n-aria-label`, `data-i18n-placeholder`, or `data-i18n-content` for translated attributes, and `t(key, values)` for text rendered by JavaScript. When adding a message, include the same key and named placeholders in both catalogs. To add a language, create its catalog, register its loader in `app.js`, and add it to the language selector in `index.html`.

## Keyboard and touch

| Action | How |
| --- | --- |
| Launch an app | Click or tap a quicklink, or type its three-character code on the dashboard. After one or two characters, a unique match shows a destination preview at the bottom and Enter opens it early. Backspace corrects the prefix and Escape clears it. |
| Switch between the dashboard and bookmarks | Cmd/Ctrl+D opens the dashboard. Cmd/Ctrl+B opens bookmarks. Both are listed under **Settings → Keyboard**. Use the navigation buttons if your browser intercepts either shortcut. |
| Change dashboard | Press 1–9 or choose a page in the command palette. Each page has its own groups and codes. |
| Edit the dashboard | Cmd/Ctrl+E opens edit mode. Select a link to change its name, code, group or URL. Drag a quicklink by its code to reorder it or move it to another group. Drop on the add-link area to append it, including in an empty group. Edit group names, colors and order using their controls. Each page supports up to six groups. |
| Hover over a group | The colored border follows the mouse inside the group and glides back to the top-left corner on exit. With reduced motion enabled, it stays in the top-left corner. |
| Add a quicklink or bookmark | Press **+** outside a text field to add a quicklink on the dashboard or a bookmark in the library. The header and mobile bar also offer an add button. Enter bookmark tags as `#travel #city #dresden` or separate them with commas. |
| Add or switch dashboard pages | In edit mode, select **Add page** next to **Add group**. You can also select the **Commands** icon in the header or press Cmd/Ctrl+K, then choose **Add dashboard page** or switch to an existing page. Arrow keys select a command and Enter runs it. |
| Browse bookmarks | Open **Bookmarks** to focus the search field and start typing. Switch between cards and rows, edit notes and tags, and open the archive. |
| Search from either mode | Cmd/Ctrl+P or **Suche** opens a panel in the lower third on desktop. Press `#` outside a text field to open the panel with `#` already in the focused search field. Type `#travel #city #dresden Guide`. Every tag and text term must match. While typing a final hashtag such as `#dr`, the panel and library suggest matching tag names and show bookmarks with any of those tags. Click a suggestion or type a space after the full tag to apply it as an exact filter. Earlier tags and text constrain both results and suggestions. Use the arrows and Enter, or tap a result. |

Punctuation shortcuts work outside text fields. The app reserves unmodified letters for quicklink codes. Theme, dashboard page and bookmark layout persist per browser. Dates are present in API records for interchange. The interface shows no clock or date.

On desktop, the bottom edge of the dashboard grid fades while more quicklinks are available below.

## Linkding clients and data transfer

Open **Settings → Linkding integrations**, enter an app name and select **Generate token**. Use the **Copy** buttons to put the Orbia server address and the token on your clipboard. A green check mark confirms the copy. Copy the token before closing Settings, then paste the address and the token into Raycast or the Chrome/Firefox Linkding extension. Each token can read and modify the bookmark library through the Linkding-compatible API. Select **Revoke** beside an app to stop its access immediately.

Token hashes are stored in SQLite and excluded from HTML and JSON exports.

Orbia implements the bookmark, tag and profile operations those clients use, including both trailing-slash forms and their browser search/edit links. Contract tests exercise the request sequences. The compatibility notes record the exact client source revisions and unsupported features. [Client contracts](docs/compatibility.md) · [API coverage](docs/linkding-compatibility.md) · [Upstream API](https://linkding.link/api/)

**Settings → Import & Export** accepts Netscape bookmark HTML from Linkding and browsers. HTML preserves tags, descriptions, Linkding notes, archive/unread/shared flags and second-resolution timestamps. JSON backups also include dashboard pages and unused tags. File imports merge by URL in one transaction. Restoring a dashboard from JSON replaces the current pages. Database IDs are local. The import limit is 20 MiB.

### Import bookmarks from a running Linkding server

In **Settings → Import from Linkding**, enter the address of your Linkding installation and an API token issued by that installation. Choose **Start import** and keep the tab open for the result. Orbia reads active and archived bookmarks in batches. Matching URLs take their titles, notes, tags and flags from Linkding. The source token is used for this request only. For HTTPS, Orbia must trust the source certificate. On a trusted LAN, an Unraid installation can use an address such as `http://192.168.1.20:9090` (use your host IP and published Linkding port) or a Docker service name on a shared network. For HTTP, the import accepts only private IPv4, IPv6 unique-local, or loopback addresses. Every resolved address must qualify. Orbia connects directly to a checked IP and skips HTTP proxies. Both schemes reject redirects. HTTP exposes the source token to anyone able to observe the local connection. When opening Orbia from the internet, access Orbia itself over HTTPS as well. Only one UI import runs at a time, with a ten-minute deadline. If interrupted, completed batches are retained and you can start the import again.

You can repeat an import to pick up new or edited bookmarks. Orbia skips unchanged records and keeps local bookmarks when a URL is deleted or renamed on the source. The Orbia container must be able to reach the Linkding server.

For a full backup with stable IDs, stop the container, copy its **entire** data directory, then restart it. Restore that directory with the container stopped and the correct owner. Keep a separate copy of your configuration.

## Develop and test

A native build requires Go 1.26+, a C compiler, SQLite headers and a library with FTS5. On Debian/Ubuntu install `build-essential libsqlite3-dev`. Run `go run ./cmd/orbia` and complete setup in the browser. The native process reads its environment. Compose reads `.env`.

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
