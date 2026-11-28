import { autofillBookmarkMetadata } from "./bookmark-metadata";
import { toast } from "./dom";
import { t } from "./language";
import { errorText, api } from "./api";
import { session } from "./session";
import { loadBookmarks } from "./bookmarks";
import type { Bookmark } from "./bookmark-data";
import { fieldText, editor, inputField, textareaField } from "./editor";

export async function editBookmark(id?: number) {
  let b: Bookmark | undefined;
  try {
    if (id) b = await api<Bookmark>(`/api/bookmarks/${id}/`);
  } catch (error) {
    toast(errorText(error), true);
    return;
  }
  let fillMetadata: ReturnType<typeof autofillBookmarkMetadata> | undefined;
  editor(
    b ? t("bookmarks.edit") : t("bookmarks.new"),
    inputField(
      "url",
      t("bookmarks.url"),
      b?.url,
      'type="url" required autocomplete="url" placeholder="https://"',
    ) +
      (b ? "" : '<div class="bookmark-metadata-fields">') +
      inputField(
        "title",
        t("bookmarks.title"),
        b?.title,
        `maxlength="512" placeholder="${t("bookmarks.titlePlaceholder")}" data-1p-ignore`,
      ) +
      textareaField("description", t("bookmarks.description"), b?.description) +
      (b ? "" : '<p id="bookmark-metadata-status" role="status"></p></div>') +
      inputField(
        "tags",
        t("bookmarks.tags"),
        b?.tag_names.join(", "),
        `placeholder="${t("bookmarks.tagsPlaceholder")}" data-1p-ignore`,
      ) +
      textareaField("notes", t("bookmarks.notes"), b?.notes, 500000) +
      `<div class="form-row"><label for="field-archived">${t("bookmarks.status")}<select aria-label="${t("bookmarks.status")}" name="archived" id="field-archived"><option value="false">${t("bookmarks.saved")}</option><option value="true" ${b?.is_archived ? "selected" : ""}>${t("bookmarks.archived")}</option></select></label><label for="field-unread">${t("bookmarks.readStatus")}<select aria-label="${t("bookmarks.readStatus")}" name="unread" id="field-unread"><option value="false">${t("bookmarks.read")}</option><option value="true" ${b?.unread ? "selected" : ""}>${t("bookmarks.unread")}</option></select></label></div>`,
    async (form) => {
      if (fillMetadata && !(await fillMetadata(form))) return false;
      const payload = {
        url: fieldText(form, "url").trim(),
        title: fieldText(form, "title").trim(),
        description: fieldText(form, "description"),
        notes: fieldText(form, "notes"),
        tag_names: fieldText(form, "tags")
          .split(/,|\s+(?=#)/)
          .map((t) => t.trim())
          .filter(Boolean),
        is_archived: fieldText(form, "archived") === "true",
        unread: fieldText(form, "unread") === "true",
      };
      await api(id ? `/api/bookmarks/${id}/` : "/api/bookmarks/", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (session.mode === "bookmarks") await loadBookmarks();
    },
    b
      ? async () => {
          await api(`/api/bookmarks/${id}/`, { method: "DELETE" });
          if (session.mode === "bookmarks") await loadBookmarks();
        }
      : null,
  );
  if (!b) fillMetadata = autofillBookmarkMetadata();
}
