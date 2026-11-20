import { UNDO_MS } from "../config.js";

// ===== Toast (state only; the Toast component renders it) =====

export interface ToastAction { label: string; run: () => void }
export interface ToastState { message: string; action: ToastAction | null; visible: boolean; id: number }

let current: ToastState = { message: "", action: null, visible: false, id: 0 };
const listeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const emit = (next: ToastState): void => { current = next; listeners.forEach((listener) => listener()); };

export const getToast = (): ToastState => current;
export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hideToast(): void {
  clearTimeout(toastTimer);
  if (current.visible) emit({ ...current, visible: false });
}

// action: optional { label, run } rendered as a button inside the toast (e.g. undo).
export function showToast(msg: string, action?: ToastAction): void {
  clearTimeout(toastTimer);
  emit({ message: msg, action: action ?? null, visible: true, id: current.id + 1 });
  toastTimer = setTimeout(hideToast, action ? UNDO_MS : 2600);
}
