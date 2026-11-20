import { useSyncExternalStore } from "react";
import { getVersion, state, subscribe } from "../../state/store.js";

/** Re-renders the caller on every render() of the store and returns the (mutable) app state. */
export function useWatchlist(): typeof state {
  useSyncExternalStore(subscribe, getVersion);
  return state;
}
