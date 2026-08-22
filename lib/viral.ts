// Viral Radar (admin vault): detect tokens going viral RIGHT NOW, run them
// through the risk engine, and turn the collision into ready-to-post X copy.
//
// Signal sources: DexScreener /token-boosts/top (most promoted) +
// /token-boosts/latest (just ignited), hydrated per chain, then scored for
// "heat" — a 0-100 composite of promotion, volume, momentum, buy pressure
// and freshness. The top picks are scanned like any CA (provider caches
// apply), and each pick ships with a generated post + the token's OG score
// card as the attachable image.
//
// Pure functions (heatScore, rankCandidates, post generators) have no
// network/env dependencies and are unit-tested in lib/viral.test.ts.
// getViralPicks is the orchestrator; it caches the whole payload in KV
// (viral:current, 15min) so admin reloads never hammer providers.
//
// Post rules match lib/admin-content.ts: main posts never carry a link,
// stay <= 240 chars, no hashtags, emoji limited to 🚨 ⚠️ ✅.

import { type Chain, isChain } from "./chains";
import { getCache, TTL } from "./cache";
import {
  getLatestBoosts,
  getTokenPairs,
  getTopBoosts,
  type DexPair,
} from "./providers/dexscreener";
import { providerAvailable, recordProviderCall } from "./quota";
import { scanToken } from "./scan";
import {
  fit,
  MAIN_POST_MAX,
  oneLinerFromFlags,
  reportUrl,
  SITE_URL,
  TG_INVITE_URL,
  type Post,
} from "./admin-content";

// ---------- data shapes ----------

// Hydrated market picture for one token, merged across its pairs.
export interface ViralCandidate {
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24h: number;
  priceChange24h: number | null; // percent
  priceChange1h: number | null; // percent
  buys24h: number;
  sells24h: number;
  ageHours: number | null; // from pairCreatedAt
  boostAmount: number; // DexScreener boost count (paid promotion)
}

export interface HeatResult {
  score: number; // 0-100
  drivers: string[]; // human-readable reasons, strongest first
}

export interface ViralVerdict {
  score: number | null;
  band: string | null; // AVOID | CAUTION | LOWER_RISK | null
  honeypot: boolean;
  flags: string[];
}

export interface ViralPick extends ViralCandidate {
  heat: number;
  drivers: string[];
  verdict: ViralVerdict | null; // null when the scan failed
  post: Post;
  reportUrl: string;
  cardUrl: string; // OG score card PNG — the attachable image
}

export interface ViralRadarData {
  generatedAt: string;
  today: string;
  picks: ViralPick[];
  digest: Post | null; // combined multi-token post; null when < 2 verdicts
}

