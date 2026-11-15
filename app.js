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
const LS_PERSON = "watchlist.person";

const PEOPLE = ["S", "L"];
// Exactly two editors: the repo owner is S, the collaborator (any other login with write access) is L.
const OWNER_LOGIN = "serchg0george";
const UNDO_MS = 5000;

function personFor(login) {
  if (!login) return "";
  return login.toLowerCase() === OWNER_LOGIN ? "S" : "L";
}
const DEFAULT_TYPES = [
  { key: "movie", label: "Фильм" },
  { key: "series", label: "Сериал" },
  { key: "anime", label: "Аниме" },
  { key: "show", label: "Шоу/офлайн" }
];
const STATUSES = ["planned", "watching", "watched", "dropped"];
const STATUS_LABELS = { planned: "Хочу посмотреть", watching: "Смотрим", watched: "Просмотрено", dropped: "Брошено" };

function getTypes() {
  if (state.data && Array.isArray(state.data.types) && state.data.types.length > 0) {
    return state.data.types;
  }
  return DEFAULT_TYPES;
}

function getTypeLabel(key) {
  const t = getTypes().find((item) => item.key === key);
  return t ? t.label : key;
}

function transliterate(str) {
  const ru = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };
  return str.split("").map((c) => {
    const low = c.toLowerCase();
    return ru[low] !== undefined ? ru[low] : c;
  }).join("");
}

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
  person: personFor(localStorage.getItem(LS_LOGIN) || ""),
  data: null, // { version, items: [...] }
  loading: true,
  error: null,
  tab: "list",
  statusFilter: "all",
  typeFilter: "all",
  search: "",
  sort: "added-desc",
  watchedSectionOpen: true,
  editingId: null,
  commentingId: null,
  highlightId: null
};

let lastPickId = null;
let highlightTimer = null;
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

function validRating(r) {
  return Number.isInteger(r) && r >= 1 && r <= 10 ? r : null;
}

function normalizeRatings(it) {
  const src = it.ratings && typeof it.ratings === "object" ? it.ratings : { S: it.rating };
  return { S: validRating(src.S), L: validRating(src.L) };
}

function normalizeComments(it) {
  const src = it.comments && typeof it.comments === "object" ? it.comments : {};
  return { S: String(src.S ?? ""), L: String(src.L ?? "") };
}

function avgRating(it) {
  const vals = PEOPLE.map((p) => it.ratings[p]).filter((r) => r != null);
  return vals.length ? vals.reduce((s, r) => s + r, 0) / vals.length : null;
}

function normalizeTypes(rawTypes) {
  if (Array.isArray(rawTypes) && rawTypes.length > 0) {
    const seen = new Set();
    const result = [];
    for (const t of rawTypes) {
      if (!t) continue;
      const key = String(t.key ?? "").trim();
      const label = String(t.label ?? key).trim();
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      result.push({ key, label });
    }
    if (result.length > 0) return result;
  }
  return DEFAULT_TYPES.map((t) => ({ ...t }));
}

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  data.version = Number.isInteger(data.version) ? data.version : 1;
  data.types = normalizeTypes(data.types);
  const fallbackKey = data.types[0]?.key || "movie";

  if (!Array.isArray(data.items)) data.items = [];
  data.items = data.items.map((it) => ({
    id: String(it.id ?? ""),
    title: String(it.title ?? ""),
    type: typeof it.type === "string" && it.type.trim() ? it.type.trim() : fallbackKey,
    status: STATUSES.includes(it.status) ? it.status : "planned",
    ratings: normalizeRatings(it),
    comments: normalizeComments(it),
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
    return false;
  }
  // Optimistic local update.
  op(state.data);
  render();
  enqueueSave(op, message);
  return true;
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
    fresh.data = normalize(fresh.data);
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
    ratings: { S: null, L: null },
    comments: { S: "", L: "" },
    note: "",
    addedAt: todayStr(),
    watchedAt: null,
    updatedBy: state.login
  };
  const op = (data) => { data.items.unshift(item); };
  applyAndSave(op, `Add "${title}"`);
}

