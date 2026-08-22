import { describe, expect, it } from "vitest";
import {
  heatScore,
  MIN_LIQUIDITY_USD,
  rankCandidates,
  viralAlertPost,
  viralCleanPost,
  viralDigestPost,
  viralPickPost,
  type ViralCandidate,
  type ViralPick,
  type ViralVerdict,
} from "./viral";
import { MAIN_POST_MAX } from "./admin-content";

function candidate(overrides: Partial<ViralCandidate>): ViralCandidate {
  return {
    chain: "solana",
    address: "addr",
    name: "Token",
    symbol: "TOK",
    imageUrl: null,
    priceUsd: 0.01,
    liquidityUsd: 50_000,
    volume24h: 0,
    priceChange24h: null,
    priceChange1h: null,
    buys24h: 0,
    sells24h: 0,
    ageHours: null,
    boostAmount: 0,
    ...overrides,
  };
}

function verdict(overrides: Partial<ViralVerdict>): ViralVerdict {
  return {
    score: 50,
    band: "CAUTION",
    honeypot: false,
    flags: [],
    ...overrides,
  };
}

function pick(overrides: Partial<ViralPick>): ViralPick {
  const c = candidate({});
  return {
    ...c,
    heat: 50,
    drivers: [],
    verdict: verdict({}),
    post: { text: "x", reply: null },
    reportUrl: "https://rugradar.trademetricspro.com/report/solana/addr",
    cardUrl: "https://rugradar.trademetricspro.com/report/solana/addr/opengraph-image",
    ...overrides,
  };
}

