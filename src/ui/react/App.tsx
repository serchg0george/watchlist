import { useEffect } from "react";
import { afterRender, isListTab, render, selectedIds, visibleIds } from "../../state/store.js";
import type { Tab } from "../../state/store.js";
import { BulkBar } from "./BulkBar.js";
import { CategoriesDialog } from "./CategoriesDialog.js";
import { Header, Tabs } from "./Header.js";
import { ListTab } from "./ListTab.js";
import { computeListView } from "./listView.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { Stats } from "./Stats.js";
import { Toast } from "./Toast.js";
import { useWatchlist } from "./useWatchlist.js";

// Scroll position per tab, so switching tabs returns to where the user was.
const tabScroll: Record<Tab, number> = { list: 0, watched: 0, dropped: 0, stats: 0 };

export function App() {
  const state = useWatchlist();
  const isList = isListTab(state.tab);
  // Losing the token or leaving the list ends selection mode.
  if (!state.token || !isList) { state.selecting = false; selectedIds.clear(); }
  const view = computeListView();
  visibleIds.length = 0;
  if (view.content.kind === "items") for (const it of view.content.items) visibleIds.push(it.id);

  useEffect(() => { document.body.classList.toggle("selecting", state.selecting); });

  const selectTab = (tab: Tab): void => {
    tabScroll[state.tab] = window.scrollY;
    state.tab = tab;
    render();
    afterRender(() => window.scrollTo(0, tabScroll[tab] || 0));
  };

  return (
    <>
      <Header />
      <Tabs counts={view.counts} onSelect={selectTab} />
      <main id="content" className="wrap">
        <ListTab view={view} hidden={!isList} />
        <Stats hidden={state.tab !== "stats"} />
      </main>
      <button id="mobile-add-btn" type="button" className="btn btn-primary mobile-add-btn" hidden={!state.token || state.tab !== "list"}>＋ Добавить</button>
      <SettingsDialog />
      <CategoriesDialog />
      <BulkBar />
      <Toast />
    </>
  );
}
