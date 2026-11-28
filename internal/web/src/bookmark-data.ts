import { escapeHTML } from "./dom";

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  notes: string;
  tag_names: string[];
  is_archived: boolean;
  unread: boolean;
}
export interface Tag { name: string; count: number }
export interface Results<T> { count: number; results: T[] }
// Only the last unfinished hashtag is a prefix. Earlier tags are exact filters.
export function searchParams(query: string) {
  const fragment = /(?:^|\s)#([^\s#"]*)$/u.exec(query);
  const params = new URLSearchParams({q: fragment ? query.slice(0, fragment.index) : query});
  if (fragment) params.set("tag_prefix", fragment[1]);
  return params;
}
export const selectedTags = (query: string) =>
  new Set((searchParams(query).get("q")!.match(/#[^\s]+/g) || []).map(t => t.slice(1).toLowerCase()));
export function toggleTag(query: string, name: string) {
  const params = searchParams(query);
  const terms: string[] = params.get("q")!.match(/"[^"]*"|\S+/g) || [];
  const value = `#${name}`;
  const found = terms.findIndex(t => t.toLowerCase() === value.toLowerCase());
  if (found >= 0) terms.splice(found, 1);
  else terms.push(value);
  return terms.length ? terms.join(" ") + " " : "";
}
export function tagMarkup(tags: Tag[], query: string, panel = false) {
  const selected = selectedTags(query);
  return tags
    .map((t) =>
      panel
        ? `<button class="tag-chip" data-panel-tag="${escapeHTML(t.name)}" aria-pressed="${selected.has(t.name)}">#${escapeHTML(t.name)}</button>`
        : `<button class="tag-item" data-bookmark-tag="${escapeHTML(t.name)}" aria-pressed="${selected.has(t.name)}"><span>#${escapeHTML(t.name)}</span><span>${t.count || 0}</span></button>`,
    )
    .join("");
}
export function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
export function unreadAttribute(book: Bookmark) {
  return book.unread ? `data-unread-id="${book.id}"` : "";
}
