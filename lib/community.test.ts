import { describe, expect, it } from "vitest";
import {
  championPost,
  contrastPost,
  raidReplies,
  rallyPost,
  type CommunityConfig,
  type CommunityVerdict,
} from "./community";
import { MAIN_POST_MAX } from "./admin-content";

const CFG: CommunityConfig = {
  chain: "solana",
  address: "CATEaddr111111111111111111111111111111111",
  label: "$CATE",
};

function verdict(overrides: Partial<CommunityVerdict>): CommunityVerdict {
  return {
    score: 92,
    band: "LOWER_RISK",
    honeypot: false,
    flags: [],
    priceUsd: 0.001,
    liquidityUsd: 1_200_000,
    volume24h: 340_000,
    holderCount: 12_400,
    ...overrides,
  };
}

const CLEAN = verdict({});
const FLAGGED = verdict({
  score: 41,
  band: "CAUTION",
  flags: [
    "LP tokens are not locked or burned — the deployer can drain the pool at any time.",
  ],
});

describe("championPost", () => {
  it("champions a clean verdict with score, stats and a community CTA", () => {
    const post = championPost(CFG, CLEAN);
    expect(post.text).toContain("✅");
    expect(post.text).toContain("$CATE");
    expect(post.text).toContain("92/100");
    expect(post.text).toContain("LOWER RISK");
    expect(post.text).toContain("$1.2M");
    expect(post.text).toContain("12,400 holders");
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });

  it("never carries a link in the main post; the reply carries the report", () => {
    const post = championPost(CFG, CLEAN);
    expect(post.text).not.toContain("http");
    expect(post.reply).toContain("/report/solana/");
  });

  it("switches to honest watch mode when the token flags", () => {
    const post = championPost(CFG, FLAGGED);
    expect(post.text).toContain("⚠️");
    expect(post.text).toContain("41/100");
    expect(post.text).toContain("CAUTION");
    expect(post.text).toContain("LP tokens are not locked");
    expect(post.text).toContain("We scan what we love too");
    expect(post.text).not.toContain("✅");
  });

  it("calls out a honeypot override explicitly", () => {
    const post = championPost(
      CFG,
      verdict({ score: 0, band: "AVOID", honeypot: true }),
    );
    expect(post.text).toContain("🚨");
    expect(post.text).toContain("HONEYPOT");
  });

  it("copes with missing market stats", () => {
    const post = championPost(
      CFG,
      verdict({ liquidityUsd: null, volume24h: null, holderCount: null }),
    );
    expect(post.text).toContain("✅");
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });
});

describe("contrastPost", () => {
  it("contrasts a clean champion against a flagged viral field", () => {
    const post = contrastPost(CFG, CLEAN, { total: 5, flagged: 3 });
    expect(post).not.toBeNull();
    expect(post!.text).toContain("5 tokens");
    expect(post!.text).toContain("3 flagged red");
    expect(post!.text).toContain("$CATE: 92/100");
    expect(post!.text).not.toContain("http");
    expect(post!.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
  });

  it("is suppressed when the champion itself flags (credibility rule)", () => {
    expect(contrastPost(CFG, FLAGGED, { total: 5, flagged: 3 })).toBeNull();
    expect(
      contrastPost(CFG, verdict({ honeypot: true, band: "AVOID", score: 0 }), {
        total: 5,
        flagged: 3,
      }),
    ).toBeNull();
  });

  it("is suppressed on quiet or clean fields", () => {
    expect(contrastPost(CFG, CLEAN, { total: 5, flagged: 0 })).toBeNull();
    expect(contrastPost(CFG, CLEAN, { total: 1, flagged: 1 })).toBeNull();
  });
});

describe("raidReplies", () => {
  it("gives three link-carrying replies for a clean token", () => {
    const replies = raidReplies(CFG, CLEAN);
    expect(replies).toHaveLength(3);
    for (const r of replies) {
      expect(r).toContain("/report/solana/");
      expect(r).toContain("$CATE");
      expect(r.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    }
  });

  it("shifts to accountability copy when the token flags", () => {
    const replies = raidReplies(CFG, FLAGGED);
    expect(replies.length).toBeGreaterThan(0);
    expect(replies[0]).toContain("CAUTION");
    expect(replies[0]).toContain("/report/solana/");
  });
});

describe("rallyPost", () => {
  it("rallies the community with the scan habit", () => {
    const post = rallyPost(CFG);
    expect(post.text).toContain("$CATE");
    expect(post.text).toContain("10 seconds");
    expect(post.text).not.toContain("http");
    expect(post.text.length).toBeLessThanOrEqual(MAIN_POST_MAX);
    expect(post.reply).toContain("http");
  });
});
