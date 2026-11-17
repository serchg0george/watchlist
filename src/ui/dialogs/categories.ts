import { deleteCategory, updateCategory, updateCategoryColor } from "../../actions.js";
import { PALETTE_PRESETS } from "../../config.js";
import { getTypes, state } from "../../state/store.js";
import { byId, el } from "../dom.js";

// ===== Categories dialog =====

let selectedCategoryKey: string | null = null;

function renderPaletteSwatches(): void {
  const container = document.getElementById("palette-swatches");
  if (!container) return;
  container.textContent = "";
  PALETTE_PRESETS.forEach((hex) => {
    const btn = el("button", {
      type: "button",
      class: "palette-swatch-btn",
      style: `background-color: ${hex}`,
      title: hex,
      "aria-label": `Оттенок ${hex}`
    });
    btn.addEventListener("click", () => {
      if (selectedCategoryKey) {
        updateCategoryColor(selectedCategoryKey, hex);
        renderCategoriesDialog();
      }
      const newColorInput = document.getElementById("new-category-color") as HTMLInputElement | null;
      if (newColorInput) newColorInput.value = hex;
    });
    container.append(btn);
  });
}

export function openCategories(): void {
  const dlg = byId<HTMLDialogElement>("categories-dialog");
  renderCategoriesDialog();
  dlg.showModal();
}

export function renderCategoriesDialog(): void {
  const list = document.getElementById("categories-list");
  if (!list) return;
  list.textContent = "";
  const types = getTypes();
  const canEdit = !!state.token;

  const hint = document.getElementById("categories-auth-hint");
  if (hint) hint.hidden = canEdit;

  const addForm = document.getElementById("add-category-form");
  if (addForm) addForm.hidden = !canEdit;

  const paletteBox = document.getElementById("palette-presets-box");
  if (paletteBox) paletteBox.hidden = !canEdit;

  renderPaletteSwatches();

  types.forEach((t) => {
    const count = state.data ? state.data.items.filter((i) => i.type === t.key).length : 0;

    const colorInput = el("input", {
      type: "color",
      class: "category-color-input",
      value: t.color || "#5b6b53",
      title: "Выбрать цвет из палитры",
      "aria-label": `Цвет категории ${t.label}`,
      disabled: !canEdit
    });

    colorInput.addEventListener("focus", () => { selectedCategoryKey = t.key; });
    colorInput.addEventListener("change", () => {
      selectedCategoryKey = t.key;
      updateCategoryColor(t.key, colorInput.value);
      renderCategoriesDialog();
    });

    const input = el("input", {
      type: "text",
      class: "category-name-input",
      value: t.label,
      "aria-label": `Название категории ${t.label}`,
      disabled: !canEdit
    });

    input.addEventListener("focus", () => { selectedCategoryKey = t.key; });

    const saveBtn = el("button", {
      type: "button",
      class: "icon-btn category-save-btn",
      text: "✓",
      title: "Сохранить название",
      "aria-label": "Сохранить название",
      disabled: true
    });

    const handleSave = (): void => {
      const val = input.value.trim();
      if (val && val !== t.label) {
        updateCategory(t.key, val);
        renderCategoriesDialog();
      } else {
        input.value = t.label;
        saveBtn.disabled = true;
      }
    };

    input.addEventListener("input", () => {
      saveBtn.disabled = !canEdit || input.value.trim() === t.label || !input.value.trim();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        input.value = t.label;
        saveBtn.disabled = true;
      }
    });

    saveBtn.addEventListener("click", handleSave);

    const countSpan = el("span", { class: "category-count", text: `${count}` });

    const delBtn = el("button", {
      type: "button",
      class: "icon-btn category-del-btn",
      text: "✕",
      title: "Удалить категорию",
      "aria-label": `Удалить категорию ${t.label}`,
      disabled: !canEdit || types.length <= 1
    });
    delBtn.addEventListener("click", () => {
      deleteCategory(t.key);
      renderCategoriesDialog();
    });

    const row = el("div", { class: "category-row" }, colorInput, input, saveBtn, countSpan, delBtn);
    list.append(row);
  });
}

export function updateTypeSelects(): void {
  const types = getTypes();

  const typeSel = document.getElementById("type-filter") as HTMLSelectElement | null;
  if (typeSel) {
    const curVal = state.typeFilter;
    typeSel.textContent = "";
    typeSel.append(el("option", { value: "all", text: "Все типы" }));
    types.forEach((t) => typeSel.append(el("option", { value: t.key, text: t.label })));
    typeSel.append(el("option", { value: "__manage__", text: "⚙ Настроить категории…" }));
    if (curVal === "all" || types.some((t) => t.key === curVal)) {
      typeSel.value = curVal;
    } else {
      state.typeFilter = "all";
      typeSel.value = "all";
    }
  }

  const addType = document.getElementById("add-type") as HTMLSelectElement | null;
  if (addType) {
    const curVal = addType.value;
    addType.textContent = "";
    types.forEach((t) => addType.append(el("option", { value: t.key, text: t.label })));
    const firstType = types[0];
    if (types.some((t) => t.key === curVal)) {
      addType.value = curVal;
    } else if (firstType) {
      addType.value = firstType.key;
    }
  }
}
