// RugRadar Telegram bot — standalone Cloudflare Worker (separate from the
// Next.js web app worker). Receives Telegram webhook updates on POST /,
// extracts token addresses from message text (EVM 0x…40hex or Solana
// base58), scans them through the public RugRadar API, and replies with a
// formatted risk card. Always answers 200 quickly; scan+reply runs in
// ctx.waitUntil so Telegram never retries.

// Minimal ambient types — this worker is dependency-free (wrangler is the
// only devDependency), so no @cloudflare/workers-types.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

interface ExportedHandler<E> {
  fetch(
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
}

interface Env {
  // wrangler secret put TELEGRAM_BOT_TOKEN
  TELEGRAM_BOT_TOKEN: string;
  // Optional: wrangler secret put TELEGRAM_WEBHOOK_SECRET — when set, must
  // match the X-Telegram-Bot-Api-Secret-Token header on every update.
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Optional override; defaults to the production RugRadar web app.
  SCANNER_BASE_URL?: string;
  // Shared Deathwatch KV namespace (schema: docs/DEATHWATCH.md) — this
  // worker reads/writes the tg:subs subscriber list.
  MEMESCANNER_CACHE: KVNamespace;
}

const DEFAULT_SCANNER_BASE = "https://rugradar.trademetricspro.com";
const MAX_SCANS_PER_MESSAGE = 3;
const FETCH_TIMEOUT_MS = 15_000;

// --- Telegram update shapes (only the fields we read) ---

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

// --- RugRadar API shapes ---

interface ResolveResult {
  kind: "resolved" | "picker" | "error";
  chain?: string;
  address?: string;
  options?: { chain: string; address: string; name?: string | null; symbol?: string | null }[];
  error?: string;
}

interface ScanResponse {
  report?: {
    chain: string;
    address: string;
    name: string | null;
    symbol: string | null;
    // Market context (informational; may be null when DexScreener is thin).
    priceUsd?: number | null;
    liquidityUsd?: number | null;
    volume24h?: number | null;
    pairAgeHours?: number | null;
    top10HolderPct?: number | null;
    holderCount?: number | null;
  };
  score?: {
    score: number | null;
    band: "AVOID" | "CAUTION" | "LOWER_RISK" | null;
    honeypotOverride: boolean;
    flags: { text: string; deduction: number }[];
  };
  error?: string;
}

// --- Address extraction ---

type Target = { kind: "evm" | "solana"; address: string; index: number };

// Solana base58 alphabet excludes 0, O, I, l.
const BASE58 = "1-9A-HJ-NP-Za-km-z";

function extractAddresses(text: string): Target[] {
  // Boundaries keep us from matching inside longer hex/alnum strings.
  const evmRe = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g;
  const solRe = new RegExp(
    `(?<![${BASE58}])[${BASE58}]{32,44}(?![${BASE58}])`,
    "g",
  );

  const found: Target[] = [];
  for (const m of text.matchAll(evmRe)) {
    found.push({ kind: "evm", address: m[0], index: m.index });
  }

  // Mask EVM hits first so the 40-hex body isn't re-read as a Solana address.
  const masked = text.replace(evmRe, (s) => " ".repeat(s.length));
  for (const m of masked.matchAll(solRe)) {
    const candidate = m[0];
    // Heuristic against English words / URL slugs: real Solana addresses are
    // mixed-case with digits.
    if (!/\d/.test(candidate)) continue;
    if (!/[a-z]/.test(candidate) || !/[A-Z]/.test(candidate)) continue;
    found.push({ kind: "solana", address: candidate, index: m.index });
  }

  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of found) {
    const key = `${t.kind}:${t.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_SCANS_PER_MESSAGE) break;
  }
  return out;
}

// --- Formatting (Telegram HTML — caller-bot style stat sheet) ---

function escHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BAND_PRESENTATION: Record<string, { emoji: string; label: string }> = {
  AVOID: { emoji: "🚨", label: "AVOID" },
  CAUTION: { emoji: "⚠️", label: "CAUTION" },
  LOWER_RISK: { emoji: "✅", label: "LOWER RISK" },
};

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Prices need precision, not rounding — memecoins live at $0.0000x.
function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toPrecision(3)}`;
}

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${Math.round(days)}d`;
}

function reportLink(base: string, chain: string, address: string): string {
  return `${base}/report/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
}

