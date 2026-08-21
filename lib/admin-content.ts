// Caption generation for the /admin content vault. Pure functions only —
// feed data goes in, ready-to-post X copy comes out. No network, no env.
//
// X-algorithm rules baked in (see task spec / vault UI):
//   - Main posts NEVER contain an outbound link (the algo suppresses them).
//     Each post comes paired with a `reply` text that carries the link —
//     posted as the first reply under the main post.
//   - Main posts stay <= 240 chars so twitter.com/intent/tweet URLs stay
//     valid and leave room for the attached card PNG.
//   - Every variant carries one reply-driving question or take.
//   - Thread posts are numbered 1/ … n/ and each <= 280 chars.
//   - No hashtags; emoji limited to 🚨 ⚠️ ✅ where they carry meaning.

import type { ScanLogEntry } from "./scanlog";

export const SITE_URL = "https://rugradar.trademetricspro.com";
export const TG_INVITE_URL = "https://t.me/+B2z7qkzpjAUwYmQ0";
export const TG_BOT_HANDLE = "@tm_rugradar_bot";

export const MAIN_POST_MAX = 240;
export const THREAD_POST_MAX = 280;

// A post plus the optional paired first-reply that carries the link.
export interface Post {
  text: string;
  reply: string | null;
}

export function intentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function reportUrl(chain: string, address: string): string {
  return `${SITE_URL}/report/${chain}/${address}`;
}

// Truncate at a word boundary with an ellipsis. Hard floor of 8 chars so a
// pathological budget can't produce an empty/garbled string.
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const budget = Math.max(8, max - 1);
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > budget / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

// Scoring flag texts are "<short claim> — <plain-English explanation>."
// (see lib/scoring). The card one-liner keeps only the claims, lowercased
// and comma-joined: "top 10 holders control 72.4% of supply, lp not locked".
export function oneLinerFromFlags(flagTexts: string[], max = 3): string {
  const claims = flagTexts.slice(0, max).map((t) => {
    const claim = t.split(" — ")[0].trim().replace(/\.$/, "");
    // Lowercase the first letter so claims join into a sentence — but keep
    // leading acronyms ("LP tokens…") intact.
    if (claim.length > 1 && /[A-Z]/.test(claim[1])) return claim;
    return claim.charAt(0).toLowerCase() + claim.slice(1);
  });
  return fit(claims.join(", "), 160);
}

// Riskiest token in the recent window: confirmed honeypots first, then
// lowest score. Returns null when nothing scored/flagged is in the window.
export function pickRiskiest(recent: ScanLogEntry[]): ScanLogEntry | null {
  const candidates = recent.filter((e) => e.honeypot || e.score !== null);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.honeypot !== b.honeypot) return a.honeypot ? -1 : 1;
    return (a.score ?? 0) - (b.score ?? 0);
  })[0];
}

function tokenLabel(name: string | null, symbol: string | null): string {
  if (symbol) return `$${symbol}`;
  return name ?? "This token";
}

// ---------- shared data shape for /api/admin/data ----------

export interface RiskiestSummary {
  chain: string;
  address: string;
  name: string | null;
  symbol: string | null;
  score: number | null;
  band: string | null;
  flagCount: number;
  flags: string[];
  line: string; // card/caption one-liner derived from flags
  url: string;
}

export interface AdminData {
  generatedAt: string;
  today: string; // e.g. "August 21, 2026"
  scanned: number; // tokens in the scan-log window
  honeypots: number; // confirmed honeypots in the window
  flagged: number; // AVOID or CAUTION in the window
  flaggedPct: number;
  window: string; // honest label for the scan-log retention ("24 hours")
  riskiest: RiskiestSummary | null;
  bands: BandCounts; // verdict split across the window
  leaderboard: TokenInsight[]; // most-scanned tokens (<= 4), flags included
  wallOfShame: TokenInsight[]; // honeypots / AVOID tokens (<= 4)
}

export interface BandCounts {
  AVOID: number;
  CAUTION: number;
  LOWER_RISK: number;
  unscored: number;
}

// Per-token detail for the Thread Studio. ScanLogEntry doesn't store flag
// text, so /api/admin/data rescans a bounded set of tokens (security data
// is cached 15min, so this is cheap) and fills topFlag/flags from the
// result. topFlag/flags are empty when the rescan failed — generators must
// cope.
export interface TokenInsight {
  chain: string;
  address: string;
  name: string | null;
  symbol: string | null;
  score: number | null;
  band: string | null;
  honeypot: boolean;
  scanCount: number; // 24h scan counter; 0 when unknown
  topFlag: string | null; // strongest flag text (composite first)
  flags: string[]; // all flag texts
  url: string;
}

