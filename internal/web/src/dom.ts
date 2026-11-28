export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function $$<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}
export const escapeHTML = (value: unknown = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
export const icon = (name: string) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

let toastTimer: number;
export function toast(message: string, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    error ? 7000 : 3500,
  );
}

export function closeDialogs() {
  $$<HTMLDialogElement>("dialog[open]").forEach((dialog) => dialog.close());
}
export function openDialog(id: string) {
  closeDialogs();
  $<HTMLDialogElement>(id).showModal();
}

$$<HTMLDialogElement>("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  });
});

export function integrationStatus(id: string, message: string, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("error", error);
}
