import { API_CONTENTS_URL, REPO } from "../config.js";
import { asRecord } from "../domain/guards.js";
import { normalize } from "../domain/normalize.js";
import type { WatchlistData } from "../domain/types.js";
import { base64ToUtf8, utf8ToBase64 } from "./encoding.js";
import type { LoadedData, WatchlistRepository } from "./repository.js";

// ===== Data loading =====

export type HttpError = Error & { status?: number };
export interface FetchedFile { data: unknown; sha: string | null }

export function httpError(message: string, status: number): HttpError {
  return Object.assign(new Error(message), { status });
}

export function apiHeaders(token: string): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

export async function fetchTimed<T>(url: string, options: RequestInit, read: (response: Response) => Promise<T> | T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try { return await read(await fetch(url, { ...options, signal: controller.signal })); }
  finally { clearTimeout(timer); }
}

export async function resolveDataBranch(token: string): Promise<string> {
  return fetchTimed(`https://api.github.com/repos/${REPO}/git/matching-refs/heads/data/`, { headers: apiHeaders(token), cache: "no-store" }, async (res) => {
    if (res.status === 404) return "master";
    if (!res.ok) throw httpError(`GitHub API: HTTP ${res.status}`, res.status);
    const refs: unknown = await res.json();
    if (!Array.isArray(refs)) throw new Error("GitHub вернул неверный список веток данных");
    const branches = refs.map((entry: unknown) => asRecord(entry)?.ref).filter((ref): ref is string => typeof ref === "string" && ref.startsWith("refs/heads/data/") && ref.length > "refs/heads/data/".length).sort();
    const last = branches[branches.length - 1];
    return last ? last.slice("refs/heads/".length) : "master";
  });
}

export async function fetchFileViaApi(token: string, branch: string): Promise<FetchedFile> {
  return fetchTimed(`${API_CONTENTS_URL}?ref=${encodeURIComponent(branch)}`, { headers: apiHeaders(token), cache: "no-store" }, async (res) => {
    if (!res.ok) throw httpError(`GitHub API: HTTP ${res.status}`, res.status);
    const json = asRecord(await res.json()) ?? {};
    return { data: JSON.parse(base64ToUtf8(String(json.content ?? ""))) as unknown, sha: typeof json.sha === "string" ? json.sha : null };
  });
}

export async function fetchFileLocal(): Promise<FetchedFile> {
  const res = await fetch("data/movies.json", { cache: "no-store" });
  if (!res.ok) throw httpError(`HTTP ${res.status}`, res.status);
  return { data: await res.json() as unknown, sha: null };
}

export function friendlyError(e: unknown): string {
  const status = asRecord(e)?.status;
  if (status === 401 || status === 403) return "Токен недействителен или нет доступа к репозиторию.";
  if (status === 404) return "Файл data/movies.json не найден в репозитории.";
  if (e instanceof TypeError) return "Нет соединения. Проверьте интернет и попробуйте снова.";
  return `Не удалось загрузить данные: ${e instanceof Error && e.message ? e.message : "неизвестная ошибка"}`;
}

export class GitHubRepository implements WatchlistRepository {
  async load(token: string): Promise<LoadedData> {
    const branch = token ? await resolveDataBranch(token) : null;
    const result = token && branch ? await fetchFileViaApi(token, branch) : await fetchFileLocal();
    return { data: normalize(result.data), branch };
  }

  async save(token: string, apply: (data: WatchlistData) => void, message: string): Promise<LoadedData> {
    if (!token) throw new Error("Нет токена");
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const branch = await resolveDataBranch(token);
      let fresh: FetchedFile;
      try { fresh = await fetchFileViaApi(token, branch); }
      catch (error) {
        if (asRecord(error)?.status !== 404) throw error;
        lastErr = error;
        continue;
      }
      const freshData = normalize(fresh.data);
      apply(freshData);
      const body = {
        message,
        content: utf8ToBase64(JSON.stringify(freshData, null, 2) + "\n"),
        ...(fresh.sha ? { sha: fresh.sha } : {}),
        branch
      };
      const res = await fetchTimed(API_CONTENTS_URL, {
        method: "PUT",
        headers: { ...apiHeaders(token), "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body)
      }, (response) => response);
      if (res.ok) return { data: normalize(freshData), branch };
      lastErr = httpError(`GitHub API: HTTP ${res.status}`, res.status);
      if (res.status === 404 || res.status === 409 || res.status === 422) continue;
      throw lastErr;
    }
    throw lastErr;
  }
}
