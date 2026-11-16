/* Watchlist: personal film/series tracker.
 * Plain ES2020, no modules, no libraries.
 * Data lives in data/movies.json; edits are committed to the repo
 * through the GitHub Contents API with a user-provided fine-grained token. */

"use strict";

// ===== Constants =====

const REPO = "serchg0george/watchlist";
const FILE_PATH = "data/movies.json";
const API_CONTENTS_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
const LS_TOKEN = "watchlist.token";
const LS_LOGIN = "watchlist.login";
const LS_PERSON = "watchlist.person";

const PEOPLE = ["S", "L"];
const REACTION_KINDS = [
  { key: "like", emoji: "👍", label: "Нравится" },
  { key: "fire", emoji: "🔥", label: "Огонь" },
  { key: "heart", emoji: "❤️", label: "Люблю" },
  { key: "grin", emoji: "😁", label: "Улыбаюсь" },
  { key: "eyes", emoji: "👀", label: "Интересно" },
  { key: "laugh", emoji: "🤣", label: "Очень смешно" },
  { key: "sad", emoji: "😢", label: "Грустно" },
  { key: "dislike", emoji: "👎", label: "Не нравится" }
];
// Exactly two editors: the repo owner is S, the collaborator (any other login with write access) is L.
const OWNER_LOGIN = "serchg0george";
const UNDO_MS = 5000;

function personFor(login) {
  if (!login) return "";
  return login.toLowerCase() === OWNER_LOGIN ? "S" : "L";
}
const DEFAULT_TYPES = [
  { key: "movie", label: "Фильм", color: "#e05638" },
  { key: "series", label: "Сериал", color: "#2563eb" },
  { key: "anime", label: "Аниме", color: "#7c3aed" },
  { key: "show", label: "Шоу", color: "#059669" }
];

const PALETTE_PRESETS = [
  "#e05638", "#ea580c", "#d97706", "#ca8a04",
  "#65a30d", "#16a34a", "#059669", "#0d9488",
  "#0891b2", "#0284c7", "#2563eb", "#4f46e5",
  "#7c3aed", "#9333ea", "#c026d3", "#db2777",
  "#e11d48", "#475569"
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

function getTypeColor(key) {
  const t = getTypes().find((item) => item.key === key);
  return t && t.color ? t.color : "#5b6b53";
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
  { key: "watching", label: "Смотрим" }
];
// Tabs that show the item list; "list" is filtered by CHIPS, the others by their own status.
const LIST_TABS = ["list", "watched", "dropped"];

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
  dataBranch: null,
  loading: true,
  error: null,
  tab: "list",
  statusFilter: "all",
  typeFilter: "all",
  search: "",
  sort: "added-desc",
  editingId: null,
  commentingId: null,
  replyDraft: null,
  editingReplyId: null,
  highlightId: null
};

let lastPickId = null;
const openItems = new Set();
const draftMemory = new Map();
const draftCleanups = new Map();
let catalogSavePending = false;

function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in-memory drafts when storage is unavailable. */ }
}

function draftKey(kind, id) { return `watchlist.draft.${state.login}.${kind}.${id}`; }
function readDraft(key) { return draftMemory.get(key) ?? readLocal(key); }
function writeDraft(key, value) {
  if (value == null) draftMemory.delete(key); else draftMemory.set(key, value);
  writeLocal(key, value);
}

function clearDraftAfterSave(key, snapshot) {
  draftCleanups.set(key, snapshot);
  waitForSaves().then(() => {
    if (JSON.stringify(readDraft(key)) === JSON.stringify(snapshot)) writeDraft(key, null);
    draftCleanups.delete(key);
  }).catch(() => {});
}
let highlightTimer = null;
let pendingSaves = 0;
const saveQueue = [];
const saveWaiters = [];
let saveRunning = false;
let saveError = null;
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
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function fetchTimed(url, options = {}, read = (response) => response) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try { return await read(await fetch(url, { ...options, signal: controller.signal })); }
  finally { clearTimeout(timer); }
}

async function resolveDataBranch(token) {
  return fetchTimed(`https://api.github.com/repos/${REPO}/git/matching-refs/heads/data/`, { headers: apiHeaders(token), cache: "no-store" }, async (res) => {
    if (res.status === 404) return "master";
    if (!res.ok) throw Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    const refs = await res.json();
    if (!Array.isArray(refs)) throw new Error("GitHub вернул неверный список веток данных");
    const branches = refs.map((entry) => entry?.ref).filter((ref) => typeof ref === "string" && ref.startsWith("refs/heads/data/") && ref.length > "refs/heads/data/".length).sort();
    return branches.length ? branches[branches.length - 1].slice("refs/heads/".length) : "master";
  });
}

async function fetchFileViaApi(token, branch) {
  return fetchTimed(`${API_CONTENTS_URL}?ref=${encodeURIComponent(branch)}`, { headers: apiHeaders(token), cache: "no-store" }, async (res) => {
    if (!res.ok) throw Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    const json = await res.json();
    return { data: JSON.parse(base64ToUtf8(json.content)), sha: json.sha };
  });
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

function normalizeReplies(it) {
  if (!Array.isArray(it.replies)) return [];
  return it.replies.filter((r) => r && typeof r === "object" &&
    typeof r.id === "string" && PEOPLE.includes(r.by) &&
    typeof r.text === "string" && r.text.trim() &&
    typeof r.to === "string" && typeof r.at === "string")
    .map((r) => {
      const reply = { ...r, text: r.text.trim() };
      if (typeof reply.editedAt !== "string") delete reply.editedAt;
      return reply;
    });
}

function normalizeReactions(it) {
  if (!it.reactions || typeof it.reactions !== "object" || Array.isArray(it.reactions)) return {};
  return Object.fromEntries(Object.entries(it.reactions).flatMap(([target, map]) => {
    if (!map || typeof map !== "object" || Array.isArray(map)) return [];
    const entries = Object.entries(map).filter(([person, kind]) =>
      PEOPLE.includes(person) && REACTION_KINDS.some((r) => r.key === kind));
    return entries.length ? [[target, Object.fromEntries(entries)]] : [];
  }));
}

function avgRating(it) {
  const vals = PEOPLE.map((p) => it.ratings[p]).filter((r) => r != null);
  return vals.length ? vals.reduce((s, r) => s + r, 0) / vals.length : null;
}

function normalizeTypes(rawTypes) {
  if (Array.isArray(rawTypes) && rawTypes.length > 0) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < rawTypes.length; i++) {
      const t = rawTypes[i];
      if (!t) continue;
      const key = String(t.key ?? "").trim();
      const label = String(t.label ?? key).trim();
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      const color = typeof t.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(t.color.trim())
        ? t.color.trim()
        : PALETTE_PRESETS[i % PALETTE_PRESETS.length];
      result.push({ key, label, color });
    }
    if (result.length > 0) return result;
  }
  return DEFAULT_TYPES.map((t) => ({ ...t }));
}

