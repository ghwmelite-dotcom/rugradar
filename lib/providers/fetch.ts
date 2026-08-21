// Shared fetch helper for all provider adapters.
// Design doc: "All provider calls: parallel fetch, hard 3s per-provider timeout."
// Adapters never throw into the caller — they return a Result type.

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const PROVIDER_TIMEOUT_MS = 3000;

export async function fetchJson<T>(
  url: string,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
