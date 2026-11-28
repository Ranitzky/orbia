import { errorText } from "./api";
import { $, escapeHTML, toast, openDialog } from "./dom";
import { t } from "./language";
import { isSaving } from "./dashboard";

export function fieldText(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error(`Missing text field: ${name}`);
  return value;
}

type Save = (fields: FormData) => Promise<void | boolean>;
let editorSave: Save;
let editorDelete: (() => Promise<void>) | null;
export const inputField = (name: string, label: string, value = "", options = "") =>
  `<label for="field-${name}">${label}<input id="field-${name}" name="${name}" value="${escapeHTML(value)}" ${options}></label>`;
export const textareaField = (name: string, label: string, value = "", max = 100000) =>
  `<label for="field-${name}">${label}<textarea id="field-${name}" name="${name}" maxlength="${max}">${escapeHTML(value)}</textarea></label>`;
export function editor(title: string, fields: string, save: Save, remove: (() => Promise<void>) | null) {
  $("#editor-title").textContent = title;
  $("#editor-fields").innerHTML = fields;
  $("#editor-error").textContent = "";
  $("#delete-button").hidden = !remove;
  $("#delete-confirm").hidden = true;
  $<HTMLButtonElement>("#save-button").disabled = false;
  editorSave = save;
  editorDelete = remove;
  openDialog("#editor-dialog");
  $(
    "#editor-fields input, #editor-fields textarea, #editor-fields select",
  )?.focus();
}
async function saveEditor(event: SubmitEvent) {
  event.preventDefault();
  const button = $<HTMLButtonElement>("#save-button");
  if (isSaving() || button.disabled) return;
  const save = editorSave;
  button.disabled = true;
  $("#editor-error").textContent = "";
  try {
    const saved = await save(new FormData($<HTMLFormElement>("#editor-form")));
    if (saved === false || editorSave !== save) return;
    $<HTMLDialogElement>("#editor-dialog").close();
    toast(t("editor.saved"));
  } catch (error) {
    if (editorSave === save) $("#editor-error").textContent = errorText(error);
  } finally {
    if (editorSave === save) button.disabled = false;
  }
}

$<HTMLFormElement>("#editor-form").addEventListener("submit", saveEditor);
$<HTMLButtonElement>("#delete-button").addEventListener("click", () => {
  $("#delete-confirm").hidden = false;
  $("#confirm-delete").focus();
});
$<HTMLButtonElement>("#confirm-delete").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("#confirm-delete");
  button.disabled = true;
  try {
    if (!editorDelete) return;
    await editorDelete();
    $<HTMLDialogElement>("#editor-dialog").close();
    toast(t("editor.deleted"));
  } catch (error) {
    $("#editor-error").textContent = errorText(error);
  } finally {
    button.disabled = false;
  }
});