// ---------- formatting helpers ----------

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m old`;
  if (hours < 48) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

function label(name: string | null, symbol: string | null): string {
  if (symbol) return `$${symbol}`;
  return name ?? "This token";
}

// ---------- heat score (pure) ----------

// Heat answers "how viral is this token right now" — NOT how safe it is.
// Five weighted signals, each log- or ratio-scaled so a single outlier
// can't max the score on its own:
//   boosts     30 — paid promotion; the strongest "someone is pushing this"
//   volume     25 — log10 scale, $10M/24h saturates
//   momentum   20 — +500% 24h saturates (14), +30% 1h spike saturates (6)
//   buy press. 15 — 70%+ buy share saturates
//   freshness  10 — <6h old = 10, <24h = 7, <72h = 4
export function heatScore(c: ViralCandidate): HeatResult {
  let score = 0;
  const drivers: { pts: number; text: string }[] = [];

  const boostPts = 30 * Math.min(1, Math.log10(1 + c.boostAmount) / 3);
  if (boostPts > 0) {
    score += boostPts;
    drivers.push({
      pts: boostPts,
      text: `${c.boostAmount.toLocaleString()} boost${c.boostAmount === 1 ? "" : "s"}`,
    });
  }

  const volPts = 25 * Math.min(1, Math.log10(1 + c.volume24h) / 7);
  if (volPts > 0) {
    score += volPts;
    drivers.push({ pts: volPts, text: `${fmtUsd(c.volume24h)} vol/24h` });
  }

  const h24 = c.priceChange24h ?? 0;
  const h1 = c.priceChange1h ?? 0;
  const momPts =
    14 * Math.min(1, Math.max(0, h24) / 500) +
    6 * Math.min(1, Math.max(0, h1) / 30);
  if (momPts > 0) {
    score += momPts;
    if (c.priceChange24h !== null && c.priceChange24h > 0) {
      drivers.push({ pts: momPts, text: `${fmtPct(c.priceChange24h)} today` });
    }
  }

  const txns = c.buys24h + c.sells24h;
  if (txns > 0) {
    const ratio = c.buys24h / txns;
    const buyPts = 15 * Math.min(1, Math.max(0, (ratio - 0.5) / 0.2));
    if (buyPts > 0) {
      score += buyPts;
      drivers.push({ pts: buyPts, text: `${Math.round(ratio * 100)}% buys` });
    }
  }

  if (c.ageHours !== null) {
    const freshPts =
      c.ageHours < 6 ? 10 : c.ageHours < 24 ? 7 : c.ageHours < 72 ? 4 : 0;
    if (freshPts > 0) {
      score += freshPts;
      drivers.push({ pts: freshPts, text: fmtAge(c.ageHours) });
    }
  }

  drivers.sort((a, b) => b.pts - a.pts);
  return {
    score: Math.round(Math.min(100, score)),
    drivers: drivers.map((d) => d.text),
  };
}

// Dust filter: no liquidity floor means the "viral" signal is noise.
export const MIN_LIQUIDITY_USD = 5_000;

export function rankCandidates(
  candidates: ViralCandidate[],
  limit: number,
): { candidate: ViralCandidate; heat: HeatResult }[] {
  return candidates
    .filter((c) => c.liquidityUsd >= MIN_LIQUIDITY_USD && (c.name || c.symbol))
    .map((candidate) => ({ candidate, heat: heatScore(candidate) }))
    .sort((a, b) => b.heat.score - a.heat.score)
    .slice(0, limit);
}

// ---------- post generators (pure) ----------

function momentumClause(c: ViralCandidate): string {
  const parts: string[] = [];
  if (c.priceChange24h !== null && c.priceChange24h > 0) {
    parts.push(`${fmtPct(c.priceChange24h)} today`);
  }
  if (c.volume24h >= MIN_LIQUIDITY_USD) parts.push(`${fmtUsd(c.volume24h)} volume`);
  if (c.boostAmount >= 10) parts.push(`${c.boostAmount.toLocaleString()} boosts`);
  return parts.join(", ");
}

// Trending + flagged = the core Viral Radar post. The crowd's excitement IS
// the hook; the verdict is the twist.
export function viralAlertPost(
  c: ViralCandidate,
  verdict: ViralVerdict,
): Post {
  const name = label(c.name, c.symbol);
  const momentum = momentumClause(c);
  const head = verdict.honeypot
    ? `🚨 ${name} is going viral and it's a confirmed honeypot — buyers literally cannot sell.`
    : `🚨 ${name} is everywhere right now${momentum ? ` — ${momentum}` : ""}.`;
  const scoreLine =
    verdict.score !== null
      ? `RugRadar: ${verdict.score}/100, ${(verdict.band ?? "UNSCORED").replace("_", " ")}.`
      : "RugRadar: security data too thin to score — that itself is a warning.";
  const flagLine = verdict.flags[0]
    ? ` ${oneLinerFromFlags(verdict.flags, 1)}.`
    : "";
  const tail = "\n\nThe crowd is aping. The contract is screaming. Still touching it?";
  return {
    text: fit(`${head}\n\n${scoreLine}${flagLine}${tail}`, MAIN_POST_MAX),
    reply: `Full ${name} risk report: ${reportUrl(c.chain, c.address)}`,
  };
}

// Trending + clean = the rare contrarian post. Still hedged: clean data is
// not the same as safe.
export function viralCleanPost(
  c: ViralCandidate,
  verdict: ViralVerdict,
): Post {
  const name = label(c.name, c.symbol);
  const momentum = momentumClause(c);
  const head = `✅ Rare sighting: ${name} is trending hard${momentum ? ` (${momentum})` : ""} and RugRadar comes back clean — ${verdict.score}/100, LOWER RISK.`;
  const tail =
    "\n\nNo drain path, no mint trap in the data. Not the same as safe — but better than most of what trends.\n\nWhat's your read?";
  return {
    text: fit(`${head}${tail}`, MAIN_POST_MAX),
    reply: `Full ${name} risk report: ${reportUrl(c.chain, c.address)}`,
  };
}