function normalizeGenres(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((genre) => {
    if (typeof genre !== "string" || !genre.trim()) return false;
    const key = genre.trim().toLocaleLowerCase("ru-RU");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((genre) => genre.trim());
}

function normalize(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  data.version = Number.isInteger(data.version) ? data.version : 1;
  data.types = normalizeTypes(data.types);
  const fallbackKey = data.types[0]?.key || "movie";

  if (!Array.isArray(data.items)) data.items = [];
  // Spread first: fields added by newer app versions (e.g. replies, reactions) must survive a save from this version.
  data.items = data.items.map((raw0) => {
    const it = raw0 && typeof raw0 === "object" ? raw0 : {};
    return {
      ...it,
      id: String(it.id ?? ""),
      title: String(it.title ?? ""),
      type: typeof it.type === "string" && it.type.trim() ? it.type.trim() : fallbackKey,
      status: STATUSES.includes(it.status) ? it.status : "planned",
      ratings: normalizeRatings(it),
      comments: normalizeComments(it),
      replies: normalizeReplies(it),
      reactions: normalizeReactions(it),
      genres: normalizeGenres(it.genres),
      note: String(it.note ?? ""),
      addedAt: typeof it.addedAt === "string" && it.addedAt ? it.addedAt : todayStr(),
      watchedAt: typeof it.watchedAt === "string" && it.watchedAt ? it.watchedAt : null,
      droppedAt: typeof it.droppedAt === "string" && it.droppedAt ? it.droppedAt : null,
      updatedBy: String(it.updatedBy ?? "")
    };
  });
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
  if (hasUnsavedChanges()) return;
  state.loading = true;
  state.error = null;
  render();
  try {
    state.dataBranch = state.token ? await resolveDataBranch(state.token) : null;
    const result = state.token ? await fetchFileViaApi(state.token, state.dataBranch) : await fetchFileLocal();
    state.data = normalize(result.data);
  } catch (e) {
    console.error("load failed", e);
    state.error = friendlyError(e);
  } finally {
    state.loading = false;
    render();
  }
}

// ===== Saving: retained optimistic queue with conflict retry =====

function hasUnsavedChanges() {
  return saveQueue.length > 0;
}

function applyAndSave(op, message) {
  if (!state.token) {
    showToast("Войдите через ⚙, чтобы редактировать список");
    return false;
  }
  if (saveQueue.some((entry) => entry.login !== state.login)) {
    showToast("Сначала сохраните изменения предыдущего пользователя");
    return false;
  }
  op(state.data);
  render();
  enqueueSave(op, message);
  return true;
}

function enqueueSave(op, message) {
  saveQueue.push({ op, message, token: state.token, login: state.login });
  pendingSaves = saveQueue.length;
  updateSaveIndicator();
  void flushSaves();
}

function waitForSaves() {
  if (saveError) return Promise.reject(saveError);
  if (!saveQueue.length) return Promise.resolve();
  return new Promise((resolve, reject) => saveWaiters.push({ resolve, reject }));
}

function settleSaveWaiters(error) {
  if (!error) {
    for (const [key, snapshot] of draftCleanups) {
      if (JSON.stringify(readDraft(key)) === JSON.stringify(snapshot)) writeDraft(key, null);
    }
    draftCleanups.clear();
    if (catalogSavePending) {
      catalogSavePending = false;
      window.WatchlistTMDB?.acknowledgeSave();
    }
  }
  const waiters = saveWaiters.splice(0);
  for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
}

function rebindPendingSaves(token, login) {
  if (saveQueue.some((entry) => entry.login !== login)) return false;
  for (const entry of saveQueue) entry.token = token;
  return true;
}

function retryFailedSaves() {
  if (saveRunning || !saveQueue.length) return;
  saveError = null;
  updateSaveIndicator();
  void flushSaves();
}

async function flushSaves() {
  if (saveRunning || saveError || !saveQueue.length) return;
  saveRunning = true;
  try {
    while (saveQueue.length) {
      const entry = saveQueue[0];
      if (state.login !== entry.login) throw new Error("Войдите под автором несохранённых изменений");
      const saved = await performSave(entry.op, entry.message, entry.token);
      saveQueue.shift();
      // Keep subsequent optimistic edits visible while each operation is committed.
      state.data = saved;
      for (const pending of saveQueue) pending.op(state.data);
      pendingSaves = saveQueue.length;
      render();
      updateSaveIndicator();
    }
    settleSaveWaiters();
  } catch (error) {
    // The failed head remains queued. Never reload over unsaved local edits.
    saveError = error;
    settleSaveWaiters(error);
    showToast("Не удалось сохранить. Изменения остались здесь — нажмите «Повторить сохранение».");
  } finally {
    saveRunning = false;
    pendingSaves = saveQueue.length;
    updateSaveIndicator();
  }
}

async function performSave(op, message, token = state.token) {
  if (!token) throw new Error("Нет токена");
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const branch = await resolveDataBranch(token);
    state.dataBranch = branch;
    let fresh;
    try { fresh = await fetchFileViaApi(token, branch); }
    catch (error) {
      if (error.status !== 404) throw error;
      lastErr = error;
      continue;
    }
    fresh.data = normalize(fresh.data);
    op(fresh.data);
    const body = {
      message,
      content: utf8ToBase64(JSON.stringify(fresh.data, null, 2) + "\n"),
      sha: fresh.sha,
      branch
    };
    const res = await fetchTimed(API_CONTENTS_URL, {
      method: "PUT",
      headers: { ...apiHeaders(token), "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body)
    });
    if (res.ok) return normalize(fresh.data);
    lastErr = Object.assign(new Error(`GitHub API: HTTP ${res.status}`), { status: res.status });
    if (res.status === 404 || res.status === 409 || res.status === 422) continue;
    throw lastErr;
  }
  throw lastErr;
}

function updateSaveIndicator() {
  const ind = document.getElementById("save-indicator");
  if (!ind) return;
  clearTimeout(saveHideTimer);
  ind.setAttribute("role", "status");
  let retry = document.getElementById("retry-save-btn");
  if (!retry) {
    retry = el("button", { id: "retry-save-btn", type: "button", class: "btn retry-save-btn", text: "Повторить сохранение" });
    retry.addEventListener("click", retryFailedSaves);
    ind.after(retry);
  }
  retry.hidden = !saveError;
  retry.disabled = saveRunning;
  ind.classList.toggle("save-error", !!saveError);
  if (saveError) {
    ind.textContent = `Не сохранено: ${pendingSaves}. Не закрывайте страницу.`;
    ind.classList.add("visible");
    ind.classList.remove("busy");
  } else if (pendingSaves > 0) {
    ind.textContent = `Сохраняется: ${pendingSaves}…`;
    ind.classList.add("visible", "busy");
  } else {
    ind.textContent = "Сохранено";
    ind.classList.add("visible");
    ind.classList.remove("busy");
    saveHideTimer = setTimeout(() => ind.classList.remove("visible"), 1600);
  }
}

// ===== Operations (each is an absolute mutation applied to a data object) =====

function addItem(title, type, metadata = {}) {
  const item = {
    id: newId(),
    title,
    type,
    status: "planned",
    ratings: { S: null, L: null },
    comments: { S: "", L: "" },
    replies: [],
    reactions: {},
    genres: normalizeGenres(metadata.genres),
    note: "",
    addedAt: todayStr(),
    watchedAt: null,
    droppedAt: null,
    updatedBy: state.login
  };
  if (metadata.tmdb) item.tmdb = { ...metadata.tmdb };
  const op = (data) => {
    if (data.items.some((entry) => entry.id === item.id || (item.tmdb && entry.tmdb?.id === item.tmdb.id && entry.tmdb?.mediaType === item.tmdb.mediaType))) return;
    data.items.unshift(JSON.parse(JSON.stringify(item)));
  };
  return applyAndSave(op, `Add "${title}"`);
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
  const date = todayStr(), login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    if (toWatched) { it.status = "watched"; it.watchedAt = date; }
    else { it.status = "planned"; it.watchedAt = null; it.droppedAt = null; }
    it.updatedBy = login;
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
  closeEditors();
  if ((item.comments[person] || "") === text) { render(); return; }
  const login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.comments[person] = text;
    if (!text) delete it.reactions[person];
    it.updatedBy = login;
  };
  const message = text ? `Comment "${item.title}" as ${person}` : `Clear ${person} comment of "${item.title}"`;
  applyAndSave(op, message);
}

function closeEditors() {
  state.editingId = null;
  state.commentingId = null;
  state.replyDraft = null;
  state.editingReplyId = null;
}

function commentAuthor(item, target) {
  if (PEOPLE.includes(target)) return item.comments[target] ? target : null;
  return item.replies.find((r) => r.id === target)?.by || null;
}

function addReply(id, to, text) {
  const item = state.data.items.find((i) => i.id === id);
  const by = state.person;
  if (!state.token || !PEOPLE.includes(by) || !item) return;
  closeEditors();
  const trimmed = text.trim();
  if (!trimmed || !commentAuthor(item, to)) { render(); return; }
  const reply = { id: newId(), to, by, text: trimmed, at: new Date().toISOString() };
  const login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it || !commentAuthor(it, to) || it.replies.some((r) => r.id === reply.id)) return;
    it.replies.push({ ...reply });
    it.updatedBy = login;
  };
  const target = PEOPLE.includes(to) ? `${to} comment` : "reply";
  applyAndSave(op, `Reply to ${target} on "${item.title}" as ${by}`);
}

