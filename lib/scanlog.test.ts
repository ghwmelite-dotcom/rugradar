import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCache } from "./cache";
import { getFeed, recordScan, type ScanLogEntry } from "./scanlog";
import type { ScoreResult } from "./scoring";
import type { TokenReport } from "./types";

// The dev cache (lib/cache.ts) is a globalThis singleton shared across tests;
// clear it directly so each test starts from an empty store.
function clearMemoryCache() {
  const cache = getCache();
  const inner = (cache as unknown as { store?: Map<string, unknown> }).store;
  inner?.clear();
}

function makeReport(
  address: string,
  overrides: Partial<TokenReport> = {},
): TokenReport {
  return {
    chain: "ethereum",
    address,
    name: "Test Token",
    symbol: "TEST",
    imageUrl: null,
    priceUsd: null,
    liquidityUsd: null,
    volume24h: null,
    pairAgeHours: null,
    dexCount: null,
    honeypot: null,
    mintable: null,
    freezable: null,
    proxy: null,
    ownershipRenounced: null,
    buyTax: null,
    sellTax: null,
    hiddenModifiableTax: null,
    contractVerified: null,
    lpLockedOrBurned: null,
    lpLockDays: null,
    top10HolderPct: null,
    devWalletPct: null,
    holderCount: null,
    availability: { contractSafety: false, liquidity: false, holders: false },
    providers: [],
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScore(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    scored: true,
    score: 50,
    band: "CAUTION",
    coverage: 3,
    cap: 100,
    honeypotOverride: false,
    categories: {} as ScoreResult["categories"],
    flags: [],
    ...overrides,
  };
}

// The aggregate feed is cached for 60s; advance past it to force a rebuild.
async function freshFeed() {
  vi.advanceTimersByTime(61_000);
  return getFeed();
}

describe("scanlog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMemoryCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records scans and returns them newest-first", async () => {
    await recordScan("ethereum", "0xaaa", makeReport("0xaaa"), makeScore());
    await recordScan("ethereum", "0xbbb", makeReport("0xbbb"), makeScore());

    const feed = await freshFeed();
    expect(feed.recent.map((e) => e.address)).toEqual(["0xbbb", "0xaaa"]);
  });

  it("fills the honeypots section from overrides and AVOID bands", async () => {
    await recordScan(
      "ethereum",
      "0xhp",
      makeReport("0xhp"),
      makeScore({ score: 0, band: "AVOID", honeypotOverride: true }),
    );
    await recordScan(
      "ethereum",
      "0xavoid",
      makeReport("0xavoid"),
      makeScore({ score: 20, band: "AVOID" }),
    );
    await recordScan(
      "ethereum",
      "0xfine",
      makeReport("0xfine"),
      makeScore({ score: 80, band: "LOWER_RISK" }),
    );

    const feed = await freshFeed();
    expect(feed.honeypots.map((e) => e.address).sort()).toEqual([
      "0xavoid",
      "0xhp",
    ]);
    expect(feed.honeypots.find((e) => e.address === "0xhp")?.honeypot).toBe(
      true,
    );
  });

  it("ranks most-scanned tokens by their 24h counters", async () => {
    for (let i = 0; i < 3; i++) {
      await recordScan("ethereum", "0xhot", makeReport("0xhot"), makeScore());
    }
    await recordScan("ethereum", "0xcold", makeReport("0xcold"), makeScore());

    const feed = await freshFeed();
    expect(feed.mostScanned[0].address).toBe("0xhot");
    expect(feed.mostScanned[0].count).toBe(3);
    expect(feed.mostScanned[1].address).toBe("0xcold");
    expect(feed.mostScanned[1].count).toBe(1);
  });

  it("counts mixed-case EVM addresses under one counter", async () => {
    await recordScan("ethereum", "0xAbC", makeReport("0xAbC"), makeScore());
    await recordScan("ethereum", "0xabc", makeReport("0xabc"), makeScore());

    const feed = await freshFeed();
    expect(feed.mostScanned).toHaveLength(1);
    expect(feed.mostScanned[0].count).toBe(2);
  });

  it("caps the stored recent list at 100 entries", async () => {
    for (let i = 0; i < 105; i++) {
      const addr = `0x${i.toString(16).padStart(4, "0")}`;
      await recordScan("ethereum", addr, makeReport(addr), makeScore());
    }
    const stored = await getCache().get<ScanLogEntry[]>("scanlog:recent");
    expect(stored).toHaveLength(100);
  });

  it("serves the cached aggregate for 60s, then rebuilds", async () => {
    await recordScan("ethereum", "0xone", makeReport("0xone"), makeScore());
    const first = await freshFeed();
    expect(first.recent).toHaveLength(1);

    // A new scan inside the cache window is not visible yet.
    await recordScan("ethereum", "0xtwo", makeReport("0xtwo"), makeScore());
    const cached = await getFeed();
    expect(cached.recent).toHaveLength(1);

    // After the 60s TTL the aggregate rebuilds.
    const rebuilt = await freshFeed();
    expect(rebuilt.recent).toHaveLength(2);
  });

  it("returns an empty feed when nothing has been scanned", async () => {
    const feed = await freshFeed();
    expect(feed).toEqual({ recent: [], honeypots: [], mostScanned: [] });
  });
});