// Pick the right single-pick generator. Unscored verdicts ride the alert
// template (thin data is presented as its own warning).
export function viralPickPost(
  c: ViralCandidate,
  verdict: ViralVerdict,
): Post {
  if (!verdict.honeypot && verdict.band === "LOWER_RISK") {
    return viralCleanPost(c, verdict);
  }
  return viralAlertPost(c, verdict);
}

// The combined daily digest: today's viral set with verdicts in one post.
export function viralDigestPost(today: string, picks: ViralPick[]): Post | null {
  const scored = picks.filter((p) => p.verdict);
  if (scored.length < 2) return null;

  const flagged = scored.filter(
    (p) => p.verdict!.honeypot || p.verdict!.band !== "LOWER_RISK",
  ).length;
  const lines = scored.slice(0, 4).map((p) => {
    const v = p.verdict!;
    const emoji =
      v.honeypot || v.band === "AVOID"
        ? "🚨"
        : v.band === "CAUTION"
          ? "⚠️"
          : v.band === "LOWER_RISK"
            ? "✅"
            : "⚠️";
    const scoreText = v.score !== null ? `${v.score}/100` : "unscored";
    return `${emoji} ${label(p.name, p.symbol)} — ${scoreText}`;
  });

  const head = `Viral heat check — ${today}\n\n${scored.length} tokens going viral right now, scanned:`;
  const body = `\n\n${lines.join("\n")}`;
  const tail =
    flagged > 0
      ? `\n\n${flagged} of ${scored.length} carry red flags. The scan takes 10 seconds. The rug takes everything.`
      : `\n\nAll clear in the data today — rare. Not the same as safe.`;
  return {
    text: fit(`${head}${body}${tail}`, MAIN_POST_MAX),
    reply: `Scan any CA before you ape: ${SITE_URL} — live alerts in the Telegram group: ${TG_INVITE_URL}`,
  };
}

// ---------- orchestration ----------

const CACHE_KEY = "viral:current";
const MAX_PICKS = 5;
const CHAIN_CAP = 30; // DexScreener tokens/v1 lookup limit

function toCandidate(
  chain: Chain,
  pairs: DexPair[],
  boost: number,
  now: number,
): ViralCandidate | null {
  if (pairs.length === 0) return null;
  const addr = pairs[0].baseToken.address;
  let liquidityUsd = 0;
  let volume24h = 0;
  let buys24h = 0;
  let sells24h = 0;
  let priceUsd: number | null = null;
  let priceChange24h: number | null = null;
  let priceChange1h: number | null = null;
  let ageHours: number | null = null;
  let bestLiq = -1;

  // Aggregate across pairs; momentum fields come from the deepest pair.
  for (const p of pairs) {
    if (p.baseToken.address !== addr) continue;
    const liq = p.liquidity?.usd ?? 0;
    liquidityUsd += liq;
    volume24h += p.volume?.h24 ?? 0;
    buys24h += p.txns?.h24?.buys ?? 0;
    sells24h += p.txns?.h24?.sells ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      priceUsd = p.priceUsd ? parseFloat(p.priceUsd) : null;
      priceChange24h = p.priceChange?.h24 ?? null;
      priceChange1h = p.priceChange?.h1 ?? null;
      ageHours = p.pairCreatedAt
        ? Math.max(0, (now - p.pairCreatedAt) / 3_600_000)
        : null;
    }
  }

  const main = pairs[0];
  return {
    chain,
    address: addr,
    name: main.baseToken.name ?? null,
    symbol: main.baseToken.symbol ?? null,
    imageUrl: main.info?.imageUrl ?? null,
    priceUsd,
    liquidityUsd,
    volume24h,
    priceChange24h,
    priceChange1h,
    buys24h,
    sells24h,
    ageHours,
    boostAmount: boost,
  };
}