function chartLink(chain: string, address: string): string {
  return `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
}

// The scan card. Two flavors of text come out of one builder:
//   html  — rich stat sheet, used as the sendPhoto caption (<= 1024 chars)
//   plain — fallback with no markup when Telegram rejects the HTML
function formatCard(
  scan: ScanResponse,
  base: string,
): { html: string; plain: string; photo: string; chain: string; address: string } {
  const report = scan.report!;
  const score = scan.score!;
  const name = report.name ?? "Unknown token";
  const ticker = report.symbol ? `$${report.symbol}` : name;
  const band = score.band ? BAND_PRESENTATION[score.band] : null;
  const emoji = score.honeypotOverride ? "🍯" : (band?.emoji ?? "❔");

  const headText = band
    ? `${ticker} · ${score.score ?? "—"}/100 — ${band.label}`
    : `${ticker} · unscored`;

  // Stat lines — only stats we actually have, two per line.
  const stats: string[] = [];
  if (report.priceUsd != null) stats.push(`💵 ${fmtPrice(report.priceUsd)}`);
  if (report.liquidityUsd != null) stats.push(`💧 Liq ${fmtUsd(report.liquidityUsd)}`);
  if (report.volume24h != null) stats.push(`📊 Vol ${fmtUsd(report.volume24h)}/24h`);
  if (report.pairAgeHours != null) stats.push(`🕐 Age ${fmtAge(report.pairAgeHours)}`);
  if (report.top10HolderPct != null)
    stats.push(`👥 Top 10: ${report.top10HolderPct.toFixed(1)}%`);
  if (report.holderCount != null)
    stats.push(`🏦 ${report.holderCount.toLocaleString()} holders`);
  const statLines: string[] = [];
  for (let i = 0; i < stats.length; i += 2) {
    statLines.push(stats.slice(i, i + 2).join("   "));
  }

  const flags = [...score.flags]
    .sort((a, b) => b.deduction - a.deduction)
    .slice(0, 3);

  const htmlLines: string[] = [];
  htmlLines.push(`${emoji} <b>${escHtml(headText)}</b>`);
  htmlLines.push(
    `${escHtml(name)} · ${escHtml(report.chain)} · <a href="${reportLink(base, report.chain, report.address)}">Full report</a>`,
  );
  if (score.honeypotOverride) {
    htmlLines.push(`🍯 <b>HONEYPOT</b> — buys go in, sells don't come out. Do not touch.`);
  }
  if (!band) {
    htmlLines.push(`<i>Unscored — not enough data to rate. Treat unknowns as risk.</i>`);
  }
  if (statLines.length > 0) {
    htmlLines.push("");
    htmlLines.push(...statLines);
  }
  if (flags.length > 0) {
    htmlLines.push("");
    htmlLines.push(`<b>Red flags</b>`);
    for (const f of flags) htmlLines.push(`• ${escHtml(f.text)} (−${f.deduction})`);
  }
  htmlLines.push("");
  htmlLines.push(`<code>${escHtml(report.address)}</code>`);

  // Plain-text fallback: same content, no markup, link spelled out.
  const plainLines: string[] = [];
  plainLines.push(`${emoji} ${headText}`);
  plainLines.push(`${name} · ${report.chain}`);
  if (score.honeypotOverride) plainLines.push(`HONEYPOT — sells blocked. Do not touch.`);
  if (!band) plainLines.push(`Unscored — not enough data to rate.`);
  if (statLines.length > 0) plainLines.push(...statLines);
  for (const f of flags) plainLines.push(`- ${f.text} (-${f.deduction})`);
  plainLines.push(report.address);
  plainLines.push(reportLink(base, report.chain, report.address));

  return {
    html: htmlLines.join("\n"),
    plain: plainLines.join("\n"),
    photo: `${reportLink(base, report.chain, report.address)}/opengraph-image`,
    chain: report.chain,
    address: report.address,
  };
}

