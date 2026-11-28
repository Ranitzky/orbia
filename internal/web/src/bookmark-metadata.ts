import { $ } from "./dom";
import { t } from "./language";
import { api } from "./api";

function canLookupBookmarkMetadata(value: string) {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority) return false;

  let target;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  if (target.username || target.password) return false;

  const hostname = target.hostname.replace(/\.$/, "");
  if (hostname.startsWith("[")) return authority.startsWith("[");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    // URL also accepts partial IPv4 literals. Wait for the full address.
    return authority.split(":")[0] === hostname;
  }

  const labels = hostname.split(".");
  return hostname.length <= 253 && labels.length > 1 &&
    /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]) &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function autofillBookmarkMetadata() {
  const dialog = $<HTMLDialogElement>("#editor-dialog");
  const url = $<HTMLInputElement>("#field-url");
  const status = $("#bookmark-metadata-status");
  const metadataFields = $(".bookmark-metadata-fields");
  metadataFields.addEventListener("animationend", event => {
    if (event.animationName === "bookmark-metadata-fade" && metadataFields.dataset.fetchGlow === "fading") {
      metadataFields.removeAttribute("data-fetch-glow");
    }
  });
  const fields = { title: $<HTMLInputElement>("#field-title"), description: $<HTMLTextAreaElement>("#field-description") };
  const edited = new Set();
  for (const [name, field] of Object.entries(fields)) {
    field.addEventListener("input", () => edited.add(name));
  }

  type Metadata = Record<string, string> | null | undefined;
  let timer: number;
  let lookup: { url: string; controller: AbortController; result: Promise<Metadata> } | undefined;
  function load(pasted = false) {
    clearTimeout(timer);
    const value = url.value.trim();
    if (!dialog.open || !url.isConnected || !url.validity.valid ||
        edited.size === 2 || !canLookupBookmarkMetadata(value)) return;
    if (lookup?.url === value) return lookup.result;
    lookup?.controller.abort();
    const controller = new AbortController();
    const current = () => dialog.open && url.isConnected && !controller.signal.aborted && url.value.trim() === value;
    if (pasted) metadataFields.dataset.fetchGlow = "loading";
    const result = api<Metadata>("/api/orbia/bookmark-metadata", {
      method: "POST",
      body: JSON.stringify({ url: value }),
      signal: controller.signal,
    }, response => {
      if (current() && response.headers.get("X-Orbia-Metadata-Fetching") === "1") {
        metadataFields.setAttribute("aria-busy", "true");
        metadataFields.dataset.fetchGlow = "loading";
      }
    }).catch(() => undefined).then(metadata => {
      if (!current()) return;
      for (const [name, field] of Object.entries(fields)) {
        if (!edited.has(name) && !field.value && metadata?.[name]) field.value = metadata[name];
      }
      metadataFields.removeAttribute("aria-busy");
      if (metadataFields.hasAttribute("data-fetch-glow") || metadata?.title || metadata?.description) {
        metadataFields.dataset.fetchGlow = "fading";
      }
      status.textContent = metadata === null || metadata?.title || metadata?.description
        ? "" : t("bookmarks.metadataUnavailable");
      return metadata;
    });
    lookup = { url: value, controller, result };
    return result;
  }

  url.addEventListener("input", event => {
    const pasted = event instanceof InputEvent && ["insertFromPaste", "insertFromPasteAsQuotation"].includes(event.inputType);
    if (pasted || lookup?.url !== url.value.trim()) {
      lookup?.controller.abort();
      lookup = undefined;
      metadataFields.removeAttribute("data-fetch-glow");
      metadataFields.removeAttribute("aria-busy");
      status.textContent = "";
      for (const [name, field] of Object.entries(fields)) {
        if (!edited.has(name)) field.value = "";
      }
    }
    clearTimeout(timer);
    if (pasted) void load(true);
    else timer = setTimeout(load, 400);
  });
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    lookup?.controller.abort();
  }, { once: true });

  return async (form: FormData) => {
    const metadata = await load();
    if (!dialog.open || !url.isConnected) return false;
    for (const name of Object.keys(fields)) {
      if (!edited.has(name) && !form.get(name) && metadata?.[name]) form.set(name, metadata[name]);
    }
    return true;
  };
}