describe("heatScore", () => {
  it("scores a dead token near zero", () => {
    const { score, drivers } = heatScore(candidate({}));
    expect(score).toBe(0);
    expect(drivers).toEqual([]);
  });

  it("never exceeds 100 even on absurd inputs", () => {
    const { score } = heatScore(
      candidate({
        boostAmount: 1_000_000,
        volume24h: 1e12,
        priceChange24h: 50_000,
        priceChange1h: 9_000,
        buys24h: 100_000,
        sells24h: 1,
        ageHours: 0.5,
      }),
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rewards each signal monotonically", () => {
    const base = heatScore(candidate({})).score;
    expect(heatScore(candidate({ boostAmount: 500 })).score).toBeGreaterThan(base);
    expect(heatScore(candidate({ volume24h: 2_000_000 })).score).toBeGreaterThan(base);
    expect(heatScore(candidate({ priceChange24h: 300 })).score).toBeGreaterThan(base);
    expect(
      heatScore(candidate({ buys24h: 700, sells24h: 300 })).score,
    ).toBeGreaterThan(base);
    expect(heatScore(candidate({ ageHours: 3 })).score).toBeGreaterThan(base);
  });

  it("log-scales boosts so 10x more promotion is not 10x the score", () => {
    const small = heatScore(candidate({ boostAmount: 100 })).score;
    const large = heatScore(candidate({ boostAmount: 10_000 })).score;
    expect(large).toBeGreaterThan(small);
    expect(large - small).toBeLessThan(small);
  });

  it("ignores negative price action — a dump is not heat", () => {
    const dump = heatScore(candidate({ priceChange24h: -80, priceChange1h: -40 }));
    expect(dump.score).toBe(0);
  });

  it("ignores sell-dominated flow", () => {
    const { score } = heatScore(candidate({ buys24h: 100, sells24h: 900 }));
    expect(score).toBe(0);
  });

  it("lists drivers strongest-first", () => {
    const { drivers } = heatScore(
      candidate({ boostAmount: 900, volume24h: 100, ageHours: 2 }),
    );
    expect(drivers.length).toBe(3);
    expect(drivers[0]).toContain("boost");
  });
});

describe("rankCandidates", () => {
  it("filters dust liquidity and anonymous tokens", () => {
    const ranked = rankCandidates(
      [
        candidate({ liquidityUsd: MIN_LIQUIDITY_USD - 1, boostAmount: 999 }),
        candidate({ name: null, symbol: null, boostAmount: 999 }),
        candidate({ symbol: "REAL", boostAmount: 10 }),
      ],
      5,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.symbol).toBe("REAL");
  });

  it("sorts by heat descending and caps the list", () => {
    const ranked = rankCandidates(
      [
        candidate({ address: "a", boostAmount: 5 }),
        candidate({ address: "b", boostAmount: 500 }),
        candidate({ address: "c", boostAmount: 50 }),
      ],
      2,
    );
    expect(ranked.map((r) => r.candidate.address)).toEqual(["b", "c"]);
  });
});

describe("viralAlertPost", () => {
  const flagged = verdict({
    score: 14,
    band: "AVOID",
    flags: [
      "Top 10 holders control 72.4% of the supply — a few wallets can dump on everyone.",
    ],
  });

  it("leads with the verdict emoji and includes momentum + score + flag", () => {
    const post = viralAlertPost(
      candidate({ priceChange24h: 340, volume24h: 2_300_000 }),
      flagged,
    );
    expect(post.text).toContain("🚨");
    expect(post.text).toContain("$TOK");
    expect(post.text).toContain("+340%");
    expect(post.text).toContain("14/100");
    expect(post.text).toContain("AVOID");
    expect(post.text).toContain("top 10 holders control 72.4%");
  });

  it("never carries a link in the main post; the reply carries the report URL", () => {
    const post = viralAlertPost(candidate({}), flagged);
    expect(post.text).not.toContain("http");
    expect(post.reply).toContain(
      "https://rugradar.trademetricspro.com/report/solana/addr",
    );
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });

  it("calls out a confirmed honeypot explicitly", () => {
    const post = viralAlertPost(
      candidate({}),
      verdict({ score: 0, band: "AVOID", honeypot: true }),
    );
    expect(post.text.toLowerCase()).toContain("honeypot");
  });

  it("stays within the main-post budget even with maximal momentum", () => {
    const post = viralAlertPost(
      candidate({
        priceChange24h: 12_000,
        volume24h: 999_000_000,
        boostAmount: 88_888,
      }),
      flagged,
    );
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });
});

describe("viralCleanPost", () => {
  it("marks the rare clean trender but hedges that clean != safe", () => {
    const post = viralCleanPost(
      candidate({ priceChange24h: 220 }),
      verdict({ score: 87, band: "LOWER_RISK" }),
    );
    expect(post.text).toContain("✅");
    expect(post.text).toContain("87/100");
    expect(post.text).toContain("LOWER RISK");
    expect(post.text).toContain("Not the same as safe");
    expect(post.text).not.toContain("http");
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });
});

describe("viralPickPost", () => {
  it("routes LOWER_RISK to the clean template", () => {
    const post = viralPickPost(
      candidate({}),
      verdict({ score: 90, band: "LOWER_RISK" }),
    );
    expect(post.text).toContain("✅");
  });

  it("routes CAUTION/AVOID/unscored to the alert template", () => {
    for (const v of [
      verdict({ band: "CAUTION" }),
      verdict({ band: "AVOID" }),
      verdict({ score: null, band: null }),
    ]) {
      expect(viralPickPost(candidate({}), v).text).toContain("🚨");
    }
  });

  it("treats unscored as its own warning", () => {
    const post = viralPickPost(candidate({}), verdict({ score: null, band: null }));
    expect(post.text).toContain("too thin to score");
  });
});

describe("viralDigestPost", () => {
  it("returns null with fewer than two scanned picks", () => {
    expect(viralDigestPost("August 22, 2026", [pick({})])).toBeNull();
    expect(
      viralDigestPost("August 22, 2026", [pick({}), pick({ verdict: null })]),
    ).toBeNull();
  });

  it("lists each pick with verdict emoji and score", () => {
    const post = viralDigestPost("August 22, 2026", [
      pick({
        symbol: "AAA",
        verdict: verdict({ score: 12, band: "AVOID" }),
      }),
      pick({
        symbol: "BBB",
        verdict: verdict({ score: 88, band: "LOWER_RISK" }),
      }),
    ]);
    expect(post).not.toBeNull();
    expect(post!.text).toContain("🚨 $AAA — 12/100");
    expect(post!.text).toContain("✅ $BBB — 88/100");
    expect(post!.text).toContain("1 of 2 carry red flags");
    expect(post!.text).not.toContain("http");
    expect(post!.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    expect(post!.reply).toContain("http");
  });

  it("notes the rare all-clear day", () => {
    const post = viralDigestPost("August 22, 2026", [
      pick({ symbol: "AAA", verdict: verdict({ score: 85, band: "LOWER_RISK" }) }),
      pick({ symbol: "BBB", verdict: verdict({ score: 90, band: "LOWER_RISK" }) }),
    ]);
    expect(post!.text).toContain("All clear");
  });
});