// --- Scanner calls ---

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Resolves a raw address to chain+address. Solana is direct; EVM goes
// through the web app's /api/resolve. Returns either the resolved pair or
// a ready-to-send reply text (multi-chain picker or error message).
type Resolved =
  | { kind: "ok"; chain: string; address: string }
  | { kind: "reply"; text: string };

async function resolveTarget(target: Target, base: string): Promise<Resolved> {
  if (target.kind === "solana") {
    return { kind: "ok", chain: "solana", address: target.address };
  }

  const resolved = (await fetchJson(
    `${base}/api/resolve?q=${encodeURIComponent(target.address)}`,
  )) as ResolveResult;
  if (resolved.kind === "resolved" && resolved.chain && resolved.address) {
    return { kind: "ok", chain: resolved.chain, address: resolved.address };
  }
  if (resolved.kind === "picker" && resolved.options?.length) {
    const lines = [
      `🔀 \`${target.address}\` exists on multiple chains:`,
      ...resolved.options.map(
        (o) =>
          `• [${escapeMd(o.chain)} — ${escapeMd(o.name ?? o.symbol ?? "token")}](${base}/report/${o.chain}/${encodeURIComponent(o.address)})`,
      ),
    ];
    return { kind: "reply", text: lines.join("\n") };
  }
  return {
    kind: "reply",
    text: `⚠️ ${escapeMd(resolved.error ?? "Address not found on any supported chain.")}`,
  };
}

// Legacy Markdown escaping — still used by picker/error/watch messages.
function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

// A scan reply is either plain text (errors, multi-chain picker) or a rich
// card (photo + HTML caption + buttons, with plain fallback).
type Reply =
  | { kind: "text"; text: string }
  | { kind: "card"; html: string; plain: string; photo: string; chain: string; address: string };

async function buildReply(target: Target, base: string): Promise<Reply> {
  const resolved = await resolveTarget(target, base);
  if (resolved.kind === "reply") return { kind: "text", text: resolved.text };
  const { chain, address } = resolved;

  let scan: ScanResponse;
  try {
    scan = (await fetchJson(
      `${base}/api/scan?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`,
    )) as ScanResponse;
  } catch (err) {
    return {
      kind: "text",
      text: `⚠️ Scan failed for \`${address}\`: ${escapeMd(err instanceof Error ? err.message : "unknown error")}`,
    };
  }
  if (!scan.report || !scan.score) {
    return {
      kind: "text",
      text: `⚠️ Scan failed for \`${address}\`: ${escapeMd(scan.error ?? "no data")}`,
    };
  }
  return { kind: "card", ...formatCard(scan, base) };
}

// --- Telegram send ---

async function sendTelegram(env: Env, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const send = (parseMode?: string) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: false,
      }),
    });

  const res = await send("Markdown");
  if (res.ok) return;
  // Odd token names can break legacy Markdown — retry once as plain text.
  const retry = await send();
  if (!retry.ok) {
    console.error("sendMessage failed", retry.status, await retry.text());
  }
}

