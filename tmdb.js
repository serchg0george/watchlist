/* TMDB search and local add drafts. Credentials never enter item metadata. */
"use strict";

window.WatchlistTMDB = (() => {
  const TOKEN_KEY = "watchlist.tmdbToken";
  const DRAFT_KEY = "watchlist.addDraft";
  const API = "https://api.themoviedb.org/3";
  let hooks, input, typeSelect, status, results, preview, searchButton, manualButton;
  let selected = null, controller = null, generation = 0, saving = false;
  let submittedDraft = null;
  let token = read(TOKEN_KEY) || "";

  function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function write(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }
  function node(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "text") element.textContent = value;
      else if (key === "class") element.className = value;
      else element.setAttribute(key, value);
    }
    children.filter(Boolean).forEach((child) => element.append(child));
    return element;
  }
  function message(text) { status.textContent = text; }
  function safePoster(path) { return typeof path === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(path) ? path : null; }
  function image(path) {
    const valid = safePoster(path);
    if (!valid) return node("span", { class: "tmdb-poster tmdb-no-poster", text: "Нет постера" });
    const img = node("img", { class: "tmdb-poster", src: `https://image.tmdb.org/t/p/w185${valid}`, alt: "", loading: "lazy", width: "92", height: "138" });
    img.addEventListener("error", () => img.replaceWith(node("span", { class: "tmdb-poster tmdb-no-poster", text: "Нет постера" })));
    return img;
  }
  function parseQuery(value) {
    const query = value.trim();
    if (!query) throw new Error("Введите название или ссылку.");
    if (!/^([a-z][a-z\d+.-]*:\/\/|www\.|(?:themoviedb|imdb)\.org|imdb\.com)/i.test(query)) return { query };
    let url;
    try { url = new URL(query.startsWith("https://") || query.startsWith("http://") ? query : `https://${query}`); }
    catch (_) { throw new Error("Не удалось прочитать ссылку. Введите название вручную."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Поддерживаются HTTPS-ссылки TMDB и IMDb.");
    const host = url.hostname.toLowerCase();
    let match;
    if ((host === "themoviedb.org" || host === "www.themoviedb.org") && (match = url.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]*)?\/?$/))) {
      const id = Number(match[2]);
      if (Number.isSafeInteger(id) && id > 0) return { mediaType: match[1], id };
    }
    if (["imdb.com", "www.imdb.com", "m.imdb.com"].includes(host) && (match = url.pathname.match(/^\/title\/(tt\d+)\/?$/))) return { imdbId: match[1] };
    throw new Error("Нужна ссылка на фильм или сериал TMDB / IMDb. Или введите название.");
  }
  function cancel() { generation++; if (controller) controller.abort(); controller = null; }
  async function request(path, params, signal) {
    if (!token) throw new Error("Добавьте токен TMDB в настройках ⚙ или используйте ручное добавление.");
    const url = new URL(API + path);
    Object.entries({ language: "ru-RU", ...params }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    let response;
    try { response = await fetch(url.href, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal, cache: "no-store", credentials: "omit", redirect: "error" }); }
    catch (error) { if (error.name === "AbortError") throw error; throw new Error("TMDB недоступен. Проверьте интернет или добавьте вручную — текст сохранён."); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("TMDB не принял токен. Проверьте его в настройках ⚙.");
      if (response.status === 429) throw new Error("Слишком много запросов к TMDB. Попробуйте чуть позже.");
      if (response.status === 404) throw new Error("Этот фильм или сериал не найден в TMDB.");
      throw new Error("Не удалось получить данные TMDB. Попробуйте ещё раз или добавьте вручную.");
    }
    try { return await response.json(); } catch (_) { throw new Error("TMDB вернул неполный ответ. Попробуйте ещё раз."); }
  }
  async function run(work) {
    cancel();
    const current = generation;
    const active = new AbortController(); controller = active;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; active.abort(); }, 12000);
    searchButton.disabled = true;
    try { await work(active.signal, () => current === generation); }
    catch (error) {
      if (current === generation) message(timedOut ? "TMDB долго не отвечает. Повторите поиск или добавьте вручную." : error.name === "AbortError" ? "Поиск отменён." : error.message);
    } finally {
      clearTimeout(timer);
      if (current === generation) { controller = null; searchButton.disabled = saving; }
    }
  }
  function asMetadata(raw, mediaType) {
    if (!Number.isSafeInteger(raw.id) || raw.id <= 0 || !["movie", "tv"].includes(mediaType)) throw new Error("TMDB вернул неполные данные.");
    const title = String(raw.title || raw.name || raw.original_title || raw.original_name || "").trim();
    if (!title) throw new Error("У результата нет названия. Добавьте его вручную.");
    const date = raw.release_date || raw.first_air_date || "";
    const runtime = mediaType === "movie" ? raw.runtime : (raw.episode_run_time || []).find((value) => Number.isInteger(value) && value > 0);
    const imdbId = raw.imdb_id || raw.external_ids?.imdb_id;
    return { title, tmdb: { id: raw.id, mediaType,
      originalTitle: String(raw.original_title || raw.original_name || title),
      year: /^\d{4}-/.test(date) ? Number(date.slice(0, 4)) : null,
      overview: typeof raw.overview === "string" ? raw.overview : "",
      posterPath: safePoster(raw.poster_path),
      runtime: Number.isInteger(runtime) && runtime > 0 ? runtime : null,
      ...(/^tt\d+$/.test(imdbId || "") ? { imdbId } : {}) },
      genres: [...new Set((Array.isArray(raw.genres) ? raw.genres : []).map((genre) => genre?.name).filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))] };
  }
  function duplicate(value) {
    return hooks.getItems().find((item) => item.tmdb?.id === value.tmdb.id && item.tmdb?.mediaType === value.tmdb.mediaType);
  }
  function persist() {
    const ok = write(DRAFT_KEY, JSON.stringify({ query: input.value, type: typeSelect.value, selected }));
    if (!ok) message("Браузер не сохранил черновик. Не закрывайте страницу до сохранения.");
  }
  function draftSignature() { return JSON.stringify({ query: input.value, type: typeSelect.value, selected }); }
  function acknowledgeSave() {
    if (submittedDraft === draftSignature()) { clearDraft(); message("Добавлено в список."); }
    submittedDraft = null;
  }
  function renderPreview() {
    preview.replaceChildren();
    preview.hidden = !selected;
    if (!selected) return;
    const value = selected;
    const tmdb = value.tmdb;
    const bits = [tmdb.mediaType === "movie" ? "Фильм" : "Сериал", tmdb.year,
      tmdb.runtime ? `${tmdb.runtime} мин${tmdb.mediaType === "tv" ? " / серия" : ""}` : null].filter(Boolean);
    const save = node("button", { type: "button", class: "btn btn-primary", text: "Добавить выбранное" });
    const back = node("button", { type: "button", class: "btn", text: "Назад к результатам" });
    const existing = duplicate(value);
    save.disabled = !!existing || saving;
    back.disabled = saving;
    save.addEventListener("click", () => addSelected(value));
    back.addEventListener("click", () => { selected = null; renderPreview(); results.hidden = false; persist(); });
    preview.append(image(tmdb.posterPath), node("div", { class: "tmdb-preview-main" },
      node("h3", { text: value.title }), node("p", { text: bits.join(" · ") }),
      tmdb.originalTitle !== value.title ? node("p", { class: "add-hint", text: tmdb.originalTitle }) : null,
      value.genres.length ? node("p", { text: value.genres.join(" · ") }) : null,
      existing ? node("p", { class: "add-hint", text: `Уже в списке: «${existing.title}»` }) : null,
      node("div", { class: "tmdb-preview-actions" }, save, back)),
      node("details", { class: "tmdb-description" }, node("summary", { text: "Описание" }),
        node("p", { class: "tmdb-overview", text: tmdb.overview || "Описание пока отсутствует." })));
    results.hidden = true;
  }
  async function choose(id, mediaType) {
    await run(async (signal, current) => {
      message("Загружаю подробности…");
      const raw = await request(`/${mediaType}/${id}`, { append_to_response: "external_ids" }, signal);
      if (!current()) return;
      selected = asMetadata(raw, mediaType);
      const preferred = mediaType === "tv" ? "series" : "movie";
      if (hooks.getTypes().some((type) => type.key === preferred)) typeSelect.value = preferred;
      renderPreview(); persist();
      message("Проверьте фильм и категорию перед добавлением.");
    });
  }
  async function search() {
    if (saving) return;
    let parsed;
    try { parsed = parseQuery(input.value); } catch (error) { message(error.message); return; }
    selected = null; renderPreview(); results.replaceChildren(); results.hidden = false; persist();
    if (parsed.id) { await choose(parsed.id, parsed.mediaType); return; }
    await run(async (signal, current) => {
      message("Ищу в TMDB…");
      const data = parsed.imdbId ? await request(`/find/${parsed.imdbId}`, { external_source: "imdb_id" }, signal) : await request("/search/multi", { query: parsed.query, include_adult: false }, signal);
      if (!current()) return;
      const found = parsed.imdbId ? [...(data.movie_results || []).map((item) => ({ ...item, media_type: "movie" })), ...(data.tv_results || []).map((item) => ({ ...item, media_type: "tv" }))] : data.results || [];
      const candidates = found.filter((item) => ["movie", "tv"].includes(item.media_type) && Number.isSafeInteger(item.id) && item.id > 0);
      for (const candidate of candidates) {
        const title = candidate.title || candidate.name || candidate.original_title || candidate.original_name || "Без названия";
        const year = (candidate.release_date || candidate.first_air_date || "").slice(0, 4);
        const btn = node("button", { type: "button", class: "tmdb-result", "aria-label": `Выбрать: ${title}${year ? ` (${year})` : ""}` }, image(candidate.poster_path),
          node("span", { class: "tmdb-result-copy" }, node("strong", { text: title }), node("small", { text: [candidate.media_type === "movie" ? "Фильм" : "Сериал", year].filter(Boolean).join(" · ") })));
        btn.addEventListener("click", () => choose(candidate.id, candidate.media_type));
        results.append(btn);
      }
      message(candidates.length ? `Найдено: ${candidates.length}. Выберите нужный вариант.` : "Ничего не найдено. Попробуйте оригинальное название или добавьте вручную.");
    });
  }
  function clearDraft() {
    cancel(); selected = null; input.value = ""; results.replaceChildren(); results.hidden = false; renderPreview();
    write(DRAFT_KEY, null); searchButton.disabled = false; message("Черновик очищен.");
  }
  function setSaving(value) {
    saving = value; searchButton.disabled = value; manualButton.disabled = value;
    input.disabled = value; typeSelect.disabled = value;
    document.getElementById("add-clear-btn").disabled = value;
    if (selected) renderPreview();
  }
  async function save(title, metadata) {
    if (saving) return;
    if (!hooks.canEdit()) { message("Войдите через ⚙, чтобы добавлять в список."); return; }
    cancel(); persist(); setSaving(true); message("Сохраняю в список…");
    submittedDraft = draftSignature();
    try {
      if (await hooks.add(title, typeSelect.value, metadata)) { clearDraft(); message("Добавлено в список."); }
      else message("Не удалось добавить. Черновик сохранён — попробуйте снова.");
    } catch (_) { message("Не удалось сохранить. Черновик сохранён; используйте повтор сохранения или попробуйте добавить снова."); }
    finally { setSaving(false); }
  }
  function addSelected(value) {
    if (duplicate(value)) { message("Этот фильм или сериал уже есть в списке."); renderPreview(); return; }
    return save(value.title, { tmdb: value.tmdb, genres: value.genres });
  }
  function manual() {
    const title = input.value.trim();
    if (!title) { message("Введите название для ручного добавления."); input.focus(); return; }
    if (/^(https?:\/\/|www\.)/i.test(title)) { message("Для ручного добавления замените ссылку названием фильма или сериала."); return; }
    const key = (text) => text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
    const existing = hooks.getItems().find((item) => key(item.title) === key(title));
    if (existing) { message(`«${existing.title}» уже есть в списке. Для одноимённого фильма найдите его через TMDB или уточните название годом.`); return; }
    return save(title, {});
  }
  function restore() {
    let draft;
    try { draft = JSON.parse(read(DRAFT_KEY) || "null"); } catch (_) { return; }
    if (!draft || typeof draft.query !== "string") return;
    input.value = draft.query;
    if (hooks.getTypes().some((type) => type.key === draft.type)) typeSelect.value = draft.type;
    const item = draft.selected;
    if (item && typeof item.title === "string" && item.tmdb && Number.isSafeInteger(item.tmdb.id) && ["movie", "tv"].includes(item.tmdb.mediaType)) {
      selected = { title: item.title, tmdb: { id: item.tmdb.id, mediaType: item.tmdb.mediaType,
        originalTitle: String(item.tmdb.originalTitle || ""), year: Number.isInteger(item.tmdb.year) ? item.tmdb.year : null,
        overview: String(item.tmdb.overview || ""), posterPath: safePoster(item.tmdb.posterPath),
        runtime: Number.isInteger(item.tmdb.runtime) ? item.tmdb.runtime : null,
        ...(/^tt\d+$/.test(item.tmdb.imdbId || "") ? { imdbId: item.tmdb.imdbId } : {}) },
        genres: Array.isArray(item.genres) ? item.genres.filter((genre) => typeof genre === "string") : [] };
      renderPreview();
    }
    if (draft.query) message("Черновик восстановлен. Продолжайте добавление.");
  }
  function init(options) {
    hooks = options; input = document.getElementById("add-title"); typeSelect = document.getElementById("add-type");
    status = document.getElementById("tmdb-status"); results = document.getElementById("tmdb-results"); preview = document.getElementById("tmdb-preview");
    searchButton = document.getElementById("tmdb-search-btn"); manualButton = document.getElementById("manual-add-btn");
    document.getElementById("add-form").addEventListener("submit", (event) => { event.preventDefault(); search(); });
    input.addEventListener("input", () => { cancel(); selected = null; renderPreview(); results.replaceChildren(); searchButton.disabled = false; persist(); });
    typeSelect.addEventListener("change", persist);
    manualButton.addEventListener("click", manual);
    document.getElementById("add-clear-btn").addEventListener("click", clearDraft);
    document.getElementById("mobile-add-btn").addEventListener("click", () => { input.scrollIntoView({ behavior: "smooth", block: "center" }); input.focus({ preventScroll: true }); });
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver(([entry]) => document.getElementById("mobile-add-btn").classList.toggle("near-add", entry.isIntersecting)).observe(document.getElementById("add-form"));
    }
    const tokenInput = document.getElementById("tmdb-token-input"), tokenStatus = document.getElementById("tmdb-token-status");
    tokenStatus.textContent = token ? "Токен TMDB сохранён в этом браузере." : "Токен TMDB пока не задан. Ручное добавление доступно.";
    document.getElementById("tmdb-token-save").addEventListener("click", () => {
      const value = tokenInput.value.trim();
      if (!value) { tokenStatus.textContent = "Введите API Read Access Token из настроек TMDB."; return; }
      if (!write(TOKEN_KEY, value)) { tokenStatus.textContent = "Не удалось сохранить токен в браузере. Проверьте доступ к локальному хранилищу."; return; }
      cancel(); token = value; tokenInput.value = ""; searchButton.disabled = saving;
      tokenStatus.textContent = "Токен сохранён. Он будет проверен при первом поиске.";
    });
    document.getElementById("tmdb-token-clear").addEventListener("click", () => {
      if (!write(TOKEN_KEY, null)) { tokenStatus.textContent = "Не удалось удалить токен из хранилища браузера."; return; }
      cancel(); token = ""; tokenInput.value = ""; searchButton.disabled = saving; tokenStatus.textContent = "Токен TMDB удалён.";
    });
    restore();
    if (!input.value && !token) message("Для поиска добавьте токен TMDB через ⚙. Можно добавить название вручную.");
  }
  return { init, parseQuery, asMetadata, safePoster, acknowledgeSave };
})();