function editReply(id, replyId, text) {
  const item = state.data.items.find((i) => i.id === id);
  const by = state.person;
  const reply = item?.replies.find((r) => r.id === replyId);
  if (!state.token || !reply || reply.by !== by) return;
  closeEditors();
  const trimmed = text.trim();
  if (!trimmed || trimmed === reply.text) { render(); return; }
  const editedAt = new Date().toISOString();
  const login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    const r = it?.replies.find((r) => r.id === replyId);
    if (!r || r.by !== by) return;
    r.text = trimmed;
    r.editedAt = editedAt;
    it.updatedBy = login;
  };
  applyAndSave(op, `Edit reply on "${item.title}"`);
}

function deleteReply(id, replyId) {
  const item = state.data.items.find((i) => i.id === id);
  const by = state.person;
  const reply = item?.replies.find((r) => r.id === replyId);
  if (!state.token || !reply || reply.by !== by || !confirm("Удалить ответ?")) return;
  closeEditors();
  const login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    const r = it?.replies.find((r) => r.id === replyId);
    if (!r || r.by !== by) return;
    for (const child of it.replies) {
      if (child.to === replyId) child.to = r.to;
    }
    it.replies = it.replies.filter((r) => r.id !== replyId);
    delete it.reactions[replyId];
    it.updatedBy = login;
  };
  applyAndSave(op, `Delete reply on "${item.title}"`);
}

function reactToComment(id, target, kind) {
  const item = state.data.items.find((i) => i.id === id);
  const by = state.person;
  if (!state.token || !PEOPLE.includes(by) || !item ||
      !REACTION_KINDS.some((r) => r.key === kind)) return;
  const author = commentAuthor(item, target);
  if (!author || author === by) return;
  const selected = item.reactions[target]?.[by] === kind ? null : kind;
  const login = state.login;
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    const currentAuthor = commentAuthor(it, target);
    if (!currentAuthor || currentAuthor === by) return;
    const map = { ...it.reactions[target] };
    if (selected) map[by] = selected;
    else delete map[by];
    if (Object.keys(map).length) it.reactions = { ...it.reactions, [target]: map };
    else delete it.reactions[target];
    it.updatedBy = login;
  };
  const label = PEOPLE.includes(target) ? `${target} comment` : "reply";
  const message = selected
    ? `React ${selected} to ${label} on "${item.title}" as ${by}`
    : `Remove reaction on "${item.title}"`;
  applyAndSave(op, message);
}

function commitEdit(id, fields) {
  const item = state.data.items.find((i) => i.id === id);
  if (!item) return;
  const dateKey = fields.status === "watched" ? "watchedAt" : fields.status === "dropped" ? "droppedAt" : null;
  const transitioned = fields.status !== item.status;
  const date = fields.finishedAt || todayStr();
  const login = state.login;
  state.editingId = null; // close the editor on save
  const op = (data) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return;
    it.title = fields.title;
    it.type = fields.type;
    it.status = fields.status;
    it.note = fields.note;
    it.genres = normalizeGenres(fields.genres);
    // Capture the intended date once, including across conflict retries.
    if (dateKey && (transitioned || fields.dateEdited)) it[dateKey] = date;
    it.updatedBy = login;
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

function addCategory(label, color) {
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
  const chosenColor = color && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())
    ? color.trim()
    : PALETTE_PRESETS[types.length % PALETTE_PRESETS.length];
  const op = (data) => {
    if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
    data.types.push({ key, label: trimmed, color: chosenColor });
  };
  if (applyAndSave(op, `Add category "${trimmed}"`)) {
    showToast(`Категория «${trimmed}» добавлена`);
    renderCategoriesDialog();
  }
}