// ---------- 1. Daily Rug Report caption (pairs with the PNG card) ----------

export interface DailyReportInput {
  date: string;
  scanned: number;
  honeypots: number;
  flagCount: number | null;
  riskiestName: string | null; // "$SYMBOL" or token name
  riskiestLine: string;
}

export function dailyReportPost(input: DailyReportInput): Post {
  const stats = `${input.scanned} scanned. ${input.honeypots} honeypot${input.honeypots === 1 ? "" : "s"} caught. ${input.flagCount ?? 0} red flags on the riskiest token.`;
  const head = `Daily Rug Report — ${input.date}\n\n${stats}`;
  const tail = `\n\nWould you touch this? Full breakdown in the reply.`;
  // Give the one-liner exactly the budget left after head + tail so the
  // reply-driving question is never the part that gets truncated away.
  let riskiest = "";
  if (input.riskiestName) {
    const prefix = `\n\nRiskiest: ${input.riskiestName} — `;
    const budget = MAIN_POST_MAX - head.length - prefix.length - 1 - tail.length;
    if (budget >= 24) {
      const line = fit(input.riskiestLine, budget);
      riskiest = `${prefix}${line}${line.endsWith("…") ? "" : "."}`;
    }
  }
  return {
    text: fit(head + riskiest + tail, MAIN_POST_MAX),
    reply: `Scan any CA before you ape — free, no sign-up: ${SITE_URL}`,
  };
}

// ---------- 2. Rug Anatomy thread ----------

export interface RugAnatomyInput {
  name: string | null;
  symbol: string | null;
  score: number | null;
  flags: string[]; // plain-English flag texts from the scan
  url: string; // full report link — goes in the paired reply, not the thread
}

export function rugAnatomyThread(input: RugAnatomyInput): {
  posts: string[];
  linkReply: string;
} {
  const label = tokenLabel(input.name, input.symbol);
  const scoreText = input.score !== null ? `${input.score}/100` : "unscored";
  const flags = input.flags.slice(0, 2);
  const total = 1 + flags.length + 2; // hook + flags + lesson + CTA

  const posts: string[] = [
    fit(
      `1/${total} Anatomy of a rug: ${label} scored ${scoreText} on RugRadar — ${input.flags.length} red flags, every one visible on-chain.\n\nLet's walk through them so you spot the next one first. 🧵`,
      THREAD_POST_MAX,
    ),
  ];
  flags.forEach((flag, i) => {
    posts.push(fit(`${i + 2}/${total} ${flag}`, THREAD_POST_MAX));
  });
  posts.push(
    fit(
      `${total - 1}/${total} The lesson: none of this was hidden. LP lock, holder concentration, mint authority — all public, all checkable in 10 seconds before you ape.`,
      THREAD_POST_MAX,
    ),
  );
  posts.push(
    fit(
      `${total}/${total} RugRadar scans any CA on Solana, Ethereum, BSC, Base, Arbitrum and Polygon — free, no sign-up. Full ${label} report in the reply. Scan before you ape.`,
      THREAD_POST_MAX,
    ),
  );

  return { posts, linkReply: `Full ${label} risk report: ${input.url}` };
}

// ---------- 3. Telegram funnel post ----------

export function telegramFunnelPost(): Post {
  return {
    text: fit(
      `Your group chat apes CAs nobody checked.\n\nAdd ${TG_BOT_HANDLE} to your Telegram group — paste any contract, get a 0-100 risk verdict with red flags in plain English, right in the chat.\n\nHow many rugs has your group eaten this year?`,
      MAIN_POST_MAX,
    ),
    reply: `Add ${TG_BOT_HANDLE} to your group here: ${TG_INVITE_URL}`,
  };
}

// ---------- 4. Milestone / social-proof post ----------

export function milestonePost(input: {
  scanned: number;
  flaggedPct: number;
  window: string;
}): Post {
  return {
    text: fit(
      `${input.scanned} tokens scanned on RugRadar in the last ${input.window}. ${input.flaggedPct}% came back flagged AVOID or CAUTION.\n\nThe rugs aren't slowing down. The scans are catching up.\n\nWhat's the most obvious red flag people still ignore?`,
      MAIN_POST_MAX,
    ),
    reply: `Run your own scan — free, no sign-up: ${SITE_URL}`,
  };
}

// ---------- CA Reply Ammo ----------

