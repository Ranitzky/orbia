# Linkding compatibility

Reviewed on 2026-11-20 against the live official documentation and source links below. The comparison is to the linked mutable upstream sources, not a pinned Linkding release. Orbia's regression tests preserve the selected contract; they do not prove equivalence to every upstream version or external client.

## Implemented contract

The documented API uses token authentication, paginated resources and bookmark operations. Orbia exposes the following subset. [Official API reference](https://linkding.link/api/).

| Endpoint / behavior | Orbia status |
| --- | --- |
| `Authorization: Token …` | Implemented; Bearer also accepted |
| `GET/POST /api/bookmarks/` | List and create, including POST upsert by normalized URL |
| `GET/PUT/PATCH/DELETE /api/bookmarks/{id}/` | Implemented; omitted mutable fields remain unchanged |
| `GET /api/bookmarks/archived/` | Implemented; regular list excludes archived items |
| `POST …/{id}/archive/`, `unarchive/` | Implemented, returning 204 |
| `GET /api/bookmarks/check/?url=…` | Existing bookmark, metadata envelope and auto_tags envelope |
| `GET/POST /api/tags/`, `GET/DELETE /api/tags/{id}/` | Implemented |
| `GET /api/user/profile/` | Implemented with static preferences describing Orbia's limits |
| `limit`, `offset` | Default 100; Orbia maximum 5000; absolute next/previous links |
| `q` | Conjunctive tags, word prefixes and quoted phrases |
| `modified_since`, `added_since` | Strict UTC timestamp cutoffs; invalid cutoffs ignored |
| Optional trailing slash | Accepted on implemented resource routes |
| Create / read / delete status | 201 / 200 / 204, with 400 validation and 401 auth errors |

Bookmark responses include the common fields plus nullable media/legacy fields. Input preserves omitted values, accepts explicit empty tag lists, and rejects null for writable fields. Timestamps can be supplied on create; updates assign a fresh modification timestamp. [Official serializer](https://github.com/sissbruecker/linkding/blob/master/bookmarks/api/serializers.py), [route implementations](https://github.com/sissbruecker/linkding/blob/master/bookmarks/api/routes.py).

## Chrome and Firefox extensions

The official extension client uses bookmark POST for create/edit, URL check, tags, profile and search. Those routes and expected statuses are included in Go contract tests. Orbia accepts the extension's scraping and snapshot flags on bookmark saves. These saves use the title and description supplied by the client. [Official extension API client](https://github.com/sissbruecker/linkding-extension/blob/master/src/linkding.js).

Configure the **server root** and token. Test an actual Chrome and Firefox installation before relying on migration. Live extension testing was not available here. Orbia's URL check returns empty metadata fields. The extension can use the active tab's title and description, and users can enter those values manually. Normal browser-extension saving is the target; optional SingleFile snapshots and asset uploads are unsupported.

## Raycast

Raycast's search, create, archive and slashless delete requests are covered by contract tests. Its edit action opens the Orbia bookmark editor by ID. The omnibox search URL used by the browser extension opens the library with its query applied. Both browser entry points are covered by Playwright. See [client source revisions and request details](compatibility.md). Installed client testing remains open.

## Intentional differences

| Area | Limitation / consequence |
| --- | --- |
| Search grammar | No OR, NOT, grouping or lax tag mode. Unsupported operators return 400. Text uses word prefixes, not identical upstream matching. |
| Metadata | `/check/` supplies empty title and description fields. Orbia fetches page metadata when creating bookmarks in its own web editor through `POST /api/orbia/bookmark-metadata`. |
| Media | Favicon, preview, archive URL and legacy website fields are null. No assets or snapshots. |
| Bundles | 501; `bundle` filter returns 501. Orbia pages are not Linkding bundles. |
| Auto-tagging | No rules. `auto_tags` is empty. |
| Read status | The library and tag facets support an Orbia-specific `unread=true` filter. Opening a bookmark in Orbia clears its unread flag. |
| Sharing | Orbia preserves the shared flag during migration. Public sharing endpoints are unsupported. |
| Profile preferences | Static compatibility response; UI preferences are browser-local. |
| URL normalization | Lowercase scheme/host and an explicit root slash; no claim of identical upstream canonicalization for every URL. |
| Hosting | Root path only. Configure a canonical origin behind a proxy. |
| REST import/export | Orbia-specific endpoints, not Linkding's settings HTML routes. |
| Errors / limits | Error details, tag normalization edge cases and resource limits may differ. |

Multiple `#tags` are AND filters in current Linkding. Orbia implements that subset, not the complete boolean search language. [Official search semantics](https://linkding.link/search/).

## Import, export and synchronization

HTML interchange handles Linkding's notes markers and archive tag, flags and second-precision timestamps. The Netscape parser intentionally targets bookmark export files, not arbitrary malformed HTML, and does not preserve folders, assets or custom attributes. [Upstream exporter](https://github.com/sissbruecker/linkding/blob/master/bookmarks/services/exporter.py).

Orbia provides `GET /api/orbia/export?format=html`, `GET /api/orbia/export` for JSON, and `POST /api/orbia/import` for raw HTML/JSON bodies. All require authentication. Import is a transactional merge by URL; JSON may also replace dashboard pages. A response reports the imported count. The web interface exposes the same operations.

Clients can poll modification cutoffs and enumerate active/archived lists. Orbia does not expose tombstones, a deletion feed, a transactional sync cursor or conflict versions for bookmarks. A polling mirror must perform full ID reconciliation to discover deletions, handle concurrent offset pagination and supply its own conflict policy. The one-way import in Settings pages through active and archived remote lists and skips unchanged bookmarks. Local-only URLs are retained. Scheduling, delete propagation and bidirectional reconciliation remain outside the MVP. Dashboard revision conflicts are a separate Orbia feature.
