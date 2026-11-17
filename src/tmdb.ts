/* TMDB search and local add drafts. Credentials never enter item metadata. */

import type { Item, MediaType, ParsedQuery, TmdbHooks, TmdbItemMetadata, TmdbSelection, WatchlistTMDBApi } from "./domain/types.js";

export const WatchlistTMDB = ((): WatchlistTMDBApi => {
  const TOKEN_KEY = "watchlist.tmdbToken";
  const DRAFT_KEY = "watchlist.addDraft";
  const API = "https://api.themoviedb.org/3";
  let hooks: TmdbHooks;
  let input: HTMLInputElement;
  let typeSelect: HTMLSelectElement;
  let status: HTMLElement;
  let results: HTMLElement;
  let preview: HTMLElement;
  let searchButton: HTMLButtonElement;
  let manualButton: HTMLButtonElement;
  let selected: TmdbSelection | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let saving = false;
  let submittedDraft: string | null = null;
  let token = read(TOKEN_KEY) || "";

  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element: #${id}`);
    return element as T;
  }
  function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }
  function read(key: string): string | null { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function write(key: string, value: string | null): boolean {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }
  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    ...children: (Node | string | null | false | undefined)[]
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "text") element.textContent = value;
      else if (key === "class") element.className = value;
      else element.setAttribute(key, value);
    }
    children.filter((child): child is Node | string => Boolean(child)).forEach((child) => element.append(child));
    return element;
  }
  function message(text: string): void { status.textContent = text; }
  function safePoster(path: unknown): string | null {
    return typeof path === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(path) ? path : null;
  }
  function image(path: unknown): HTMLElement {
    const valid = safePoster(path);
    if (!valid) return node("span", { class: "tmdb-poster tmdb-no-poster", text: "Нет постера" });
    const img = node("img", { class: "tmdb-poster", src: `https://image.tmdb.org/t/p/w185${valid}`, alt: "", loading: "lazy", width: "92", height: "138" });
    img.addEventListener("error", () => img.replaceWith(node("span", { class: "tmdb-poster tmdb-no-poster", text: "Нет постера" })));
    return img;
  }
  function parseQuery(value: string): ParsedQuery {
    const query = value.trim();
    if (!query) throw new Error("Введите название или ссылку.");
    if (!/^([a-z][a-z\d+.-]*:\/\/|www\.|(?:themoviedb|imdb)\.org|imdb\.com)/i.test(query)) return { query };
    let url: URL;
    try { url = new URL(query.startsWith("https://") || query.startsWith("http://") ? query : `https://${query}`); }
    catch (_) { throw new Error("Не удалось прочитать ссылку. Введите название вручную."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Поддерживаются HTTPS-ссылки TMDB и IMDb.");
    const host = url.hostname.toLowerCase();
    let match: RegExpMatchArray | null;
    if ((host === "themoviedb.org" || host === "www.themoviedb.org") && (match = url.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]*)?\/?$/))) {
      const id = Number(match[2]);
      if (Number.isSafeInteger(id) && id > 0) return { mediaType: match[1] as MediaType, id };
    }
    if (["imdb.com", "www.imdb.com", "m.imdb.com"].includes(host) && (match = url.pathname.match(/^\/title\/(tt\d+)\/?$/))) return { imdbId: match[1] };
    throw new Error("Нужна ссылка на фильм или сериал TMDB / IMDb. Или введите название.");
  }
  function cancel(): void { generation++; if (controller) controller.abort(); controller = null; }
  async function request(path: string, params: Record<string, string | number | boolean>, signal: AbortSignal): Promise<unknown> {
    if (!token) throw new Error("Добавьте токен TMDB в настройках ⚙ или используйте ручное добавление.");
    const url = new URL(API + path);
    Object.entries({ language: "ru-RU", ...params }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    let response: Response;
    try { response = await fetch(url.href, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal, cache: "no-store", credentials: "omit", redirect: "error" }); }
    catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new Error("TMDB недоступен. Проверьте интернет или добавьте вручную — текст сохранён."); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("TMDB не принял токен. Проверьте его в настройках ⚙.");
      if (response.status === 429) throw new Error("Слишком много запросов к TMDB. Попробуйте чуть позже.");
      if (response.status === 404) throw new Error("Этот фильм или сериал не найден в TMDB.");
      throw new Error("Не удалось получить данные TMDB. Попробуйте ещё раз или добавьте вручную.");
    }
    try { return await response.json(); } catch (_) { throw new Error("TMDB вернул неполный ответ. Попробуйте ещё раз."); }
  }
  async function run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>): Promise<void> {
    cancel();
    const current = generation;
    const active = new AbortController(); controller = active;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; active.abort(); }, 12000);
    searchButton.disabled = true;
    try { await work(active.signal, () => current === generation); }
    catch (error) {
      if (current === generation) {
        message(timedOut
          ? "TMDB долго не отвечает. Повторите поиск или добавьте вручную."
          : error instanceof Error && error.name === "AbortError"
            ? "Поиск отменён."
            : error instanceof Error ? error.message : String(error));
      }
    } finally {
      clearTimeout(timer);
      if (current === generation) { controller = null; searchButton.disabled = saving; }
    }
  }
  function asMetadata(raw: unknown, mediaType: MediaType): TmdbSelection {
    const rawObj = asRecord(raw);
    if (!rawObj || typeof rawObj.id !== "number" || !Number.isSafeInteger(rawObj.id) || rawObj.id <= 0 || !["movie", "tv"].includes(mediaType)) {
      throw new Error("TMDB вернул неполные данные.");
    }
    const title = String(rawObj.title || rawObj.name || rawObj.original_title || rawObj.original_name || "").trim();
    if (!title) throw new Error("У результата нет названия. Добавьте его вручную.");
    const date = String(rawObj.release_date || rawObj.first_air_date || "");
    const epRunTimes = Array.isArray(rawObj.episode_run_time) ? rawObj.episode_run_time : [];
    const runtimeRaw = mediaType === "movie"
      ? rawObj.runtime
      : epRunTimes.find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
    const runtime = typeof runtimeRaw === "number" && Number.isInteger(runtimeRaw) && runtimeRaw > 0 ? runtimeRaw : null;
    const extIds = asRecord(rawObj.external_ids);
    const imdbRaw = rawObj.imdb_id || extIds?.imdb_id;
    const imdbId = typeof imdbRaw === "string" && /^tt\d+$/.test(imdbRaw) ? imdbRaw : undefined;
    return {
      title,
      tmdb: {
        id: rawObj.id,
        mediaType,
        originalTitle: String(rawObj.original_title || rawObj.original_name || title),
        year: /^\d{4}-/.test(date) ? Number(date.slice(0, 4)) : null,
        overview: typeof rawObj.overview === "string" ? rawObj.overview : "",
        posterPath: safePoster(rawObj.poster_path),
        runtime,
        ...(imdbId ? { imdbId } : {})
      },
      genres: [...new Set((Array.isArray(rawObj.genres) ? rawObj.genres : [])
        .map((genre) => asRecord(genre)?.name)
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        .map((name) => name.trim()))]
    };
  }
  function duplicate(value: TmdbSelection): Item | undefined {
    return hooks.getItems().find((item) => item.tmdb?.id === value.tmdb.id && item.tmdb?.mediaType === value.tmdb.mediaType);
  }
  function persist(): void {
    const ok = write(DRAFT_KEY, JSON.stringify({ query: input.value, type: typeSelect.value, selected }));
    if (!ok) message("Браузер не сохранил черновик. Не закрывайте страницу до сохранения.");
  }
  function draftSignature(): string { return JSON.stringify({ query: input.value, type: typeSelect.value, selected }); }
  function acknowledgeSave(): void {
    if (submittedDraft === draftSignature()) { clearDraft(); message("Добавлено в список."); }
    submittedDraft = null;
  }
  function renderPreview(): void {
    preview.replaceChildren();
    preview.hidden = !selected;
    if (!selected) return;
    const value = selected;
    const tmdb = value.tmdb;
    const bits = [tmdb.mediaType === "movie" ? "Фильм" : "Сериал", tmdb.year,
      tmdb.runtime ? `${tmdb.runtime} мин${tmdb.mediaType === "tv" ? " / серия" : ""}` : null].filter(Boolean);
    const saveBtn = node("button", { type: "button", class: "btn btn-primary", text: "Добавить выбранное" });
    const back = node("button", { type: "button", class: "btn", text: "Назад к результатам" });
    const existing = duplicate(value);
    saveBtn.disabled = !!existing || saving;
    back.disabled = saving;
    saveBtn.addEventListener("click", () => addSelected(value));
    back.addEventListener("click", () => { selected = null; renderPreview(); results.hidden = false; persist(); });
    preview.append(image(tmdb.posterPath), node("div", { class: "tmdb-preview-main" },
      node("h3", { text: value.title }), node("p", { text: bits.join(" · ") }),
      tmdb.originalTitle !== value.title ? node("p", { class: "add-hint", text: tmdb.originalTitle }) : null,
      value.genres.length ? node("p", { text: value.genres.join(" · ") }) : null,
      existing ? node("p", { class: "add-hint", text: `Уже в списке: «${existing.title}»` }) : null,
      node("div", { class: "tmdb-preview-actions" }, saveBtn, back)),
      node("details", { class: "tmdb-description" }, node("summary", { text: "Описание" }),
        node("p", { class: "tmdb-overview", text: tmdb.overview || "Описание пока отсутствует." })));
    results.hidden = true;
  }
  async function choose(id: number, mediaType: MediaType): Promise<void> {
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
  interface TmdbCandidate {
    id: number;
    media_type: MediaType;
    title?: unknown;
    name?: unknown;
    original_title?: unknown;
    original_name?: unknown;
    release_date?: unknown;
    first_air_date?: unknown;
    poster_path?: unknown;
  }
  async function search(): Promise<void> {
    if (saving) return;
    let parsedQuery: ParsedQuery;
    try { parsedQuery = parseQuery(input.value); } catch (error) { message(error instanceof Error ? error.message : String(error)); return; }
    selected = null; renderPreview(); results.replaceChildren(); results.hidden = false; persist();
    if ("id" in parsedQuery) { await choose(parsedQuery.id, parsedQuery.mediaType); return; }
    await run(async (signal, current) => {
      message("Ищу в TMDB…");
      const data = "imdbId" in parsedQuery
        ? await request(`/find/${parsedQuery.imdbId}`, { external_source: "imdb_id" }, signal)
        : await request("/search/multi", { query: parsedQuery.query, include_adult: false }, signal);
      if (!current()) return;
      const dataObj = asRecord(data);
      const found: unknown[] = "imdbId" in parsedQuery
        ? [
            ...(Array.isArray(dataObj?.movie_results) ? dataObj.movie_results : []).map((item) => ({ ...(asRecord(item) || {}), media_type: "movie" })),
            ...(Array.isArray(dataObj?.tv_results) ? dataObj.tv_results : []).map((item) => ({ ...(asRecord(item) || {}), media_type: "tv" }))
          ]
        : (Array.isArray(dataObj?.results) ? dataObj.results : []);
      const candidates = found.filter((item): item is TmdbCandidate => {
        const rec = asRecord(item);
        return !!rec && (rec.media_type === "movie" || rec.media_type === "tv") && typeof rec.id === "number" && Number.isSafeInteger(rec.id) && rec.id > 0;
      });
      for (const candidate of candidates) {
        const title = String(candidate.title || candidate.name || candidate.original_title || candidate.original_name || "Без названия");
        const dateStr = typeof candidate.release_date === "string" && candidate.release_date
          ? candidate.release_date
          : typeof candidate.first_air_date === "string" ? candidate.first_air_date : "";
        const year = dateStr.slice(0, 4);
        const btn = node("button", { type: "button", class: "tmdb-result", "aria-label": `Выбрать: ${title}${year ? ` (${year})` : ""}` }, image(candidate.poster_path),
          node("span", { class: "tmdb-result-copy" }, node("strong", { text: title }), node("small", { text: [candidate.media_type === "movie" ? "Фильм" : "Сериал", year].filter(Boolean).join(" · ") })));
        btn.addEventListener("click", () => choose(candidate.id, candidate.media_type));
        results.append(btn);
      }
      message(candidates.length ? `Найдено: ${candidates.length}. Выберите нужный вариант.` : "Ничего не найдено. Попробуйте оригинальное название или добавьте вручную.");
    });
  }
  function clearDraft(): void {
    cancel(); selected = null; input.value = ""; results.replaceChildren(); results.hidden = false; renderPreview();
    write(DRAFT_KEY, null); searchButton.disabled = false; message("Черновик очищен.");
  }
  function setSaving(value: boolean): void {
    saving = value; searchButton.disabled = value; manualButton.disabled = value;
    input.disabled = value; typeSelect.disabled = value;
    byId<HTMLButtonElement>("add-clear-btn").disabled = value;
    if (selected) renderPreview();
  }
  async function save(title: string, metadata: TmdbItemMetadata): Promise<void> {
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
  function addSelected(value: TmdbSelection): Promise<void> | undefined {
    if (duplicate(value)) { message("Этот фильм или сериал уже есть в списке."); renderPreview(); return; }
    return save(value.title, { tmdb: value.tmdb, genres: value.genres });
  }
  function manual(): Promise<void> | undefined {
    const title = input.value.trim();
    if (!title) { message("Введите название для ручного добавления."); input.focus(); return; }
    if (/^(https?:\/\/|www\.)/i.test(title)) { message("Для ручного добавления замените ссылку названием фильма или сериала."); return; }
    const key = (text: string): string => text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
    const existing = hooks.getItems().find((item) => key(item.title) === key(title));
    if (existing) { message(`«${existing.title}» уже есть в списке. Для одноимённого фильма найдите его через TMDB или уточните название годом.`); return; }
    return save(title, {});
  }
  function restore(): void {
    let draftRaw: unknown;
    try { draftRaw = JSON.parse(read(DRAFT_KEY) || "null"); } catch (_) { return; }
    const draft = asRecord(draftRaw);
    if (!draft || typeof draft.query !== "string") return;
    input.value = draft.query;
    if (typeof draft.type === "string" && hooks.getTypes().some((type) => type.key === draft.type)) typeSelect.value = draft.type;
    const item = asRecord(draft.selected);
    const tmdb = asRecord(item?.tmdb);
    if (item && typeof item.title === "string" && tmdb && typeof tmdb.id === "number" && Number.isSafeInteger(tmdb.id) && (tmdb.mediaType === "movie" || tmdb.mediaType === "tv")) {
      selected = {
        title: item.title,
        tmdb: {
          id: tmdb.id,
          mediaType: tmdb.mediaType,
          originalTitle: String(tmdb.originalTitle || ""),
          year: typeof tmdb.year === "number" && Number.isInteger(tmdb.year) ? tmdb.year : null,
          overview: String(tmdb.overview || ""),
          posterPath: safePoster(tmdb.posterPath),
          runtime: typeof tmdb.runtime === "number" && Number.isInteger(tmdb.runtime) ? tmdb.runtime : null,
          ...(typeof tmdb.imdbId === "string" && /^tt\d+$/.test(tmdb.imdbId) ? { imdbId: tmdb.imdbId } : {})
        },
        genres: Array.isArray(item.genres) ? item.genres.filter((genre): genre is string => typeof genre === "string") : []
      };
      renderPreview();
    }
    if (draft.query) message("Черновик восстановлен. Продолжайте добавление.");
  }
  function init(options: TmdbHooks): void {
    hooks = options;
    input = byId<HTMLInputElement>("add-title");
    typeSelect = byId<HTMLSelectElement>("add-type");
    status = byId("tmdb-status");
    results = byId("tmdb-results");
    preview = byId("tmdb-preview");
    searchButton = byId<HTMLButtonElement>("tmdb-search-btn");
    manualButton = byId<HTMLButtonElement>("manual-add-btn");
    byId("add-form").addEventListener("submit", (event) => { event.preventDefault(); search(); });
    input.addEventListener("input", () => { cancel(); selected = null; renderPreview(); results.replaceChildren(); searchButton.disabled = false; persist(); });
    typeSelect.addEventListener("change", persist);
    manualButton.addEventListener("click", manual);
    byId("add-clear-btn").addEventListener("click", clearDraft);
    byId("mobile-add-btn").addEventListener("click", () => { input.scrollIntoView({ behavior: "smooth", block: "center" }); input.focus({ preventScroll: true }); });
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver(([entry]) => byId("mobile-add-btn").classList.toggle("near-add", entry.isIntersecting)).observe(byId("add-form"));
    }
    const tokenInput = byId<HTMLInputElement>("tmdb-token-input");
    const tokenStatus = byId("tmdb-token-status");
    tokenStatus.textContent = token ? "Токен TMDB сохранён в этом браузере." : "Токен TMDB пока не задан. Ручное добавление доступно.";
    byId("tmdb-token-save").addEventListener("click", () => {
      const value = tokenInput.value.trim();
      if (!value) { tokenStatus.textContent = "Введите API Read Access Token из настроек TMDB."; return; }
      if (!write(TOKEN_KEY, value)) { tokenStatus.textContent = "Не удалось сохранить токен в браузере. Проверьте доступ к локальному хранилищу."; return; }
      cancel(); token = value; tokenInput.value = ""; searchButton.disabled = saving;
      tokenStatus.textContent = "Токен сохранён. Он будет проверен при первом поиске.";
    });
    byId("tmdb-token-clear").addEventListener("click", () => {
      if (!write(TOKEN_KEY, null)) { tokenStatus.textContent = "Не удалось удалить токен из хранилища браузера."; return; }
      cancel(); token = ""; tokenInput.value = ""; searchButton.disabled = saving; tokenStatus.textContent = "Токен TMDB удалён.";
    });
    restore();
    if (!input.value && !token) message("Для поиска добавьте токен TMDB через ⚙. Можно добавить название вручную.");
  }
  return { init, parseQuery, asMetadata, safePoster, acknowledgeSave };
})();
