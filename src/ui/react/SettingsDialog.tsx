import { useRef, useState } from "react";
import { LS_LOGIN, LS_PERSON, LS_TOKEN, personFor } from "../../config.js";
import { apiHeaders, friendlyError, httpError } from "../../data/github.js";
import { asRecord } from "../../domain/guards.js";
import { loadAll, restorePendingSaves, saves } from "../../state/saving.js";
import { render, state } from "../../state/store.js";
import { showToast } from "../../state/toast.js";
import { closeSettings, openCategories, registerDialog } from "./dialogs.js";

// The TMDB block (#tmdb-token-*) is wired by tmdb.ts, so it stays uncontrolled markup.
export function SettingsDialog() {
  const tokenInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const saveToken = async (): Promise<void> => {
    const input = tokenInput.current;
    const token = input?.value.trim() || state.token;
    if (!token) { setError("Введите токен."); return; }
    setError("");
    try {
      // Verify the token and learn our login.
      const res = await fetch("https://api.github.com/user", { headers: apiHeaders(token), cache: "no-store" });
      if (!res.ok) throw httpError(`GitHub API: HTTP ${res.status}`, res.status);
      const user = asRecord(await res.json());
      const login = typeof user?.login === "string" ? user.login : "";
      if (!saves.rebind(token, login)) {
        setError("Сначала сохраните изменения текущего пользователя. Можно обновить его токен.");
        return;
      }
      localStorage.setItem(LS_TOKEN, token);
      localStorage.setItem(LS_LOGIN, login);
      localStorage.removeItem(LS_PERSON); // legacy: person is now derived from the login
      state.token = token;
      state.login = login;
      state.person = personFor(state.login);
      saves.retry();
      if (input) input.value = "";
      closeSettings();
      render();
      showToast(`Вход выполнен: ${state.login} (${state.person})`);
      void loadAll().then(restorePendingSaves); // from now on read fresh data via the API
    } catch (e) {
      console.error("token check failed", e);
      setError(friendlyError(e));
    }
  };

  const logout = (): void => {
    if (saves.hasUnsaved()) { showToast("Сначала сохраните изменения — нажмите «Повторить сохранение»."); return; }
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_LOGIN);
    localStorage.removeItem(LS_PERSON);
    state.token = "";
    state.login = "";
    state.person = "";
    closeSettings();
    render();
    showToast("Вы вышли. Режим: только просмотр.");
    void loadAll(); // back to the public copy of data/movies.json
  };

  return (
    <dialog id="settings-dialog" ref={(node) => registerDialog("settings", node)}
      onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
      onClose={() => setError("")}>
      <h2>Настройки</h2>
      <p id="data-branch-status" className="settings-text" style={{ color: "var(--muted)" }}>{`Данные: ${state.dataBranch || "опубликованная версия GitHub Pages"}`}</p>
      <p className="settings-text">Чтобы редактировать список, создайте токен GitHub: Settings → Developer settings → Personal access tokens.</p>
      <ul className="settings-steps">
        <li>Владелец репозитория: Fine-grained tokens, Repository access — только <code>serchg0george/watchlist</code>, Permissions — Contents: Read and write.</li>
        <li>Второй участник (коллаборатор): Tokens (classic), scope — только <code>public_repo</code>.</li>
      </ul>
      <label className="token-label" htmlFor="token-input">Токен</label>
      <input ref={tokenInput} id="token-input" type="password" placeholder="github_pat_… (оставьте пустым, чтобы не менять)" autoComplete="off" spellCheck={false} />
      <p className="settings-text person-hint">Кто вы, сайт определит по логину: владелец репозитория — S, второй участник — L.</p>
      <div className="settings-section">
        <button type="button" id="open-categories-from-settings" className="btn full-width-btn" onClick={() => { closeSettings(); openCategories(); }}>Категории</button>
      </div>
      <section className="settings-section tmdb-settings" aria-labelledby="tmdb-settings-title">
        <h3 id="tmdb-settings-title">Поиск фильмов · TMDB</h3>
        <label className="token-label" htmlFor="tmdb-token-input">API Read Access Token</label>
        <input id="tmdb-token-input" type="password" placeholder="Токен доступа для чтения TMDB" autoComplete="off" spellCheck={false} />
        <p className="settings-text">Токен хранится только в этом браузере и отправляется только TMDB. На другом устройстве введите его отдельно.</p>
        <div className="dialog-actions">
          <button id="tmdb-token-save" type="button" className="btn">Сохранить TMDB</button>
          <button id="tmdb-token-clear" type="button" className="btn">Удалить токен TMDB</button>
        </div>
        <p id="tmdb-token-status" className="settings-text" role="status"></p>
        <div className="tmdb-attribution">
          <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer"><img src="icons/tmdb.svg" width={100} alt="TMDB" /></a>
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </div>
      </section>
      <div id="settings-error" className="settings-error" role="alert">{error}</div>
      <div className="dialog-actions">
        <button type="button" id="cancel-settings-btn" className="btn" onClick={closeSettings}>Отмена</button>
        <button type="button" id="logout-btn" className="btn btn-danger" onClick={logout}>Выйти</button>
        <button type="button" id="save-token-btn" className="btn btn-primary" onClick={() => { void saveToken(); }}>Сохранить</button>
      </div>
    </dialog>
  );
}
