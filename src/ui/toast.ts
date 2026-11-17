import { UNDO_MS } from "../config.js";
import { byId, el } from "./dom.js";

// ===== Toast =====

interface ToastAction { label: string; run: () => void }

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// action: optional { label, run } rendered as a button inside the toast (e.g. undo).
export function showToast(msg: string, action?: ToastAction): void {
  const t = byId("toast");
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
