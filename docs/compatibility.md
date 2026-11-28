# Linkding client compatibility

Use the Orbia server URL and an Orbia API token in the client settings. Enter the server URL without a trailing slash or `/api`. The clients append the paths below and send the token in the `Authorization: Token <token>` header. [Linkding API authentication](https://linkding.link/api/#authentication) · [Raycast extension](https://www.raycast.com/InteractiveNinja/linkding) · [Official Firefox and Chrome extensions](https://linkding.link/browser-extension/)

## Raycast

| User action | Request and expected result |
| --- | --- |
| Search Linkding | `GET /api/bookmarks/?q=<text>&limit=101`. Raycast reads the `results` array, including when the search text is empty. Each bookmark needs a numeric `id`, a URL, a string `title` and a `tag_names` array. Optional `website_title` and `website_description` provide display fallbacks. |
| Create Bookmark or Save Browser Tab | `POST /api/bookmarks/` with JSON. The form sends the URL, title, description, notes, unread flag and tags as `tag_names`. Raycast accepts any successful HTTP status. It fetches page metadata directly from the target website. |
| Archive | `POST /api/bookmarks/<id>/archive/` with an empty body. Upstream returns 204 and removes the bookmark from the active list. |
| Delete | `DELETE /api/bookmarks/<id>` without a trailing slash. A successful deletion should be visible on the next search. |
| Edit in Linkding | Opens the HTML page `/bookmarks/<id>/edit` in the user's browser. Opening a bookmark itself uses its saved URL. |

The Raycast Store lists macOS support and documents a Firefox limitation for its Save Browser Tab command. Firefox users can capture their current tab with the official browser extension. [Raycast Store](https://www.raycast.com/InteractiveNinja/linkding) · [Search, archive and delete requests][ray-http] · [Display fields and edit URL][ray-context] · [Create request][ray-create] · [Create form][ray-form] · [Metadata lookup][ray-meta]

## Firefox and Chrome

Firefox and Chrome 1.15.1 contain the same HTTP client. The popup checks exact status codes. A 200 response to a successful save would still display an error in the extension. [Firefox HTTP client][firefox] · [Chrome HTTP client][chrome]

| User action | Request and expected result |
| --- | --- |
| Test connection | `GET /api/bookmarks/?limit=1` must return 200 and a JSON object with `results`. An empty array works. |
| Open the popup or check the tab badge | `GET /api/bookmarks/check/?url=<encoded-url>` returns 200. Supply `bookmark` as the existing record or `null`, a `metadata` object with `url`, `title` and `description`, and `auto_tags` as a list of names. If an existing record lacks `date_added`, the extension calls `GET /api/bookmarks/<id>/`. |
| Show the share option | `GET /api/user/profile/` returns 200 and a JSON object. The popup shows its share checkbox when `enable_sharing` is true. |
| Suggest tags | `GET /api/tags/?limit=5000` returns 200. The popup reads the `name` of each tag in `results`. |
| Save or edit the current tab | `POST /api/bookmarks/?disable_scraping` must return 201 with the saved bookmark as JSON, including when the URL already exists. The popup sends `url`, `title`, `description`, `notes`, `tag_names`, `unread` and `shared`. Editing the same URL updates the original record. The SingleFile option adds the bare `disable_html_snapshot` flag. Validation errors use 400 and a JSON body. |
| Delete the current bookmark | `DELETE /api/bookmarks/<id>/` must return 204. |
| Search in the address bar | Suggestions call `GET /api/bookmarks/?q=<encoded-text>&limit=5`. Selecting a suggestion opens its URL. Submitting free text opens the HTML page `/bookmarks?q=<encoded-text>`. |

The popup can take the title and description from the active tab or from the server's check response. Orbia returns empty metadata fields in that response. Orbia's new-bookmark editor uses its own metadata endpoint. Its cache uses `metadata.url` to identify a matching tab. SingleFile invokes a separate browser extension with its own upload settings. [Popup form][popup] · [Metadata cache][cache] · [Address bar and badge][background] · [SingleFile settings][options]

## Verification scope

The request paths, payloads and status checks above were verified against the cited client sources on 20 November 2026. This review did not run the installed Raycast, Firefox or Chrome extensions against Orbia. For a live check, save a disposable URL in one client, look it up in another, edit its tags, then archive or delete it and repeat the search. Checking the stored result matters because Raycast removes archived and deleted entries from its list before the server confirms the change. [Raycast search implementation][ray-http]

Linkding's wider REST API also documents paginated bookmark and tag lists (`count`, `next`, `previous`, `results`), the archive list, unarchive, PUT/PATCH updates, tag management, bundles and bookmark assets. Those endpoints have their own contracts beyond the client actions above. [Official REST API](https://linkding.link/api/) · [Upstream archive and unarchive responses][server]

[ray-http]: https://github.com/raycast/extensions/blob/ce8f05c5abe34002f1a21c35d6a4cda6d44d63db/extensions/linkding/src/hooks/use-linkding-api.ts
[ray-context]: https://github.com/raycast/extensions/blob/ce8f05c5abe34002f1a21c35d6a4cda6d44d63db/extensions/linkding/src/bookmarks-context.tsx
[ray-create]: https://github.com/raycast/extensions/blob/ce8f05c5abe34002f1a21c35d6a4cda6d44d63db/extensions/linkding/src/hooks/use-create-bookmark.ts
[ray-form]: https://github.com/raycast/extensions/blob/ce8f05c5abe34002f1a21c35d6a4cda6d44d63db/extensions/linkding/src/components/create-bookmark-form.tsx
[ray-meta]: https://github.com/raycast/extensions/blob/ce8f05c5abe34002f1a21c35d6a4cda6d44d63db/extensions/linkding/src/hooks/use-url-metadata.tsx
[firefox]: https://github.com/sissbruecker/linkding-extension/blob/d0221d9c5271245217d06e76c49b86a70b0fedb9/src/linkding.js
[chrome]: https://github.com/sissbruecker/linkding-extension/blob/86460e63ccee8269cc367f9954f1bc2938d750ee/src/linkding.js
[popup]: https://github.com/sissbruecker/linkding-extension/blob/d0221d9c5271245217d06e76c49b86a70b0fedb9/src/popup-form.js
[cache]: https://github.com/sissbruecker/linkding-extension/blob/d0221d9c5271245217d06e76c49b86a70b0fedb9/src/cache.js
[background]: https://github.com/sissbruecker/linkding-extension/blob/d0221d9c5271245217d06e76c49b86a70b0fedb9/src/background.js
[options]: https://github.com/sissbruecker/linkding-extension/blob/d0221d9c5271245217d06e76c49b86a70b0fedb9/src/options.js
[server]: https://github.com/sissbruecker/linkding/blob/27b7303baf41bb28babc610ac8eaa486e1ddfab5/bookmarks/api/routes.py
