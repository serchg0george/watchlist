import { bulkDelete, bulkSetStatus, bulkSetType } from "../../actions.js";
import { STATUSES, STATUS_LABELS } from "../../config.js";
import type { Status } from "../../domain/types.js";
import { getTypes, render, selectedIds, state, visibleIds } from "../../state/store.js";
import { byId, el } from "../dom.js";

// Bottom bar with bulk actions for the current selection; rebuilt on every render.
export function renderBulkBar(): void {
  const bar = byId("bulk-bar");
  if (!state.selecting) { bar.hidden = true; return; }

  // Prune ids that no longer exist in the data.
  const existing = new Set(state.data?.items.map((it) => it.id));
  for (const id of [...selectedIds]) if (!existing.has(id)) selectedIds.delete(id);
  const n = selectedIds.size;

  bar.textContent = "";
  bar.append(el("span", { class: "bulk-count", text: `Выбрано: ${n}` }));

  // Selects every visible item, or clears the selection when all visible are already in it.
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectAllBtn = el("button", { type: "button", class: "btn", text: allVisibleSelected ? "Снять выбор" : "Все видимые" });
  selectAllBtn.addEventListener("click", () => {
    if (allVisibleSelected) selectedIds.clear(); else for (const id of visibleIds) selectedIds.add(id);
    render();
  });
  bar.append(selectAllBtn);

  const statusSel = el("select", { class: "bulk-status", "aria-label": "Статус" });
  statusSel.append(el("option", { value: "", text: "Статус…", disabled: true, selected: true }));
  for (const s of STATUSES) statusSel.append(el("option", { value: s, text: STATUS_LABELS[s] }));
  statusSel.disabled = n === 0;
  statusSel.addEventListener("change", () => { if (statusSel.value) bulkSetStatus([...selectedIds], statusSel.value as Status); });
  bar.append(statusSel);

  const typeSel = el("select", { class: "bulk-type", "aria-label": "Категория" });
  typeSel.append(el("option", { value: "", text: "Категория…" }));
  for (const t of getTypes()) typeSel.append(el("option", { value: t.key, text: t.label }));
  typeSel.disabled = n === 0;
  typeSel.addEventListener("change", () => { if (typeSel.value) bulkSetType([...selectedIds], typeSel.value); });
  bar.append(typeSel);

  const deleteBtn = el("button", { type: "button", class: "btn bulk-delete", text: "Удалить" });
  deleteBtn.disabled = n === 0;
  deleteBtn.addEventListener("click", () => bulkDelete([...selectedIds]));
  bar.append(deleteBtn);

  const doneBtn = el("button", { type: "button", class: "btn", text: "Готово" });
  doneBtn.addEventListener("click", () => { state.selecting = false; selectedIds.clear(); render(); });
  bar.append(doneBtn);

  bar.hidden = false;
}
