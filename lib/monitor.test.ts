import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kickMonitor } from "./monitor";
import {
  addToWatchlist,
  getAlerts,
  getReceipts,
  ALERTS_KEY,
  WATCHLIST_KEY,
  type AlertEntry,
  type WatchEntry,
} from "./watchlist";

// Mock the DexScreener provider; everything else (watchlist, quota) runs on
// the shared in-memory store. Telegram is stubbed off by leaving the token
// unset, so no fetch ever fires.
const mocks = vi.hoisted(() => ({ getTokenPairs: vi.fn() }));
vi.mock("./providers/dexscreener", () => ({
  getTokenPairs: mocks.getTokenPairs,
}));

// The dev store (lib/watchlist.ts / lib/monitor.ts) is a globalThis
// singleton shared across tests; clear it directly per test.
const g = globalThis as unknown as {
  __memescanWatchState?: Map<string, unknown>;
};

function store(): Map<string, unknown> {
  if (!g.__memescanWatchState) g.__memescanWatchState = new Map();
  return g.__memescanWatchState;
}

const T0 = new Date("2026-08-21T12:00:00.000Z");

function makeEntry(
  address: string,
  overrides: Partial<WatchEntry> = {},
): WatchEntry {
  return {
    chain: "ethereum",
    address,
    symbol: "TEST",
    name: "Test Token",
    addedAt: "2026-08-20T10:00:00.000Z",
    lastScore: 25,
    lastBand: "AVOID",
    honeypot: false,
    ...overrides,
  };
}

function pairs(liqUsd: number) {
  return [
    {
      chainId: "ethereum",
      dexId: "uniswap",
      url: "",
      pairAddress: "0xpair",
      baseToken: { address: "0xtoken", name: "Test Token", symbol: "TEST" },
      quoteToken: { address: "0xweth", name: "WETH", symbol: "WETH" },
      priceUsd: "1.0",
      liquidity: { usd: liqUsd },
    },
  ];
}

function setLiquidity(liqUsd: number) {
  mocks.getTokenPairs.mockResolvedValue({ ok: true, data: pairs(liqUsd) });
}

function seedSnap(address: string, liquidityUsd: number, ts: string) {
  store().set(`watch:snap:ethereum:${address.toLowerCase()}`, {
    liquidityUsd,
    priceUsd: 1,
    ts,
  });
}

function tenMinBeforeT0(): string {
  return new Date(T0.getTime() - 10 * 60_000).toISOString();
}

beforeEach(() => {
  store().clear();
  mocks.getTokenPairs.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("kickMonitor throttle", () => {
  it("runs once per 90s across kicks", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    setLiquidity(10_000);

    await kickMonitor();
    expect(mocks.getTokenPairs).toHaveBeenCalledTimes(1);

    // Inside the window: no provider calls at all.
    await kickMonitor();
    expect(mocks.getTokenPairs).toHaveBeenCalledTimes(1);

    // Past the window: runs again.
    vi.setSystemTime(T0.getTime() + 91_000);
    await kickMonitor();
    expect(mocks.getTokenPairs).toHaveBeenCalledTimes(2);
  });

  it("stamps the throttle even when the watchlist is empty", async () => {
    await kickMonitor();
    expect(store().get("monitor:lastkick")).toBe(T0.getTime());
    expect(mocks.getTokenPairs).not.toHaveBeenCalled();
  });
});

describe("snapshot diffing", () => {
  it("stores a first-ever baseline snapshot without alerting", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    setLiquidity(10_000);

    await kickMonitor();

    expect(await getAlerts()).toEqual([]);
    const snap = store().get("watch:snap:ethereum:0xaaa") as {
      liquidityUsd: number;
    };
    expect(snap.liquidityUsd).toBe(10_000);
  });

  it("raises rug when LP falls below $1k from above", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    seedSnap("0xaaa", 5_000, tenMinBeforeT0());
    setLiquidity(500);

    await kickMonitor();

    const alerts = await getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("rug");
    expect(alerts[0].rule).toBe("liquidity-gone");
    expect(alerts[0].text).toBe(
      "Liquidity dropped 90% in ~10 min ($5.0k → $500)",
    );
    expect(alerts[0].ts).toBe(T0.toISOString());
  });

  it("raises critical on a ≥50% LP drop", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    seedSnap("0xaaa", 10_000, tenMinBeforeT0());
    setLiquidity(4_000);

    await kickMonitor();

    const alerts = await getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].rule).toBe("lp-drain");
  });

  it("raises warning on a ≥25% LP drop", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    seedSnap("0xaaa", 10_000, tenMinBeforeT0());
    setLiquidity(7_000);

    await kickMonitor();

    const alerts = await getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].rule).toBe("lp-drop");
  });

  it("stays quiet below the 25% threshold", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    seedSnap("0xaaa", 10_000, tenMinBeforeT0());
    setLiquidity(8_000);

    await kickMonitor();
    expect(await getAlerts()).toEqual([]);
  });

  it("swallows provider failures without alerting or throwing", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    seedSnap("0xaaa", 10_000, tenMinBeforeT0());
    mocks.getTokenPairs.mockResolvedValue({ ok: false, error: "boom" });

    await expect(kickMonitor()).resolves.toBeUndefined();
    expect(await getAlerts()).toEqual([]);
  });
});

