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
