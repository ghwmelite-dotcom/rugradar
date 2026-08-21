// Rate limiter — in-memory token bucket, 30 scans/min per IP.
//
// CLOUDFLARE MIGRATION NOTE: the design doc prefers the Workers
// rate-limiting binding on the scan route (free tier), with a KV token
// bucket as fallback. Replace checkRateLimit's internals with the binding
// (env.SCAN_RATE_LIMITER.limit({ key: ip })) or a KV bucket; keep the
// call-site contract.

const LIMIT = 30; // tokens
const WINDOW_MS = 60_000; // refilled over 1 minute
const REFILL_PER_MS = LIMIT / WINDOW_MS;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const globalForRl = globalThis as unknown as {
  __memescanBuckets?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  if (!globalForRl.__memescanBuckets) {
    globalForRl.__memescanBuckets = new Map();
  }
  return globalForRl.__memescanBuckets;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const map = buckets();
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { tokens: LIMIT, lastRefill: now };
    map.set(key, bucket);
  }
  bucket.tokens = Math.min(
    LIMIT,
    bucket.tokens + (now - bucket.lastRefill) * REFILL_PER_MS,
  );
  bucket.lastRefill = now;

  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (map.size > 10_000) {
    for (const [k, b] of map) {
      if (now - b.lastRefill > WINDOW_MS * 5) map.delete(k);
    }
  }

  if (bucket.tokens < 1) {
    return { allowed: false, remaining: 0 };
  }
  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}
