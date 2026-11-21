# Architecture and design decisions

## Product boundaries

Orbia has one owner and one bookmark library. It replaces Linkding for clients pointed at its base URL. There is no multi-server conflict resolution. The MVP indexes saved fields. Page crawling and snapshot storage would require a separate fetch worker and retention policy.

Dashboard pages and bookmarks are separate concepts. Keys 1–9 select dashboard pages. Every page owns its groups and quicklinks; bookmark filters always refer to the shared library. A quicklink is not automatically a bookmark. Three-character codes are unique within their page, not globally.

## Runtime

One long-running Go process serves the API and embedded static assets. There is no JavaScript build step and no Node runtime in production. Files in `internal/web/static` are embedded into the binary. A local JetBrains Mono font removes a third-party font request and works offline after loading the app.

SQLite is the only persistent service. Orbia links the system SQLite library through cgo, keeping the Go module dependency-free. `internal/sqlite` owns prepared statements, bindings, row decoding and transactions through a small cgo API. It deliberately does not implement a general `database/sql` driver. This reduces dependencies but makes the native boundary an explicit maintenance responsibility. It requires a C compiler and SQLite headers when building and a compatible SQLite library at runtime. Use a native Docker build for each architecture; ordinary `CGO_ENABLED=0` cross-compilation does not work.

The Docker build and runtime use the same Alpine release to keep their native SQLite ABI compatible. The local Compose smoke test uses a Linux ARM64 image. A separate emulated AMD64 build also passed its startup healthcheck. Unraid hardware validation remains open.

## Storage and queries

| Data | Storage and invariant |
| --- | --- |
| Bookmarks | Unique normalized URL, indexed archived state and creation order |
| Tags | Unique lowercase name, normalized spaces, indexed joins in both directions |
| Search | FTS5 external-content table with insert/update/delete triggers |
| Dashboard | Validated JSON aggregate with an increasing revision |
| Login sessions | Signed opaque cookies backed by an in-memory nonce registry |
| Theme/view/page preference | Browser localStorage; not part of the server backup |

The Linkding import commits each source page atomically and skips unchanged bookmarks.

The connection uses WAL, foreign keys, a five-second busy timeout, and normal synchronous mode. A Go mutex serializes operations on one native connection. Transactional writes use `BEGIN IMMEDIATE` and roll back on errors or panic. This is adequate for a single-user 10k library, and avoids transaction interleaving. It is not intended for high-concurrency multi-user use. A future SQLite connection pool should preserve the same Store operations; it would need careful WAL and transaction testing. WAL mode does not make an unlocked live database-file copy a valid backup.

Queries are parameterized. FTS5 uses Unicode tokenization, accent folding and prefix indexes. The supported query grammar is an implicit AND of word prefixes, exact quoted phrases and exact `#tags`. Explicit `and` is accepted. OR/NOT/grouping return a validation error instead of being silently misinterpreted. Stored timestamps use a fixed-width UTC representation, so strict `modified_since`/`added_since` comparisons retain nanosecond precision and can use indexes.

The bookmark UI requests 36 items at a time; the quick panel requests 30. A page's tags are loaded in one batch, not one query per result. Facets use the complete matching database set, not just the visible page. Requests are debounced by 150 ms and aborted when input changes; sequence guards reject stale responses. The browser never downloads the entire bookmark library for a normal search.

Dashboard writes include the revision that was read. A stale update returns 409; the UI reloads current data and preserves the open edit form for the user to retry. A full validated aggregate is appropriate for a maximum of nine pages and 600 links per page. Avoid migrating this design to unbounded multi-user document editing.

## Module boundaries

- `cmd/orbia`: environment configuration, process lifecycle and HTTP timeouts.
- `internal/sqlite`: native resource ownership and transaction execution.
- `internal/app/store.go`: bookmark validation, storage, search and tag operations.
- `internal/app/dashboard.go`: dashboard aggregate and concurrency rules.
- `internal/app/server.go`: Linkding-shaped routes and Orbia-specific endpoints.
- `internal/app/auth.go`: login, token checks, session issuance/revocation and origin checks.
- `internal/app/transfer.go`: consistent export and transactional merge import.
- `internal/web`: buildless browser application and local assets.

New database migrations should advance `PRAGMA user_version`. The server refuses a database created by a newer schema. Back up the database before upgrading. Schema version 3 retains tokens issued through Settings.

## Authentication and deployment

The owner sets the sign-in password through the environment. The web password is compared using PBKDF2-HMAC-SHA256 with a random process salt and 210,000 iterations. Settings generates 256-bit random app tokens and returns each secret once. SQLite indexes their SHA-256 digests. App tokens grant access to the Linkding client routes. Sessions expire after 24 hours, are HttpOnly and SameSite Strict, and can be revoked on logout. The registry holds at most 32 sessions. Restarting the process invalidates all browser sessions. Token creation and revocation take effect immediately. Password changes take effect at restart.

Token management and remote imports require a browser session. The Settings import fetches fixed bookmark paths and rejects redirects. HTTPS uses normal certificate verification. Plain HTTP uses a separate proxy-free transport. Each new connection resolves the host, checks every result for a private or loopback address, and dials an approved numeric IP directly. Mixed public/private DNS responses and link-local addresses are rejected before an authenticated request can be sent. The source token stays in request memory.

Login attempts use a bounded global bucket. Ten unsuccessful attempts within a minute block login until the next window. This avoids trusting spoofable proxy headers but means an attacker could temporarily block the owner's login; a reverse proxy can add stronger controls. API requests need a session or token. An explicitly invalid Authorization header cannot fall back to a valid cookie.

Cookie-authenticated mutations validate Origin or reject cross-site Fetch Metadata. `ORBIA_ORIGIN` sets the canonical origin behind a proxy; otherwise the request Host is used. Extension CORS permits token-based requests from extension origins only, without credentialed cookies. The application does not enable arbitrary website CORS. Restrictive CSP, frame blocking, no-referrer and nosniff headers are set. User-provided HTML is escaped before insertion, URL schemes are limited to HTTP(S), and Orbia never fetches saved URLs on the server. There is no server-side URL preview or SSRF-capable crawler.

## Visual decisions

The supplied reference guided the near-black surface, fine 18 px dot grid, local mono font, bracket logo, six outlined groups, short colored top strokes, uppercase labels with `//`, three-character badges and quiet row separators. The group accents follow the reference's turquoise, mint, blue, lilac, yellow and pink.

The header follows the reference's bracketed actions. The Tags and Settings keys use punctuation so every letter remains available for code search. Page tabs appear when another page exists or the user is editing. The main dashboard has no hero, analytics widgets, clock or date. A unique code prefix shows a text destination preview and dims nonmatches. Hover adds a small movement, tinted background and accent outline. Reduced-motion preferences disable transitions.

Desktop uses three columns, tablet two and phone one. On phones, a fixed bottom bar exposes navigation, search and creation without shortcuts. A visible code input opens the touch keyboard and handles digit-leading codes. The bookmark search dialog sits in approximately the lower third of desktop screens and uses more of a small phone viewport. It shows a horizontal tag strip and scrollable results.

Native dialogs provide modal focus containment and Escape dismissal. Controls have accessible names, forms use explicit labels, status updates use live regions, and page tabs support arrow/Home/End keys. Keyboard alternatives are available as buttons because browsers may reserve Cmd+P. Contrast, screen-reader behavior and physical iPhone ergonomics still need an actual browser/accessibility audit; implemented semantics are not a WCAG certification.
