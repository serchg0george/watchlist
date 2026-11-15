/* Watchlist: personal film/series tracker.
 * Plain ES2020, no modules, no libraries.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

"use strict";

// ===== Constants =====

const REPO = "serchg0george/watchlist";
const BRANCH = "master";
const FILE_PATH = "data/movies.json";
const API_FILE_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
const LS_TOKEN = "watchlist.token";
const LS_LOGIN = "watchlist.login";

const TYPES = ["movie", "series", "anime", "show"];
const STATUSES = ["planned", "watching", "watched", "dropped"];

const TYPE_LABELS = { movie: "Фильм", series: "Сериал", anime: "Аниме", show: "Шоу/офлайн" };
const STATUS_LABELS = { planned: "Хочу посмотреть", watching: "Смотрим", watched: "Просмотрено", dropped: "Брошено" };

const CHIPS = [
  { key: "all", label: "Все" },
  { key: "planned", label: "Хочу" },
  { key: "watching", label: "Смотрим" },
  { key: "watched", label: "Просмотрено" },
  { key: "dropped", label: "Брошено" }
];

const SORTS = [
  { key: "added-desc", label: "Недавно добавленные" },
  { key: "watched-desc", label: "Недавно просмотренные" },
  { key: "rating-desc", label: "По оценке" },
  { key: "title-asc", label: "По названию" }
];

// ===== State =====

const state = {
  token: localStorage.getItem(LS_TOKEN) || "",
  login: localStorage.getItem(LS_LOGIN) || "",
  data: null, // { version, items: [...] }
  loading: true,
  error: null,
  tab: "list",
  statusFilter: "all",
  typeFilter: "all",
  search: "",
  sort: "added-desc",
  watchedSectionOpen: true,
  editingId: null
};

let pendingSaves = 0;
let saveChain = Promise.resolve();
let toastTimer = null;
let saveHideTimer = null;

// ===== Small DOM helper (no innerHTML with user data) =====

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ===== Encoding helpers: base64 <-> UTF-8 (safe for Cyrillic and large files) =====

function base64ToUtf8(b64) {
  const bin = atob(b64); // one char per byte
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  // Chunked to avoid call-stack limits on large strings.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newId() {
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Data loading =====

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function fetchFileViaApi(token) {
  const res = await fetch(API_FILE_URL, { headers: apiHeaders(token), cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
  const json = await res.json();
  return { data: JSON.parse(base64ToUtf8(json.content)), sha: json.sha };
}

async function fetchFileLocal() {
  const res = await fetch("data/movies.json", { cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return { data: await res.json(), sha: null };
}

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  data.version = Number.isInteger(data.version) ? data.version : 1;
  if (!Array.isArray(data.items)) data.items = [];
  data.items = data.items.map((it) => ({
    id: String(it.id ?? ""),
    title: String(it.title ?? ""),
    type: TYPES.includes(it.type) ? it.type : "movie",
    status: STATUSES.includes(it.status) ? it.status : "planned",
    rating: Number.isInteger(it.rating) && it.rating >= 1 && it.rating <= 5 ? it.rating : null,
    note: String(it.note ?? ""),
    addedAt: typeof it.addedAt === "string" && it.addedAt ? it.addedAt : todayStr(),
    watchedAt: typeof it.watchedAt === "string" && it.watchedAt ? it.watchedAt : null,
    updatedBy: String(it.updatedBy ?? "")
  }));
  return data;
}

function friendlyError(e) {
  const status = e && e.status;
  if (status === 401 || status === 403) return "Токен недействителен или нет доступа к репозиторию.";
  if (status === 404) return "Файл data/movies.json не найден в репозитории.";
  if (e instanceof TypeError) return "Нет соединения. Проверьте интернет и попробуйте снова.";
  return `Не удалось загрузить данные: ${e && e.message ? e.message : "неизвестная ошибка"}`;
}

async function loadAll() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const result = state.token ? await fetchFileViaApi(state.token) : await fetchFileLocal();
    state.data = normalize(result.data);
  } catch (e) {
    console.error("load failed", e);
    state.error = friendlyError(e);
  } finally {
    state.loading = false;
    render();
  }
}

// ===== Saving: optimistic op + serialized queue with sha retry =====

function applyAndSave(op, message) {
  if (!state.token) {
    showToast("Войдите через ⚙, чтобы редактировать список");
    return;
  }
  // Optimistic local update.
  op(state.data);
  render();
  enqueueSave(op, message);
}

function enqueueSave(op, message) {
  pendingSaves++;
  updateSaveIndicator();
  saveChain = saveChain
    .then(() => performSave(op, message))
    .catch((err) => {
      console.error("save failed", err);
      showToast("Не удалось сохранить. Перезагружаю данные…");
      loadAll(); // resync with the server copy
    })
    .finally(() => {
      pendingSaves--;
      updateSaveIndicator();
    });
}

async function performSave(op, message) {
  const token = state.token;
  if (!token) throw new Error("Нет токена");
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 1. Fetch the latest content + sha from the server.
    const fresh = await fetchFileViaApi(token);
    // 2. Apply the same op to the fresh copy so concurrent edits are kept.
    op(fresh.data);
    // 3. Commit via PUT with the file sha.
    const body = {
      message,
      content: utf8ToBase64(JSON.stringify(fresh.data, null, 2) + "\n"),
      sha: fresh.sha,
      branch: BRANCH
    };
    const res = await fetch(API_FILE_URL, {
      method: "PUT",
      headers: { ...apiHeaders(token), "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (res.ok) {
      // 5. Success: local state becomes the saved data.
      state.data = normalize(fresh.data);
      render();
      return;
    }
    lastErr = Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    if (res.status === 409 || res.status === 422) continue; // sha mismatch: retry from step 1
    throw lastErr;
  }
  throw lastErr;
}

function updateSaveIndicator() {
  const ind = document.getElementById("save-indicator");
  if (!ind) return;
  clearTimeout(saveHideTimer);
  if (pendingSaves > 0) {
    ind.textContent = "Сохранение…";
    ind.classList.add("visible", "busy");
  } else {
    ind.textContent = "Сохранено";
    ind.classList.add("visible");
    ind.classList.remove("busy");
    saveHideTimer = setTimeout(() => ind.classList.remove("visible"), 1600);
  }
}

// ===== Operations (each is an absolute mutation applied to a data object) =====

function addItem(title, type) {
  const item = {
    id: newId(),
    title,
    type,
    status: "planned",
    rating: null,
    note: "",
    addedAt: todayStr(),
    watchedAt: null,
    updatedBy: state.login
  };
  const op = (data) => { data.items.unshift(item); };
  applyAndSave(op, `Add "${title}"`);
}

function toggleWatched(id) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  const toWatched = !(item.status === "watched" || item.status === "dropped");
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    if (toWatched) { it.status = "watched"; it.watchedAt = todayStr(); }
    else { it.status = "planned"; it.watchedAt = null; }
    it.updatedBy = state.login;
  };
  const message = toWatched ? `Mark "${item.title}" watched` : `Edit "${item.title}"`;
  applyAndSave(op, message);
}

function rateItem(id, star) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  // Clicking the current rating again clears it.
  const newRating = item.rating === star ? null : star;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.rating = newRating;
    it.updatedBy = state.login;
  };
  const message = newRating == null ? `Edit "${item.title}"` : `Rate "${item.title}" ${newRating}/5`;
  applyAndSave(op, message);
}

function commitEdit(id, fields) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  state.editingId = null; // close the editor on save
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.title = fields.title;
    it.type = fields.type;
    it.status = fields.status;
    it.note = fields.note;
    it.watchedAt = fields.watchedAt;
    it.updatedBy = state.login;
  };
  applyAndSave(op, `Edit "${fields.title}"`);
}

function deleteItem(id) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  state.editingId = null;
  const op = (data) => { data.items = data.items.filter((i) => i.id !== id); };
  applyAndSave(op, `Delete "${item.title}"`);
}

// ===== Rendering =====

function render() {
  renderHeader();
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  document.getElementById("list-tab").hidden = state.tab !== "list";
  document.getElementById("stats-tab").hidden = state.tab !== "stats";
  document.getElementById("add-form").hidden = !state.token;
  if (state.tab === "list") renderList();
  else renderStats();
}

function renderHeader() {
  const line = document.getElementById("auth-status");
  line.textContent = state.token && state.login ? `Редактирует: ${state.login}` : "Только просмотр";
}

function sortItems(items, key) {
  const arr = items.slice();
  switch (key) {
    case "watched-desc":
      arr.sort((a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || "") || b.addedAt.localeCompare(a.addedAt));
      break;
    case "rating-desc":
      arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title, "ru"));
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

function updateChips(base) {
  const counts = { all: base.length, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { if (counts[it.status] != null) counts[it.status]++; });
  document.querySelectorAll("#chips .chip").forEach((chip) => {
    const key = chip.dataset.key;
    chip.querySelector(".count").textContent = String(counts[key]);
    chip.classList.toggle("active", state.statusFilter === key);
  });
}

function buildItemRow(item) {
  if (state.editingId === item.id && state.token) return buildEditor(item);

  const isFinished = item.status === "watched" || item.status === "dropped";
  const canEdit = !!state.token;

  // Checkbox: checked for watched/dropped.
  const cb = el("input", { type: "checkbox", class: "item-check", "aria-label": `Просмотрено: ${item.title}` });
  cb.checked = isFinished;
  if (!canEdit) cb.disabled = true;
  cb.addEventListener("change", () => toggleWatched(item.id));

  const children = [el("label", { class: "check-wrap" }, cb)];
  children.push(el("span", { class: "item-title", text: item.title }));
  children.push(el("span", { class: "badge badge-type", text: TYPE_LABELS[item.type] || item.type }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }
  if (item.note) children.push(el("span", { class: "item-note", text: item.note }));

  // Stars are shown only for finished items; read-only without a token.
  if (isFinished) {
    const stars = el("span", { class: "stars" });
    for (let i = 1; i <= 5; i++) {
      const on = i <= item.rating;
      if (canEdit) {
        const s = el("button", { type: "button", class: `star${on ? " on" : ""}`, text: on ? "★" : "☆", "aria-label": `${i} из 5` });
        s.addEventListener("click", () => rateItem(item.id, i));
        stars.append(s);
      } else {
        stars.append(el("span", { class: `star static${on ? " on" : ""}`, text: on ? "★" : "☆" }));
      }
    }
    children.push(stars);
  }

  if (canEdit) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: "item-row" }, ...children);
}

function buildEditor(item) {
  const titleInput = el("input", { type: "text", class: "edit-title", value: item.title, "aria-label": "Название" });
  const typeSelect = el("select", { class: "edit-type", "aria-label": "Тип" },
    ...Object.entries(TYPE_LABELS).map(([k, v]) => el("option", { value: k, text: v })));
  typeSelect.value = item.type;

  const statusSelect = el("select", { class: "edit-status", "aria-label": "Статус" },
    ...Object.entries(STATUS_LABELS).map(([k, v]) => el("option", { value: k, text: v })));
  statusSelect.value = item.status;

  const noteInput = el("input", { type: "text", class: "edit-note", value: item.note || "", placeholder: "Заметка", "aria-label": "Заметка" });
  const dateInput = el("input", { type: "date", class: "edit-date", value: item.watchedAt || "", "aria-label": "Дата просмотра" });

  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  const deleteBtn = el("button", { type: "button", class: "btn btn-danger", text: "Удалить" });

  saveBtn.addEventListener("click", () => {
    const t = titleInput.value.trim();
    if (!t) { showToast("Название не может быть пустым"); return; }
    commitEdit(item.id, {
      title: t,
      type: typeSelect.value,
      status: statusSelect.value,
      note: noteInput.value.trim(),
      watchedAt: dateInput.value || null
    });
  });
  cancelBtn.addEventListener("click", () => { state.editingId = null; render(); });
  deleteBtn.addEventListener("click", () => {
    if (confirm(`Удалить «${item.title}»?`)) deleteItem(item.id);
  });

  return el("div", { class: "editor" },
    el("div", { class: "editor-grid" }, titleInput, typeSelect, statusSelect, noteInput, dateInput),
    el("div", { class: "editor-actions" }, saveBtn, cancelBtn, deleteBtn)
  );
}

function buildSection(items) {
  const list = el("div", { class: "item-list" });
  if (items.length === 0) list.append(el("div", { class: "state-msg", text: "Ничего не найдено" }));
  else items.forEach((it) => list.append(buildItemRow(it)));
  return list;
}

function renderList() {
  const box = document.getElementById("items");
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
    if (q && !(it.title.toLowerCase().includes(q) || it.note.toLowerCase().includes(q))) return false;
    return true;
  });

  updateChips(base);
  const sorted = sortItems(base, state.sort);

  if (state.statusFilter === "all") {
    // Google Keep style: active items first, then a collapsible finished section.
    const active = sorted.filter((it) => it.status === "planned" || it.status === "watching");
    const finished = sorted.filter((it) => it.status === "watched" || it.status === "dropped");

    box.append(buildSection(active));

    const toggleBtn = el("button", { type: "button", class: "section-toggle" },
      el("span", { class: "chevron", text: state.watchedSectionOpen ? "▾" : "▸" }),
      `${finished.length} просмотрено`);
    toggleBtn.addEventListener("click", () => { state.watchedSectionOpen = !state.watchedSectionOpen; render(); });

    const section = el("div", { class: "section finished-section" }, toggleBtn);
    if (state.watchedSectionOpen) section.append(buildSection(finished));
    box.append(section);
  } else {
    box.append(buildSection(sorted.filter((it) => it.status === state.statusFilter)));
  }
}

// ===== Stats tab =====

function statCard(label, value) {
  return el("div", { class: "card" },
    el("div", { class: "card-value", text: String(value) }),
    el("div", { class: "card-label", text: label }));
}

function sectionTitle(text) {
  return el("h2", { class: "section-title", text });
}

// valueNum drives the bar width; display overrides the count text.
function barRow(labelText, valueNum, max, display) {
  const pct = max > 0 && valueNum > 0 ? Math.max(3, (valueNum / max) * 100) : 0;
  return el("div", { class: "bar-row" },
    el("span", { class: "bar-label", text: labelText }),
    el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${pct}%` })),
    el("span", { class: "bar-count", text: display != null ? String(display) : String(valueNum) }));
}

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function monthLabel(key) { // key: YYYY-MM
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function computeMonths(items) {
  const map = {};
  items.forEach((it) => {
    if (it.watchedAt) {
      const key = it.watchedAt.slice(0, 7);
      map[key] = (map[key] || 0) + 1;
    }
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12) // last 12 months that have data
    .map(([key, count]) => ({ key, count }));
}

function renderStats() {
  const box = document.getElementById("stats");
  box.textContent = "";

  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }

  const items = state.data.items;
  const countBy = (pred) => items.filter(pred).length;

  const total = items.length;
  const watched = countBy((i) => i.status === "watched");
  const watching = countBy((i) => i.status === "watching");
  const planned = countBy((i) => i.status === "planned");
  const dropped = countBy((i) => i.status === "dropped");
  const ratedItems = items.filter((i) => i.rating != null);
  const avg = ratedItems.length ? ratedItems.reduce((s, i) => s + i.rating, 0) / ratedItems.length : null;

  box.append(el("div", { class: "cards" },
    statCard("Всего", total),
    statCard("Просмотрено", watched),
    statCard("Смотрим", watching),
    statCard("В планах", planned),
    statCard("Брошено", dropped),
    statCard("Средняя оценка", avg == null ? "—" : avg.toFixed(1)),
    statCard("Оценено", ratedItems.length)
  ));

  // Rating distribution, 5 stars down to 1.
  box.append(sectionTitle("Распределение оценок"));
  const dist = el("div", { class: "bars" });
  let maxCount = 0;
  const counts = {};
  for (let s = 5; s >= 1; s--) {
    counts[s] = countBy((i) => i.rating === s);
    maxCount = Math.max(maxCount, counts[s]);
  }
  if (maxCount === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока нет оценок" }));
  } else {
    for (let s = 5; s >= 1; s--) dist.append(barRow(`${s}★`, counts[s], maxCount));
    box.append(dist);
  }

  // Breakdown by type: watched / total.
  box.append(sectionTitle("По типам"));
  const typeBox = el("div", { class: "bars" });
  for (const t of TYPES) {
    const tot = countBy((i) => i.type === t);
    const w = countBy((i) => i.type === t && i.status === "watched");
    typeBox.append(barRow(TYPE_LABELS[t], w, tot, `${w} / ${tot}`));
  }
  box.append(typeBox);

  // Watched per month by watchedAt.
  box.append(sectionTitle("Просмотрено по месяцам"));
  const months = computeMonths(items);
  if (months.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока нет данных" }));
  } else {
    const mBox = el("div", { class: "bars" });
    const mMax = Math.max(...months.map((m) => m.count), 1);
    months.forEach((m) => mBox.append(barRow(monthLabel(m.key), m.count, mMax)));
    box.append(mBox);
  }

  // Top rated: up to 10, rating desc then watchedAt desc.
  box.append(sectionTitle("Топ по оценке"));
  const top = items
    .filter((i) => i.rating != null)
    .sort((a, b) => (b.rating - a.rating) || (b.watchedAt || "").localeCompare(a.watchedAt || ""))
    .slice(0, 10);
  if (top.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока нет оценок" }));
  } else {
    const topList = el("ol", { class: "top-list" });
    top.forEach((it) => topList.append(el("li", {},
      el("span", { class: "top-title", text: it.title }),
      el("span", { class: "top-rating", text: `${it.rating}★` }))));
    box.append(topList);
  }

  // Who marked items (per updatedBy login, skip empty).
  box.append(sectionTitle("Кто отметил"));
  const byUser = {};
  items.forEach((i) => { if (i.updatedBy) byUser[i.updatedBy] = (byUser[i.updatedBy] || 0) + 1; });
  const users = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
  if (users.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока никто не отмечал" }));
  } else {
    const uBox = el("div", { class: "bars" });
    const uMax = Math.max(...users.map((u) => u[1]), 1);
    users.forEach(([login, count]) => uBox.append(barRow(login, count, uMax)));
    box.append(uBox);
  }
}

// ===== Toast =====

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 2600);
}

// ===== Settings dialog =====

function openSettings() {
  const dlg = document.getElementById("settings-dialog");
  document.getElementById("settings-error").textContent = "";
  dlg.showModal();
}

async function saveToken() {
  const input = document.getElementById("token-input");
  const errEl = document.getElementById("settings-error");
  const token = input.value.trim();
  if (!token) { errEl.textContent = "Введите токен."; return; }
  errEl.textContent = "";
  try {
    // Verify the token and learn our login.
    const res = await fetch("https://api.github.com/user", { headers: apiHeaders(token), cache: "no-store" });
    if (!res.ok) throw Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    const user = await res.json();
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_LOGIN, user.login || "");
    state.token = token;
    state.login = user.login || "";
    input.value = "";
    document.getElementById("settings-dialog").close();
    showToast(`Вход выполнен: ${state.login}`);
    loadAll(); // from now on read fresh data via the API
  } catch (e) {
    console.error("token check failed", e);
    errEl.textContent = friendlyError(e);
  }
}

function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_LOGIN);
  state.token = "";
  state.login = "";
  document.getElementById("settings-dialog").close();
  showToast("Вы вышли. Режим: только просмотр.");
  loadAll(); // back to the public copy of data/movies.json
}

// ===== Init =====

function init() {
  // Tabs.
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); });
  });

  // Status chips (built once, counts updated on each list render).
  const chipsEl = document.getElementById("chips");
  CHIPS.forEach((c) => {
    const chip = el("button", { type: "button", class: "chip", "data-key": c.key }, c.label, el("span", { class: "count" }));
    chip.addEventListener("click", () => { state.statusFilter = c.key; render(); });
    chipsEl.append(chip);
  });

  // Type filter.
  const typeSel = document.getElementById("type-filter");
  typeSel.append(el("option", { value: "all", text: "Все типы" }));
  Object.entries(TYPE_LABELS).forEach(([k, v]) => typeSel.append(el("option", { value: k, text: v })));
  typeSel.addEventListener("change", () => { state.typeFilter = typeSel.value; render(); });

  // Search.
  const searchInput = document.getElementById("search");
  searchInput.addEventListener("input", () => { state.search = searchInput.value; render(); });

  // Sort.
  const sortSel = document.getElementById("sort");
  SORTS.forEach((s) => sortSel.append(el("option", { value: s.key, text: s.label })));
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; render(); });

  // Add form (hidden without a token).
  const addForm = document.getElementById("add-form");
  const addTitle = document.getElementById("add-title");
  const addType = document.getElementById("add-type");
  Object.entries(TYPE_LABELS).forEach(([k, v]) => addType.append(el("option", { value: k, text: v })));
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = addTitle.value.trim();
    if (!t) return;
    addItem(t, addType.value);
    addTitle.value = "";
  });

  // Settings dialog.
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("save-token-btn").addEventListener("click", saveToken);
  document.getElementById("logout-btn").addEventListener("click", logout);
  const dlg = document.getElementById("settings-dialog");
  document.getElementById("cancel-settings-btn").addEventListener("click", () => dlg.close());
  // Close when clicking the backdrop.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  render();
  loadAll();
}

document.addEventListener("DOMContentLoaded", init);
