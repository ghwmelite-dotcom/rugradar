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
    // liquidity (v1, 12h old): 100-40-60(age-doubled <$10k)-10-10 -> clamped 0
    expect(result.categories.liquidity.score).toBe(0);
    // holders (v1, 12h old): 100-45(age-scaled >50%)-25-20 = 10
    expect(result.categories.holders.score).toBe(10);
    // composite: (20*.4 + 0*.35 + 10*.25) = 10.5 -> 11
    expect(result.score).toBe(11);
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

describe("scoreToken v1 — age gate", () => {
  it("caps a spotless <24h-old token at 69 / CAUTION and explains itself", () => {
    const result = scoreToken(
      cleanToken({ pairAgeHours: 3, lpLockDays: 90 }),
    );
    // Raw composite is 100; the age gate caps it out of LOWER RISK.
    expect(result.ageCap).toBe(69);
    expect(result.cap).toBe(69);
    expect(result.score).toBe(69);
    expect(result.band).toBe("CAUTION");
    const capFlag = result.flags.find((f) => f.category === null);
    expect(capFlag?.text).toContain("capped at 69");
    expect(capFlag?.text).toContain("3 hours old");
  });

  it("caps a 24h-7d token at 84 (LOWER RISK, but not spotless)", () => {
    const result = scoreToken(cleanToken({ pairAgeHours: 24 }));
    expect(result.ageCap).toBe(84);
    expect(result.score).toBe(84);
    expect(result.band).toBe("LOWER_RISK");
    const mid = scoreToken(cleanToken({ pairAgeHours: 72 }));
    expect(mid.ageCap).toBe(84);
    expect(mid.score).toBe(84);
  });

  it("lifts the gate at exactly 7 days", () => {
    const result = scoreToken(cleanToken({ pairAgeHours: 168 }));
    expect(result.ageCap).toBeNull();
    expect(result.score).toBe(100);
    expect(result.band).toBe("LOWER_RISK");
  });

  it("never gates on unknown age", () => {
    const result = scoreToken(cleanToken({ pairAgeHours: null }));
    expect(result.ageCap).toBeNull();
    expect(result.score).toBe(100);
  });

  it("takes the min of the age gate and the coverage cap", () => {
    const result = scoreToken(
      cleanToken({
        pairAgeHours: 12,
        top10HolderPct: null,
        availability: { contractSafety: true, liquidity: true, holders: false },
      }),
    );
    expect(result.coverage).toBe(2);
    expect(result.cap).toBe(69); // min(75 coverage, 69 age)
    expect(result.score).toBe(69);
    expect(result.band).toBe("CAUTION");
  });

  it("only emits the age-cap flag when the gate actually binds", () => {
    // 3h-old token scoring 61 raw: under the 69 gate, so no cap flag.
    const result = scoreToken(
      cleanToken({
        pairAgeHours: 3,
        liquidityUsd: 5_000,
        lpLockDays: null,
        dexCount: 1,
        top10HolderPct: 60,
      }),
    );
    // liquidity: 100-60-10-10 = 20; holders: 100-45 = 55 -> composite 61
    expect(result.score).toBe(61);
    expect(result.flags.some((f) => f.text.includes("capped at"))).toBe(false);
  });
});

describe("scoreToken v1 — fresh-launch scaling", () => {
  it("doubles the <$10k liquidity deduction under 7 days old", () => {
    const result = scoreToken(
      cleanToken({ pairAgeHours: 48, liquidityUsd: 8_000 }),
    );
    // 100 - 60 (age-doubled) = 40; mature equivalent costs only -30.
    expect(result.categories.liquidity.score).toBe(40);
    const flag = result.categories.liquidity.flags[0];
    expect(flag.deduction).toBe(60);
    expect(flag.text).toContain("less than 7 days old");
  });

  it("doubles the <$50k liquidity deduction under 7 days old", () => {
    const result = scoreToken(
      cleanToken({ pairAgeHours: 48, liquidityUsd: 30_000 }),
    );
    expect(result.categories.liquidity.score).toBe(70); // 100 - 30
  });

  it("scales top-10 >50% concentration to -45 under 7 days old", () => {
    const result = scoreToken(
      cleanToken({ pairAgeHours: 48, top10HolderPct: 60 }),
    );
    // 100 - 45 = 55; mature equivalent costs only -30.
    expect(result.categories.holders.score).toBe(55);
    const flag = result.categories.holders.flags[0];
    expect(flag.deduction).toBe(45);
    expect(flag.text).toContain("fresh concentration");
  });

  it("scores the doc's BABYCATE example: 1h-old pump.fun launch lands CAUTION, not LOWER RISK", () => {
    const result = scoreToken(
      cleanToken({
        pairAgeHours: 1,
        liquidityUsd: 0,
        lpLockedOrBurned: true, // pump.fun burns LP by construction
        lpLockDays: null,
        dexCount: 1,
        top10HolderPct: 72.4,
        devWalletPct: 0,
        holderCount: 500,
      }),
    );
    // liquidity: 100-60-10-10 = 20; holders: 100-45 = 55; contract: 100
    expect(result.categories.liquidity.score).toBe(20);
    expect(result.categories.holders.score).toBe(55);
    // composite: 40 + 7 + 13.75 = 60.75 -> 61 (under the 69 gate, no cap flag)
    expect(result.score).toBe(61);
    expect(result.band).toBe("CAUTION");
    expect(result.flags.some((f) => f.text.includes("capped at"))).toBe(false);
  });

  it("leaves mature tokens untouched by the scaling", () => {
    const result = scoreToken(
      cleanToken({ pairAgeHours: 2400, liquidityUsd: 8_000, top10HolderPct: 60 }),
    );
    expect(result.categories.liquidity.score).toBe(70); // -30, not -60
    expect(result.categories.holders.score).toBe(70); // -30, not -45
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