// Undo restores the item exactly as it was before the change (re-inserting it if it was deleted).
function snapshotOf(item) {
  return { item: JSON.parse(JSON.stringify(item)), index: state.data.items.indexOf(item) };
}

function offerUndo(msg, snap) {
  showToast(msg, { label: "Отменить", run: () => restoreItem(snap) });
}

function restoreItem(snap) {
  const op = (data) => {
    const restored = JSON.parse(JSON.stringify(snap.item)); // fresh copy: op runs on local and server data
    const i = data.items.findIndex((x) => x.id === restored.id);
    if (i >= 0) data.items[i] = restored;
    else data.items.splice(Math.min(Math.max(snap.index, 0), data.items.length), 0, restored);
  };
  applyAndSave(op, `Undo change of "${snap.item.title}"`);
}

function toggleWatched(id) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  const snap = snapshotOf(item);
  const toWatched = !(item.status === "watched" || item.status === "dropped");
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    if (toWatched) { it.status = "watched"; it.watchedAt = todayStr(); }
    else { it.status = "planned"; it.watchedAt = null; }
    it.updatedBy = state.login;
  };
  const message = toWatched ? `Mark "${item.title}" watched` : `Edit "${item.title}"`;
  if (applyAndSave(op, message)) {
    offerUndo(toWatched ? `«${item.title}» — просмотрено` : `«${item.title}» снова в списке`, snap);
  }
}

function rateItem(id, person, star) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  // Clicking the current rating again clears it.
  const newRating = item.ratings[person] === star ? null : star;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.ratings[person] = newRating;
    it.updatedBy = state.login;
  };
  const message = newRating == null
    ? `Clear ${person} rating of "${item.title}"`
    : `Rate "${item.title}" ${person} ${newRating}/10`;
  applyAndSave(op, message);
}

function setComment(id, person, text) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  state.commentingId = null;
  if ((item.comments[person] || "") === text) { render(); return; }
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.comments[person] = text;
    it.updatedBy = state.login;
  };
  const message = text ? `Comment "${item.title}" as ${person}` : `Clear ${person} comment of "${item.title}"`;
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
  const snap = snapshotOf(item);
  const op = (data) => { data.items = data.items.filter((i) => i.id !== id); };
  if (applyAndSave(op, `Delete "${item.title}"`)) offerUndo(`«${item.title}» удалено`, snap);
}

function addCategory(label) {
  const trimmed = label.trim();
  if (!trimmed) return;
  const types = getTypes();
  if (types.some((t) => t.label.toLowerCase() === trimmed.toLowerCase())) {
    showToast(`Категория «${trimmed}» уже существует`);
    return;
  }
  const baseSlug = transliterate(trimmed).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let key = baseSlug || `type-${Date.now().toString(36)}`;
  if (types.some((t) => t.key === key)) {
    key = `${key}-${Date.now().toString(36).slice(-4)}`;
  }
  const op = (data) => {
    if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
    data.types.push({ key, label: trimmed });
  };
  if (applyAndSave(op, `Add category "${trimmed}"`)) {
    showToast(`Категория «${trimmed}» добавлена`);
    renderCategoriesDialog();
  }
}

function updateCategory(key, newLabel) {
  const trimmed = newLabel.trim();
  if (!trimmed) {
    showToast("Название категории не может быть пустым");
    renderCategoriesDialog();
    return;
  }
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.label === trimmed) return;
  const op = (data) => {
    if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
    const t = data.types.find((item) => item.key === key);
    if (t) t.label = trimmed;
  };
  if (applyAndSave(op, `Rename category to "${trimmed}"`)) {
    showToast(`Категория переименована в «${trimmed}»`);
    renderCategoriesDialog();
  }
}

