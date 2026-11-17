import { LS_LOGIN, LS_PERSON, LS_TOKEN, personFor } from "../../config.js";
import { apiHeaders, friendlyError, httpError } from "../../data/github.js";
import { asRecord } from "../../domain/guards.js";
import { loadAll, restorePendingSaves, saves } from "../../state/saving.js";
import { state } from "../../state/store.js";
import { byId, el } from "../dom.js";
import { showToast } from "../toast.js";

// ===== Settings dialog =====

export function openSettings(): void {
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

export async function saveToken(): Promise<void> {
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

export function logout(): void {
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
