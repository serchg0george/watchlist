import { pickRandom } from "../../actions.js";
import { CHIPS, SORTS, getTypes, render, selectedIds, state } from "../../state/store.js";
import { openCategories } from "./dialogs.js";
import { ItemRow } from "./ItemRow.js";
import type { ListView } from "./listView.js";

// The add form's inner nodes are driven by tmdb.ts (it binds to these ids once and fills results/preview itself),
// so they stay mounted and React never renders children into #tmdb-results / #tmdb-preview.
function AddForm({ hidden }: { hidden: boolean }) {
  return (
    <form id="add-form" className="add-form" hidden={hidden}>
      <label htmlFor="add-title">Добавить в список</label>
      <div className="add-query-row">
        <input id="add-title" type="text" placeholder="Название или ссылка TMDB / IMDb" aria-label="Название или ссылка" autoComplete="off" enterKeyHint="search" required />
        <button id="tmdb-search-btn" type="submit" className="btn btn-primary">Найти</button>
      </div>
      <div className="add-manual-row">
        <select id="add-type" aria-label="Тип добавляемого">
          {getTypes().map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button id="manual-add-btn" type="button" className="btn">Добавить вручную</button>
        <button id="add-clear-btn" type="button" className="btn">Очистить черновик</button>
      </div>
      <p id="tmdb-status" className="add-hint" role="status" aria-live="polite"></p>
      <div id="tmdb-results" className="tmdb-results" aria-label="Результаты поиска"></div>
      <div id="tmdb-preview" className="tmdb-preview" hidden></div>
    </form>
  );
}

function Filters({ counts }: { counts: Record<string, number> | null }) {
  const isList = state.tab === "list";
  const types = getTypes();
  const typeValue = state.typeFilter === "all" || types.some((t) => t.key === state.typeFilter) ? state.typeFilter : "all";
  return (
    <div className="filters">
      <div id="chips" className="chips" role="group" aria-label="Фильтр по статусу" hidden={!isList}>
        {CHIPS.map((c) => (
          <button key={c.key} type="button" className={`chip${state.statusFilter === c.key ? " active" : ""}`} data-key={c.key} onClick={() => { state.statusFilter = c.key; render(); }}>
            {c.label}<span className="count">{counts ? String(counts[c.key]) : ""}</span>
          </button>
        ))}
      </div>
      <div className="filter-row">
        <select id="type-filter" aria-label="Тип" value={typeValue} onChange={(e) => {
          if (e.target.value === "__manage__") { openCategories(); return; }
          state.typeFilter = e.target.value;
          render();
        }}>
          <option value="all">Все типы</option>
          {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          <option value="__manage__">⚙ Настроить категории…</option>
        </select>
        <input id="search" type="search" placeholder="Поиск…" autoComplete="off" value={state.search} onChange={(e) => { state.search = e.target.value; render(); }} />
        <select id="sort" aria-label="Сортировка" value={state.sort} onChange={(e) => { state.sort = SORTS.find((s) => s.key === e.target.value)?.key ?? state.sort; render(); }}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <button id="random-btn" type="button" className="btn random-btn" hidden={!isList} onClick={pickRandom}>🎲 Что посмотреть сегодня?</button>
      <button id="select-btn" type="button" className="btn select-btn" hidden={!state.token} onClick={() => {
        state.selecting = !state.selecting;
        if (!state.selecting) selectedIds.clear();
        render();
      }}>{state.selecting ? "Готово" : "☑ Выбрать"}</button>
      <button type="button" className="btn" onClick={() => { state.statusFilter = "all"; state.typeFilter = "all"; state.search = ""; render(); }}>Сбросить фильтры</button>
    </div>
  );
}

export function ListTab({ view, hidden }: { view: ListView; hidden: boolean }) {
  const { content } = view;
  let items;
  if (content.kind === "loading") items = <div className="state-msg">Загрузка…</div>;
  else if (content.kind === "error") items = <div className="state-msg error">{content.message}</div>;
  else if (content.kind === "empty") items = <div className="state-msg">Список пуст</div>;
  else {
    items = (
      <div className="item-list">
        {content.items.length === 0 ? <div className="state-msg">Ничего не найдено</div> : content.items.map((it) => <ItemRow key={it.id} item={it} />)}
      </div>
    );
  }
  return (
    <section id="list-tab" className="tab-panel" hidden={hidden}>
      <AddForm hidden={!state.token || state.tab !== "list"} />
      <Filters counts={view.counts} />
      <div id="items" className="items">{items}</div>
    </section>
  );
}
