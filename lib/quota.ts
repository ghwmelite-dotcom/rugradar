// Upstream quota circuit breaker (design doc: "Data Degradation").
//
// Conservative v1 daily budgets — when a provider's budget is exhausted it is
// treated as DOWN (degraded report path) until the daily reset.
//
// P1 STUB: counters live in isolate memory only (approximate counting is fine
// for a tripwire). CLOUDFLARE MIGRATION NOTE: per the doc, aggregate counters
// in memory and flush to KV once per minute per counter to stay under the
// Workers free tier's ~1,000 KV writes/day; reset daily. Numbers to be
// verified against observed free-tier limits during integration.

export type ProviderName = "dexscreener" | "goplus" | "rugcheck";

const DAILY_BUDGETS: Record<ProviderName, number> = {
  goplus: 2_000,
  rugcheck: 5_000,
  // Effectively unbounded at our volume, but tracked.
  dexscreener: Number.POSITIVE_INFINITY,
};

interface Counter {
  count: number;
  dayStart: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const globalForQuota = globalThis as unknown as {
  __memescanQuota?: Map<ProviderName, Counter>;
};

function counters(): Map<ProviderName, Counter> {
  if (!globalForQuota.__memescanQuota) {
    globalForQuota.__memescanQuota = new Map();
  }
  return globalForQuota.__memescanQuota;
}

function current(provider: ProviderName): Counter {
  const map = counters();
  let c = map.get(provider);
  const now = Date.now();
  if (!c || now - c.dayStart >= DAY_MS) {
    c = { count: 0, dayStart: now };
    map.set(provider, c);
  }
  return c;
}

export function providerAvailable(provider: ProviderName): boolean {
  return current(provider).count < DAILY_BUDGETS[provider];
}

export function recordProviderCall(provider: ProviderName): void {
  current(provider).count += 1;
}

export function quotaSnapshot(): Record<ProviderName, { used: number; budget: number }> {
  return {
    dexscreener: { used: current("dexscreener").count, budget: DAILY_BUDGETS.dexscreener },
    goplus: { used: current("goplus").count, budget: DAILY_BUDGETS.goplus },
    rugcheck: { used: current("rugcheck").count, budget: DAILY_BUDGETS.rugcheck },
  };
}
