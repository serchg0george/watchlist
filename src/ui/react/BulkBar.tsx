import { bulkDelete, bulkSetStatus, bulkSetType } from "../../actions.js";
import { STATUSES, STATUS_LABELS } from "../../config.js";
import { isStatus } from "../../domain/guards.js";
import { getTypes, render, selectedIds, state, visibleIds } from "../../state/store.js";

// Bottom bar with bulk actions for the current selection.
export function BulkBar() {
  if (!state.selecting) return <div id="bulk-bar" className="bulk-bar" hidden />;
  // Prune ids that no longer exist in the data.
  const existing = new Set(state.data?.items.map((it) => it.id));
  for (const id of [...selectedIds]) if (!existing.has(id)) selectedIds.delete(id);
  const n = selectedIds.size;
  // Selects every visible item, or clears the selection when all visible are already in it.
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  return (
    <div id="bulk-bar" className="bulk-bar">
      <span className="bulk-count">{`Выбрано: ${n}`}</span>
      <button type="button" className="btn" onClick={() => {
        if (allVisibleSelected) selectedIds.clear(); else for (const id of visibleIds) selectedIds.add(id);
        render();
      }}>{allVisibleSelected ? "Снять выбор" : "Все видимые"}</button>
      <select className="bulk-status" aria-label="Статус" value="" disabled={n === 0} onChange={(e) => { if (isStatus(e.target.value)) bulkSetStatus([...selectedIds], e.target.value); }}>
        <option value="" disabled>Статус…</option>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
      <select className="bulk-type" aria-label="Категория" value="" disabled={n === 0} onChange={(e) => { if (e.target.value) bulkSetType([...selectedIds], e.target.value); }}>
        <option value="">Категория…</option>
        {getTypes().map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <button type="button" className="btn bulk-delete" disabled={n === 0} onClick={() => bulkDelete([...selectedIds])}>Удалить</button>
      <button type="button" className="btn" onClick={() => { state.selecting = false; selectedIds.clear(); render(); }}>Готово</button>
    </div>
  );
}
