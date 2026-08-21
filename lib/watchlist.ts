// Deathwatch watchlist state (docs/DEATHWATCH.md): long-lived structured
// lists shared across the web app, the rugradar-watch worker and the
// Telegram bot via the shared MEMESCANNER_CACHE KV namespace.
//
// Storage keys:
//   watch:list     WatchEntry[], newest first, cap 200, no TTL (web app +
//                  bot write; worker reads)
//   alerts:recent  AlertEntry[], newest first, cap 100, 7d TTL (worker
//                  writes; web app reads)
//   calledit:list  ReceiptEntry[], cap 500, no TTL (worker writes; web app
//                  reads)
//
// These keys intentionally bypass lib/cache.ts's getCache() — that store is
// for TTL'd scan cache entries; watchlist state is long-lived and list-
// shaped, so we use the KV binding directly (in-memory Map in dev/tests,
// mirroring lib/cache.ts's fallback pattern).
//
// All reads degrade to empty structures on failure — never throw into pages.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Chain } from "./chains";
import type { Band } from "./scoring";

export interface WatchEntry {
  chain: Chain;
  address: string;
  symbol: string | null;
  name: string | null;
  addedAt: string; // ISO timestamp — the receipt if the token later rugs
  lastScore: number | null; // null when unscored or the add-time scan failed
  lastBand: Band | null;
  honeypot: boolean;
}

export type AlertSeverity = "warning" | "critical" | "rug";

export interface AlertEntry {
  ts: string; // ISO timestamp
  chain: Chain;
  address: string;
  symbol: string | null;
  severity: AlertSeverity;
  rule: string;
  text: string;
}

export interface ReceiptEntry {
  chain: Chain;
  address: string;
  symbol: string | null;
  // Band at watch time; "HONEYPOT" when the flag was the honeypot signal
  // alone (unscored entry). Null only in legacy/bot-written receipts.
  flaggedBand: Band | "HONEYPOT" | null;
  flaggedAt: string; // ISO — watch metadata timestamp
  ruggedAt: string; // ISO — when the worker confirmed liquidity gone
  rule: string;
}

export interface DeathwatchStats {
  watched: number; // tokens currently on the watchlist
  receipts: number; // confirmed rugs of watched tokens
  flaggedReceipts: number; // receipts whose flaggedBand was AVOID/CAUTION
  // flaggedReceipts / receipts — null when there are no receipts, so the UI
  // can hide the rate instead of quoting a meaningless number.
  flaggedHitRate: number | null;
}

export const WATCHLIST_KEY = "watch:list";
export const ALERTS_KEY = "alerts:recent";
export const RECEIPTS_KEY = "calledit:list";

const MAX_WATCHED = 200; // spec cap; LRU-evict oldest when full

// Minimal structural type for the KV binding (avoids a workers-types dep).
interface KVBindingLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

// Singleton surviving Next.js dev hot-reloads, shared with the tests.
const globalForWatch = globalThis as unknown as {
  __memescanWatchState?: Map<string, unknown>;
};

function memoryStore(): Map<string, unknown> {
  if (!globalForWatch.__memescanWatchState) {
    globalForWatch.__memescanWatchState = new Map();
  }
  return globalForWatch.__memescanWatchState;
}

// Returns the MEMESCANNER_CACHE binding when present (production Workers,
// and `next dev` with initOpenNextCloudflareForDev); otherwise an in-memory
// stand-in with the same get/put shape.
function store(): KVBindingLike {
  try {
    const env = getCloudflareContext().env as unknown as {
      MEMESCANNER_CACHE?: KVBindingLike;
    };
    if (env.MEMESCANNER_CACHE) return env.MEMESCANNER_CACHE;
  } catch {
    // Not in a Cloudflare request context (e.g. plain node, tests).
  }
  const map = memoryStore();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, JSON.parse(value));
    },
  };
}

async function readList<T>(key: string): Promise<T[]> {
  const value = await store().get(key, "json");
  return Array.isArray(value) ? (value as T[]) : [];
}

function watchKey(chain: Chain, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

export async function getWatchlist(): Promise<WatchEntry[]> {
  try {
    return await readList<WatchEntry>(WATCHLIST_KEY);
  } catch {
    return [];
  }
}

// Add (or refresh) a watch entry. Dedupes by chain + lowercased address:
// a re-watch updates the metadata in place but keeps the original addedAt,
// since that timestamp is the receipt if the token later rugs. When the
// list is full the oldest entry is evicted. Best-effort — never throws.
export async function addToWatchlist(entry: WatchEntry): Promise<void> {
  try {
    const kv = store();
    const list = await readList<WatchEntry>(WATCHLIST_KEY);
    const key = watchKey(entry.chain, entry.address);
    const existing = list.findIndex(
      (e) => watchKey(e.chain, e.address) === key,
    );
    if (existing >= 0) {
      list[existing] = { ...entry, addedAt: list[existing].addedAt };
    } else {
      list.unshift(entry);
      if (list.length > MAX_WATCHED) list.length = MAX_WATCHED;
    }
    await kv.put(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    // Watchlist writes are best-effort; never break the request.
  }
}

export async function getAlerts(): Promise<AlertEntry[]> {
  try {
    return await readList<AlertEntry>(ALERTS_KEY);
  } catch {
    return [];
  }
}

export async function getReceipts(): Promise<ReceiptEntry[]> {
  try {
    return await readList<ReceiptEntry>(RECEIPTS_KEY);
  } catch {
    return [];
  }
}

// Accuracy numbers for the Deathwatch strip. Honest framing per the spec:
// the hit rate is only over confirmed rugs of watched tokens, and the raw
// sample sizes are always returned alongside it.
export async function getStats(): Promise<DeathwatchStats> {
  try {
    const [watchlist, receipts] = await Promise.all([
      getWatchlist(),
      getReceipts(),
    ]);
    const flaggedReceipts = receipts.filter(
      (r) => r.flaggedBand === "AVOID" || r.flaggedBand === "CAUTION",
    ).length;
    return {
      watched: watchlist.length,
      receipts: receipts.length,
      flaggedReceipts,
      flaggedHitRate:
        receipts.length > 0 ? flaggedReceipts / receipts.length : null,
    };
  } catch {
    return { watched: 0, receipts: 0, flaggedReceipts: 0, flaggedHitRate: null };
  }
}
