# Validation

## Executed locally

- Go 1.26.1 on macOS ARM64. The native binary built with cgo. `go vet ./...`, `node --check internal/web/static/app.js` and `go test -race -count=1 ./...` passed.
- The Go suite checks bookmark and tag operations, upserts, omitted fields, authorization, cookie sessions, origin checks, pagination, archived lists, timestamp cutoffs, dashboard revisions, FTS maintenance, import rollback and persistence. One contract follows Raycast's slashless DELETE. A separate test imports 103 bookmarks across active and archived pages, skips unchanged records on a repeat import and picks up a subsequent archive update.
- All eight Playwright cases passed in desktop Chrome and all eight passed in WebKit 26.5. Both engines used the real HTTP server and a temporary SQLite database. Tests cover 3/2/1-column dashboard layouts, code-only lookup and navigation, editing, persistence, commands, conjunctive search, bookmark CRUD, mobile focus containment and the two external-client HTML routes. The phone viewport was 390 × 844 with touch enabled.
- The default dashboard was rendered at the reference size of 1671 × 941. The local web font and all styles load from the embedded app. [Rendered dashboard](dashboard.png)
- A Linux container smoke test started with a root-owned directory (0700) and a root-owned database file (0600). The entrypoint prepared both for 99:100, preserved the owner of an unrelated file, and the healthcheck succeeded with the server running as 99:100 and zero effective capabilities.
- Docker Compose built the Linux ARM64 image, started the non-root/read-only service, and reported a healthy container. An authenticated bookmark created before rebuilding and recreating the container retained its URL and title through the bind mount. The test removed that record afterward.

- A separate Linux AMD64 build ran under Docker Desktop emulation with a read-only root filesystem and temporary data mount. Its HTTP healthcheck returned 200.

## Search at 10,000 bookmarks

The test inserts 10,000 records with overlapping tags into a fresh on-disk SQLite database. A search for `Guide #travel #city #dresden` returns 100 matches and a page of 36. The test checks correctness, so slower hardware does not produce an artificial failure.

These times measure store operations with a warm local database. Browser debounce, network latency, concurrent imports and Unraid storage performance are additional costs.

## Remaining checks

The implementation has been compared with Linkding's documentation and the Raycast and browser extension sources. Installed third-party clients, a live upstream Linkding server, physical iPhone hardware, screen readers and deployment to an actual Unraid host remain unverified. GitHub Actions is configured for repository builds and has not run for this workspace.
