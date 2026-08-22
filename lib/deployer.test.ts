import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCache } from "./cache";
import { getDeployerProfile } from "./deployer";
import { recordScan, SCANLOG_RECENT_KEY, type ScanLogEntry } from "./scanlog";
import type { ScoreResult } from "./scoring";
import type { TokenReport } from "./types";

// The dev cache (lib/cache.ts) is a globalThis singleton shared across tests;
// clear it directly so each test starts from an empty store.
function clearMemoryCache() {
  const cache = getCache();
  const inner = (cache as unknown as { store?: Map<string, unknown> }).store;
  inner?.clear();
}

const DEPLOYER = "0xDeP10YeR00000000000000000000000000000001";

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
    deployerAddress: null,
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
    ageCap: null,
    honeypotOverride: false,
    categories: {} as ScoreResult["categories"],
    flags: [],
    ...overrides,
  };
}

// Log a scan by DEPLOYER for the given token address with the given band.
async function logToken(
  address: string,
  band: "AVOID" | "CAUTION" | "LOWER_RISK",
  overrides: Partial<TokenReport> = {},
) {
  await recordScan(
    "ethereum",
    address,
    makeReport(address, { deployerAddress: DEPLOYER, ...overrides }),
    makeScore({ band, score: band === "AVOID" ? 10 : 60 }),
  );
}

describe("getDeployerProfile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMemoryCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty profile when nothing has been scanned", async () => {
    const profile = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(profile.address).toBe(DEPLOYER);
    expect(profile.devWalletPct).toBeNull();
    expect(profile.priorTokens).toEqual([]);
    expect(profile.serialRugger).toBe(false);
  });

  it("passes through the current token's dev wallet share", async () => {
    const profile = await getDeployerProfile(
      DEPLOYER,
      "ethereum",
      "0xnew",
      8.5,
    );
    expect(profile.devWalletPct).toBe(8.5);
  });

  it("finds prior tokens by the same deployer, excluding the current token", async () => {
    await logToken("0xaaa", "CAUTION", { name: "Alpha", symbol: "ALPHA" });
    await logToken("0xbbb", "AVOID", { name: "Beta", symbol: "BETA" });
    // A scan of the token currently being reported must not list itself.
    await logToken("0xcurrent", "LOWER_RISK");
    // A different deployer's token must not match.
    await recordScan(
      "ethereum",
      "0xother",
      makeReport("0xother", { deployerAddress: "0xSomeoneElse" }),
      makeScore({ band: "AVOID", score: 5 }),
    );

    const profile = await getDeployerProfile(
      DEPLOYER,
      "ethereum",
      "0xcurrent",
    );
    expect(profile.priorTokens.map((t) => t.address)).toEqual([
      "0xbbb",
      "0xaaa",
    ]);
    expect(profile.priorTokens[0].band).toBe("AVOID");
    expect(profile.priorTokens[0].score).toBe(10);
  });

  it("matches EVM deployer addresses case-insensitively", async () => {
    await logToken("0xaaa", "AVOID");

    const profile = await getDeployerProfile(
      DEPLOYER.toLowerCase(),
      "ethereum",
      "0xnew",
    );
    expect(profile.priorTokens).toHaveLength(1);
  });

  it("dedupes rescans — one token scanned twice counts as one prior", async () => {
    await logToken("0xaaa", "AVOID");
    await logToken("0xaaa", "AVOID");

    const profile = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(profile.priorTokens).toHaveLength(1);
    expect(profile.serialRugger).toBe(false);
  });

  it("flags a serial rugger at >= 2 prior AVOID tokens", async () => {
    await logToken("0xaaa", "AVOID");
    await logToken("0xbbb", "CAUTION");

    const one = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(one.priorTokens).toHaveLength(2);
    expect(one.serialRugger).toBe(false);

    await logToken("0xccc", "AVOID");

    const two = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(two.priorTokens).toHaveLength(3);
    expect(two.serialRugger).toBe(true);
  });

  it("ignores old log entries recorded before deployerAddress existed", async () => {
    // Seed the log directly with a pre-F5 entry (no deployerAddress field).
    const oldEntry: ScanLogEntry = {
      chain: "ethereum",
      address: "0xold",
      name: "Old Token",
      symbol: "OLD",
      imageUrl: null,
      score: 10,
      band: "AVOID",
      honeypot: false,
      scannedAt: new Date().toISOString(),
    };
    await getCache().set(SCANLOG_RECENT_KEY, [oldEntry], 24 * 60 * 60);

    const profile = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(profile.priorTokens).toEqual([]);
    expect(profile.serialRugger).toBe(false);
  });

  it("returns an empty profile instead of throwing when the cache fails", async () => {
    const cache = getCache();
    const spy = vi
      .spyOn(cache, "get")
      .mockRejectedValueOnce(new Error("kv down"));

    const profile = await getDeployerProfile(DEPLOYER, "ethereum", "0xnew");
    expect(profile.priorTokens).toEqual([]);
    expect(profile.serialRugger).toBe(false);
    spy.mockRestore();
  });
});