// Scan card delivery: branded score-card image (sendPhoto) with the HTML
// stat sheet as caption and Chart/Report buttons. Fallback chain:
// photo+HTML -> message+HTML (with link preview) -> plain text. Telegram
// photo captions cap at 1024 chars — the stat sheet is well under that.
async function sendScanCard(
  env: Env,
  chatId: number,
  card: { html: string; plain: string; photo: string; chain: string; address: string },
  base: string,
): Promise<void> {
  const buttons = {
    inline_keyboard: [
      [
        { text: "📊 Chart", url: chartLink(card.chain, card.address) },
        { text: "🔍 Full report", url: reportLink(base, card.chain, card.address) },
      ],
    ],
  };

  const photo = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: card.photo,
        caption: card.html.slice(0, 1024),
        parse_mode: "HTML",
        reply_markup: buttons,
      }),
    },
  );
  if (photo.ok) return;
  console.error("sendPhoto failed", photo.status, await photo.text());

  const htmlMsg = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: card.html,
        parse_mode: "HTML",
        reply_markup: buttons,
        disable_web_page_preview: false,
      }),
    },
  );
  if (htmlMsg.ok) return;
  console.error("sendMessage HTML failed", htmlMsg.status, await htmlMsg.text());

  await sendTelegram(env, chatId, card.plain);
}

// --- Deathwatch: subscriber list (tg:subs) + commands ---

async function getSubs(env: Env): Promise<number[]> {
  const value = await env.MEMESCANNER_CACHE.get("tg:subs", "json");
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is number => typeof x === "number");
}

async function addSub(env: Env, chatId: number): Promise<void> {
  const subs = await getSubs(env);
  if (subs.includes(chatId)) return;
  subs.push(chatId);
  await env.MEMESCANNER_CACHE.put("tg:subs", JSON.stringify(subs));
}

async function removeSub(env: Env, chatId: number): Promise<boolean> {
  const subs = await getSubs(env);
  const next = subs.filter((id) => id !== chatId);
  if (next.length === subs.length) return false;
  await env.MEMESCANNER_CACHE.put("tg:subs", JSON.stringify(next));
  return true;
}

const HELP_TEXT = [
  "👁 *RugRadar Deathwatch* — commands:",
  "/start — get liquidity-drain alerts here",
  "/watch <address> — watch a token and alert on drains",
  "/stop — mute all alerts",
  "",
  "Or just paste a token address to scan it.",
].join("\n");

const WELCOME_TEXT = [
  "👁 *RugRadar Deathwatch* — you're on the alert list.",
  "",
  "We monitor watched tokens around the clock. The moment a token's",
  "liquidity starts draining, you get a Telegram alert here first —",
  "before the rug shows up on the chart.",
  "",
  "• /watch <address> — add a token to the watchlist",
  "• /stop — mute alerts",
  "• Paste any token address for an instant risk scan",
  "",
  "Live alert feed + receipts: https://rugradar.trademetricspro.com/alerts",
].join("\n");

async function handleStart(env: Env, chatId: number): Promise<void> {
  try {
    await addSub(env, chatId);
    await sendTelegram(env, chatId, WELCOME_TEXT);
  } catch (err) {
    console.error("/start failed", chatId, err);
    await sendTelegram(env, chatId, "⚠️ Couldn't subscribe you right now — try again in a moment.");
  }
}

async function handleStop(env: Env, chatId: number): Promise<void> {
  try {
    const removed = await removeSub(env, chatId);
    await sendTelegram(
      env,
      chatId,
      removed
        ? "🔕 Alerts off. You won't get Deathwatch alerts here anymore. /start to re-subscribe."
        : "You weren't subscribed to Deathwatch alerts. /start to subscribe.",
    );
  } catch (err) {
    console.error("/stop failed", chatId, err);
    await sendTelegram(env, chatId, "⚠️ Couldn't update your subscription — try again in a moment.");
  }
}

interface WatchResponse {
  ok?: boolean;
  watched?: { chain?: string; address?: string; symbol?: string | null; name?: string | null };
  error?: string;
}

