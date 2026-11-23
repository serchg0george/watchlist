import { render as rtlRender } from "@testing-library/react";
import type { ReactNode } from "react";
import { normalize } from "../../src/domain/normalize.js";
import { collapsedCards, expandedOverviews, openComments, selectedIds, state } from "../../src/state/store.js";
import { useWatchlist } from "../../src/ui/react/useWatchlist.js";

// Re-renders children on every store render(), like App does.
function Live({ children }: { children: () => ReactNode }) {
  useWatchlist();
  return <>{children()}</>;
}

export function renderLive(children: () => ReactNode) {
  return rtlRender(<Live>{children}</Live>);
}

/** Resets the shared store to a loaded, read-only state with the given raw items. */
export function seed(items: Record<string, unknown>[], extra: Partial<typeof state> = {}): void {
  state.data = normalize({ items });
  Object.assign(state, { loading: false, error: null, token: "", login: "", person: "", tab: "list", statusFilter: "all", typeFilter: "all", search: "", sort: "added-desc", finishedSort: "watched-desc", selecting: false, editingId: null, commentingId: null, replyDraft: null, editingReplyId: null, highlightId: null }, extra);
  for (const set of [collapsedCards, expandedOverviews, selectedIds]) set.clear();
  openComments.clear();
}
