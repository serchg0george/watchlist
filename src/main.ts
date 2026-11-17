/* Watchlist: personal film/series tracker.
 * Strict TypeScript compiled by tsc to native ES modules, no libraries.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

import { addCategory, addItem, addReply, closeEditors, commitEdit, deleteCategory, deleteItem, deleteReply, editReply, pickRandom, rateItem, reactToComment, setComment, toggleWatched, updateCategory, updateCategoryColor } from "./actions.js";
import { LS_LOGIN, LS_PERSON, LS_TOKEN, PALETTE_PRESETS, PEOPLE, REACTION_KINDS, STATUS_LABELS, personFor } from "./config.js";
import { apiHeaders, friendlyError, httpError } from "./data/github.js";
import { todayStr } from "./domain/dates.js";
import { asRecord, isPerson, isStatus } from "./domain/guards.js";
import { avgRating } from "./domain/items.js";
import type { Item, Person, Reply, Status } from "./domain/types.js";
import { clearDraftAfterSave, draftKey, loadAll, markCatalogSave, readDraft, restorePendingSaves, saves, writeDraft } from "./state/saving.js";
import { CHIPS, SORTS, getTypes, getTypeColor, getTypeLabel, isListTab, openItems, readLocal, render, setRenderer, state, writeLocal } from "./state/store.js";
import type { SortKey, Tab } from "./state/store.js";
import { WatchlistTMDB } from "./tmdb.js";
import { byId, el } from "./ui/dom.js";
import { renderStats } from "./ui/stats.js";
import { showToast } from "./ui/toast.js";

// ===== Rendering =====

function renderAll(): void {
  renderHeader();
  updateTypeSelects();
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const isList = isListTab(state.tab);
  byId("list-tab").hidden = !isList;
  byId("stats-tab").hidden = state.tab !== "stats";
  byId("add-form").hidden = !state.token || state.tab !== "list";
  byId("mobile-add-btn").hidden = !state.token || state.tab !== "list";
  byId("chips").hidden = state.tab !== "list";
  byId("random-btn").hidden = state.tab !== "list";
  if (isList) renderList();
  else renderStats();
}

function renderHeader(): void {
  const line = byId("auth-status");
  line.textContent = state.token && state.login
    ? `Редактирует: ${state.login}${state.person ? ` (${state.person})` : ""}`
    : "Только просмотр";
}

function sortItems(items: Item[], key: SortKey): Item[] {
  const arr = items.slice();
  switch (key) {
    case "watched-desc":
      arr.sort((a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || "") || b.addedAt.localeCompare(a.addedAt));
      break;
    case "rating-desc":
      arr.sort((a, b) => (avgRating(b) ?? -1) - (avgRating(a) ?? -1) || a.title.localeCompare(b.title, "ru"));
      break;
    case "title-asc":
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      break;
    case "added-desc":
    default:
      // Stable sort: same-day items keep file order (new items are prepended).
      arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  return arr;
}

function updateChips(base: Item[]): void {
  const counts: Record<string, number> = { all: 0, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { counts[it.status] = (counts[it.status] ?? 0) + 1; });
  counts.all = counts.planned ?? 0;
  document.querySelectorAll<HTMLElement>("#chips .chip").forEach((chip) => {
    const key = chip.dataset.key ?? "";
    const count = chip.querySelector(".count");
    if (count) count.textContent = String(counts[key]);
    chip.classList.toggle("active", state.statusFilter === key);
  });
  document.querySelectorAll<HTMLElement>(".tab-btn .count").forEach((span) => {
    span.textContent = String(counts[span.parentElement?.dataset.tab ?? ""]);
  });
}

function buildCommentEditor(person: Person | "", text: string, save: (text: string) => void, label: string): HTMLElement {
  const identity = state.editingReplyId ? `edit-${state.editingReplyId}` : state.replyDraft ? `reply-${state.replyDraft.itemId}-${state.replyDraft.to}` : `comment-${state.commentingId}-${person}`;
  const key = draftKey("comment", identity);
  const ta = el("textarea", { class: "comment-input", rows: 2, placeholder: label, "aria-label": label });
  const draftText = readDraft(key)?.text;
  ta.value = typeof draftText === "string" ? draftText : text;
  ta.addEventListener("input", () => writeDraft(key, { text: ta.value }));
  const submit = () => {
    const snapshot = { text: ta.value };
    writeDraft(key, snapshot);
    save(ta.value.trim());
    clearDraftAfterSave(key, snapshot);
  };
  const cancel = () => { closeEditors(); render(); };
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", cancel);
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  const editor = el("div", { class: `comment-line person-${person.toLowerCase()} mine` },
    el("span", { class: "person-tag", text: person }), ta,
    el("div", { class: "comment-actions" }, saveBtn, cancelBtn));
  setTimeout(() => { if (ta.isConnected) ta.focus(); }, 0);
  return editor;
}

function buildCommentActions(item: Item, target: string, author: Person, canEdit: boolean, isReply: boolean): HTMLElement {
  const actions = el("div", { class: "comment-controls" });
  const reactions = el("div", { class: "reaction-options", role: "group", "aria-label": "Реакции" });
  const links = el("div", { class: "comment-links" });
  const mine = canEdit && state.person === author;
  const map = item.reactions[target] || {};
  for (const kind of REACTION_KINDS) {
    const count = PEOPLE.filter((p) => map[p]?.includes(kind.key)).length;
    const active = canEdit && isPerson(state.person) && map[state.person]?.includes(kind.key);
    const btn = el("button", {
      type: "button",
      class: `reaction-pill${active ? ` person-${state.person.toLowerCase()}` : ""}`,
      disabled: !canEdit || mine,
      title: mine ? "Нельзя реагировать на свой комментарий" : canEdit ? kind.label : "Войдите, чтобы реагировать",
      "aria-label": `${kind.label}: ${count}`,
      "aria-pressed": String(!!active)
    }, el("span", { class: "reaction-emoji", text: kind.emoji, "aria-hidden": "true" }),
    count ? el("span", { class: "reaction-count", text: count, "aria-hidden": "true" }) : null);
    btn.addEventListener("click", () => reactToComment(item.id, target, kind.key));
    reactions.append(btn);
  }
  if (canEdit) {
    const replyBtn = el("button", { type: "button", class: "comment-action", text: "Ответить" });
    replyBtn.addEventListener("click", () => {
      closeEditors();
      state.replyDraft = { itemId: item.id, to: target };
      render();
    });
    links.append(replyBtn);
  }
  if (isReply && mine) {
    const editBtn = el("button", { type: "button", class: "comment-action", text: "Изменить" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingReplyId = target; render(); });
    const deleteBtn = el("button", { type: "button", class: "comment-action", text: "Удалить" });
    deleteBtn.addEventListener("click", () => deleteReply(item.id, target));
    links.append(editBtn, deleteBtn);
  }
  actions.append(reactions);
  if (links.children.length) actions.append(links);
  return actions;
}

function replyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildComments(item: Item, canEdit: boolean): HTMLElement {
  const comments = el("div", { class: "comments" });
  const sorted = item.replies.slice().sort((a, b) => a.at.localeCompare(b.at));
  const children = new Map<string, Reply[]>();
  const ids = new Set(item.replies.map((r) => r.id));
  for (const reply of sorted) {
    const list = children.get(reply.to) ?? [];
    list.push(reply);
    children.set(reply.to, list);
  }
  const appendDraft = (node: HTMLElement, target: string): void => {
    if (canEdit && state.replyDraft?.itemId === item.id && state.replyDraft.to === target) {
      node.append(buildCommentEditor(state.person, "", (text) => addReply(item.id, target, text), "Ваш ответ…"));
    }
  };
  // Flatten the tree so the visual indent can stop growing after level three.
  // Track reply objects to render malformed cycles/duplicate ids without looping or losing text.
  const visited = new Set<Reply>();
  const appendReplies = (replies: Reply[], depth: number): void => {
    const stack = replies.slice().reverse().map((reply) => ({ reply, depth }));
    for (let next = stack.pop(); next; next = stack.pop()) {
      const { reply, depth } = next;
      if (visited.has(reply)) continue;
      visited.add(reply);
      const node = el("div", {
        class: "comment-node reply-node", style: `--reply-depth:${Math.min(depth, 3)}`, "data-reply-id": reply.id
      });
      const mine = canEdit && state.person === reply.by;
      if (mine && state.editingReplyId === reply.id) {
        node.append(buildCommentEditor(reply.by, reply.text,
          (text) => editReply(item.id, reply.id, text), "Ваш ответ…"));
      } else {
        node.append(el("div", { class: `comment-line person-${reply.by.toLowerCase()}` },
          el("span", { class: "person-tag", text: reply.by }),
          el("span", { class: "comment-text", text: reply.text }),
          el("span", { class: "reply-date", text: `${replyDate(reply.at)}${reply.editedAt ? " (изм.)" : ""}` })),
        buildCommentActions(item, reply.id, reply.by, canEdit, true));
      }
      appendDraft(node, reply.id);
      comments.append(node);
      const nested = children.get(reply.id) || [];
      for (const child of nested.slice().reverse()) stack.push({ reply: child, depth: depth + 1 });
    }
  };
  for (const p of PEOPLE) {
    const text = item.comments[p];
    const mine = canEdit && state.person === p;
    const rootReplies = children.get(p) || [];
    const node = el("div", { class: "comment-node" });
    if (mine && state.commentingId === item.id) {
      node.append(buildCommentEditor(p, text, (value) => setComment(item.id, p, value), `Комментарий ${p}`));
    } else {
      if (text || rootReplies.length) {
        const line = el("div", {
          class: `comment-line person-${p.toLowerCase()}${mine && text ? " mine" : ""}${!text ? " comment-deleted" : ""}`,
          role: mine && text ? "button" : null,
          tabindex: mine && text ? 0 : null,
          title: mine && text ? "Изменить комментарий" : null
        }, el("span", { class: "person-tag", text: p }),
        el("span", { class: "comment-text", text: text || "Комментарий удалён" }));
        if (mine && text) {
          const open = () => { closeEditors(); state.commentingId = item.id; render(); };
          line.addEventListener("click", open);
          line.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
        }
        node.append(line);
        if (text) node.append(buildCommentActions(item, p, p, canEdit, false));
      }
      if (!text && mine) {
        const addBtn = el("button", { type: "button", class: "comment-add", text: "💬 Комментарий" });
        addBtn.addEventListener("click", () => { closeEditors(); state.commentingId = item.id; render(); });
        node.append(addBtn);
      }
    }
    appendDraft(node, p);
    if (node.children.length) comments.append(node);
    appendReplies(rootReplies, 1);
  }
  // Orphans follow both roots. Cycles have no root, so start any remaining component here as well.
  appendReplies(sorted.filter((r) => !isPerson(r.to) && !ids.has(r.to)), 1);
  for (const reply of sorted) if (!visited.has(reply)) appendReplies([reply], 1);
  return comments;
}

function buildItemRow(item: Item): HTMLElement {
  if (state.editingId === item.id && state.token) return buildEditor(item);

  const isFinished = item.status === "watched" || item.status === "dropped";
  const canEdit = !!state.token;

  // Checkbox: checked for watched/dropped.
  const cb = el("input", { type: "checkbox", class: "item-check", "aria-label": `Просмотрено: ${item.title}` });
  cb.checked = isFinished;
  if (!canEdit) cb.disabled = true;
  cb.addEventListener("change", () => toggleWatched(item.id));

  const children: HTMLElement[] = [el("label", { class: "check-wrap" }, cb)];
  children.push(el("span", { class: "item-title", text: item.title }));
  const typeColor = getTypeColor(item.type);
  children.push(el("span", { class: "badge badge-type", style: `--cat-color: ${typeColor}`, text: getTypeLabel(item.type) }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }
  const details = el("details", { class: "item-details" }, el("summary", { text: "Подробности и обсуждение" }));
  details.open = openItems.has(item.id) || state.commentingId === item.id || state.replyDraft?.itemId === item.id || item.replies.some((r) => r.id === state.editingReplyId);
  details.addEventListener("toggle", () => { if (details.isConnected) { if (details.open) openItems.add(item.id); else openItems.delete(item.id); } });
  if (item.note) details.append(el("span", { class: "item-note", text: item.note }));
  if (item.genres?.length) details.append(el("span", { class: "item-genres", text: item.genres.join(" · ") }));
  if (item.tmdb && ["movie", "tv"].includes(item.tmdb.mediaType) && Number.isSafeInteger(item.tmdb.id) && item.tmdb.id > 0) {
    const meta = item.tmdb;
    children.push(el("span", { class: "item-meta", text: [meta.year, meta.runtime != null && meta.runtime > 0 ? `${meta.runtime} мин${meta.mediaType === "tv" ? " / серия" : ""}` : ""].filter(Boolean).join(" · ") }));
    const info = el("div", { class: "catalog-info" });
    if (typeof meta.posterPath === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(meta.posterPath)) {
      const image = el("img", { class: "catalog-poster", src: `https://image.tmdb.org/t/p/w185${meta.posterPath}`, alt: `Постер: ${item.title}`, loading: "lazy", width: 92, height: 138 });
      image.addEventListener("error", () => { image.hidden = true; });
      info.append(image);
    }
    info.append(el("div", { class: "catalog-description" }, el("p", { text: meta.overview || "Описание пока отсутствует." }),
      el("a", { class: "catalog-source", href: `https://www.themoviedb.org/${meta.mediaType}/${meta.id}`, target: "_blank", rel: "noopener noreferrer", text: "Открыть в TMDB" })));
    details.append(info);
  }
  const finishedAt = item.status === "dropped" ? item.droppedAt : item.status === "watched" ? item.watchedAt : null;
  if (finishedAt) children.push(el("span", { class: "item-date", text: `${item.status === "dropped" ? "Брошено" : "Просмотрено"}: ${finishedAt.split("-").reverse().join(".")}` }));

  // Each person rates only on their own line; the other line is read-only.
  if (isFinished) {
    const ratings = el("div", { class: "ratings" });
    for (const p of PEOPLE) {
      const value = item.ratings[p];
      const mine = canEdit && state.person === p;
      const line = el("div", { class: `rating-line person-${p.toLowerCase()}${mine ? " mine" : ""}` },
        el("span", { class: "person-tag", text: p }));
      const stars = el("span", { class: "stars" });
      for (let i = 1; i <= 10; i++) {
        const on = value != null && i <= value;
        if (mine) {
          const s = el("button", { type: "button", class: `star${on ? " on" : ""}`, text: on ? "★" : "☆", "aria-label": `${p}: ${i} из 10` });
          s.addEventListener("click", () => rateItem(item.id, p, i));
          stars.append(s);
        } else {
          stars.append(el("span", { class: `star static${on ? " on" : ""}`, text: on ? "★" : "☆" }));
        }
      }
      line.append(stars, el("span", { class: "rating-value", text: value != null ? String(value) : "—" }));
      ratings.append(line);
    }
    details.append(ratings);
  }

  const comments = buildComments(item, canEdit);
  if (comments.children.length > 0) details.append(comments);
  children.push(details);

  if (canEdit) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: `item-row${state.highlightId === item.id ? " highlight" : ""}`, "data-id": item.id }, ...children);
}

function buildEditor(item: Item): HTMLElement {
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

function buildSection(items: Item[]): HTMLElement {
  const list = el("div", { class: "item-list" });
  if (items.length === 0) list.append(el("div", { class: "state-msg", text: "Ничего не найдено" }));
  else items.forEach((it) => list.append(buildItemRow(it)));
  return list;
}

function renderList(): void {
  const box = byId("items");
  box.textContent = "";

  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  if (!state.data || state.data.items.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Список пуст" }));
    updateChips([]);
    return;
  }

  const q = state.search.trim().toLowerCase();
  // Base list respects type + search filters (not the status filter).
  const base = state.data.items.filter((it) => {
    if (state.typeFilter !== "all" && it.type !== state.typeFilter) return false;
    if (q && !(it.title.toLowerCase().includes(q) || String(it.tmdb?.originalTitle || "").toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)) || it.replies.some((r) => r.text.toLowerCase().includes(q)))) return false;
    return true;
  });

  updateChips(base);
  const sorted = sortItems(base, state.sort);

  const status: Status = state.tab === "watched" || state.tab === "dropped" ? state.tab : state.statusFilter === "watching" ? "watching" : "planned";
  box.append(buildSection(sorted.filter((it) => it.status === status)));
}

// ===== Settings dialog =====

function openSettings(): void {
  const dlg = byId<HTMLDialogElement>("settings-dialog");
  let branchStatus = document.getElementById("data-branch-status");
  if (!branchStatus) {
    branchStatus = el("p", { id: "data-branch-status", class: "settings-text", style: "color: var(--muted)" });
    dlg.querySelector("h2")?.after(branchStatus);
  }
  branchStatus.textContent = `Данные: ${state.dataBranch || "опубликованная версия GitHub Pages"}`;
  byId("settings-error").textContent = "";
  dlg.showModal();
}

async function saveToken(): Promise<void> {
  const input = byId<HTMLInputElement>("token-input");
  const errEl = byId("settings-error");
  const token = input.value.trim() || state.token;
  if (!token) { errEl.textContent = "Введите токен."; return; }
  errEl.textContent = "";
  try {
    // Verify the token and learn our login.
    const res = await fetch("https://api.github.com/user", { headers: apiHeaders(token), cache: "no-store" });
    if (!res.ok) throw httpError(`GitHub API: HTTP ${res.status}`, res.status);
    const user = asRecord(await res.json());
    const login = typeof user?.login === "string" ? user.login : "";
    if (!saves.rebind(token, login)) {
      errEl.textContent = "Сначала сохраните изменения текущего пользователя. Можно обновить его токен.";
      return;
    }
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_LOGIN, login);
    localStorage.removeItem(LS_PERSON); // legacy: person is now derived from the login
    state.token = token;
    state.login = login;
    state.person = personFor(state.login);
    saves.retry();
    input.value = "";
    byId<HTMLDialogElement>("settings-dialog").close();
    showToast(`Вход выполнен: ${state.login} (${state.person})`);
    void loadAll().then(restorePendingSaves); // from now on read fresh data via the API
  } catch (e) {
    console.error("token check failed", e);
    errEl.textContent = friendlyError(e);
  }
}

function logout(): void {
  if (saves.hasUnsaved()) { showToast("Сначала сохраните изменения — нажмите «Повторить сохранение»."); return; }
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_LOGIN);
  localStorage.removeItem(LS_PERSON);
  state.token = "";
  state.login = "";
  state.person = "";
  byId<HTMLDialogElement>("settings-dialog").close();
  showToast("Вы вышли. Режим: только просмотр.");
  void loadAll(); // back to the public copy of data/movies.json
}

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

function openCategories(): void {
  const dlg = byId<HTMLDialogElement>("categories-dialog");
  renderCategoriesDialog();
  dlg.showModal();
}

function renderCategoriesDialog(): void {
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

function updateTypeSelects(): void {
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

// ===== Init =====

function init(): void {
  setRenderer(renderAll);
  const savedScroll = asRecord(readLocal("watchlist.scroll")) ?? {};
  const tabScroll: Record<Tab, number> = { list: 0, watched: 0, dropped: 0, stats: 0 };
  window.addEventListener("beforeunload", (event) => {
    if (!saves.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  // Tabs.
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab !== "stats" && !isListTab(tab)) return;
      tabScroll[state.tab] = window.scrollY;
      state.tab = tab;
      render();
      window.scrollTo(0, tabScroll[state.tab] || 0);
    });
  });

  // Status chips (built once, counts updated on each list render).
  const chipsEl = byId("chips");
  CHIPS.forEach((c) => {
    const chip = el("button", { type: "button", class: "chip", "data-key": c.key }, c.label, el("span", { class: "count" }));
    chip.addEventListener("click", () => { state.statusFilter = c.key; render(); });
    chipsEl.append(chip);
  });

  // Type filter.
  const typeSel = byId<HTMLSelectElement>("type-filter");
  typeSel.addEventListener("change", () => {
    if (typeSel.value === "__manage__") {
      typeSel.value = state.typeFilter;
      openCategories();
      return;
    }
    state.typeFilter = typeSel.value;
    render();
  });

  // Search.
  const searchInput = byId<HTMLInputElement>("search");
  searchInput.addEventListener("input", () => { state.search = searchInput.value; render(); });

  // Sort.
  const sortSel = byId<HTMLSelectElement>("sort");
  const findSort = (value: unknown): SortKey | undefined => SORTS.find((s) => s.key === value)?.key;
  SORTS.forEach((s) => sortSel.append(el("option", { value: s.key, text: s.label })));
  sortSel.addEventListener("change", () => { state.sort = findSort(sortSel.value) ?? state.sort; render(); });

  updateTypeSelects();
  const initCatalog = (): void => WatchlistTMDB.init({
    getItems: () => state.data?.items || [], getTypes, canEdit: () => !!state.token && !state.loading && !state.error,
    add: async (title, type, metadata) => {
      const tmdb = metadata?.tmdb;
      if (tmdb && state.data?.items.some((it) => it.tmdb?.id === tmdb.id && it.tmdb?.mediaType === tmdb.mediaType)) {
        throw new Error("Этот тайтл уже есть в списке.");
      }
      if (!addItem(title, type, metadata)) return false;
      markCatalogSave();
      await saves.wait();
      return true;
    }
  });
  const view = asRecord(readLocal("watchlist.view")) ?? {};
  state.tab = view.tab === "stats" || isListTab(view.tab) ? view.tab : "list";
  if (state.tab === "list" && (view.statusFilter === "watched" || view.statusFilter === "dropped")) state.tab = view.statusFilter;
  state.statusFilter = CHIPS.find((c) => c.key === view.statusFilter)?.key ?? "all";
  state.typeFilter = typeof view.typeFilter === "string" ? view.typeFilter : "all";
  state.search = typeof view.search === "string" ? view.search : "";
  state.sort = findSort(view.sort) ?? "added-desc";
  searchInput.value = state.search;
  sortSel.value = state.sort;
  const clearFilters = el("button", { type: "button", class: "btn", text: "Сбросить фильтры" });
  clearFilters.addEventListener("click", () => { state.statusFilter = "all"; state.typeFilter = "all"; state.search = ""; searchInput.value = ""; render(); });
  document.querySelector(".filters")?.append(clearFilters);
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => writeLocal("watchlist.scroll", { tab: state.tab, y: window.scrollY }), 200); }, { passive: true });

  // Random pick.
  byId("random-btn").addEventListener("click", pickRandom);

  // Installable app / offline cache (needs http(s), not file://).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e: unknown) => console.warn("service worker registration failed", e));
  }

  // Settings dialog.
  byId("settings-btn").addEventListener("click", openSettings);
  byId("save-token-btn").addEventListener("click", () => { void saveToken(); });
  byId("logout-btn").addEventListener("click", logout);
  const dlg = byId<HTMLDialogElement>("settings-dialog");
  byId("cancel-settings-btn").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // Categories dialog.
  byId("categories-btn").addEventListener("click", openCategories);
  byId("open-categories-from-settings").addEventListener("click", () => {
    dlg.close();
    openCategories();
  });
  const catDlg = byId<HTMLDialogElement>("categories-dialog");
  byId("close-categories-btn").addEventListener("click", () => catDlg.close());
  catDlg.addEventListener("click", (e) => { if (e.target === catDlg) catDlg.close(); });

  const addCategoryForm = byId<HTMLFormElement>("add-category-form");
  const newCategoryInput = byId<HTMLInputElement>("new-category-input");
  const newCategoryColor = document.getElementById("new-category-color") as HTMLInputElement | null;
  addCategoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = newCategoryInput.value.trim();
    if (!val) return;
    const color = newCategoryColor ? newCategoryColor.value : null;
    addCategory(val, color);
    renderCategoriesDialog();
    newCategoryInput.value = "";
    if (newCategoryColor) {
      newCategoryColor.value = PALETTE_PRESETS[getTypes().length % PALETTE_PRESETS.length] ?? newCategoryColor.value;
    }
  });

  render();
  void loadAll().then(() => {
    restorePendingSaves();
    initCatalog();
    const y = savedScroll.y;
    if (savedScroll.tab === state.tab && typeof y === "number" && Number.isFinite(y)) window.scrollTo(0, y);
  });
}

document.addEventListener("DOMContentLoaded", init);
