// Community Beacon (admin vault): a dedicated content engine for ONE
// championed community token ($CATE). The play: become the scanner of
// record for that community — daily radar checks, contrast posts against
// the day's viral field, and raid replies the community can paste under
// its own posts (each carrying the token's RugRadar report link, which
// unfurls the OG score card and pulls the community back to the site).
//
// CREDIBILITY RULE (non-negotiable): generators follow the ACTUAL scan
// verdict. When the champion token is clean, copy champions it; when it
// flags, copy switches to honest watch mode and the contrast post is
// suppressed entirely — a rug scanner that shills through red flags is
// worth nothing.
//
// Config (chain + address + label) is operator-set from the vault and
// stored long-lived in KV (admin:community) via the direct-binding pattern
// from lib/watchlist.ts — not the TTL'd cache.
//
// Pure generators (championPost, contrastPost, raidReplies, rallyPost) are
// unit-tested in lib/community.test.ts. Post rules match
// lib/admin-content.ts: main posts <= 240 chars, no links in main posts
// (links live in the paired reply — EXCEPT raid replies, which ARE
// replies and therefore carry the link by design).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChain, type Chain } from "./chains";
import {
  fit,
  MAIN_POST_MAX,
  oneLinerFromFlags,
  reportUrl,
  SITE_URL,
  TG_INVITE_URL,
  type Post,
} from "./admin-content";
import { scanToken } from "./scan";
import { getViralPicks } from "./viral";

// ---------- config (KV-backed, long-lived) ----------

export interface CommunityConfig {
  chain: Chain;
  address: string;
  label: string; // display label, e.g. "$CATE"
}

export const COMMUNITY_KEY = "admin:community";

interface KVBindingLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

// Singleton surviving Next.js dev hot-reloads (mirrors lib/watchlist.ts).
const globalForCommunity = globalThis as unknown as {
  __memescanCommunityState?: Map<string, unknown>;
};

function memoryStore(): Map<string, unknown> {
  if (!globalForCommunity.__memescanCommunityState) {
    globalForCommunity.__memescanCommunityState = new Map();
  }
  return globalForCommunity.__memescanCommunityState;
}

function store(): KVBindingLike {
  try {
    const env = getCloudflareContext().env as unknown as {
      MEMESCANNER_CACHE?: KVBindingLike;
    };
    if (env.MEMESCANNER_CACHE) return env.MEMESCANNER_CACHE;
  } catch {
    // Not in a Cloudflare request context (plain node, tests).
  }
  const map = memoryStore();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, JSON.parse(value));
    },
  };
}

export async function getCommunityConfig(): Promise<CommunityConfig | null> {
  try {
    const value = await store().get(COMMUNITY_KEY, "json");
    if (!value || typeof value !== "object") return null;
    const cfg = value as Partial<CommunityConfig>;
    if (!cfg.chain || !isChain(cfg.chain) || !cfg.address) return null;
    return {
      chain: cfg.chain,
      address: cfg.address,
      label: cfg.label?.trim() || "$CATE",
    };
  } catch {
    return null;
  }
}

export async function saveCommunityConfig(
  cfg: CommunityConfig,
): Promise<void> {
  if (!isChain(cfg.chain)) throw new Error("Unsupported chain.");
  if (!cfg.address.trim()) throw new Error("Contract address is required.");
  await store().put(
    COMMUNITY_KEY,
    JSON.stringify({
      chain: cfg.chain,
      address: cfg.address.trim(),
      label: cfg.label.trim() || "$CATE",
    }),
  );
}

// ---------- shared shapes ----------

export interface CommunityVerdict {
  score: number | null;
  band: string | null; // AVOID | CAUTION | LOWER_RISK | null
  honeypot: boolean;
  flags: string[];
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  holderCount: number | null;
}

export interface CommunityPack {
  generatedAt: string;
  today: string;
  config: CommunityConfig;
  verdict: CommunityVerdict | null; // null when the scan failed
  champion: Post | null;
  contrast: Post | null;
  rally: Post;
  raidReplies: string[];
  reportUrl: string;
  cardUrl: string;
  // Operator-facing reason when champion/contrast are null.
  note: string | null;
}

// ---------- formatting helpers ----------

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function bandLabel(band: string | null): string {
  return band ? band.replace("_", " ") : "UNSCORED";
}

// One line of market stats from whatever data exists.
function statsLine(v: CommunityVerdict): string {
  const parts: string[] = [];
  if (v.liquidityUsd != null) parts.push(`💧 Liq ${fmtUsd(v.liquidityUsd)}`);
  if (v.volume24h != null) parts.push(`📊 Vol ${fmtUsd(v.volume24h)}`);
  if (v.holderCount != null)
    parts.push(`👥 ${v.holderCount.toLocaleString()} holders`);
  return parts.join(" · ");
}

// ---------- generators (pure) ----------

