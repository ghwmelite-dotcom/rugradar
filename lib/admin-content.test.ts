import { describe, expect, it } from "vitest";
import {
  caReplyVerdict,
  dailyReportPost,
  fit,
  generateThread,
  intentUrl,
  MAIN_POST_MAX,
  milestonePost,
  oneLinerFromFlags,
  pickRiskiest,
  rugAnatomyThread,
  telegramFunnelPost,
  THREAD_POST_MAX,
  threadUnavailableReason,
  type AdminData,
  type ThreadType,
  type TokenInsight,
} from "./admin-content";
import type { ScanLogEntry } from "./scanlog";

function entry(overrides: Partial<ScanLogEntry>): ScanLogEntry {
  return {
    chain: "solana",
    address: "addr",
    name: "Token",
    symbol: "TOK",
    imageUrl: null,
    score: 50,
    band: "CAUTION",
    honeypot: false,
    scannedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("fit", () => {
  it("leaves short text untouched", () => {
    expect(fit("hello", 10)).toBe("hello");
  });
  it("truncates at a word boundary with an ellipsis", () => {
    const out = fit("one two three four five", 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("oneLinerFromFlags", () => {
  it("keeps only the claims, lowercased and comma-joined", () => {
    const line = oneLinerFromFlags([
      "Top 10 holders control 72.4% of the supply — a few wallets can dump on everyone.",
      "LP tokens are not locked or burned — the deployer can drain the pool at any time.",
      "Pair is 1 hour old — brand-new pairs are the classic rug setup.",
    ]);
    expect(line).toBe(
      "top 10 holders control 72.4% of the supply, LP tokens are not locked or burned, pair is 1 hour old",
    );
  });
});

describe("pickRiskiest", () => {
  it("prefers honeypots over low scores", () => {
    const picked = pickRiskiest([
      entry({ address: "low", score: 3 }),
      entry({ address: "hp", score: 80, honeypot: true }),
    ]);
    expect(picked?.address).toBe("hp");
  });
  it("otherwise picks the lowest score", () => {
    const picked = pickRiskiest([
      entry({ address: "a", score: 41 }),
      entry({ address: "b", score: 12 }),
    ]);
    expect(picked?.address).toBe("b");
  });
  it("returns null when nothing is scored or flagged", () => {
    expect(pickRiskiest([entry({ score: null, band: null })])).toBeNull();
    expect(pickRiskiest([])).toBeNull();
  });
});

describe("dailyReportPost", () => {
  const base = {
    date: "August 21, 2026",
    scanned: 16,
    honeypots: 1,
    flagCount: 4,
    riskiestName: "$BABYCATE",
    riskiestLine:
      "top 10 wallets hold 72.4% of supply, $0 locked liquidity, pair 1 hour old",
  };

  it("stays within the main-post limit, even with a huge one-liner", () => {
    expect(dailyReportPost(base).text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    const huge = dailyReportPost({
      ...base,
      riskiestLine: "x".repeat(500),
      riskiestName: "$AVERYLONGSYMBOLNAME",
    });
    expect(huge.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });

  it("never puts a link in the main post; the reply carries it", () => {
    const post = dailyReportPost(base);
    expect(post.text).not.toMatch(/https?:\/\//);
    expect(post.reply).toContain("https://rugradar.trademetricspro.com");
  });

  it("keeps the reply-driving question when the line must shrink", () => {
    const post = dailyReportPost({ ...base, riskiestLine: "y".repeat(500) });
    expect(post.text).toContain("Would you touch this?");
  });
});

describe("rugAnatomyThread", () => {
  const input = {
    name: "Baby Cate",
    symbol: "BABYCATE",
    score: 12,
    flags: [
      "Top 10 holders control 72.4% of the supply — a few wallets can dump on everyone.",
      "LP tokens are not locked or burned — the deployer can drain the pool at any time.",
      "Pair is 1 hour old — brand-new pairs are the classic rug setup.",
    ],
    url: "https://rugradar.trademetricspro.com/report/solana/abc",
  };

  it("numbers every post and stays <= 280 chars each", () => {
    const { posts } = rugAnatomyThread(input);
    expect(posts.length).toBeGreaterThanOrEqual(4);
    expect(posts.length).toBeLessThanOrEqual(5);
    posts.forEach((p, i) => {
      expect(p.startsWith(`${i + 1}/${posts.length} `)).toBe(true);
      expect(p.length).toBeLessThanOrEqual(THREAD_POST_MAX);
    });
  });

  it("keeps the report link out of the thread, in the paired reply", () => {
    const { posts, linkReply } = rugAnatomyThread(input);
    for (const p of posts) expect(p).not.toMatch(/https?:\/\//);
    expect(linkReply).toContain(input.url);
  });
});

describe("telegramFunnelPost", () => {
  it("fits the limit, has a question, and moves the invite to the reply", () => {
    const post = telegramFunnelPost();
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    expect(post.text).toContain("?");
    expect(post.text).not.toContain("t.me");
    expect(post.reply).toContain("https://t.me/+B2z7qkzpjAUwYmQ0");
    expect(post.reply).toContain("@tm_rugradar_bot");
  });
});

describe("milestonePost", () => {
  it("fits the limit and asks a question", () => {
    const post = milestonePost({ scanned: 132, flaggedPct: 61, window: "24 hours" });
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    expect(post.text).toContain("61%");
    expect(post.text).toContain("?");
    expect(post.text).not.toMatch(/https?:\/\//);
  });
});

describe("caReplyVerdict", () => {
  it("composes a reply-ready verdict with the report link, <= 280 chars", () => {
    const text = caReplyVerdict({
      score: 12,
      band: "AVOID",
      name: "Baby Cate",
      symbol: "BABYCATE",
      flags: [
        "LP tokens are not locked or burned — the deployer can drain the pool at any time.",
        "Top 10 holders control 72.4% of the supply — a few wallets can dump on everyone.",
      ],
      url: "https://rugradar.trademetricspro.com/report/solana/abc",
    });
    expect(text).toContain("🚨");
    expect(text).toContain("12/100");
    expect(text).toContain("AVOID");
    expect(text).toContain(
      "https://rugradar.trademetricspro.com/report/solana/abc",
    );
    expect(text.length).toBeLessThanOrEqual(THREAD_POST_MAX);
  });

  it("handles unscored tokens without crashing", () => {
    const text = caReplyVerdict({
      score: null,
      band: null,
      name: null,
      symbol: null,
      flags: [],
      url: "https://rugradar.trademetricspro.com/report/solana/abc",
    });
    expect(text).toContain("unscored");
    expect(text.length).toBeLessThanOrEqual(THREAD_POST_MAX);
  });
});

describe("intentUrl", () => {
  it("URL-encodes the text", () => {
    expect(intentUrl("a b?&c")).toBe(
      "https://twitter.com/intent/tweet?text=a%20b%3F%26c",
    );
  });
});

// ---------- Thread Studio ----------

const F1 =
  "Top 10 holders control 72.4% of the supply — a few wallets can dump on everyone.";
const F2 =
  "LP tokens are not locked or burned — the deployer can drain the pool at any time.";
const F3 = "Pair is 1 hour old — brand-new pairs are the classic rug setup.";
const FHONEYPOT = "Confirmed honeypot — sells are blocked by the contract.";

function insight(overrides: Partial<TokenInsight>): TokenInsight {
  return {
    chain: "solana",
    address: "addr",
    name: "Token",
    symbol: "TOK",
    score: 50,
    band: "CAUTION",
    honeypot: false,
    scanCount: 1,
    topFlag: null,
    flags: [],
    url: "https://rugradar.trademetricspro.com/report/solana/addr",
    ...overrides,
  };
}

function richData(overrides: Partial<AdminData> = {}): AdminData {
  return {
    generatedAt: "2026-08-21T12:00:00.000Z",
    today: "August 21, 2026",
    scanned: 16,
    honeypots: 1,
    flagged: 5,
    flaggedPct: 31,
    window: "24 hours",
    riskiest: {
      chain: "solana",
      address: "r1",
      name: "Baby Cate",
      symbol: "BABYCATE",
      score: 12,
      band: "AVOID",
      flagCount: 3,
      flags: [F1, F2, F3],
      line: "top 10 holders control 72.4% of the supply, LP tokens are not locked or burned, pair is 1 hour old",
      url: "https://rugradar.trademetricspro.com/report/solana/r1",
    },
    bands: { AVOID: 2, CAUTION: 3, LOWER_RISK: 9, unscored: 2 },
    leaderboard: [
      insight({
        symbol: "BABYCATE",
        address: "r1",
        scanCount: 23,
        score: 12,
        band: "AVOID",
        topFlag: F1,
        flags: [F1, F2],
      }),
      insight({
        symbol: "MOONDOG",
        address: "m2",
        scanCount: 17,
        score: 74,
        band: "LOWER_RISK",
      }),
      insight({
        symbol: "PEPEJR",
        address: "p3",
        scanCount: 9,
        score: 55,
        band: "CAUTION",
        topFlag: F1,
        flags: [F1],
      }),
    ],
    wallOfShame: [
      insight({
        symbol: "SCAMX",
        address: "s9",
        honeypot: true,
        score: 0,
        band: "AVOID",
        topFlag: FHONEYPOT,
        flags: [FHONEYPOT],
      }),
    ],
    ...overrides,
  };
}

function emptyData(): AdminData {
  return richData({
    scanned: 0,
    honeypots: 0,
    flagged: 0,
    flaggedPct: 0,
    riskiest: null,
    bands: { AVOID: 0, CAUTION: 0, LOWER_RISK: 0, unscored: 0 },
    leaderboard: [],
    wallOfShame: [],
  });
}

const ALL_TYPES: ThreadType[] = [
  "anatomy",
  "leaderboard",
  "red-flag-class",
  "honeypot-watch",
  "daily-recap",
];

describe("thread studio generators — shared contract (rich data)", () => {
  for (const type of ALL_TYPES) {
    it(`${type}: numbered, <= 280, no links in body, link in reply`, () => {
      const thread = generateThread(type, richData());
      expect(thread).not.toBeNull();
      const { posts, linkReply } = thread!;
      expect(posts.length).toBeGreaterThanOrEqual(3);
      posts.forEach((p, i) => {
        expect(p.startsWith(`${i + 1}/${posts.length} `)).toBe(true);
        expect(p.length).toBeLessThanOrEqual(THREAD_POST_MAX);
        expect(p).not.toMatch(/https?:\/\//); // links never in the body
        expect(p).not.toMatch(/#/); // no hashtags
      });
      expect(linkReply).toMatch(/https?:\/\//);
    });
  }
});

describe("leaderboard thread", () => {
  it("gives each board token a post with scans, verdict, and top flag", () => {
    const { posts } = generateThread("leaderboard", richData())!;
    // hook + 3 tokens + CTA
    expect(posts.length).toBe(5);
    expect(posts[1]).toContain("$BABYCATE");
    expect(posts[1]).toContain("23 scans");
    expect(posts[1]).toContain("12/100");
    expect(posts[1]).toContain("Top 10 holders control 72.4%");
    // LOWER_RISK token without flags gets the honest "not the same as safe".
    expect(posts[2]).toContain("$MOONDOG");
    expect(posts[2]).toContain("not the same as safe");
  });
});

describe("red flag class thread", () => {
  it("ranks the most common claim first", () => {
    const { posts } = generateThread("red-flag-class", richData())!;
    // F1's claim appears on two tokens in the pool — it teaches first.
    expect(posts[1]).toContain("Top 10 holders control 72.4% of the supply");
    expect(posts[1]).toContain("$BABYCATE");
  });
});

describe("honeypot watch thread", () => {
  it("names the caught token with its verdict", () => {
    const { posts } = generateThread("honeypot-watch", richData())!;
    expect(posts[0]).toContain("🚨");
    expect(posts[1]).toContain("$SCAMX");
    expect(posts[1]).toContain("0/100");
    expect(posts[1]).toContain("Confirmed honeypot");
  });
});

describe("daily recap thread", () => {
  it("tells the day's numbers as a narrative", () => {
    const { posts } = generateThread("daily-recap", richData())!;
    expect(posts[0]).toContain("16 tokens scanned");
    expect(posts[0]).toContain("31%");
    expect(posts[1]).toContain("2 AVOID, 3 CAUTION, 9 LOWER RISK");
    expect(posts.join("\n")).toContain("$BABYCATE");
    expect(posts.join("\n")).toContain("pattern of the day");
  });

  it("falls back to an honest quiet-day insight when no flags exist", () => {
    const quiet = richData({
      riskiest: null,
      leaderboard: [insight({ band: "LOWER_RISK", score: 80 })],
      wallOfShame: [],
    });
    const { posts } = generateThread("daily-recap", quiet)!;
    expect(posts.join("\n")).toContain("Quiet day on the radar");
  });
});

describe("graceful empty-data behavior", () => {
  it("every generator returns null on an empty window", () => {
    for (const type of ALL_TYPES) {
      expect(generateThread(type, emptyData())).toBeNull();
    }
  });

  it("threadUnavailableReason explains every disabled type", () => {
    for (const type of ALL_TYPES) {
      const reason = threadUnavailableReason(type, emptyData());
      expect(typeof reason).toBe("string");
      expect(reason!.length).toBeGreaterThan(10);
    }
    expect(threadUnavailableReason("anatomy", null)).toMatch(/not loaded/);
  });

  it("honeypot watch is disabled specifically when the wall is empty", () => {
    expect(threadUnavailableReason("honeypot-watch", emptyData())).toMatch(
      /quiet day/,
    );
    expect(threadUnavailableReason("honeypot-watch", richData())).toBeNull();
  });

  it("never invents tokens: thin pools yield fewer posts, not filler", () => {
    const thin = richData({ leaderboard: [insight({ scanCount: 3 })] });
    const { posts } = generateThread("leaderboard", thin)!;
    expect(posts.length).toBe(3); // hook + 1 token + CTA
  });
});