// Reply-ready verdict to paste under viral CA posts. This one DOES carry
// the report link — it's a reply, and the link unfurls the OG score card.
export function caReplyVerdict(input: {
  score: number | null;
  band: string | null; // AVOID | CAUTION | LOWER_RISK | null
  name: string | null;
  symbol: string | null;
  flags: string[];
  url: string;
}): string {
  const emoji =
    input.band === "AVOID"
      ? "🚨"
      : input.band === "CAUTION"
        ? "⚠️"
        : input.band === "LOWER_RISK"
          ? "✅"
          : "⚠️";
  const label = tokenLabel(input.name, input.symbol);
  const scoreText = input.score !== null ? `${input.score}/100` : "unscored";
  const bandText = input.band ? input.band.replace("_", " ") : "UNSCORED";
  const head = `${emoji} ${label} — ${scoreText}, ${bandText}.`;
  const tail = `Full breakdown: ${input.url}`;
  const claims = oneLinerFromFlags(input.flags, 2);
  const trimmed = fit(
    claims,
    Math.max(0, THREAD_POST_MAX - head.length - tail.length - 3),
  );
  const body = trimmed ? ` ${trimmed}${trimmed.endsWith("…") ? "" : "."}` : "";
  return fit(`${head}${body} ${tail}`, THREAD_POST_MAX);
}

// ---------- Thread Studio ----------

// Five data-driven thread generators. Shared contract:
//   - posts are numbered "1/ … n/", each <= 280 chars (numberPosts enforces)
//   - post 1 works as a standalone hook; the final post is a CTA
//   - NO links in the thread body — linkReply carries them (X suppresses
//     posts with outbound links, and the vault's whole flow is: post the
//     thread, then drop linkReply as the first reply)
//   - thin data -> generator returns null; threadUnavailableReason explains
//     why to the operator. Generators NEVER invent tokens or numbers.

export type ThreadType =
  | "anatomy"
  | "leaderboard"
  | "red-flag-class"
  | "honeypot-watch"
  | "daily-recap";

export interface GeneratedThread {
  type: ThreadType;
  title: string;
  posts: string[];
  linkReply: string;
}

export const THREAD_TYPE_META: {
  type: ThreadType;
  title: string;
  blurb: string;
}[] = [
  {
    type: "anatomy",
    title: "Rug Anatomy",
    blurb: "Dissect the window's worst token, flag by flag.",
  },
  {
    type: "leaderboard",
    title: "Radar Leaderboard",
    blurb: "The most-scanned tokens and what the radar says about each.",
  },
  {
    type: "red-flag-class",
    title: "Red Flag Class",
    blurb: "Teach today's most common red flags with real examples.",
  },
  {
    type: "honeypot-watch",
    title: "Honeypot Watch",
    blurb: "Name and shame the window's caught honeypots and AVOIDs.",
  },
  {
    type: "daily-recap",
    title: "Daily Recap",
    blurb: "The day's scan numbers as a narrative, with one insight.",
  },
];

function bandTextOf(band: string | null): string {
  return band ? band.replace("_", " ") : "UNSCORED";
}

function verdictEmoji(band: string | null, honeypot: boolean): string {
  if (honeypot || band === "AVOID") return "🚨";
  if (band === "CAUTION") return "⚠️";
  if (band === "LOWER_RISK") return "✅";
  return "⚠️";
}

function scoreTextOf(score: number | null): string {
  return score !== null ? `${score}/100` : "unscored";
}

// The claim half of a scoring flag text ("<claim> — <explanation>").
function claimOf(flagText: string): string {
  return flagText.split(" — ")[0].trim().replace(/\.$/, "");
}

// Number a list of post bodies "i/n …" and clamp each to the thread limit.
function numberPosts(bodies: string[]): string[] {
  const total = bodies.length;
  return bodies.map((b, i) =>
    fit(`${i + 1}/${total} ${b}`, THREAD_POST_MAX),
  );
}

// Every (flag, token) sighting in the window, most interesting sources
// first: riskiest, then wall of shame, then leaderboard. Tokens deduped.
interface FlagSighting {
  claim: string;
  full: string;
  label: string;
  count: number; // how many tokens in the pool share this claim
}