describe("alert dedupe", () => {
  it("skips the same chain+address+rule within 30 min, re-alerts after", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    const existing: AlertEntry = {
      ts: new Date(T0.getTime() - 10 * 60_000).toISOString(),
      chain: "ethereum",
      address: "0xaaa",
      symbol: "TEST",
      severity: "critical",
      rule: "lp-drain",
      text: "Liquidity dropped 55% in ~5 min ($10.0k → $4.5k)",
    };
    store().set(ALERTS_KEY, [existing]);
    seedSnap("0xaaa", 10_000, tenMinBeforeT0());
    setLiquidity(4_000);

    await kickMonitor();
    expect(await getAlerts()).toHaveLength(1); // dupe suppressed

    // Same alert now older than 30 min: a fresh drain re-alerts.
    store().set(ALERTS_KEY, [
      { ...existing, ts: new Date(T0.getTime() - 31 * 60_000).toISOString() },
    ]);
    vi.setSystemTime(T0.getTime() + 91_000); // past the kick throttle
    seedSnap("0xaaa", 4_000, T0.toISOString()); // fresh baseline to drain from
    setLiquidity(1_500);

    await kickMonitor();
    const alerts = await getAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[0].rule).toBe("lp-drain");
  });
});

describe("called-it receipts", () => {
  it("writes a receipt when a flagged token rugs", async () => {
    await addToWatchlist(
      makeEntry("0xaaa", {
        lastBand: "AVOID",
        addedAt: "2026-08-19T08:00:00.000Z",
      }),
    );
    seedSnap("0xaaa", 5_000, tenMinBeforeT0());
    setLiquidity(100);

    await kickMonitor();

    const receipts = await getReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      chain: "ethereum",
      address: "0xaaa",
      flaggedBand: "AVOID",
      flaggedAt: "2026-08-19T08:00:00.000Z",
      ruggedAt: T0.toISOString(),
      rule: "liquidity-gone",
    });
  });

  it("writes no receipt when the token was never flagged", async () => {
    await addToWatchlist(
      makeEntry("0xaaa", { lastBand: "LOWER_RISK", honeypot: false }),
    );
    seedSnap("0xaaa", 5_000, tenMinBeforeT0());
    setLiquidity(100);

    await kickMonitor();

    expect(await getAlerts()).toHaveLength(1); // alert still fires
    expect(await getReceipts()).toEqual([]);
  });

  it("receipts honeypot-flagged unscored tokens as HONEYPOT", async () => {
    await addToWatchlist(
      makeEntry("0xaaa", { lastBand: null, lastScore: null, honeypot: true }),
    );
    seedSnap("0xaaa", 5_000, tenMinBeforeT0());
    setLiquidity(100);

    await kickMonitor();

    const receipts = await getReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].flaggedBand).toBe("HONEYPOT");
  });
});

describe("cursor rotation", () => {
  it("processes a wrapping slice of 6 per kick and advances the cursor", async () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry(`0xt${i}`, { lastBand: "CAUTION" }),
    );
    store().set(WATCHLIST_KEY, entries);
    setLiquidity(10_000);

    const seen = () =>
      mocks.getTokenPairs.mock.calls.map((c) => c[1][0] as string);

    await kickMonitor();
    expect(seen()).toEqual(["0xt0", "0xt1", "0xt2", "0xt3", "0xt4", "0xt5"]);
    expect(store().get("watch:cursor")).toBe(6);

    vi.setSystemTime(T0.getTime() + 91_000);
    await kickMonitor();
    expect(seen().slice(6)).toEqual([
      "0xt6",
      "0xt7",
      "0xt0",
      "0xt1",
      "0xt2",
      "0xt3",
    ]);
    expect(store().get("watch:cursor")).toBe(4); // (6 + 6) % 8
  });
});