function updateCategoryColor(key, newColor) {
  const trimmed = newColor.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return;
  const current = getTypes().find((t) => t.key === key);
  if (!current || current.color === trimmed) return;
  const op = (data) => {
    if (!Array.isArray(data.types)) data.types = DEFAULT_TYPES.map((t) => ({ ...t }));
    const t = data.types.find((item) => item.key === key);
    if (t) t.color = trimmed;
  };
  if (applyAndSave(op, `Change color for category "${current.label}"`)) {
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
  if (pool.length === 0) { showToast("В списке «Все» пусто"); return; }
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
  persistView();
  renderHeader();
  updateTypeSelects();
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const isList = LIST_TABS.includes(state.tab);
  document.getElementById("list-tab").hidden = !isList;
  document.getElementById("stats-tab").hidden = state.tab !== "stats";
  document.getElementById("add-form").hidden = !state.token || state.tab !== "list";
  document.getElementById("mobile-add-btn").hidden = !state.token || state.tab !== "list";
  document.getElementById("chips").hidden = state.tab !== "list";
  document.getElementById("random-btn").hidden = state.tab !== "list";
  if (isList) renderList();
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
  const counts = { all: 0, planned: 0, watching: 0, watched: 0, dropped: 0 };
  base.forEach((it) => { if (counts[it.status] != null) counts[it.status]++; });
  counts.all = counts.planned;
  document.querySelectorAll("#chips .chip").forEach((chip) => {
    const key = chip.dataset.key;
    chip.querySelector(".count").textContent = String(counts[key]);
    chip.classList.toggle("active", state.statusFilter === key);
  });
  document.querySelectorAll(".tab-btn .count").forEach((span) => {
    span.textContent = String(counts[span.parentElement.dataset.tab]);
  });
}

function buildCommentEditor(person, text, save, label) {
  const identity = state.editingReplyId ? `edit-${state.editingReplyId}` : state.replyDraft ? `reply-${state.replyDraft.itemId}-${state.replyDraft.to}` : `comment-${state.commentingId}-${person}`;
  const key = draftKey("comment", identity);
  const ta = el("textarea", { class: "comment-input", rows: 2, placeholder: label, "aria-label": label });
  ta.value = readDraft(key)?.text ?? text;
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

function buildCommentActions(item, target, author, canEdit, isReply) {
  const actions = el("div", { class: "comment-controls" });
  const reactions = el("div", { class: "reaction-options", role: "group", "aria-label": "Реакции" });
  const links = el("div", { class: "comment-links" });
  const mine = canEdit && state.person === author;
  const map = item.reactions[target] || {};
  for (const kind of REACTION_KINDS) {
    const count = PEOPLE.filter((p) => map[p] === kind.key).length;
    const active = canEdit && map[state.person] === kind.key;
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

function replyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildComments(item, canEdit) {
  const comments = el("div", { class: "comments" });
  const sorted = item.replies.slice().sort((a, b) => a.at.localeCompare(b.at));
  const children = new Map();
  const ids = new Set(item.replies.map((r) => r.id));
  for (const reply of sorted) {
    if (!children.has(reply.to)) children.set(reply.to, []);
    children.get(reply.to).push(reply);
  }
  const appendDraft = (node, target) => {
    if (canEdit && state.replyDraft?.itemId === item.id && state.replyDraft.to === target) {
      node.append(buildCommentEditor(state.person, "", (text) => addReply(item.id, target, text), "Ваш ответ…"));
    }
  };
  // Flatten the tree so the visual indent can stop growing after level three.
  // Track reply objects to render malformed cycles/duplicate ids without looping or losing text.
  const visited = new Set();
  const appendReplies = (replies, depth) => {
    const stack = replies.slice().reverse().map((reply) => ({ reply, depth }));
    while (stack.length) {
      const { reply, depth } = stack.pop();
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
      for (let i = nested.length - 1; i >= 0; i--) stack.push({ reply: nested[i], depth: depth + 1 });
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
  appendReplies(sorted.filter((r) => !PEOPLE.includes(r.to) && !ids.has(r.to)), 1);
  for (const reply of sorted) if (!visited.has(reply)) appendReplies([reply], 1);
  return comments;
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
    children.push(el("span", { class: "item-meta", text: [meta.year, meta.runtime > 0 ? `${meta.runtime} мин${meta.mediaType === "tv" ? " / серия" : ""}` : ""].filter(Boolean).join(" · ") }));
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

function buildEditor(item) {
  const key = draftKey("item", item.id);
  const draft = readDraft(key);
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
  const genresInput = el("input", { type: "text", value: (item.genres || []).join(", "), placeholder: "Например: комедия, драма", "aria-label": "Жанры через запятую" });
  const genresField = el("label", { class: "edit-genres" }, el("span", { text: "Жанры через запятую" }), genresInput);
  const dateInput = el("input", { type: "date", class: "edit-date" });
  const dateLabel = el("span");
  const dateField = el("label", { class: "edit-date-field" }, dateLabel, dateInput,
    el("small", { text: "При смене статуса дата ставится автоматически. Можно исправить вручную." }));
  let dateEdited = false;
  const updateDateField = () => {
    const status = statusSelect.value;
    const key = status === "watched" ? "watchedAt" : status === "dropped" ? "droppedAt" : null;
    dateField.hidden = !key;
    dateLabel.textContent = status === "dropped" ? "Дата отказа от просмотра" : "Дата просмотра";
    dateInput.setAttribute("aria-label", dateLabel.textContent);
    dateInput.value = key ? (status !== item.status ? todayStr() : item[key] || "") : "";
    dateEdited = false;
  };
  updateDateField();
  statusSelect.addEventListener("change", updateDateField);
  dateInput.addEventListener("input", () => { dateEdited = true; });
  if (draft && typeof draft === "object") {
    titleInput.value = draft.title ?? item.title;
    typeSelect.value = getTypes().some((t) => t.key === draft.type) ? draft.type : item.type;
    statusSelect.value = STATUSES.includes(draft.status) ? draft.status : item.status;
    noteInput.value = draft.note ?? item.note;
    genresInput.value = draft.genres ?? (item.genres || []).join(", ");
    updateDateField();
    dateInput.value = draft.date ?? dateInput.value;
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
      status: statusSelect.value,
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
    if (q && !(it.title.toLowerCase().includes(q) || String(it.tmdb?.originalTitle || "").toLowerCase().includes(q) || it.note.toLowerCase().includes(q) || PEOPLE.some((p) => it.comments[p].toLowerCase().includes(q)) || it.replies.some((r) => r.text.toLowerCase().includes(q)))) return false;
    return true;
  });

  updateChips(base);
  const sorted = sortItems(base, state.sort);

  const status = state.tab !== "list" ? state.tab : state.statusFilter === "watching" ? "watching" : "planned";
  box.append(buildSection(sorted.filter((it) => it.status === status)));
}

// ===== Stats tab =====

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTH_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function statsFmt(value) {
  return value == null ? "—" : value.toFixed(1).replace(".", ",");
}

function computeMonths(items, today = new Date()) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
    return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, month: date.getMonth(), year: date.getFullYear(), count: 0, items: [] };
  });
  items.forEach((item) => {
    if (item.status !== "watched" || !item.watchedAt) return;
    const month = months.find((m) => m.key === item.watchedAt.slice(0, 7));
    if (month) { month.count++; month.items.push(item); }
  });
  return months;
}

function computeStats(items, types, today = new Date()) {
  const values = {}, counts = {}, averages = {};
  for (const person of PEOPLE) {
    values[person] = items.map((item) => item.ratings?.[person]).filter((r) => Number.isInteger(r) && r >= 1 && r <= 10);
    counts[person] = Array(11).fill(0);
    values[person].forEach((r) => counts[person][r]++);
    averages[person] = values[person].length ? values[person].reduce((sum, r) => sum + r, 0) / values[person].length : null;
  }
  const valid = (r) => Number.isInteger(r) && r >= 1 && r <= 10;
  const both = items.filter((item) => valid(item.ratings?.S) && valid(item.ratings?.L));
  const newer = (a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || "");
  const groups = new Map();
  both.forEach((item) => {
    const key = `${item.ratings.S}:${item.ratings.L}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  // Preserve items whose category is no longer in the configured list.
  const categories = types.map((type) => ({ ...type }));
  items.forEach((item) => {
    if (!categories.some((type) => type.key === item.type)) categories.push({ key: item.type, label: item.type || "Без типа", color: "var(--muted)" });
  });
  const watched = items.filter((item) => item.status === "watched");
  const watchedBoth = both.filter((item) => item.status === "watched");
  const genreGroups = new Map();
  watched.forEach((item) => {
    const seen = new Set();
    for (const raw of Array.isArray(item.genres) ? item.genres : []) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      const label = raw.trim(), key = label.toLocaleLowerCase("ru-RU");
      if (seen.has(key)) continue;
      seen.add(key);
      if (!genreGroups.has(key)) genreGroups.set(key, { label, items: [] });
      genreGroups.get(key).items.push(item);
    }
  });
  const genres = [...genreGroups.values()].map((genre) => {
    const paired = genre.items.filter((item) => valid(item.ratings?.S) && valid(item.ratings?.L));
    const people = Object.fromEntries(PEOPLE.map((person) => {
      const ratings = genre.items.map((item) => item.ratings?.[person]).filter(valid);
      return [person, { count: ratings.length, average: ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null }];
    }));
    return { label: genre.label, count: genre.items.length, people, paired: paired.length,
      agreement: paired.length ? 100 * (1 - paired.reduce((sum, item) => sum + Math.abs(item.ratings.S - item.ratings.L), 0) / paired.length / 9) : null };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentDate = `${currentMonth}-${String(today.getDate()).padStart(2, "0")}`;
  const monthly = watchedBoth.filter((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.watchedAt || "") || item.watchedAt.slice(0, 7) !== currentMonth || item.watchedAt > currentDate) return false;
    const day = Number(item.watchedAt.slice(8)), maxDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return day >= 1 && day <= maxDay;
  });
  const bestMonthly = Math.max(0, ...monthly.map((item) => item.ratings.S + item.ratings.L));
  return {
    values, counts, averages, both, groups, genres,
    favoriteMonth: { label: `${MONTH_FULL[today.getMonth()]} ${today.getFullYear()}`, count: monthly.length,
      items: monthly.filter((item) => item.ratings.S + item.ratings.L === bestMonthly).sort((a, b) => newer(a, b) || a.title.localeCompare(b.title, "ru")) },
    close: both.filter((item) => Math.abs(item.ratings.S - item.ratings.L) <= 1).length,
    exact: both.filter((item) => item.ratings.S === item.ratings.L).length,
    statuses: Object.fromEntries(STATUSES.map((status) => [status, items.filter((item) => item.status === status).length])),
    months: computeMonths(items, today),
    diffs: watchedBoth.filter((item) => item.ratings.S !== item.ratings.L).sort((a, b) => Math.abs(b.ratings.S - b.ratings.L) - Math.abs(a.ratings.S - a.ratings.L) || newer(a, b)).slice(0, 5),
    top: [...both].sort((a, b) => (b.ratings.S + b.ratings.L) - (a.ratings.S + a.ratings.L) || newer(a, b)).slice(0, 10),
    categories: categories.map((type) => ({ ...type, total: items.filter((item) => item.type === type.key).length, watched: items.filter((item) => item.type === type.key && item.status === "watched").length }))
  };
}

function statsSvg(tag, attrs, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  children.flat().forEach((child) => { if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child))); });
  return node;
}

function statsChart(width, height, label, interactive = false) {
  return statsSvg("svg", { width: "100%", viewBox: `0 0 ${width} ${height}`, role: interactive ? "group" : "img", "aria-label": label });
}

function statsWho(person, text = person) {
  return el("b", { class: `who ${person.toLowerCase()}`, text });
}

function statsBadge(item) {
  const type = getTypes().find((t) => t.key === item.type);
  return el("span", { class: "badge", style: `--c:${type?.color || "var(--muted)"}`, text: type?.label || item.type || "Без типа" });
}

function statsEmpty(text) {
  return el("p", { class: "empty", text });
}

function statsSection(key, title, note) {
  const body = el("div", { class: "sec-body", id: key });
  const section = el("section", { class: `card sec-${key}`, "aria-labelledby": `h-${key}` },
    el("h2", { class: "sec-title", id: `h-${key}`, text: title }),
    note ? el("p", { class: "sec-note", text: note }) : null, body);
  return { section, body };
}

function statsLegend(entries) {
  return el("div", { class: "legend" }, ...entries.map(([label, color]) => el("span", {}, el("i", { class: "sw", style: `background:${color}`, "aria-hidden": "true" }), label)));
}

function statsTooltip(tip, node, content) {
  const hide = () => { tip.hidden = true; };
  const show = () => {
    tip.replaceChildren(...content());
    tip.hidden = false;
    const bounds = node.getBoundingClientRect(), margin = 8;
    tip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tip.offsetWidth - margin, bounds.left + bounds.width / 2 - tip.offsetWidth / 2))}px`;
    const top = bounds.top - tip.offsetHeight - margin;
    tip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tip.offsetHeight - margin, top < margin ? bounds.bottom + margin : top))}px`;
  };
  node.addEventListener("pointerenter", show);
  node.addEventListener("focus", show);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("blur", hide);
  node.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
}

function renderStatsHero(items, data) {
  const card = (name, label, ...children) => el("div", { class: `card hero-${name}` }, el("div", { class: "kpi-label", text: label }), ...children);
  const statuses = [
    ["watched", "Просмотрено", "var(--accent)"], ["watching", "Смотрим", "color-mix(in srgb,var(--accent) 50%,transparent)"],
    ["planned", "В планах", "var(--track)"], ["dropped", "Брошено", "var(--danger)"]
  ];
  const watched = card("watched", "Просмотрено", el("div", { class: "kpi" }, data.statuses.watched, el("small", { text: ` из ${items.length}` })));
  if (items.length) watched.append(el("div", { class: "status-bar", role: "img", "aria-label": statuses.map(([key, label]) => `${label}: ${data.statuses[key]}`).join(", ") },
    ...statuses.filter(([key]) => data.statuses[key]).map(([key, label, color]) => el("i", { style: `flex:${data.statuses[key]};background:${color}`, title: `${label}: ${data.statuses[key]}` }))),
    statsLegend(statuses.map(([key, label, color]) => [`${label} ${data.statuses[key]}`, color])));
  else watched.append(statsEmpty("Список пока пуст"));
  const average = card("avg", "Средняя оценка");
  if (data.values.S.length || data.values.L.length) {
    average.append(el("div", { class: "vs" },
      el("div", { class: "vs-side s" }, statsWho("S"), el("span", { class: "kpi", text: statsFmt(data.averages.S) })),
      el("div", { class: "vs-sep", text: "vs" }),
      el("div", { class: "vs-side l" }, statsWho("L"), el("span", { class: "kpi", text: statsFmt(data.averages.L) }))));
    average.append(el("div", { class: "avg-bars", "aria-hidden": "true" },
      ...PEOPLE.map((person) => el("div", { class: `avg-bar ${person.toLowerCase()}` }, el("i", { style: `width:${(data.averages[person] || 0) * 10}%` }))),
      el("div", { class: "avg-ticks" }, ...[0, 5, 10].map((n) => el("span", { text: n })))));
    let caption = "Для сравнения нужны оценки S и L";
    if (data.averages.S != null && data.averages.L != null) {
      const difference = data.averages.S - data.averages.L;
      caption = Math.abs(difference) < 0.05 ? "Поровну" : `${difference > 0 ? "S" : "L"} щедрее на ${statsFmt(Math.abs(difference))}`;
    }
    average.append(el("div", { class: "kpi-cap", text: caption }));
  } else average.append(statsEmpty("Пока нет оценок"));
  average.append(el("div", { class: "kpi-cap", text: `Оценок: S ${data.values.S.length} · L ${data.values.L.length}` }));
  const match = card("match", "Совпадение вкусов");
  if (data.both.length) {
    const percentage = Math.round(data.close / data.both.length * 100), circumference = 2 * Math.PI * 24;
    const ring = statsSvg("svg", { width: 60, height: 60, viewBox: "0 0 60 60", "aria-hidden": "true" },
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--track)", "stroke-width": 8 }),
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--accent)", "stroke-width": 8, "stroke-dasharray": `${circumference * data.close / data.both.length} ${circumference}`, transform: "rotate(-90 30 30)" }));
    match.append(el("div", { class: "match" }, ring, el("div", { class: "kpi-m", text: `${percentage}%` })), el("div", { class: "kpi-cap", text: `${data.close} из ${data.both.length} общих оценок с разницей ≤ 1` }));
  } else match.append(statsEmpty("Пока нет общих оценок"));
  const both = card("both", "Оценили оба", el("div", { class: "kpi-m", text: data.both.length }), el("div", { class: "kpi-cap", text: `Совпали точно: ${data.exact}` }));
  return el("section", { class: "hero", "aria-label": "Главное" }, watched, average, match, both);
}

function renderStatsHistogram(data, tip) {
  const mode = (person) => data.counts[person].indexOf(Math.max(...data.counts[person]));
  const phrases = PEOPLE.filter((person) => data.values[person].length).map((person, i) => `${person}${i ? " —" : " ставит"} ${mode(person)}`);
  const { section, body } = statsSection("hist", "Распределение оценок", phrases.length ? `Чаще всего ${phrases.join(", ")}` : null);
  if (!phrases.length) { body.append(statsEmpty("Пока нет оценок")); return section; }
  const chart = statsChart(440, 220, "Распределение оценок S и L от 1 до 10");
  const max = Math.max(...data.counts.S, ...data.counts.L), step = max <= 4 ? 1 : Math.ceil(max / 4), ceiling = Math.ceil(max / step) * step;
  const y = (n) => 182 - n / ceiling * 160;
  for (let n = 0; n <= ceiling; n += step) chart.append(statsSvg("line", { class: "grid", x1: 26, x2: 438, y1: y(n), y2: y(n) }), statsSvg("text", { class: "ax", x: 18, y: y(n) + 4, "text-anchor": "end" }, n));
  for (let rating = 1; rating <= 10; rating++) {
    const cx = 26 + (rating - 0.5) * 41.2;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `Оценка ${rating}: S ${data.counts.S[rating]}, L ${data.counts.L[rating]}` });
    group.append(statsSvg("rect", { class: "col-bg", x: cx - 19, y: 4, width: 38, height: 198, rx: 6 }));
    PEOPLE.forEach((person, index) => {
      const count = data.counts[person][rating], x = cx + (index ? 1 : -15);
      if (count) group.append(statsSvg("rect", { x, y: y(count), width: 14, height: 182 - y(count), rx: 3, fill: `var(--${person.toLowerCase()})` }), statsSvg("text", { class: "val", x: x + 7, y: y(count) - 5, "text-anchor": "middle", fill: `var(--${person.toLowerCase()})` }, count));
    });
    group.append(statsSvg("text", { class: "ax-strong", x: cx, y: 201, "text-anchor": "middle" }, rating));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `Оценка ${rating}` }), ...PEOPLE.map((person) => el("div", { class: "tip-row" }, statsWho(person), `${data.counts[person][rating]} тайтлов`))]);
    chart.append(group);
  }
  chart.append(statsSvg("text", { class: "ax", x: 232, y: 218, "text-anchor": "middle" }, "оценка"));
  body.append(statsLegend([["S", "var(--s)"], ["L", "var(--l)"]]), el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsMonths(data, tip) {
  const total = data.months.reduce((sum, month) => sum + month.count, 0);
  const best = data.months.reduce((a, b) => b.count > a.count ? b : a);
  const note = total ? `${total} за 12 месяцев · больше всего — ${MONTH_FULL[best.month]} (${best.count}) · текущий месяц ещё идёт` : "Последние 12 календарных месяцев · текущий месяц ещё идёт";
  const { section, body } = statsSection("months", "Просмотрено по месяцам", note);
  if (!total) { body.append(statsEmpty("За последние 12 месяцев ничего не просмотрено")); return section; }
  const chart = statsChart(440, 220, "Просмотрено за последние 12 календарных месяцев");
  const max = Math.max(...data.months.map((month) => month.count));
  chart.append(statsSvg("line", { class: "grid", x1: 2, x2: 438, y1: 192, y2: 192 }));
  data.months.forEach((month, index) => {
    const x = 2 + (index + 0.5) * 436 / 12, height = month.count / max * 168;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `${MONTH_FULL[month.month]} ${month.year}: ${month.count}` });
    group.append(statsSvg("rect", { class: "col-bg", x: x - 17, y: 4, width: 34, height: 214, rx: 6 }),
      statsSvg("rect", { x: x - 11, y: month.count ? 192 - height : 190, width: 22, height: month.count ? height : 2, rx: 3, fill: month.count ? "var(--accent)" : "var(--track)", "fill-opacity": index === 11 ? 0.55 : 1 }),
      statsSvg("text", { class: "val", x, y: month.count ? 187 - height : 183, "text-anchor": "middle", fill: "var(--text)" }, month.count),
      statsSvg("text", { class: index === 11 ? "ax-strong" : "ax", x, y: 212, "text-anchor": "middle" }, MONTH_NAMES[month.month]));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `${MONTH_FULL[month.month]} ${month.year}` }), ...(month.items.length ? month.items.map((item) => el("div", { class: "tip-row", text: item.title })) : [el("div", { class: "tip-sub", text: "Ничего не просмотрено" })])]);
    chart.append(group);
  });
  body.append(el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsScatter(data, tip) {
  const { section, body } = statsSection("scatter", "S против L", "Каждая точка — тайтл, оценённый обоими. Нажмите на точку, чтобы увидеть названия.");
  if (!data.both.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  const chart = statsChart(440, 440, "Оценка S по горизонтали, оценка L по вертикали. Выберите точку, чтобы увидеть тайтлы", true);
  const x = (value) => 30 + (value - 0.5) * 40, y = (value) => 404 - (value - 0.5) * 39.4;
  const band = [[0.5, 1.5], [9.5, 10.5], [10.5, 10.5], [10.5, 9.5], [1.5, 0.5], [0.5, 0.5]];
  chart.append(statsSvg("polygon", { points: band.map(([s, l]) => `${x(s)},${y(l)}`).join(" "), fill: "var(--accent)", "fill-opacity": 0.1 }));
  for (let rating = 1; rating <= 10; rating++) chart.append(
    statsSvg("line", { class: "grid", x1: x(rating), x2: x(rating), y1: 10, y2: 404 }), statsSvg("line", { class: "grid", x1: 30, x2: 430, y1: y(rating), y2: y(rating) }),
    statsSvg("text", { class: "ax-strong", x: x(rating), y: 420, "text-anchor": "middle" }, rating), statsSvg("text", { class: "ax-strong", x: 22, y: y(rating) + 4, "text-anchor": "end" }, rating));
  chart.append(statsSvg("line", { x1: x(0.5), x2: x(10.5), y1: y(0.5), y2: y(10.5), stroke: "var(--muted)", "stroke-dasharray": "5 5" }),
    statsSvg("text", { class: "ax", x: 150, y: 265, transform: "rotate(-45 150 265)", "text-anchor": "middle" }, "согласны · ±1"),
    statsSvg("text", { x: x(1), y: y(10), fill: "var(--l)", "font-size": 12, "font-weight": 600 }, "L выше"),
    statsSvg("text", { x: x(10), y: y(1), fill: "var(--s)", "font-size": 12, "font-weight": 600, "text-anchor": "end" }, "S выше"),
    statsSvg("text", { class: "ax", x: 230, y: 438, "text-anchor": "middle" }, "оценка S →"),
    statsSvg("text", { class: "ax", transform: "translate(9 207) rotate(-90)", "text-anchor": "middle" }, "оценка L →"));
  const detail = el("div", { class: "scatter-detail", id: "scatter-detail", hidden: true, role: "region", "aria-label": "Выбранные тайтлы", "aria-live": "polite" });
  const points = [];
  [...data.groups.values()].sort((a, b) => b.length - a.length).forEach((items) => {
    const { S: s, L: l } = items[0].ratings, color = s > l ? "var(--s)" : l > s ? "var(--l)" : "var(--accent)";
    const point = statsSvg("g", { class: "pt", tabindex: 0, role: "button", "aria-label": `S ${s}, L ${l}: ${items.map((item) => item.title).join(", ")}. Показать тайтлы`, "aria-controls": "scatter-detail", "aria-expanded": "false", "fill-opacity": 0.5 });
    point.append(statsSvg("circle", { cx: x(s), cy: y(l), r: Math.min(18, 7 + (items.length - 1) * 4), fill: color, stroke: color, "stroke-width": 1.5 }));
    if (items.length > 1) point.append(statsSvg("text", { x: x(s), y: y(l) + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "var(--text)", "fill-opacity": 1 }, items.length));
    const select = () => {
      tip.hidden = true;
      points.forEach((other) => other.setAttribute("aria-expanded", String(other === point)));
      detail.replaceChildren(el("div", { class: "scatter-detail-head" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)),
        el("div", { class: "scatter-detail-list" }, ...items.map((item) => el("div", { class: "scatter-detail-item" }, el("span", { class: "title", text: item.title }), statsBadge(item)))));
      detail.hidden = false;
    };
    point.addEventListener("click", select);
    point.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    statsTooltip(tip, point, () => items.map((item) => el("div", { class: "tip-row" }, el("span", { text: item.title }), el("span", { class: "tip-r" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)))));
    points.push(point); chart.append(point);
  });
  body.append(el("div", { class: "chart scatter-box" }, chart), statsLegend([["S выше", "var(--s)"], ["L выше", "var(--l)"], ["поровну", "var(--accent)"]]),
    el("p", { class: "sec-note", text: "Размер и число — сколько тайтлов" }), detail);
  return section;
}

function statsItemButton(item) {
  const button = el("button", { type: "button", class: "title stats-title-button", text: item.title, title: item.title, "aria-label": `Открыть обсуждение: ${item.title}` });
  button.addEventListener("click", () => {
    closeEditors();
    state.tab = LIST_TABS.includes(item.status) ? item.status : "list";
    state.statusFilter = item.status === "watching" ? "watching" : "all";
    state.typeFilter = "all";
    state.search = "";
    document.getElementById("search").value = "";
    state.highlightId = item.id;
    openItems.add(item.id);
    render();
    const row = document.querySelector(`.item-row[data-id="${CSS.escape(item.id)}"]`);
    if (row) { row.setAttribute("tabindex", "-1"); row.focus({ preventScroll: true }); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      state.highlightId = null;
      document.querySelectorAll(".item-row.highlight").forEach((node) => node.classList.remove("highlight"));
    }, 3000);
  });
  return button;
}

function renderStatsGenres(data) {
  const { section, body } = statsSection("genres", "Совпадение по жанрам", "Только просмотренное. Один тайтл может входить в несколько жанров.");
  if (!data.genres.length) { body.append(statsEmpty("Добавьте жанры в редакторе просмотренных тайтлов — здесь появится сравнение ваших вкусов.")); return section; }
  body.append(el("div", { class: "genre-grid" }, ...data.genres.map((genre) => {
    const card = el("article", { class: "genre-card" },
      el("div", { class: "genre-head" }, el("h3", { text: genre.label }), el("span", { class: "genre-count", text: `Просмотрено: ${genre.count}` })),
      el("div", { class: "genre-ratings" }, ...PEOPLE.map((person) => el("div", { class: "genre-rating" },
        statsWho(person), el("strong", { text: statsFmt(genre.people[person].average) }),
        el("span", { class: "genre-count", text: `оценок: ${genre.people[person].count}` })))),
      el("div", { class: "genre-agreement" }, el("strong", { text: genre.agreement == null ? "Пока не сравнить" : `${Math.round(genre.agreement)}% совпадения` }),
        el("span", { class: "genre-count", text: `Оценили оба: ${genre.paired}` })));
    if (genre.agreement != null) card.append(el("div", { class: "genre-meter", "aria-hidden": "true" }, el("i", { style: `width:${genre.agreement}%` })));
    if (genre.paired < 3) card.append(el("p", { class: "sec-note", text: genre.paired ? "Пока мало совместных оценок — результат предварительный." : "Нужны оценки обоих на одни и те же тайтлы." }));
    return card;
  })));
  body.append(el("p", { class: "sec-note genre-formula", text: "Средние оценки S и L учитывают все их оценки в жанре. Совпадение = 100 × (1 − средняя разница общих оценок / 9): одинаковые оценки дают 100%, разница в 9 баллов — 0%." }));
  return section;
}

function renderStatsFavorite(data) {
  const favorite = data.favoriteMonth;
  const { section, body } = statsSection("favorite", "Фаворит месяца", `${favorite.label} · по средней оценке двоих`);
  if (!favorite.items.length) { body.append(statsEmpty("В этом месяце пока нет просмотренных тайтлов с датой и оценками обоих.")); return section; }
  body.append(el("p", { class: "sec-note", text: `Тайтлов с двумя оценками за месяц: ${favorite.count}${favorite.items.length > 1 ? ". Первое место разделили:" : ""}` }));
  favorite.items.forEach((item) => body.append(el("div", { class: "favorite-row" },
    el("div", { class: "favorite-main" }, statsItemButton(item), statsBadge(item)),
    el("div", { class: "pair" }, statsWho("S", `S ${item.ratings.S}`), statsWho("L", `L ${item.ratings.L}`)),
    el("strong", { class: "favorite-score", "aria-label": `Средняя оценка ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

function renderStatsDiffs(data) {
  const { section, body } = statsSection("diff", "Самые спорные просмотры", "Пять самых больших расхождений среди просмотренного. Нажмите на название, чтобы открыть обсуждение.");
  body.id = "diffs";
  if (!data.diffs.length) { body.append(statsEmpty("Пока нет просмотренных тайтлов с разными оценками обоих.")); return section; }
  const position = (value) => (value - 1) / 9 * 100;
  data.diffs.forEach((item) => {
    const { S: s, L: l } = item.ratings;
    const scale = el("div", { class: "scale", "aria-hidden": "true" }, el("div", { class: "scale-track" }));
    for (let value = 1; value <= 10; value++) scale.append(el("i", { class: "scale-tick", style: `left:${position(value)}%` }));
    scale.append(el("i", { class: "scale-line", style: `left:${position(Math.min(s, l))}%;width:${Math.abs(s - l) / 9 * 100}%;background:linear-gradient(90deg,var(--${s <= l ? "s" : "l"}),var(--${s <= l ? "l" : "s"}))` }),
      el("span", { class: "dot s", style: `left:${position(s)}%`, text: "S" }), el("span", { class: "dot l", style: `left:${position(l)}%`, text: "L" }));
    body.append(el("div", { class: "row" }, el("div", { class: "row-head" }, statsItemButton(item),
      el("span", { class: "pair" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)), el("span", { class: "delta", "aria-label": `разница ${Math.abs(s - l)}`, text: `Δ ${Math.abs(s - l)}` })), scale));
  });
  body.append(el("div", { class: "scale-axis", "aria-hidden": "true" }, ...Array.from({ length: 10 }, (_, i) => el("span", { style: `left:${position(i + 1)}%`, text: i + 1 }))));
  return section;
}

function renderStatsCategories(items, data) {
  const { section, body } = statsSection("cats", "По типам", "Длина отрезка — всего в списке, заливка — просмотрено");
  if (!items.length) { body.append(statsEmpty("Список пока пуст")); return section; }
  body.append(el("div", { class: "seg", role: "img", "aria-label": data.categories.map((type) => `${type.label}: ${type.watched} из ${type.total}`).join(", ") },
    ...data.categories.filter((type) => type.total).map((type) => el("div", { class: "seg-part", style: `--c:${type.color || "var(--muted)"};flex:${type.total}`, title: `${type.label}: ${type.watched} из ${type.total}` }, el("i", { style: `width:${type.watched / type.total * 100}%` })))),
    el("div", { class: "cat-grid" }, ...data.categories.map((type) => el("div", { class: "cat-item" }, el("span", { class: "cat-name" }, el("i", { class: "sw", style: `background:${type.color || "var(--muted)"}` }), type.label), el("span", { class: "cnt" }, type.watched, el("small", { text: ` / ${type.total}` }))))));
  return section;
}

function renderStatsTop(data) {
  const { section, body } = statsSection("top", "Топ по средней оценке", "Только тайтлы, оценённые обоими");
  if (!data.top.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  body.style.setProperty("--top-rows", Math.ceil(data.top.length / 2));
  data.top.forEach((item, index) => body.append(el("div", { class: "top-row" }, el("span", { class: "rank", text: index + 1 }),
    el("div", { class: "top-main" }, el("span", { class: "title", text: item.title, title: item.title }), statsBadge(item)),
    el("div", { class: "mini-pair", "aria-label": `S ${item.ratings.S}, L ${item.ratings.L}` }, ...PEOPLE.map((person) => el("div", { class: `mini ${person.toLowerCase()}`, "aria-hidden": "true" }, el("b", { text: person }), el("span", { class: "mini-bar" }, el("i", { style: `width:${item.ratings[person] * 10}%` })), el("span", { text: item.ratings[person] })))),
    el("span", { class: "avg", "aria-label": `средняя ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

function renderStats() {
  const box = document.getElementById("stats");
  box.textContent = "";
  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  const items = state.data?.items || [], data = computeStats(items, getTypes());
  const tip = el("div", { class: "tip", role: "tooltip", hidden: true });
  const stack = el("div", { class: "stack" }, renderStatsHero(items, data), renderStatsFavorite(data), renderStatsDiffs(data), renderStatsGenres(data), renderStatsHistogram(data, tip), renderStatsMonths(data, tip), renderStatsScatter(data, tip), renderStatsCategories(items, data), renderStatsTop(data));
  box.append(el("div", { class: "stats-wrap" }, el("header", { class: "page-head" }, el("h1", { text: "Статистика" }), el("p", { text: `S и L · данные на ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` })), stack), tip);
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
  let branchStatus = document.getElementById("data-branch-status");
  if (!branchStatus) {
    branchStatus = el("p", { id: "data-branch-status", class: "settings-text", style: "color: var(--muted)" });
    dlg.querySelector("h2").after(branchStatus);
  }
  branchStatus.textContent = `Данные: ${state.dataBranch || "опубликованная версия GitHub Pages"}`;
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
    if (!rebindPendingSaves(token, user.login || "")) {
      errEl.textContent = "Сначала сохраните изменения текущего пользователя. Можно обновить его токен.";
      return;
    }
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_LOGIN, user.login || "");
    localStorage.removeItem(LS_PERSON); // legacy: person is now derived from the login
    state.token = token;
    state.login = user.login || "";
    state.person = personFor(state.login);
    retryFailedSaves();
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
  if (hasUnsavedChanges()) { showToast("Сначала сохраните изменения — нажмите «Повторить сохранение»."); return; }
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

let selectedCategoryKey = null;

function renderPaletteSwatches() {
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
      }
      const newColorInput = document.getElementById("new-category-color");
      if (newColorInput) newColorInput.value = hex;
    });
    container.append(btn);
  });
}

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

    const row = el("div", { class: "category-row" }, colorInput, input, saveBtn, countSpan, delBtn);
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

function persistView() {
  if (state.loading) return;
  writeLocal("watchlist.view", { tab: state.tab, statusFilter: state.statusFilter, typeFilter: state.typeFilter, search: state.search, sort: state.sort });
}

function init() {
  const savedScroll = readLocal("watchlist.scroll", {});
  const tabScroll = { list: 0, watched: 0, dropped: 0, stats: 0 };
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  // Tabs.
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabScroll[state.tab] = window.scrollY;
      state.tab = btn.dataset.tab;
      render();
      window.scrollTo(0, tabScroll[state.tab] || 0);
    });
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

  updateTypeSelects();
  const initCatalog = () => WatchlistTMDB.init({
    getItems: () => state.data?.items || [], getTypes, canEdit: () => !!state.token && !state.loading && !state.error,
    add: async (title, type, metadata) => {
      if (metadata?.tmdb && state.data.items.some((it) => it.tmdb?.id === metadata.tmdb.id && it.tmdb?.mediaType === metadata.tmdb.mediaType)) {
        throw new Error("Этот тайтл уже есть в списке.");
      }
      if (!addItem(title, type, metadata)) return false;
      catalogSavePending = true;
      await waitForSaves();
      return true;
    }
  });
  const view = readLocal("watchlist.view", {});
  state.tab = view.tab === "stats" || LIST_TABS.includes(view.tab) ? view.tab : "list";
  if (state.tab === "list" && (view.statusFilter === "watched" || view.statusFilter === "dropped")) state.tab = view.statusFilter;
  state.statusFilter = CHIPS.some((c) => c.key === view.statusFilter) ? view.statusFilter : "all";
  state.typeFilter = typeof view.typeFilter === "string" ? view.typeFilter : "all";
  state.search = typeof view.search === "string" ? view.search : "";
  state.sort = SORTS.some((s) => s.key === view.sort) ? view.sort : "added-desc";
  searchInput.value = state.search;
  sortSel.value = state.sort;
  const clearFilters = el("button", { type: "button", class: "btn", text: "Сбросить фильтры" });
  clearFilters.addEventListener("click", () => { state.statusFilter = "all"; state.typeFilter = "all"; state.search = ""; searchInput.value = ""; render(); });
  document.querySelector(".filters").append(clearFilters);
  let scrollTimer;
  window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => writeLocal("watchlist.scroll", { tab: state.tab, y: window.scrollY }), 200); }, { passive: true });

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
  const newCategoryColor = document.getElementById("new-category-color");
  addCategoryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = newCategoryInput.value.trim();
    if (!val) return;
    const color = newCategoryColor ? newCategoryColor.value : null;
    addCategory(val, color);
    newCategoryInput.value = "";
    if (newCategoryColor) {
      newCategoryColor.value = PALETTE_PRESETS[getTypes().length % PALETTE_PRESETS.length];
    }
  });

  render();
  loadAll().then(() => {
    initCatalog();
    if (savedScroll.tab === state.tab && Number.isFinite(savedScroll.y)) window.scrollTo(0, savedScroll.y);
  });
}

document.addEventListener("DOMContentLoaded", init);
