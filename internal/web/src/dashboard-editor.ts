import { escapeHTML, toast } from "./dom";
import { t } from "./language";
import { dashboardPages, activePage, allLinks, setPage, changeDashboard } from "./dashboard";
import { fieldText, editor, inputField } from "./editor";
import { setMode } from "./navigation";

const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function editLink(id?: string, groupID?: string) {
  const page = activePage(),
    group = page.groups.find((g) => g.links.some((l) => l.id === id));
  const link = group?.links.find((l) => l.id === id);
  groupID = group?.id || groupID || page.groups[0]?.id;
  if (!page.groups.length) {
    toast(t("dashboard.groupRequired"));
    editGroup();
    return;
  }
  const fields =
    inputField(
      "name",
      t("editor.name"),
      link?.name,
      'required maxlength="200" autocomplete="off" data-1p-ignore',
    ) +
    `<div class="form-row">${inputField("code", t("dashboard.code"), link?.code, 'required pattern="[A-Za-z0-9]{3}" minlength="3" maxlength="3" placeholder="IMM" autocomplete="off" style="text-transform:uppercase"')}<label for="field-group">${t("dashboard.group")}<select name="group" id="field-group">${page.groups.map((g) => `<option value="${escapeHTML(g.id)}" ${g.id === groupID ? "selected" : ""}>${escapeHTML(g.name)}</option>`).join("")}</select></label></div>` +
    inputField(
      "url",
      t("dashboard.destinationUrl"),
      link?.url,
      'type="url" required placeholder="https://immich.example.com" autocomplete="url"',
    ) +
    `<p class="field-hint">${t("dashboard.codeHint")}</p>`;
  editor(
    link ? t("dashboard.editQuicklink") : t("dashboard.newQuicklink"),
    fields,
    async (form) => {
      const code = fieldText(form, "code").toUpperCase(),
        name = fieldText(form, "name").trim();
      if (!name) throw new Error(t("editor.nameRequired"));
      if (allLinks().some((l) => l.code === code && l.id !== id))
        throw new Error(t("dashboard.duplicateCode"));
      await changeDashboard((d) => {
        const groups = activePage(d).groups;
        const target = groups.find((g) => g.id === fieldText(form, "group"));
        if (!target) throw new Error(t("dashboard.groupRequired"));
        const entry = {
          id: id || uid(),
          name,
          code,
          url: fieldText(form, "url").trim(),
        };
        const index = target.links.findIndex((l) => l.id === id);
        if (index >= 0) target.links[index] = entry;
        else {
          for (const group of groups)
            group.links = group.links.filter((l) => l.id !== id);
          target.links.push(entry);
        }
      });
    },
    link
      ? async () =>
          changeDashboard((d) => {
            activePage(d).groups.forEach((g) => {
              g.links = g.links.filter((l) => l.id !== id);
            });
          })
      : null,
  );
}
export function editGroup(id?: string) {
  const page = activePage(),
    group = page.groups.find((g) => g.id === id);
  if (!group && page.groups.length >= 6) {
    toast(t("dashboard.groupLimit"), true);
    return;
  }
  const colors = [
    "#36d8d3",
    "#88d9ae",
    "#8abcf4",
    "#bb9ae9",
    "#e9cf81",
    "#ec91b7",
  ];
  editor(
    group ? t("dashboard.editGroup") : t("dashboard.newGroup"),
    inputField("name", t("editor.name"), group?.name, 'required maxlength="80" data-1p-ignore') +
      `<div class="form-row"><label for="field-color">${t("dashboard.accentColor")}<input id="field-color" name="color" type="color" value="${group?.color || colors[page.groups.length]}" required></label><label for="field-position">${t("editor.position")}<select id="field-position" name="position">${Array.from({ length: group ? page.groups.length : page.groups.length + 1 }, (_, i) => `<option value="${i}" ${i === (group ? page.groups.indexOf(group) : page.groups.length) ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label></div>` +
      (group
        ? `<p class="field-hint">${t("dashboard.deleteGroupWarning", {count: group.links.length})}</p>`
        : ""),
    async (form) => {
      if (!fieldText(form, "name").trim())
        throw new Error(t("editor.nameRequired"));
      await changeDashboard((d) => {
        const p = activePage(d),
          old = p.groups.find((g) => g.id === id);
        p.groups = p.groups.filter((g) => g.id !== id);
        p.groups.splice(Number(fieldText(form, "position")), 0, {
          id: id || uid(),
          name: fieldText(form, "name").trim(),
          color: fieldText(form, "color"),
          links: old?.links || [],
        });
      });
    },
    group
      ? async () =>
          changeDashboard((d) => {
            const p = activePage(d);
            p.groups = p.groups.filter((g) => g.id !== id);
          })
      : null,
  );
}
export function editPage(create: boolean) {
  if (create && dashboardPages().length >= 9) {
    toast(t("dashboard.pageLimit"));
    return;
  }
  const page = activePage(),
    newID = uid();
  editor(
    create ? t("dashboard.addDashboardPage") : t("dashboard.editDashboardPage"),
    inputField(
      "name",
      t("editor.name"),
      create ? "" : page.name,
      `required maxlength="80" placeholder="${t("dashboard.pageNamePlaceholder")}" data-1p-ignore`,
    ) +
      `<p class="field-hint">${create ? t("dashboard.newPageHint") : t("dashboard.editPageHint")}</p>`,
    async (form) => {
      const name = fieldText(form, "name").trim();
      if (!name) throw new Error(t("editor.nameRequired"));
      await changeDashboard((d) => {
        if (create) d.pages.push({ id: newID, name, groups: [] });
        else activePage(d).name = name;
      });
      if (create) setPage(newID);
      setMode("dashboard");
    },
    !create && dashboardPages().length > 1
      ? async () => {
          await changeDashboard((d) => {
            d.pages = d.pages.filter((p) => p.id !== page.id);
          });
          setPage(dashboardPages()[0].id);
        }
      : null,
  );
}
