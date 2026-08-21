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

// --- Formatting (Telegram legacy Markdown) ---

function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

const BAND_PRESENTATION: Record<string, { emoji: string; label: string }> = {
  AVOID: { emoji: "🚨", label: "AVOID" },
  CAUTION: { emoji: "⚠️", label: "CAUTION" },
  LOWER_RISK: { emoji: "✅", label: "LOWER RISK" },
};

function formatCard(scan: ScanResponse, base: string): string {
  const report = scan.report!;
  const score = scan.score!;
  const name = report.name ?? "Unknown token";
  const symbol = report.symbol ? ` ($${report.symbol})` : "";
  const band = score.band ? BAND_PRESENTATION[score.band] : null;
  const emoji = band?.emoji ?? "❔";

  const lines: string[] = [];
  lines.push(`${emoji} *${escapeMd(name)}${escapeMd(symbol)}* · ${escapeMd(report.chain)}`);
  if (score.score == null || !band) {
    lines.push(`Score: _unscored — not enough data to rate_`);
  } else {
    lines.push(`Score: *${score.score}/100* — ${band.emoji} ${band.label}`);
  }
  if (score.honeypotOverride) {
    lines.push(`🍯 *HONEYPOT* — sell simulation failed. Do not buy.`);
  }
  const flags = [...score.flags]
    .sort((a, b) => b.deduction - a.deduction)
    .slice(0, 3);
  for (const f of flags) {
    lines.push(`• ${escapeMd(f.text)} (−${f.deduction})`);
  }
  lines.push(`[Full report](${base}/report/${report.chain}/${encodeURIComponent(report.address)})`);
  return lines.join("\n");
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

async function buildReply(target: Target, base: string): Promise<string> {
  let chain: string;
  let address = target.address;

  if (target.kind === "solana") {
    chain = "solana";
  } else {
    const resolved = (await fetchJson(
      `${base}/api/resolve?q=${encodeURIComponent(target.address)}`,
    )) as ResolveResult;
    if (resolved.kind === "resolved" && resolved.chain && resolved.address) {
      chain = resolved.chain;
      address = resolved.address;
    } else if (resolved.kind === "picker" && resolved.options?.length) {
      const lines = [
        `🔀 \`${target.address}\` exists on multiple chains:`,
        ...resolved.options.map(
          (o) =>
            `• [${escapeMd(o.chain)} — ${escapeMd(o.name ?? o.symbol ?? "token")}](${base}/report/${o.chain}/${encodeURIComponent(o.address)})`,
        ),
      ];
      return lines.join("\n");
    } else {
      return `⚠️ ${escapeMd(resolved.error ?? "Address not found on any supported chain.")}`;
    }
  }

  let scan: ScanResponse;
  try {
    scan = (await fetchJson(
      `${base}/api/scan?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`,
    )) as ScanResponse;
  } catch (err) {
    return `⚠️ Scan failed for \`${address}\`: ${escapeMd(err instanceof Error ? err.message : "unknown error")}`;
  }
  if (!scan.report || !scan.score) {
    return `⚠️ Scan failed for \`${address}\`: ${escapeMd(scan.error ?? "no data")}`;
  }
  return formatCard(scan, base);
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

// --- Update handling ---

async function processUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg) return;
  const text = msg.text ?? msg.caption ?? "";
  if (!text.trim()) return;

  const targets = extractAddresses(text);
  if (targets.length === 0) return;

  const base = (env.SCANNER_BASE_URL ?? DEFAULT_SCANNER_BASE).replace(/\/$/, "");
  for (const target of targets) {
    try {
      const reply = await buildReply(target, base);
      await sendTelegram(env, msg.chat.id, reply);
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
