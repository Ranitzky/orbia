# MVP status

| Area | Implemented and checked | Remaining limits |
| --- | --- | --- |
| Dashboard | Six reference groups with 24 editable links, nine independent quicklink lists, digit navigation, prefix selection before three characters, destination preview and keyboard launch. | Codes are unique per list. Users must set their actual service URLs. |
| Commands | Create and switch lists, change theme, edit names/URLs/codes, add links, switch modes. Buttons expose each keyboard action. | Browsers and OS-level shortcuts can intercept individual key combinations. |
| Bookmarks | Card/list views, tag navigation, CRUD, archive, notes, AND filters, prefix text search and matching tag suggestions. Cmd/Ctrl+P works in both modes. | Search covers stored fields. External page bodies and attached files are outside the index. |
| Design and accessibility | Local JetBrains Mono, dotted canvas, dark/light themes, focus indication, reduced motion, modal keyboard navigation and touch controls. Desktop, tablet and phone layouts passed browser checks. | Physical iPhone, VoiceOver and a full accessibility audit remain open. |
| Scale | SQLite FTS5 and join indexes, paginated results, debounce and cancellation. Search tested with 10,000 bookmarks. | Single-owner design. Imports and exports can hold the database connection. Very large tag vocabularies increase facet response size. |
| Linkding integrations | Selected REST contract plus search/edit browser URLs verified against upstream documentation and pinned client sources. Browser routes and API flows are regression-tested. | Installed Raycast, Chrome and Firefox extensions still need end-to-end verification. No bundles, automatic tagging rules, scraping, snapshots or public sharing. |
| Migration | Netscape HTML interchange, JSON export/import, one-way import of active and archived Linkding bookmarks from Settings. Repeat imports are tested. | The import retains local-only URLs, including URLs removed or renamed upstream. No two-way reconciliation. |
| Deployment | Non-root Compose service, example Unraid configuration, healthcheck, volume persistence after container recreation. | Docker Desktop validation does not reproduce the target server's disk, permissions, network or reverse proxy. |

[Architecture](architecture.md) · [Client contracts](compatibility.md) · [Validation results](validation.md)
