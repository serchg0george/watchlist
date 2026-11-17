import type { WatchlistData } from "../domain/types.js";

export interface LoadedData { data: WatchlistData; branch: string | null }

export interface WatchlistRepository {
  /** token "" -> read the deployed data/movies.json (branch null). */
  load(token: string): Promise<LoadedData>;
  /** Re-reads the freshest remote copy, applies `apply`, writes it; retries 404/409/422 up to 3 times. */
  save(token: string, apply: (data: WatchlistData) => void, message: string): Promise<LoadedData>;
}
