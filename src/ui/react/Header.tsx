import { saveIndicator, saves } from "../../state/saving.js";
import { isListTab, state } from "../../state/store.js";
import type { Tab } from "../../state/store.js";
import { openCategories, openSettings } from "./dialogs.js";

function SaveIndicator() {
  let text = "", classes = "save-indicator";
  if (saves.error) { text = `Не сохранено: ${saves.size}. Не закрывайте страницу.`; classes += " visible save-error"; }
  else if (saves.size > 0) { text = `Сохраняется: ${saves.size}…`; classes += " visible busy"; }
  else if (saveIndicator.touched) { text = "Сохранено"; if (saveIndicator.visible) classes += " visible"; }
  return (
    <>
      <span id="save-indicator" className={classes} role="status">{text}</span>
      <button id="retry-save-btn" type="button" className="btn retry-save-btn" hidden={!saves.error} disabled={saves.running} onClick={() => saves.retry()}>Повторить сохранение</button>
    </>
  );
}

function OfflineBadge() {
  if (!state.offline || !state.offlineSince) return <span id="offline-badge" className="offline-badge" hidden />;
  const date = new Date(state.offlineSince).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <span id="offline-badge" className="offline-badge">{`Офлайн · данные от ${date}`}</span>;
}

export function Header() {
  return (
    <header className="app-header">
      <div className="wrap header-inner">
        <div className="header-left">
          <h1>Что посмотреть</h1>
          <div id="auth-status" className="auth-status">
            {state.token && state.login ? `Редактирует: ${state.login}${state.person ? ` (${state.person})` : ""}` : "Только просмотр"}
          </div>
        </div>
        <div className="header-right">
          <SaveIndicator />
          <OfflineBadge />
          <button id="categories-btn" type="button" className="btn header-btn categories-btn" onClick={openCategories}>Категории</button>
          <button id="settings-btn" type="button" className="icon-btn settings-btn" aria-label="Настройки" title="Настройки" onClick={openSettings}>⚙</button>
        </div>
      </div>
    </header>
  );
}

const TABS: { key: Tab; label: string; counted: boolean }[] = [
  { key: "list", label: "Список", counted: false },
  { key: "watched", label: "Просмотрено", counted: true },
  { key: "dropped", label: "Брошено", counted: true },
  { key: "stats", label: "Статистика", counted: false }
];

export function Tabs({ counts, onSelect }: { counts: Record<string, number> | null; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="tabs">
      <div className="wrap tabs-inner">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab-btn${state.tab === t.key ? " active" : ""}`} data-tab={t.key} onClick={() => { if (t.key === "stats" || isListTab(t.key)) onSelect(t.key); }}>
            {t.label}{t.counted && <span className="count">{counts ? String(counts[t.key]) : ""}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
