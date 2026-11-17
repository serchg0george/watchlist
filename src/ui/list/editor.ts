import { commitEdit, deleteItem } from "../../actions.js";
import { STATUS_LABELS } from "../../config.js";
import { todayStr } from "../../domain/dates.js";
import { isStatus } from "../../domain/guards.js";
import type { Item } from "../../domain/types.js";
import { clearDraftAfterSave, draftKey, readDraft, writeDraft } from "../../state/saving.js";
import { getTypes, render, state } from "../../state/store.js";
import { el } from "../dom.js";
import { showToast } from "../toast.js";

export function buildEditor(item: Item): HTMLElement {
  const key = draftKey("item", item.id);
  const draft = readDraft(key);
  const titleInput = el("input", { type: "text", class: "edit-title", value: item.title, "aria-label": "Название" });
  const typeSelect = el("select", { class: "edit-type", "aria-label": "Тип" },
    ...getTypes().map((t) => el("option", { value: t.key, text: t.label })));
  typeSelect.value = item.type;
  const firstType = getTypes()[0];
  if (!typeSelect.value && firstType) {
    typeSelect.value = firstType.key;
  }

  const statusSelect = el("select", { class: "edit-status", "aria-label": "Статус" },
    ...Object.entries(STATUS_LABELS).map(([k, v]) => el("option", { value: k, text: v })));
  statusSelect.value = item.status;

  const noteInput = el("input", { type: "text", class: "edit-note", value: item.note || "", placeholder: "Заметка", "aria-label": "Заметка" });
  const genresInput = el("input", { type: "text", value: (item.genres || []).join(", "), placeholder: "Например: комедия, драма", "aria-label": "Жанры через запятую" });
  const genresField = el("label", { class: "edit-genres" }, el("span", { text: "Жанры через запятую" }), genresInput);
  const dateInput = el("input", { type: "date", class: "edit-date" });
  const dateLabel = el("span");
  const dateField = el("label", { class: "edit-date-field" }, dateLabel, dateInput,
    el("small", { text: "При смене статуса дата ставится автоматически. Можно исправить вручную." }));
  let dateEdited = false;
  const updateDateField = (): void => {
    const status = statusSelect.value;
    const key: "watchedAt" | "droppedAt" | null = status === "watched" ? "watchedAt" : status === "dropped" ? "droppedAt" : null;
    dateField.hidden = !key;
    dateLabel.textContent = status === "dropped" ? "Дата отказа от просмотра" : "Дата просмотра";
    dateInput.setAttribute("aria-label", dateLabel.textContent);
    dateInput.value = key ? (status !== item.status ? todayStr() : item[key] || "") : "";
    dateEdited = false;
  };
  updateDateField();
  statusSelect.addEventListener("change", updateDateField);
  dateInput.addEventListener("input", () => { dateEdited = true; });
  if (draft) {
    const text = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
    titleInput.value = text(draft.title, item.title);
    typeSelect.value = typeof draft.type === "string" && getTypes().some((t) => t.key === draft.type) ? draft.type : item.type;
    statusSelect.value = isStatus(draft.status) ? draft.status : item.status;
    noteInput.value = text(draft.note, item.note);
    genresInput.value = text(draft.genres, (item.genres || []).join(", "));
    updateDateField();
    dateInput.value = text(draft.date, dateInput.value);
    dateEdited = !!draft.dateEdited;
  }
  const snapshot = () => ({ title: titleInput.value, type: typeSelect.value, status: statusSelect.value, note: noteInput.value, genres: genresInput.value, date: dateInput.value, dateEdited });
  for (const input of [titleInput, typeSelect, statusSelect, noteInput, genresInput, dateInput]) {
    input.addEventListener("input", () => writeDraft(key, snapshot()));
    input.addEventListener("change", () => writeDraft(key, snapshot()));
  }

  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  const deleteBtn = el("button", { type: "button", class: "btn btn-danger", text: "Удалить" });

  saveBtn.addEventListener("click", () => {
    const t = titleInput.value.trim();
    if (!t) { showToast("Название не может быть пустым"); return; }
    if (!dateField.hidden && !dateInput.checkValidity()) { dateInput.reportValidity(); return; }
    const savedDraft = snapshot();
    writeDraft(key, savedDraft);
    commitEdit(item.id, {
      title: t,
      type: typeSelect.value,
      status: isStatus(statusSelect.value) ? statusSelect.value : item.status,
      note: noteInput.value.trim(),
      genres: genresInput.value.split(","),
      finishedAt: dateInput.value || null,
      dateEdited
    });
    clearDraftAfterSave(key, savedDraft);
  });
  cancelBtn.addEventListener("click", () => { state.editingId = null; render(); });
  deleteBtn.addEventListener("click", () => {
    if (confirm(`Удалить «${item.title}»?`)) deleteItem(item.id);
  });

  return el("div", { class: "editor" },
    el("div", { class: "editor-grid" }, titleInput, typeSelect, statusSelect, noteInput, genresField, dateField),
    el("div", { class: "editor-actions" }, saveBtn, cancelBtn, deleteBtn)
  );
}
