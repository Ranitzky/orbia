import { errorText } from "./api";
import { toast } from "./dom";

type MoveLink = (from: string, to: string, link: string, before?: string) => Promise<void>;

// Track movement only for the duration of a drag. Link arrays change once, on drop.
export function bindQuicklinkDrag(grid: HTMLElement, canDrag: () => boolean, moveLink: MoveLink) {
  grid.addEventListener("pointerdown", (start) => {
    if (!canDrag() || !start.isPrimary || start.button !== 0) return;
    if (!(start.target instanceof Element)) return;
    const row = start.target.closest<HTMLElement>(".quicklink");
    if (!row || (start.pointerType !== "mouse" && !start.target.closest(".quick-code"))) return;
    const source = row.closest<HTMLElement>(".group-card");
    if (!source) return;
    const drag = new AbortController();
    const options = { signal: drag.signal };
    let x = start.clientX, y = start.clientY, dragging = false, frame = 0;
    let marker: HTMLElement | null | undefined;
    let edge: string | undefined;

    function mark(element?: HTMLElement | null, position?: string) {
      if (marker === element && edge === position) return;
      marker?.removeAttribute("data-drop");
      marker = element;
      edge = position;
      if (marker) marker.dataset.drop = position;
    }
    function targetAtPointer() {
      const hit = document.elementFromPoint(x, y);
      const group = hit?.closest<HTMLElement>("#groups .group-card");
      if (!group || !hit) return {};
      const link = hit.closest<HTMLElement>(".quicklink");
      if (!link) {
        const first = hit.closest(".group-heading") && group.querySelector<HTMLElement>(".quicklink");
        return first ? { group, element: first, position: "before" } : { group, element: group, position: "end" };
      }
      const rect = link.getBoundingClientRect();
      return { group, element: link, position: y < rect.top + rect.height / 2 ? "before" : "after" };
    }
    const paint = () => {
      frame = 0;
      if (!row.isConnected || grid.closest("[hidden]")) return cancel();
      const target = targetAtPointer();
      mark(target.element, target.position);
      const speed = y < 52 ? -12 : y > innerHeight - 52 ? 12 : 0;
      if (speed) {
        const previous = scrollY;
        window.scrollBy(0, speed);
        if (scrollY !== previous) frame = requestAnimationFrame(paint);
      }
    }
    const cancel = () => {
      drag.abort();
      cancelAnimationFrame(frame);
      mark(null);
      row.classList.remove("dragging");
      if (row.hasPointerCapture(start.pointerId)) row.releasePointerCapture(start.pointerId);
    }
    row.setPointerCapture(start.pointerId);
    row.addEventListener("pointermove", event => {
      if (event.pointerId !== start.pointerId) return;
      x = event.clientX;
      y = event.clientY;
      if (!dragging) {
        if (Math.hypot(x - start.clientX, y - start.clientY) < 6) return;
        dragging = true;
        row.classList.add("dragging");
      }
      if (!frame) frame = requestAnimationFrame(paint);
    }, options);
    row.addEventListener("lostpointercapture", cancel, options);
    row.addEventListener("pointercancel", cancel, options);
    row.addEventListener("pointerup", event => {
      if (event.pointerId !== start.pointerId) return;
      x = event.clientX;
      y = event.clientY;
      const target = targetAtPointer();
      cancel();
      if (!dragging) return;
      // A completed pointer gesture can still synthesize an edit click.
      const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      const { group: targetGroup } = target;
      if (!targetGroup || !target.element) return;
      const before = target.position === "before" ? target.element :
        target.position === "after" ? target.element.nextElementSibling : null;
      if (target.group === source && (before === row || before === row.nextElementSibling)) return;
      const from = source.dataset.group;
      const to = targetGroup.dataset.group;
      const link = row.dataset.link;
      if (from && to && link) {
        const beforeID = before instanceof HTMLElement ? before.dataset.link : undefined;
        moveLink(from, to, link, beforeID).catch(error => toast(errorText(error), true));
      }
    }, options);
  });
}
