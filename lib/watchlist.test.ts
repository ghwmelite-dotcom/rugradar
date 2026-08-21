import { beforeEach, describe, expect, it } from "vitest";
import {
  addToWatchlist,
  getAlerts,
  getReceipts,
  getStats,
  getWatchlist,
  ALERTS_KEY,
  RECEIPTS_KEY,
  WATCHLIST_KEY,
  type AlertEntry,
  type ReceiptEntry,
  type WatchEntry,
} from "./watchlist";

// The dev store (lib/watchlist.ts) is a globalThis singleton shared across
// tests; clear it directly so each test starts from an empty store.
const g = globalThis as unknown as {
  __memescanWatchState?: Map<string, unknown>;
};

function store(): Map<string, unknown> {
  if (!g.__memescanWatchState) g.__memescanWatchState = new Map();
  return g.__memescanWatchState;
}

function makeEntry(
  address: string,
  overrides: Partial<WatchEntry> = {},
): WatchEntry {
  return {
    chain: "ethereum",
    address,
    symbol: "TEST",
    name: "Test Token",
    addedAt: new Date().toISOString(),
    lastScore: 25,
    lastBand: "AVOID",
    honeypot: false,
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<ReceiptEntry> = {}): ReceiptEntry {
  return {
    chain: "ethereum",
    address: "0xrug",
    symbol: "RUG",
    flaggedBand: "AVOID",
    flaggedAt: "2026-08-20T10:00:00.000Z",
    ruggedAt: "2026-08-20T15:00:00.000Z",
    rule: "liquidity gone — rug confirmed",
    ...overrides,
  };
}

beforeEach(() => {
  store().clear();
});

describe("watchlist", () => {
  it("adds entries and returns them newest first", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    await addToWatchlist(makeEntry("0xbbb"));

    const list = await getWatchlist();
    expect(list.map((e) => e.address)).toEqual(["0xbbb", "0xaaa"]);
  });

  it("dedupes by chain + lowercased address, refreshing metadata in place", async () => {
    const first = makeEntry("0xAbC", {
      addedAt: "2026-08-20T10:00:00.000Z",
      lastScore: 25,
      lastBand: "AVOID",
    });
    await addToWatchlist(first);
    await addToWatchlist(
      makeEntry("0xabc", {
        addedAt: "2026-08-21T10:00:00.000Z",
        lastScore: 55,
        lastBand: "CAUTION",
      }),
    );

    const list = await getWatchlist();
    expect(list).toHaveLength(1);
    // Metadata refreshed...
    expect(list[0].lastScore).toBe(55);
    expect(list[0].lastBand).toBe("CAUTION");
    // ...but the original addedAt is kept — it's the receipt timestamp.
    expect(list[0].addedAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("treats the same address on different chains as distinct", async () => {
    await addToWatchlist(makeEntry("0xabc", { chain: "ethereum" }));
    await addToWatchlist(makeEntry("0xabc", { chain: "bsc" }));

    expect(await getWatchlist()).toHaveLength(2);
  });

  it("caps the list at 200 and evicts the oldest entries", async () => {
    for (let i = 0; i < 205; i++) {
      const addr = `0x${i.toString(16).padStart(4, "0")}`;
      await addToWatchlist(makeEntry(addr));
    }

    const list = await getWatchlist();
    expect(list).toHaveLength(200);
    const addresses = new Set(list.map((e) => e.address));
    // The first five added (oldest) are evicted; the rest remain.
    for (let i = 0; i < 5; i++) {
      expect(addresses.has(`0x${i.toString(16).padStart(4, "0")}`)).toBe(false);
    }
    expect(addresses.has("0x00cc")).toBe(true); // 204th, newest
    expect(addresses.has("0x0005")).toBe(true); // oldest survivor
  });

  it("degrades to empty structures on a corrupt stored value", async () => {
    store().set(WATCHLIST_KEY, { nope: true });

    expect(await getWatchlist()).toEqual([]);
    const stats = await getStats();
    expect(stats.watched).toBe(0);
  });
});

describe("alerts and receipts reads", () => {
  it("returns empty arrays when nothing is stored", async () => {
    expect(await getAlerts()).toEqual([]);
    expect(await getReceipts()).toEqual([]);
  });

  it("reads worker-written alerts and receipts as stored", async () => {
    const alert: AlertEntry = {
      ts: "2026-08-21T12:00:00.000Z",
      chain: "solana",
      address: "SoMeAdDrEsS",
      symbol: "DRAIN",
      severity: "critical",
      rule: "lp-drop-50",
      text: "liquidity draining fast — down 62% vs last snapshot",
    };
    store().set(ALERTS_KEY, [alert]);
    store().set(RECEIPTS_KEY, [makeReceipt()]);

    expect(await getAlerts()).toEqual([alert]);
    expect(await getReceipts()).toEqual([makeReceipt()]);
  });
});

describe("getStats", () => {
  it("returns zeroed stats with a null hit rate when empty", async () => {
    const stats = await getStats();
    expect(stats).toEqual({
      watched: 0,
      receipts: 0,
      flaggedReceipts: 0,
      flaggedHitRate: null,
    });
  });

  it("counts watched tokens and flagged receipts honestly", async () => {
    await addToWatchlist(makeEntry("0xaaa"));
    await addToWatchlist(makeEntry("0xbbb"));
    store().set(RECEIPTS_KEY, [
      makeReceipt({ address: "0x1", flaggedBand: "AVOID" }),
      makeReceipt({ address: "0x2", flaggedBand: "CAUTION" }),
      makeReceipt({ address: "0x3", flaggedBand: "LOWER_RISK" }),
      makeReceipt({ address: "0x4", flaggedBand: null }), // honeypot-flagged
    ]);

    const stats = await getStats();
    expect(stats.watched).toBe(2);
    expect(stats.receipts).toBe(4);
    // Only AVOID/CAUTION flags count toward the "flagged first" number.
    expect(stats.flaggedReceipts).toBe(2);
    expect(stats.flaggedHitRate).toBe(0.5);
  });
});
