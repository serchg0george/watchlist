import { useSyncExternalStore } from "react";
import { getToast, hideToast, subscribeToast } from "../../state/toast.js";

export function Toast() {
  const toast = useSyncExternalStore(subscribeToast, getToast);
  const action = toast.action;
  return (
    <div id="toast" className={`toast${action ? " has-action" : ""}${toast.visible ? " visible" : ""}`} role="status">
      <span className="toast-text">{toast.message}</span>
      {action && <button type="button" className="toast-action" onClick={() => { hideToast(); action.run(); }}>{action.label}</button>}
    </div>
  );
}
