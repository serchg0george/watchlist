import { useRef, useState } from "react";
import { commitEdit, deleteItem } from "../../actions.js";
import { STATUS_LABELS } from "../../config.js";
import { todayStr } from "../../domain/dates.js";
import { isStatus } from "../../domain/guards.js";
import type { Item } from "../../domain/types.js";
import { clearDraftAfterSave, draftKey, readDraft, writeDraft } from "../../state/saving.js";
import { getTypes, render, state } from "../../state/store.js";
import { showToast } from "../../state/toast.js";

interface Fields { title: string; type: string; status: string; note: string; genres: string; date: string; dateEdited: boolean }

const dateKeyFor = (status: string): "watchedAt" | "droppedAt" | null => status === "watched" ? "watchedAt" : status === "dropped" ? "droppedAt" : null;
// At status change the date resets to today (new status) or the stored date (back to the original status).
const defaultDate = (item: Item, status: string): string => {
  const key = dateKeyFor(status);
  return key ? (status !== item.status ? todayStr() : item[key] || "") : "";
};

function initialFields(item: Item, key: string): Fields {
  const types = getTypes();
  const type = types.some((t) => t.key === item.type) ? item.type : types[0]?.key ?? item.type;
  const base: Fields = { title: item.title, type, status: item.status, note: item.note || "", genres: (item.genres || []).join(", "), date: defaultDate(item, item.status), dateEdited: false };
  const draft = readDraft(key);
  if (!draft) return base;
  const text = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
  const status = isStatus(draft.status) ? draft.status : item.status;
  return {
    title: text(draft.title, item.title),
    type: typeof draft.type === "string" && types.some((t) => t.key === draft.type) ? draft.type : type,
    status,
    note: text(draft.note, item.note),
    genres: text(draft.genres, base.genres),
    date: text(draft.date, defaultDate(item, status)),
    dateEdited: !!draft.dateEdited
  };
}

export function Editor({ item }: { item: Item }) {
  const key = draftKey("item", item.id);
  const [fields, setFields] = useState(() => initialFields(item, key));
  const dateInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Fields>): void => {
    const next = { ...fields, ...patch };
    setFields(next);
    writeDraft(key, next);
  };
  const dateKey = dateKeyFor(fields.status);
  const dateLabel = fields.status === "dropped" ? "Дата отказа от просмотра" : "Дата просмотра";

  const save = (): void => {
    const title = fields.title.trim();
    if (!title) { showToast("Название не может быть пустым"); return; }
    if (dateKey && dateInput.current && !dateInput.current.checkValidity()) { dateInput.current.reportValidity(); return; }
    writeDraft(key, fields);
    commitEdit(item.id, {
      title,
      type: fields.type,
      status: isStatus(fields.status) ? fields.status : item.status,
      note: fields.note.trim(),
      genres: fields.genres.split(","),
      finishedAt: fields.date || null,
      dateEdited: fields.dateEdited
    });
    clearDraftAfterSave(key, fields);
  };

  return (
    <div className="editor">
      <div className="editor-grid">
        <input type="text" className="edit-title" aria-label="Название" value={fields.title} onChange={(e) => update({ title: e.target.value })} />
        <select className="edit-type" aria-label="Тип" value={fields.type} onChange={(e) => update({ type: e.target.value })}>
          {getTypes().map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="edit-status" aria-label="Статус" value={fields.status} onChange={(e) => update({ status: e.target.value, date: defaultDate(item, e.target.value), dateEdited: false })}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="text" className="edit-note" placeholder="Заметка" aria-label="Заметка" value={fields.note} onChange={(e) => update({ note: e.target.value })} />
        <label className="edit-genres">
          <span>Жанры через запятую</span>
          <input type="text" placeholder="Например: комедия, драма" aria-label="Жанры через запятую" value={fields.genres} onChange={(e) => update({ genres: e.target.value })} />
        </label>
        <label className="edit-date-field" hidden={!dateKey}>
          <span>{dateLabel}</span>
          <input ref={dateInput} type="date" className="edit-date" aria-label={dateLabel} value={fields.date} onChange={(e) => update({ date: e.target.value, dateEdited: true })} />
          <small>При смене статуса дата ставится автоматически. Можно исправить вручную.</small>
        </label>
      </div>
      <div className="editor-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
        <button type="button" className="btn" onClick={() => { state.editingId = null; render(); }}>Отмена</button>
        <button type="button" className="btn btn-danger" onClick={() => { if (confirm(`Удалить «${item.title}»?`)) deleteItem(item.id); }}>Удалить</button>
      </div>
    </div>
  );
}
