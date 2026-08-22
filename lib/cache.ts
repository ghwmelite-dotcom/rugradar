// Cache interface + implementations.
//
// Production (Cloudflare Workers): KV-backed store bound as MEMESCANNER_CACHE
// (see wrangler.jsonc; accessed via @opennextjs/cloudflare's
// getCloudflareContext). Dev/fallback: in-memory Map.
// TTLs per the design doc: security 15min, market 60s, trending 5min.

import { getCloudflareContext } from "@opennextjs/cloudflare";

// Methods are async because Cloudflare KV is async; the in-memory
// implementation resolves immediately. get/set shape is unchanged from P1.
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export const TTL = {
  SECURITY: 15 * 60, // GoPlus / RugCheck — 15 min
  MARKET: 60, // DexScreener — 60 s
  TRENDING: 5 * 60, // trending feed — 5 min, single global entry
  VIRAL: 15 * 60, // Viral Radar payload — 15 min, single global entry
} as const;

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCache implements CacheStore {
  private store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

// Minimal structural type for the KV binding (avoids a workers-types dep).
interface KVNamespaceLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
}

class KVCache implements CacheStore {
  constructor(private kv: KVNamespaceLike) {}

  async get<T>(key: string): Promise<T | undefined> {
    // KV expirationTtl handles expiry; null = miss.
    const value = await this.kv.get(key, "json");
    return value === null ? undefined : (value as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  }
}

// Singleton surviving Next.js dev hot-reloads.
const globalForCache = globalThis as unknown as { __memescanCache?: MemoryCache };

function memoryCache(): MemoryCache {
  if (!globalForCache.__memescanCache) {
    globalForCache.__memescanCache = new MemoryCache();
  }
  return globalForCache.__memescanCache;
}

// Returns the KV-backed cache when the MEMESCANNER_CACHE binding is present
// (production Workers, and `next dev` with initOpenNextCloudflareForDev);
// otherwise the in-memory Map.
export function getCache(): CacheStore {
  try {
    const env = getCloudflareContext().env as unknown as {
      MEMESCANNER_CACHE?: KVNamespaceLike;
    };
    if (env.MEMESCANNER_CACHE) {
      return new KVCache(env.MEMESCANNER_CACHE);
    }
  } catch {
    // Not in a Cloudflare request context (e.g. plain node, tests).
  }
  return memoryCache();
}