function deleteCategory(key) {
  const types = getTypes();
  if (types.length <= 1) {
    showToast("Нельзя удалить последнюю категорию");
    return;
  }
  const target = types.find((t) => t.key === key);
  if (!target) return;
  const count = state.data ? state.data.items.filter((i) => i.type === key).length : 0;
  const confirmMsg = count > 0
    ? `В категории «${target.label}» есть ${count} элементов. При удалении категории они сохранятся. Удалить категорию?`
    : `Удалить категорию «${target.label}»?`;
  if (!confirm(confirmMsg)) return;

  const op = (data) => {
    if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
    data.types = data.types.filter((item) => item.key !== key);
  };
  if (applyAndSave(op, `Delete category "${target.label}"`)) {
    showToast(`Категория «${target.label}» удалена`);
    renderCategoriesDialog();
  }
}

// Duplicate check: case-, "ё"- and punctuation-insensitive title match.
function titleKey(s) {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function findDuplicate(title) {
  if (!state.data) return null;
  const key = titleKey(title);
  return state.data.items.find((it) => titleKey(it.title) === key) || null;
}

// Random pick from "planned", respecting the type filter; avoids repeating the previous pick.
function pickRandom() {
  if (!state.data) return;
  const pool = state.data.items.filter((it) => it.status === "planned" && (state.typeFilter === "all" || it.type === state.typeFilter));
  if (pool.length === 0) { showToast("В «Хочу посмотреть» пусто"); return; }
  const candidates = pool.length > 1 ? pool.filter((it) => it.id !== lastPickId) : pool;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  lastPickId = pick.id;
  // Make sure the picked row is visible.
  state.tab = "list";
  state.statusFilter = "all";
  state.search = "";
  document.getElementById("search").value = "";
  state.highlightId = pick.id;
  render();
  showToast(`🎲 ${pick.title}`);
  const row = document.querySelector(`.item-row[data-id="${CSS.escape(pick.id)}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  // Drop the highlight without a re-render, so nothing in progress gets rebuilt.
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    state.highlightId = null;
    document.querySelectorAll(".item-row.highlight").forEach((r) => r.classList.remove("highlight"));
  }, 3000);
}

// ===== Rendering =====

function render() {
  renderHeader();
  updateTypeSelects();
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  document.getElementById("list-tab").hidden = state.tab !== "list";
  document.getElementById("stats-tab").hidden = state.tab !== "stats";
  document.getElementById("add-form").hidden = !state.token;
  if (state.tab === "list") renderList();
  else renderStats();
}

function renderHeader() {
  const line = document.getElementById("auth-status");
  line.textContent = state.token && state.login
    ? `Редактирует: ${state.login}${state.person ? ` (${state.person})` : ""}`
    : "Только просмотр";
}

function sortItems(items, key) {
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
  children.push(el("span", { class: "badge badge-type", text: getTypeLabel(item.type) }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }
  if (item.note) children.push(el("span", { class: "item-note", text: item.note }));

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
    children.push(ratings);
  }

  // Comments are shown for any status; each person edits only their own line.
  const comments = el("div", { class: "comments" });
  for (const p of PEOPLE) {
    const text = item.comments[p];
    const mine = canEdit && state.person === p;
    if (mine && state.commentingId === item.id) {
      const ta = el("textarea", { class: "comment-input", rows: 2, placeholder: "Ваш комментарий…", "aria-label": `Комментарий ${p}` });
      ta.value = text;
      const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
      const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
      saveBtn.addEventListener("click", () => setComment(item.id, p, ta.value.trim()));
      cancelBtn.addEventListener("click", () => { state.commentingId = null; render(); });
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          setComment(item.id, p, ta.value.trim());
        } else if (e.key === "Escape") {
          state.commentingId = null;
          render();
        }
      });
      comments.append(el("div", { class: `comment-line person-${p.toLowerCase()} mine` },
        el("span", { class: "person-tag", text: p }), ta,
        el("div", { class: "comment-actions" }, saveBtn, cancelBtn)));
      setTimeout(() => ta.focus(), 0);
    } else if (text) {
      const line = el("div", {
        class: `comment-line person-${p.toLowerCase()}${mine ? " mine" : ""}`,
        role: mine ? "button" : null,
        tabindex: mine ? 0 : null,
        title: mine ? "Изменить комментарий" : null
      }, el("span", { class: "person-tag", text: p }), el("span", { class: "comment-text", text }));
      if (mine) {
        const open = () => { state.commentingId = item.id; render(); };
        line.addEventListener("click", open);
        line.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
      }
      comments.append(line);
    } else if (mine) {
      const addBtn = el("button", { type: "button", class: "comment-add", text: "💬 Комментарий" });
      addBtn.addEventListener("click", () => { state.commentingId = item.id; render(); });
      comments.append(addBtn);
    }
  }
  if (comments.children.length > 0) children.push(comments);

  if (canEdit) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: `item-row${state.highlightId === item.id ? " highlight" : ""}`, "data-id": item.id }, ...children);
}

function buildEditor(item) {
  const titleInput = el("input", { type: "text", class: "edit-title", value: item.title, "aria-label": "Название" });
  const typeSelect = el("select", { class: "edit-type", "aria-label": "Тип" },
    ...getTypes().map((t) => el("option", { value: t.key, text: t.label })));
  typeSelect.value = item.type;
  if (!typeSelect.value && getTypes().length > 0) {
    typeSelect.value = getTypes()[0].key;
  }

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
    if (q && !(it.title.toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)))) return false;
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

function statCard(label, value, extraClass) {
  return el("div", { class: `card${extraClass ? ` ${extraClass}` : ""}` },
    el("div", { class: "card-value", text: String(value) }),
    el("div", { class: "card-label", text: label }));
}

function ratingPair(it) {
  return el("span", { class: "rating-pair" },
    ...PEOPLE.map((p) => el("span", { class: `pair-chip person-${p.toLowerCase()}`, text: `${p} ${it.ratings[p] ?? "—"}` })));
}

function sectionTitle(text) {
  return el("h2", { class: "section-title", text });
}

// valueNum drives the bar width; display overrides the count text.
function barRow(labelText, valueNum, max, display, extraClass) {
  const pct = max > 0 && valueNum > 0 ? Math.max(3, (valueNum / max) * 100) : 0;
  return el("div", { class: `bar-row${extraClass ? ` ${extraClass}` : ""}` },
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
  const fmtAvg = (vals) => vals.length ? (vals.reduce((s, r) => s + r, 0) / vals.length).toFixed(1) : "—";
  const valsOf = (p) => items.map((i) => i.ratings[p]).filter((r) => r != null);
  const both = items.filter((i) => i.ratings.S != null && i.ratings.L != null);
  const allVals = [...valsOf("S"), ...valsOf("L")];

  box.append(el("div", { class: "cards" },
    statCard("Всего", total),
    statCard("Просмотрено", watched),
    statCard("Смотрим", watching),
    statCard("В планах", planned),
    statCard("Брошено", dropped)
  ));

  box.append(sectionTitle("Оценки S и L"));
  box.append(el("div", { class: "cards" },
    statCard("Средняя S", fmtAvg(valsOf("S")), "person-s"),
    statCard("Средняя L", fmtAvg(valsOf("L")), "person-l"),
    statCard("Средняя общая", fmtAvg(allVals)),
    statCard("Оценок S", valsOf("S").length, "person-s"),
    statCard("Оценок L", valsOf("L").length, "person-l"),
    statCard("Оценили оба", both.length),
    statCard("Совпали", both.filter((i) => i.ratings.S === i.ratings.L).length)
  ));

  // Rating distribution, 10 stars down to 1, S and L side by side.
  box.append(sectionTitle("Распределение оценок"));
  if (allVals.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока нет оценок" }));
  } else {
    const dist = el("div", { class: "bars" });
    const counts = {};
    let maxCount = 0;
    for (const p of PEOPLE) {
      counts[p] = {};
      for (let s = 1; s <= 10; s++) {
        counts[p][s] = countBy((i) => i.ratings[p] === s);
        maxCount = Math.max(maxCount, counts[p][s]);
      }
    }
    for (let s = 10; s >= 1; s--) {
      for (const p of PEOPLE) {
        dist.append(barRow(`${s}★ ${p}`, counts[p][s], maxCount, null, `person-${p.toLowerCase()}`));
      }
    }
    box.append(dist);
  }

  box.append(sectionTitle("Самые большие расхождения"));
  const diffs = both
    .filter((i) => i.ratings.S !== i.ratings.L)
    .sort((a, b) => Math.abs(b.ratings.S - b.ratings.L) - Math.abs(a.ratings.S - a.ratings.L))
    .slice(0, 10);
  if (diffs.length === 0) {
    box.append(el("div", { class: "state-msg", text: both.length ? "Пока во всём согласны" : "Нет фильмов, оценённых обоими" }));
  } else {
    const list = el("ol", { class: "top-list" });
    diffs.forEach((it) => list.append(el("li", {},
      el("span", { class: "top-title", text: it.title }),
      ratingPair(it))));
    box.append(list);
  }

  // Breakdown by type: watched / total.
  box.append(sectionTitle("По типам"));
  const typeBox = el("div", { class: "bars" });
  for (const t of getTypes()) {
    const tot = countBy((i) => i.type === t.key);
    const w = countBy((i) => i.type === t.key && i.status === "watched");
    typeBox.append(barRow(t.label, w, tot, `${w} / ${tot}`));
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

  // Top rated by the average of S and L: up to 10, then watchedAt desc.
  box.append(sectionTitle("Топ по средней оценке"));
  const top = items
    .filter((i) => avgRating(i) != null)
    .sort((a, b) => (avgRating(b) - avgRating(a)) || (b.watchedAt || "").localeCompare(a.watchedAt || ""))
    .slice(0, 10);
  if (top.length === 0) {
    box.append(el("div", { class: "state-msg", text: "Пока нет оценок" }));
  } else {
    const topList = el("ol", { class: "top-list" });
    top.forEach((it) => topList.append(el("li", {},
      el("span", { class: "top-title", text: it.title }),
      ratingPair(it),
      el("span", { class: "top-rating", text: `${avgRating(it).toFixed(1)}★` }))));
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

// action: optional { label, run } rendered as a button inside the toast (e.g. undo).
function showToast(msg, action) {
  const t = document.getElementById("toast");
  t.textContent = "";
  t.append(el("span", { class: "toast-text", text: msg }));
  if (action) {
    const btn = el("button", { type: "button", class: "toast-action", text: action.label });
    btn.addEventListener("click", () => {
      clearTimeout(toastTimer);
      t.classList.remove("visible");
      action.run();
    });
    t.append(btn);
  }
  t.classList.toggle("has-action", !!action);
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), action ? UNDO_MS : 2600);
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
  const token = input.value.trim() || state.token;
  if (!token) { errEl.textContent = "Введите токен."; return; }
  errEl.textContent = "";
  try {
    // Verify the token and learn our login.
    const res = await fetch("https://api.github.com/user", { headers: apiHeaders(token), cache: "no-store" });
    if (!res.ok) throw Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    const user = await res.json();
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_LOGIN, user.login || "");
    localStorage.removeItem(LS_PERSON); // legacy: person is now derived from the login
    state.token = token;
    state.login = user.login || "";
    state.person = personFor(state.login);
    input.value = "";
    document.getElementById("settings-dialog").close();
    showToast(`Вход выполнен: ${state.login} (${state.person})`);
    loadAll(); // from now on read fresh data via the API
  } catch (e) {
    console.error("token check failed", e);
    errEl.textContent = friendlyError(e);
  }
}

function logout() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_LOGIN);
  localStorage.removeItem(LS_PERSON);
  state.token = "";
  state.login = "";
  state.person = "";
  document.getElementById("settings-dialog").close();
  showToast("Вы вышли. Режим: только просмотр.");
  loadAll(); // back to the public copy of data/movies.json
}

// ===== Categories dialog =====

function openCategories() {
  const dlg = document.getElementById("categories-dialog");
  renderCategoriesDialog();
  dlg.showModal();
}

function renderCategoriesDialog() {
  const list = document.getElementById("categories-list");
  if (!list) return;
  list.textContent = "";
  const types = getTypes();
  const canEdit = !!state.token;

  const hint = document.getElementById("categories-auth-hint");
  if (hint) hint.hidden = canEdit;

  const addForm = document.getElementById("add-category-form");
  if (addForm) addForm.hidden = !canEdit;

  types.forEach((t) => {
    const count = state.data ? state.data.items.filter((i) => i.type === t.key).length : 0;
    const input = el("input", {
      type: "text",
      class: "category-name-input",
      value: t.label,
      "aria-label": `Название категории ${t.label}`,
      disabled: !canEdit
    });

    const saveBtn = el("button", {
      type: "button",
      class: "icon-btn category-save-btn",
      text: "✓",
      title: "Сохранить название",
      "aria-label": "Сохранить название",
      disabled: true
    });

    const handleSave = () => {
      const val = input.value.trim();
      if (val && val !== t.label) {
        updateCategory(t.key, val);
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
    delBtn.addEventListener("click", () => deleteCategory(t.key));

    const row = el("div", { class: "category-row" }, input, saveBtn, countSpan, delBtn);
    list.append(row);
  });
}

function updateTypeSelects() {
  const types = getTypes();

  const typeSel = document.getElementById("type-filter");
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

  const addType = document.getElementById("add-type");
  if (addType) {
    const curVal = addType.value;
    addType.textContent = "";
    types.forEach((t) => addType.append(el("option", { value: t.key, text: t.label })));
    if (types.some((t) => t.key === curVal)) {
      addType.value = curVal;
    } else if (types.length > 0) {
      addType.value = types[0].key;
    }
  }
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
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = addTitle.value.trim();
    if (!t) return;
    const dup = findDuplicate(t);
    if (dup && !confirm(`«${dup.title}» уже есть в списке (${STATUS_LABELS[dup.status]}). Всё равно добавить?`)) return;
    addItem(t, addType.value);
    addTitle.value = "";
  });

  // Random pick.
  document.getElementById("random-btn").addEventListener("click", pickRandom);

  // Installable app / offline cache (needs http(s), not file://).
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker registration failed", e));
  }

  // Settings dialog.
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("save-token-btn").addEventListener("click", saveToken);
  document.getElementById("logout-btn").addEventListener("click", logout);
  const dlg = document.getElementById("settings-dialog");
  document.getElementById("cancel-settings-btn").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  // Categories dialog.
  document.getElementById("categories-btn").addEventListener("click", openCategories);
  document.getElementById("open-categories-from-settings").addEventListener("click", () => {
    dlg.close();
    openCategories();
  });
  const catDlg = document.getElementById("categories-dialog");
  document.getElementById("close-categories-btn").addEventListener("click", () => catDlg.close());
  catDlg.addEventListener("click", (e) => { if (e.target === catDlg) catDlg.close(); });

  const addCategoryForm = document.getElementById("add-category-form");
  const newCategoryInput = document.getElementById("new-category-input");
  addCategoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = newCategoryInput.value.trim();
    if (!val) return;
    addCategory(val);
    newCategoryInput.value = "";
  });

  render();
  loadAll();
}

document.addEventListener("DOMContentLoaded", init);
