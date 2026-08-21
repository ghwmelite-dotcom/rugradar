import { describe, expect, it } from "vitest";
import { scoreToken, bandForScore } from "./index";
import type { TokenReport } from "../types";

// Base fixture: a clean, legit-looking token with all categories available.
function cleanToken(overrides: Partial<TokenReport> = {}): TokenReport {
  return {
    chain: "solana",
    address: "So11111111111111111111111111111111111111112",
    name: "Clean Token",
    symbol: "CLEAN",
    imageUrl: null,
    priceUsd: 1.23,
    liquidityUsd: 500_000,
    volume24h: 250_000,
    pairAgeHours: 2400, // 100 days
    dexCount: 3,
    honeypot: false,
    mintable: false,
    freezable: false,
    proxy: false,
    ownershipRenounced: true,
    buyTax: 0,
    sellTax: 0,
    hiddenModifiableTax: false,
    contractVerified: true,
    lpLockedOrBurned: true,
    lpLockDays: 90,
    top10HolderPct: 20,
    devWalletPct: 2,
    holderCount: 5000,
    availability: { contractSafety: true, liquidity: true, holders: true },
    providers: [
      { provider: "dexscreener", ok: true },
      { provider: "rugcheck", ok: true },
    ],
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("scoreToken", () => {
  it("scores a clean legit-looking token as LOWER RISK", () => {
    const result = scoreToken(cleanToken());
    expect(result.scored).toBe(true);
    expect(result.score).toBe(100);
    expect(result.band).toBe("LOWER_RISK");
    expect(result.coverage).toBe(3);
    expect(result.cap).toBe(100);
    expect(result.flags).toHaveLength(0);
  });

  it("forces score 0 / AVOID on a honeypot regardless of other data", () => {
    const result = scoreToken(cleanToken({ honeypot: true }));
    expect(result.honeypotOverride).toBe(true);
    expect(result.score).toBe(0);
    expect(result.band).toBe("AVOID");
    expect(result.flags.some((f) => f.category === null)).toBe(true);
  });

  it("scores a rug-ish token (unlocked LP, mintable, concentrated) as AVOID", () => {
    const result = scoreToken(
      cleanToken({
        mintable: true,
        freezable: true,
        ownershipRenounced: false,
        contractVerified: false,
        lpLockedOrBurned: false,
        lpLockDays: null,
        liquidityUsd: 5_000,
        dexCount: 1,
        pairAgeHours: 12,
        top10HolderPct: 60,
        devWalletPct: 12,
        holderCount: 50,
      }),
    );
    // contractSafety: 100-30-25-15-10 = 20
    expect(result.categories.contractSafety.score).toBe(20);
    // liquidity: 100-40-30-10-10 = 10
    expect(result.categories.liquidity.score).toBe(10);
    // holders: 100-30-25-20 = 25
    expect(result.categories.holders.score).toBe(25);
    // composite: (20*.4 + 10*.35 + 25*.25) = 17.75 -> 18
    expect(result.score).toBe(18);
    expect(result.band).toBe("AVOID");
    expect(result.flags.length).toBeGreaterThanOrEqual(8);
  });

  it("caps the composite at 75 with 2-of-3 category coverage", () => {
    const result = scoreToken(
      cleanToken({
        top10HolderPct: null,
        availability: { contractSafety: true, liquidity: true, holders: false },
      }),
    );
    expect(result.coverage).toBe(2);
    expect(result.cap).toBe(75);
    expect(result.score).toBe(75); // 100 weighted, capped at 75
    expect(result.band).toBe("LOWER_RISK");
    expect(result.categories.holders.available).toBe(false);
    expect(result.categories.holders.score).toBeNull();
  });

  it("caps the composite at 50 with 1-of-3 category coverage", () => {
    const result = scoreToken(
      cleanToken({
        honeypot: null,
        lpLockedOrBurned: true,
        availability: { contractSafety: false, liquidity: true, holders: false },
      }),
    );
    expect(result.coverage).toBe(1);
    expect(result.cap).toBe(50);
    expect(result.score).toBe(50);
    expect(result.band).toBe("CAUTION");
  });

  it("returns an unscored result with 0-of-3 coverage", () => {
    const result = scoreToken(
      cleanToken({
        honeypot: null,
        lpLockedOrBurned: null,
        top10HolderPct: null,
        availability: {
          contractSafety: false,
          liquidity: false,
          holders: false,
        },
      }),
    );
    expect(result.scored).toBe(false);
    expect(result.score).toBeNull();
    expect(result.band).toBeNull();
    expect(result.coverage).toBe(0);
  });

  it("applies only the highest matching liquidity-depth tier ($8k costs -30, not -45)", () => {
    const result = scoreToken(cleanToken({ liquidityUsd: 8_000 }));
    // 100 - 30 (under $10k tier only) = 70; NOT -30-15
    expect(result.categories.liquidity.score).toBe(70);
  });

  it("applies only one LP lock tier (locked <30d costs -15, not -55)", () => {
    const result = scoreToken(
      cleanToken({ lpLockedOrBurned: true, lpLockDays: 10 }),
    );
    expect(result.categories.liquidity.score).toBe(85);
  });

  it("burned LP costs -0 on the lock tiers", () => {
    const result = scoreToken(
      cleanToken({ lpLockedOrBurned: true, lpLockDays: null }),
    );
    expect(result.categories.liquidity.score).toBe(100);
  });

  it("applies only the highest top-10 holder tier (60% costs -30, not -45)", () => {
    const result = scoreToken(cleanToken({ top10HolderPct: 60 }));
    expect(result.categories.holders.score).toBe(70);
  });

  it("applies only the highest dev-wallet tier (12% costs -25, not -35)", () => {
    const result = scoreToken(cleanToken({ devWalletPct: 12 }));
    expect(result.categories.holders.score).toBe(75);
  });

  it("treats hidden modifiable tax as exclusive over the high-tax tier", () => {
    const result = scoreToken(
      cleanToken({ hiddenModifiableTax: true, buyTax: 15, sellTax: 15 }),
    );
    // -30 for modifiable tax only, not -30-20
    expect(result.categories.contractSafety.score).toBe(70);
  });

  it("clamps category scores to 0 when deductions exceed 100", () => {
    const result = scoreToken(
      cleanToken({
        mintable: true, // -30
        freezable: true, // -25
        proxy: true, // -20 (owner active)
        ownershipRenounced: false, // -15
        hiddenModifiableTax: true, // -30
        contractVerified: false, // -10
        // raw: 100 - 130 = -30 -> clamped to 0
      }),
    );
    expect(result.categories.contractSafety.score).toBe(0);
    // composite: 0*.4 + 100*.35 + 100*.25 = 60 -> CAUTION
    expect(result.score).toBe(60);
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.band).toBe("CAUTION");
  });

  it("emits a plain-language flag for every deduction", () => {
    const result = scoreToken(
      cleanToken({ mintable: true, lpLockedOrBurned: false, top10HolderPct: 60 }),
    );
    const texts = result.flags.map((f) => f.text);
    expect(texts.some((t) => /mint authority/i.test(t))).toBe(true);
    expect(texts.some((t) => /not locked or burned/i.test(t))).toBe(true);
    expect(texts.some((t) => /top 10 holders/i.test(t))).toBe(true);
    expect(result.flags.every((f) => f.deduction > 0)).toBe(true);
  });
});

describe("bandForScore", () => {
  it("maps scores to bands per the rubric", () => {
    expect(bandForScore(0)).toBe("AVOID");
    expect(bandForScore(39)).toBe("AVOID");
    expect(bandForScore(40)).toBe("CAUTION");
    expect(bandForScore(69)).toBe("CAUTION");
    expect(bandForScore(70)).toBe("LOWER_RISK");
    expect(bandForScore(100)).toBe("LOWER_RISK");
  });
});