// Fetch + hydrate + rank + scan + caption the day's viral picks. Cached as a
// whole for 15 minutes; every layer below (market 60s, security 15min,
// trending sources) caches independently too, so a cold build costs ~2
// boost calls + N hydration calls + up to MAX_PICKS scans once per window.
export async function getViralPicks(
  limit = MAX_PICKS,
): Promise<ViralRadarData> {
  const cache = getCache();
  const cached = await cache.get<ViralRadarData>(CACHE_KEY);
  if (cached) return cached;

  const now = Date.now();
  const data: ViralRadarData = {
    generatedAt: new Date(now).toISOString(),
    today: new Date(now).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    picks: [],
    digest: null,
  };

  if (providerAvailable("dexscreener")) {
    // Top = most promoted overall; latest = just ignited. Union, max boost.
    recordProviderCall("dexscreener");
    const [top, latest] = await Promise.all([
      getTopBoosts(),
      getLatestBoosts(),
    ]);
    recordProviderCall("dexscreener");

    const boostByKey = new Map<string, { chain: Chain; address: string; boost: number }>();
    for (const res of [top, latest]) {
      if (!res.ok) continue;
      for (const b of res.data) {
        if (!isChain(b.chainId)) continue;
        const key = `${b.chainId}:${b.tokenAddress.toLowerCase()}`;
        const existing = boostByKey.get(key);
        if (!existing || b.totalAmount > existing.boost) {
          boostByKey.set(key, {
            chain: b.chainId,
            address: b.tokenAddress,
            boost: b.totalAmount,
          });
        }
      }
    }

    // Group per chain for batched hydration (30 addresses per call).
    const byChain = new Map<Chain, { address: string; boost: number }[]>();
    for (const item of boostByKey.values()) {
      const list = byChain.get(item.chain) ?? [];
      if (list.length < CHAIN_CAP) {
        list.push({ address: item.address, boost: item.boost });
      }
      byChain.set(item.chain, list);
    }

    const hydrated = await Promise.all(
      [...byChain.entries()].map(async ([chain, list]) => {
        recordProviderCall("dexscreener");
        const res = await getTokenPairs(chain, list.map((i) => i.address));
        return { chain, list, pairs: res.ok ? res.data : [] };
      }),
    );

    const candidates: ViralCandidate[] = [];
    for (const { chain, list, pairs } of hydrated) {
      // Group returned pairs by base-token address.
      const pairsByAddr = new Map<string, DexPair[]>();
      for (const p of pairs) {
        const key = p.baseToken.address.toLowerCase();
        const arr = pairsByAddr.get(key) ?? [];
        arr.push(p);
        pairsByAddr.set(key, arr);
      }
      for (const item of list) {
        const tokenPairs = pairsByAddr.get(item.address.toLowerCase());
        if (!tokenPairs) continue;
        const candidate = toCandidate(chain, tokenPairs, item.boost, now);
        if (candidate) candidates.push(candidate);
      }
    }

    // Rank by heat, then scan the winners in parallel. A failed scan keeps
    // the pick with a null verdict rather than failing the whole payload.
    const ranked = rankCandidates(candidates, limit);
    const picks = await Promise.all(
      ranked.map(async ({ candidate, heat }) => {
        let verdict: ViralVerdict | null = null;
        try {
          const result = await scanToken(candidate.chain, candidate.address);
          verdict = {
            score: result.score.score,
            band: result.score.band,
            honeypot: result.score.honeypotOverride,
            flags: result.score.flags.map((f) => f.text),
          };
        } catch {
          verdict = null;
        }
        const pick: ViralPick = {
          ...candidate,
          heat: heat.score,
          drivers: heat.drivers,
          verdict,
          post: verdict
            ? viralPickPost(candidate, verdict)
            : {
                text: fit(
                  `⚠️ ${label(candidate.name, candidate.symbol)} is going viral${momentumClause(candidate) ? ` — ${momentumClause(candidate)}` : ""}.\n\nRugRadar couldn't complete the scan just now — treat unknowns as risk.\n\nVerify before you ape?`,
                  MAIN_POST_MAX,
                ),
                reply: `Scan it yourself: ${SITE_URL}`,
              },
          reportUrl: reportUrl(candidate.chain, candidate.address),
          cardUrl: `${SITE_URL}/report/${candidate.chain}/${candidate.address}/opengraph-image`,
        };
        return pick;
      }),
    );
    data.picks = picks;
    data.digest = viralDigestPost(data.today, picks);
  }

  // Cache failures too (short window) so a DexScreener outage doesn't turn
  // every admin load into a provider hammering session.
  await cache.set(CACHE_KEY, data, TTL.VIRAL);
  return data;
}