// The daily champion post. Clean verdict = champion mode; flagged verdict
// = honest watch mode (the credibility rule).
export function championPost(
  cfg: CommunityConfig,
  v: CommunityVerdict,
): Post {
  const clean = !v.honeypot && v.band === "LOWER_RISK";
  const scoreText = v.score !== null ? `${v.score}/100` : "unscored";
  const stats = statsLine(v);

  if (clean) {
    const head = `✅ ${cfg.label} daily radar check — ${scoreText}, LOWER RISK.`;
    const mid = stats ? `\n\n${stats}` : "";
    const tail = `\n\nWhile today's hype coins flash red, the community token stays clean. Verify it yourself — same scan, public, free.\n\n${cfg.label} fam — drop a ✅ if you scanned before you aped.`;
    return {
      text: fit(`${head}${mid}${tail}`, MAIN_POST_MAX),
      reply: `${cfg.label}'s live risk report: ${reportUrl(cfg.chain, cfg.address)}`,
    };
  }

  // Honest watch mode.
  const flagLine = v.flags[0]
    ? `\n\n${oneLinerFromFlags(v.flags, 1)}.`
    : "";
  const head = v.honeypot
    ? `🚨 ${cfg.label} radar check — the scan flags a HONEYPOT pattern.`
    : `⚠️ ${cfg.label} radar check — ${scoreText}, ${bandLabel(v.band)}.`;
  const tail = `\n\nWe scan what we love too — that's the whole point. A community that knows its flags can hold devs accountable.\n\nEyes on the next scan.`;
  return {
    text: fit(`${head}${flagLine}${tail}`, MAIN_POST_MAX),
    reply: `${cfg.label}'s live risk report — see every flag: ${reportUrl(cfg.chain, cfg.address)}`,
  };
}

// Contrast post: the champion vs today's viral field. Only generated when
// the champion is clean AND at least one viral pick is flagged — never
// punch down from a flagged house (credibility rule).
export function contrastPost(
  cfg: CommunityConfig,
  v: CommunityVerdict,
  viral: { total: number; flagged: number },
): Post | null {
  const clean = !v.honeypot && v.band === "LOWER_RISK";
  if (!clean || viral.total < 2 || viral.flagged < 1) return null;

  const scoreText = v.score !== null ? `${v.score}/100` : "clean";
  return {
    text: fit(
      `Today's viral field: ${viral.total} tokens heating up — ${viral.flagged} flagged red by the radar. 🚨\n\nMeanwhile ${cfg.label}: ${scoreText}, LOWER RISK. ✅\n\nViral isn't the same as safe. The community that scans, lasts.`,
      MAIN_POST_MAX,
    ),
    reply: `Check ${cfg.label} against any trending CA: ${SITE_URL}`,
  };
}

// Raid replies — short, paste-ready replies for the community to drop
// under ${label} posts. These ARE replies, so they carry the report link
// by design: every raid unfurls the score card under someone else's post.
export function raidReplies(
  cfg: CommunityConfig,
  v: CommunityVerdict,
): string[] {
  const url = reportUrl(cfg.chain, cfg.address);
  const clean = !v.honeypot && v.band === "LOWER_RISK";
  const scoreText = v.score !== null ? `${v.score}/100` : "scanned";

  if (clean) {
    return [
      fit(
        `Scanned ✅ ${cfg.label} — ${scoreText}, LOWER RISK on RugRadar. Don't trust, verify: ${url}`,
        MAIN_POST_MAX,
      ),
      fit(
        `Before you ape ${cfg.label}, scan the CA — takes 10 seconds, verdict's public: ${url} ✅`,
        MAIN_POST_MAX,
      ),
      fit(
        `${cfg.label} passes the radar while today's trending rugs don't. Receipts: ${url}`,
        MAIN_POST_MAX,
      ),
    ];
  }
  return [
    fit(
      `${cfg.label} radar verdict: ${scoreText} ${bandLabel(v.band)} — know the flags before you size in: ${url}`,
      MAIN_POST_MAX,
    ),
    fit(
      `Every ${cfg.label} holder should know what the scan says. Public verdict: ${url}`,
      MAIN_POST_MAX,
    ),
  ];
}

// Community rally post — engagement bait that teaches the scan habit.
export function rallyPost(cfg: CommunityConfig): Post {
  return {
    text: fit(
      `The ${cfg.label} community doesn't ape blind.\n\nEvery holder can verify the contract in 10 seconds — same radar, same score, public for everyone.\n\nDrop your ${cfg.label} conviction below 👇`,
      MAIN_POST_MAX,
    ),
    reply: `Scan ${cfg.label} or any CA — free: ${SITE_URL} · live rug alerts: ${TG_INVITE_URL}`,
  };
}

// ---------- orchestration ----------

export async function getCommunityPack(): Promise<CommunityPack | null> {
  const config = await getCommunityConfig();
  if (!config) return null;

  const now = new Date();
  const pack: CommunityPack = {
    generatedAt: now.toISOString(),
    today: now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    config,
    verdict: null,
    champion: null,
    contrast: null,
    rally: rallyPost(config),
    raidReplies: [],
    reportUrl: reportUrl(config.chain, config.address),
    cardUrl: `${SITE_URL}/report/${config.chain}/${config.address}/opengraph-image`,
    note: null,
  };

  try {
    const result = await scanToken(config.chain, config.address);
    const verdict: CommunityVerdict = {
      score: result.score.score,
      band: result.score.band,
      honeypot: result.score.honeypotOverride,
      flags: result.score.flags.map((f) => f.text),
      priceUsd: result.report.priceUsd,
      liquidityUsd: result.report.liquidityUsd,
      volume24h: result.report.volume24h,
      holderCount: result.report.holderCount,
    };
    pack.verdict = verdict;
    pack.champion = championPost(config, verdict);
    pack.raidReplies = raidReplies(config, verdict);

    // Contrast needs the viral field; reuse the Viral Radar cache so this
    // is free once the vault has warmed it.
    try {
      const viral = await getViralPicks();
      const scanned = viral.picks.filter((p) => p.verdict);
      const flagged = scanned.filter(
        (p) => p.verdict!.honeypot || p.verdict!.band !== "LOWER_RISK",
      ).length;
      pack.contrast = contrastPost(config, verdict, {
        total: scanned.length,
        flagged,
      });
    } catch {
      pack.contrast = null; // viral field unavailable — contrast optional
    }
  } catch {
    pack.note =
      "Scan failed for the configured token — check the chain + address.";
  }

  return pack;
}
