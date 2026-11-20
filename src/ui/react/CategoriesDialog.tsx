import { useRef, useState } from "react";
import { addCategory, deleteCategory, updateCategory, updateCategoryColor } from "../../actions.js";
import { PALETTE_PRESETS } from "../../config.js";
import type { CategoryType } from "../../domain/types.js";
import { getTypes, state } from "../../state/store.js";
import { registerDialog } from "./dialogs.js";

interface RowProps { type: CategoryType; count: number; canEdit: boolean; canDelete: boolean; onSelect: () => void }

// Keyed by key + label, so a saved rename resets the local draft.
function CategoryRow({ type, count, canEdit, canDelete, onSelect }: RowProps) {
  const [name, setName] = useState(type.label);
  const changed = name.trim() !== "" && name.trim() !== type.label;
  const save = (): void => {
    const value = name.trim();
    if (value && value !== type.label) updateCategory(type.key, value);
    else setName(type.label);
  };
  return (
    <div className="category-row">
      <input type="color" className="category-color-input" value={type.color || "#5b6b53"} title="Выбрать цвет из палитры" aria-label={`Цвет категории ${type.label}`} disabled={!canEdit}
        onFocus={onSelect} onChange={(e) => { onSelect(); updateCategoryColor(type.key, e.target.value); }} />
      <input type="text" className="category-name-input" value={name} aria-label={`Название категории ${type.label}`} disabled={!canEdit}
        onFocus={onSelect} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          else if (e.key === "Escape") setName(type.label);
        }} />
      <button type="button" className="icon-btn category-save-btn" title="Сохранить название" aria-label="Сохранить название" disabled={!canEdit || !changed} onClick={save}>✓</button>
      <span className="category-count">{count}</span>
      <button type="button" className="icon-btn category-del-btn" title="Удалить категорию" aria-label={`Удалить категорию ${type.label}`} disabled={!canEdit || !canDelete} onClick={() => deleteCategory(type.key)}>✕</button>
    </div>
  );
}

export function CategoriesDialog() {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const selectedKey = useRef<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#e05638");
  const types = getTypes();
  const canEdit = !!state.token;
  const close = (): void => dialog.current?.close();

  return (
    <dialog id="categories-dialog" ref={(node) => { dialog.current = node; registerDialog("categories", node); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <h2>Категории</h2>
      <p className="dialog-desc">Редактируйте категории и цвета из палитры или добавляйте новые.</p>
      <div id="categories-auth-hint" className="settings-text dialog-hint" hidden={canEdit}>Войдите через ⚙, чтобы редактировать категории.</div>
      <div id="categories-list" className="categories-list">
        {types.map((t) => (
          <CategoryRow key={`${t.key}:${t.label}`} type={t} canEdit={canEdit} canDelete={types.length > 1}
            count={state.data ? state.data.items.filter((i) => i.type === t.key).length : 0}
            onSelect={() => { selectedKey.current = t.key; }} />
        ))}
      </div>
      <div id="palette-presets-box" className="palette-presets-box" hidden={!canEdit}>
        <div className="palette-title">Быстрые оттенки (нажмите на кружок или на значок цвета):</div>
        <div id="palette-swatches" className="palette-swatches">
          {PALETTE_PRESETS.map((hex) => (
            <button key={hex} type="button" className="palette-swatch-btn" style={{ backgroundColor: hex }} title={hex} aria-label={`Оттенок ${hex}`}
              onClick={() => { if (selectedKey.current) updateCategoryColor(selectedKey.current, hex); setNewColor(hex); }} />
          ))}
        </div>
      </div>
      <form id="add-category-form" className="add-category-form" hidden={!canEdit} onSubmit={(e) => {
        e.preventDefault();
        const value = newName.trim();
        if (!value) return;
        addCategory(value, newColor);
        setNewName("");
        setNewColor(PALETTE_PRESETS[getTypes().length % PALETTE_PRESETS.length] ?? newColor);
      }}>
        <input id="new-category-color" type="color" value={newColor} className="category-color-input" title="Выбрать цвет из палитры" aria-label="Цвет новой категории" onChange={(e) => setNewColor(e.target.value)} />
        <input id="new-category-input" type="text" placeholder="Новая категория…" autoComplete="off" required value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="btn btn-primary">Добавить</button>
      </form>
      <div className="dialog-actions">
        <button type="button" id="close-categories-btn" className="btn" onClick={close}>Закрыть</button>
      </div>
    </dialog>
  );
}