function collectFlagSightings(data: AdminData): FlagSighting[] {
  const sources: { label: string; flags: string[] }[] = [];
  if (data.riskiest) {
    sources.push({
      label: tokenLabel(data.riskiest.name, data.riskiest.symbol),
      flags: data.riskiest.flags,
    });
  }
  const seen = new Set<string>(
    data.riskiest
      ? [`${data.riskiest.chain}:${data.riskiest.address.toLowerCase()}`]
      : [],
  );
  for (const t of [...data.wallOfShame, ...data.leaderboard]) {
    const key = `${t.chain}:${t.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ label: tokenLabel(t.name, t.symbol), flags: t.flags });
  }

  const byClaim = new Map<string, FlagSighting>();
  for (const src of sources) {
    for (const full of src.flags) {
      const claim = claimOf(full);
      const existing = byClaim.get(claim);
      if (existing) {
        existing.count += 1;
      } else {
        byClaim.set(claim, { claim, full, label: src.label, count: 1 });
      }
    }
  }
  // Most common first; ties keep first-seen (most-interesting-source) order.
  return [...byClaim.values()].sort((a, b) => b.count - a.count);
}

function anatomyThread(data: AdminData): GeneratedThread | null {
  const r = data.riskiest;
  if (!r || r.flags.length === 0) return null;
  const { posts, linkReply } = rugAnatomyThread({
    name: r.name,
    symbol: r.symbol,
    score: r.score,
    flags: r.flags,
    url: r.url,
  });
  return { type: "anatomy", title: "Rug Anatomy", posts, linkReply };
}

function leaderboardThread(data: AdminData): GeneratedThread | null {
  const board = data.leaderboard.slice(0, 4);
  if (board.length === 0) return null;

  const hook = `The most-scanned tokens on RugRadar in the last ${data.window} — and what the radar says about each.\n\nThe crowd is checking. Here's what it's looking at. 🧵`;
  const tokenPosts = board.map((t) => {
    const label = tokenLabel(t.name, t.symbol);
    const head = `${verdictEmoji(t.band, t.honeypot)} ${label} — ${t.scanCount} scan${t.scanCount === 1 ? "" : "s"}. Radar: ${scoreTextOf(t.score)}, ${bandTextOf(t.band)}.`;
    if (t.topFlag) return `${head} ${claimOf(t.topFlag)}.`;
    if (t.band === "LOWER_RISK") {
      return `${head} No major red flags in the available data — not the same as safe.`;
    }
    return `${head} Data too thin for a full read — treat unknowns as risk.`;
  });
  const cta = `Scan any CA before you ape — Solana, Ethereum, BSC, Base, Arbitrum, Polygon. Free, no sign-up. Link in the reply.`;

  return {
    type: "leaderboard",
    title: "Radar Leaderboard",
    posts: numberPosts([hook, ...tokenPosts, cta]),
    linkReply: `Scan any token before you ape: ${SITE_URL}`,
  };
}

function redFlagClassThread(data: AdminData): GeneratedThread | null {
  // Ranked by frequency; prefer one lesson per token so the class shows
  // variety, backfilling from repeat tokens when the pool is thin.
  const sightings = collectFlagSightings(data);
  const lessons: FlagSighting[] = [];
  const usedLabels = new Set<string>();
  for (const s of sightings) {
    if (lessons.length >= 3) break;
    if (usedLabels.has(s.label)) continue;
    usedLabels.add(s.label);
    lessons.push(s);
  }
  for (const s of sightings) {
    if (lessons.length >= 3) break;
    if (!lessons.includes(s)) lessons.push(s);
  }
  if (lessons.length === 0) return null;

  const hook = `Red Flag Class, live from today's scans.\n\nThe ${lessons.length} most common red flags RugRadar caught in the last ${data.window} — each on a real token, each checkable before you buy. 🧵`;
  const lessonPosts = lessons.map(
    (s, i) =>
      `Flag ${i + 1}/${lessons.length} — spotted on ${s.label} today:\n\n${s.full}`,
  );
  const cta = `Every flag in this thread is visible on-chain, checkable in 10 seconds before you ape. RugRadar does it for any CA — free, link in the reply.`;

  return {
    type: "red-flag-class",
    title: "Red Flag Class",
    posts: numberPosts([hook, ...lessonPosts, cta]),
    linkReply: `Run your own scan — free, no sign-up: ${SITE_URL}`,
  };
}

function honeypotWatchThread(data: AdminData): GeneratedThread | null {
  const wall = data.wallOfShame.slice(0, 4);
  if (wall.length === 0) return null;

  const hpNote =
    data.honeypots > 0
      ? `, ${data.honeypots} of them confirmed honeypot${data.honeypots === 1 ? "" : "s"}`
      : "";
  const hook = `🚨 Honeypot watch — last ${data.window}: ${data.bands.AVOID} token${data.bands.AVOID === 1 ? "" : "s"} scored AVOID${hpNote}.\n\nThe worst offenders, with receipts: 🧵`;
  const tokenPosts = wall.map((t) => {
    const label = tokenLabel(t.name, t.symbol);
    const head = `${verdictEmoji(t.band, t.honeypot)} ${label} — ${scoreTextOf(t.score)}, ${bandTextOf(t.band)}.`;
    // Full flag text, not just the claim — the explanation IS the receipt.
    return t.topFlag
      ? `${head} ${t.topFlag}`
      : `${head} Full evidence on the report page.`;
  });
  const cta = `That CA being shilled in your replies right now? Scan it before you ape — 10 seconds, free. Link in the reply.`;

  return {
    type: "honeypot-watch",
    title: "Honeypot Watch",
    posts: numberPosts([hook, ...tokenPosts, cta]),
    linkReply: `Scan any CA: ${SITE_URL} — or let ${TG_BOT_HANDLE} scan them inside your Telegram group: ${TG_INVITE_URL}`,
  };
}

function dailyRecapThread(data: AdminData): GeneratedThread | null {
  if (data.scanned === 0) return null;

  const bodies: string[] = [
    `Daily Rug Recap — ${data.today}.\n\n${data.scanned} tokens scanned in the last ${data.window}. ${data.flaggedPct}% came back flagged AVOID or CAUTION.\n\nThe numbers, then the lesson. 🧵`,
    `The split: ${data.bands.AVOID} AVOID, ${data.bands.CAUTION} CAUTION, ${data.bands.LOWER_RISK} LOWER RISK${data.bands.unscored > 0 ? `, ${data.bands.unscored} unscored` : ""}. ${data.honeypots} confirmed honeypot${data.honeypots === 1 ? "" : "s"}.\n\nEvery verdict came from public on-chain data — nothing here was hidden.`,
  ];

  if (data.riskiest) {
    const r = data.riskiest;
    bodies.push(
      `Riskiest of the day: ${tokenLabel(r.name, r.symbol)} — ${scoreTextOf(r.score)}, ${bandTextOf(r.band)}.\n\n${r.line}.`,
    );
  }

  const sightings = collectFlagSightings(data);
  if (sightings.length > 0) {
    const top = sightings[0];
    bodies.push(
      top.count > 1
        ? `The pattern of the day: "${top.claim}" — flagged on ${top.count} different tokens in one window.\n\nOne habit kills most of these: scan before you ape.`
        : `The pattern of the day: ${top.claim}.\n\nOne habit kills most of these: scan before you ape.`,
    );
  } else {
    bodies.push(
      `Quiet day on the radar — few flags in the window.\n\nQuiet isn't the same as safe. The scan habit matters most on the days nothing looks wrong.`,
    );
  }

  bodies.push(
    `Same scan, any CA, any day — Solana, Ethereum, BSC, Base, Arbitrum, Polygon. Free, no sign-up. Link in the reply.\n\nFollow for tomorrow's recap.`,
  );

  return {
    type: "daily-recap",
    title: "Daily Recap",
    posts: numberPosts(bodies),
    linkReply: `Scan any CA: ${SITE_URL} — or let ${TG_BOT_HANDLE} scan them inside your Telegram group: ${TG_INVITE_URL}`,
  };
}

// Null = available; otherwise a human-readable reason the type is disabled.
export function threadUnavailableReason(
  type: ThreadType,
  data: AdminData | null,
): string | null {
  if (!data) return "Feed data not loaded yet.";
  switch (type) {
    case "anatomy":
      return data.riskiest && data.riskiest.flags.length > 0
        ? null
        : "No flagged token with scannable flags in the current window.";
    case "leaderboard":
      return data.leaderboard.length > 0
        ? null
        : "No tokens scanned in the current window yet.";
    case "red-flag-class":
      return collectFlagSightings(data).length > 0
        ? null
        : "No red flags on any scanned token in the window — quiet day.";
    case "honeypot-watch":
      return data.wallOfShame.length > 0
        ? null
        : "No honeypots or AVOID tokens in the window — quiet day.";
    case "daily-recap":
      return data.scanned > 0
        ? null
        : "No scans logged in the current window yet.";
  }
}

// Run one generator. Returns null when the type is unavailable for this
// data — check threadUnavailableReason for the operator-facing why.
export function generateThread(
  type: ThreadType,
  data: AdminData,
): GeneratedThread | null {
  switch (type) {
    case "anatomy":
      return anatomyThread(data);
    case "leaderboard":
      return leaderboardThread(data);
    case "red-flag-class":
      return redFlagClassThread(data);
    case "honeypot-watch":
      return honeypotWatchThread(data);
    case "daily-recap":
      return dailyRecapThread(data);
  }
}
