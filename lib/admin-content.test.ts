import { describe, expect, it } from "vitest";
import {
  caReplyVerdict,
  dailyReportPost,
  fit,
  intentUrl,
  MAIN_POST_MAX,
  milestonePost,
  oneLinerFromFlags,
  pickRiskiest,
  rugAnatomyThread,
  telegramFunnelPost,
  THREAD_POST_MAX,
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