async function handleWatch(env: Env, chatId: number, args: string, base: string): Promise<void> {
  const targets = extractAddresses(args);
  if (targets.length === 0) {
    await sendTelegram(env, chatId, "Usage: `/watch <token address>` — e.g. `/watch 0x…` or a Solana mint.");
    return;
  }

  let resolved: Resolved;
  try {
    resolved = await resolveTarget(targets[0], base);
  } catch (err) {
    console.error("/watch resolve failed", targets[0].address, err);
    await sendTelegram(env, chatId, "⚠️ Couldn't resolve that address — scanner error. Try again in a moment.");
    return;
  }
  if (resolved.kind === "reply") {
    await sendTelegram(env, chatId, resolved.text);
    return;
  }
  const { chain, address } = resolved;

  let body: WatchResponse | null = null;
  try {
    const res = await fetch(`${base}/api/watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, address }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    body = (await res.json().catch(() => null)) as WatchResponse | null;
    if (!res.ok) {
      const msg = body?.error ?? `HTTP ${res.status}`;
      await sendTelegram(env, chatId, `⚠️ Couldn't watch \`${address}\`: ${escapeMd(msg)}`);
      return;
    }
  } catch (err) {
    console.error("/watch api failed", chain, address, err);
    await sendTelegram(env, chatId, "⚠️ Couldn't reach the watchlist service — try again in a moment.");
    return;
  }

  // Watching implies subscribing: alerts land here first.
  try {
    await addSub(env, chatId);
  } catch (err) {
    console.error("/watch subscribe failed", chatId, err);
  }

  const label = body?.watched?.symbol
    ? `$${body.watched.symbol}`
    : body?.watched?.name ?? `${address.slice(0, 8)}…`;
  const lines = [
    `👁 Now watching *${escapeMd(label)}* · ${escapeMd(chain)}`,
    "You'll get an alert here the moment its liquidity starts draining.",
    `[Full report](${base}/report/${encodeURIComponent(chain)}/${encodeURIComponent(address)})`,
  ];
  await sendTelegram(env, chatId, lines.join("\n"));
}

// Returns true when the message was a command (handled or not).
async function handleCommand(
  env: Env,
  chatId: number,
  text: string,
  base: string,
): Promise<boolean> {
  const match = /^\/(\w+)(?:@\w+)?\b([\s\S]*)$/.exec(text.trim());
  if (!match) return false;
  const command = match[1].toLowerCase();
  const args = match[2].trim();

  switch (command) {
    case "start":
      await handleStart(env, chatId);
      return true;
    case "stop":
      await handleStop(env, chatId);
      return true;
    case "watch":
      await handleWatch(env, chatId, args, base);
      return true;
    default:
      await sendTelegram(env, chatId, HELP_TEXT);
      return true;
  }
}

// --- Update handling ---

async function processUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg) return;
  const text = msg.text ?? msg.caption ?? "";
  if (!text.trim()) return;

  const base = (env.SCANNER_BASE_URL ?? DEFAULT_SCANNER_BASE).replace(/\/$/, "");

  // Slash commands (/start, /stop, /watch, help) take precedence over
  // free-text contract scanning.
  if (text.trim().startsWith("/")) {
    await handleCommand(env, msg.chat.id, text, base);
    return;
  }

  const targets = extractAddresses(text);
  if (targets.length === 0) return;

  for (const target of targets) {
    try {
      const reply = await buildReply(target, base);
      if (reply.kind === "card") {
        await sendScanCard(env, msg.chat.id, reply, base);
      } else {
        await sendTelegram(env, msg.chat.id, reply.text);
      }
    } catch (err) {
      console.error("scan failed", target.address, err);
      await sendTelegram(
        env,
        msg.chat.id,
        `⚠️ Couldn't scan \`${target.address}\` — scanner error. Try again in a moment.`,
      ).catch(() => {});
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response("rugradar-bot OK", { status: 200 });
    }
    if (request.method !== "POST" || url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const header = request.headers.get("x-telegram-bot-api-secret-token");
      if (header !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      // Malformed body — still 200 so Telegram doesn't retry.
      return new Response("OK", { status: 200 });
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error("TELEGRAM_BOT_TOKEN secret is not set");
      return new Response("OK", { status: 200 });
    }

    ctx.waitUntil(
      processUpdate(update, env).catch((err) => console.error("update failed", err)),
    );
    return new Response("OK", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
