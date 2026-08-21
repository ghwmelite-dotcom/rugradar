// RugRadar Deathwatch — cron monitor + alert engine. Standalone Cloudflare
// Worker. Every cron tick it rotates through a ≤25-token slice of the
// shared KV watchlist (cursor in watch:cursor), fetches fresh liquidity
// from DexScreener, diffs against the stored snapshot (watch:snap:*), and
// on a state change prepends to alerts:recent, broadcasts to all tg:subs
// via Telegram, and records calledit:list receipts when a flag preceded
// the rug. Shared KV schema: docs/DEATHWATCH.md.
//
// The run never throws: every token is processed in its own try/catch and
// the whole run is wrapped too.

// Minimal ambient types — this worker is dependency-free (wrangler is the
// only devDependency), so no @cloudflare/workers-types.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

interface ExportedHandler<E> {
  fetch?(
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
  scheduled?(
    controller: ScheduledController,
    env: E,
    ctx: ExecutionContext,
  ): void | Promise<void>;
}

interface Env {
  MEMESCANNER_CACHE: KVNamespace;
  // wrangler secret put TELEGRAM_BOT_TOKEN — same bot as rugradar-bot.
  TELEGRAM_BOT_TOKEN: string;
}

// --- Shared KV schema shapes (docs/DEATHWATCH.md) ---

interface WatchEntry {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  addedAt: number;
  lastScore: number | null;
  lastBand: string | null;
  honeypot: boolean;
}

interface Snapshot {
  liquidityUsd: number;
  priceUsd: number | null;
  ts: number;
}

type Severity = "warning" | "critical" | "rug";

interface Alert {
  ts: number;
  chain: string;
  address: string;
  symbol: string | null;
  severity: Severity;
  rule: string;
  text: string;
}

interface Receipt {
  chain: string;
  address: string;
  symbol: string | null;
  flaggedBand: string | null;
  flaggedAt: number;
  ruggedAt: number;
  rule: string;
}

// --- DexScreener response (only the fields we read) ---

interface DexPair {
  liquidity?: { usd?: number };
  priceUsd?: string;
}

interface DexResponse {
  pairs?: DexPair[] | null;
}

const SLICE_SIZE = 25;
const ALERTS_CAP = 100;
const RECEIPTS_CAP = 500;
const SNAPSHOT_TTL_S = 48 * 60 * 60; // 48h
const ALERTS_TTL_S = 7 * 24 * 60 * 60; // 7d
const DEX_TIMEOUT_MS = 10_000;
const TG_TIMEOUT_MS = 10_000;
const REPORT_BASE = "https://rugradar.trademetricspro.com";

// Drop thresholds, per spec.
const CRITICAL_DROP_PCT = 50;
const WARNING_DROP_PCT = 25;
const RUG_LP_USD = 1_000;

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🚨",
  warning: "⚠️",
  rug: "💀",
};

// --- KV helpers ---

async function kvJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const value = await kv.get(key, "json");
  return (value ?? null) as T | null;
}

// --- DexScreener ---

interface MarketState {
  liquidityUsd: number;
  priceUsd: number | null;
}

async function fetchMarketState(address: string): Promise<MarketState> {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    { signal: AbortSignal.timeout(DEX_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
  const data = (await res.json()) as DexResponse;
  const pairs = Array.isArray(data.pairs) ? data.pairs : [];

  let liquidityUsd = 0;
  let bestPair: DexPair | null = null;
  let bestLiq = -1;
  for (const pair of pairs) {
    const usd = Number(pair?.liquidity?.usd ?? 0);
    if (Number.isFinite(usd) && usd > 0) liquidityUsd += usd;
    if (usd > bestLiq) {
      bestLiq = usd;
      bestPair = pair;
    }
  }
  const price = Number(bestPair?.priceUsd);
  return {
    liquidityUsd,
    priceUsd: Number.isFinite(price) && price > 0 ? price : null,
  };
}

// --- Alert rules ---

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

// Observational language only (docs/DEATHWATCH.md copy rules): state
// changed, liquidity drained X% in N min — never "we predicted this".
function evaluate(
  entry: WatchEntry,
  prev: Snapshot,
  curr: MarketState,
  now: number,
): Alert | null {
  const dropPct =
    prev.liquidityUsd > 0
      ? ((prev.liquidityUsd - curr.liquidityUsd) / prev.liquidityUsd) * 100
      : 0;
  if (dropPct < WARNING_DROP_PCT && !(curr.liquidityUsd < RUG_LP_USD && prev.liquidityUsd >= RUG_LP_USD)) {
    return null;
  }

  const mins = Math.max(1, Math.round((now - prev.ts) / 60_000));
  const delta = `${formatUsd(prev.liquidityUsd)} → ${formatUsd(curr.liquidityUsd)}`;

  let severity: Severity;
  let rule: string;
  let text: string;
  if (curr.liquidityUsd < RUG_LP_USD && prev.liquidityUsd >= RUG_LP_USD) {
    severity = "rug";
    rule = "liquidity gone — rug confirmed";
    text = `Liquidity drained ${dropPct.toFixed(1)}% in ${mins} min (${delta}) — pool is effectively empty.`;
  } else if (dropPct >= CRITICAL_DROP_PCT) {
    severity = "critical";
    rule = "liquidity draining fast";
    text = `Liquidity dropped ${dropPct.toFixed(1)}% in ${mins} min (${delta}).`;
  } else if (dropPct >= WARNING_DROP_PCT) {
    severity = "warning";
    rule = "liquidity dropping";
    text = `Liquidity dropped ${dropPct.toFixed(1)}% in ${mins} min (${delta}).`;
  } else {
    return null;
  }

  return {
    ts: now,
    chain: entry.chain,
    address: entry.address,
    symbol: entry.symbol,
    severity,
    rule,
    text,
  };
}

// --- Telegram broadcast ---

function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

// Compact, dramatic card — must read well in a busy trading group: one
// glance gives severity, token, what changed, and the way out (report).
function formatAlertCard(alert: Alert, receipt?: Receipt): string {
  const emoji = SEVERITY_EMOJI[alert.severity];
  const symbol = alert.symbol ? `$${alert.symbol}` : alert.address.slice(0, 8) + "…";
  const headline =
    alert.severity === "rug"
      ? "RUG CONFIRMED"
      : alert.severity === "critical"
        ? "LIQUIDITY DRAINING FAST"
        : "LIQUIDITY DROPPING";
  const lines = [
    `${emoji} *${headline}* — ${escapeMd(symbol)} · ${escapeMd(alert.chain)}`,
    escapeMd(alert.text),
  ];
  if (receipt) {
    // The flag preceded the rug — say so, and point at the public ledger.
    const flaggedOn = new Date(receipt.flaggedAt).toISOString().slice(0, 10);
    const band = receipt.flaggedBand ?? "risk";
    lines.push(
      `⚑ We flagged it *${escapeMd(band)}* on ${flaggedOn} — [receipt](${REPORT_BASE}/alerts)`,
    );
  }
  lines.push(
    `[Full report](${REPORT_BASE}/report/${encodeURIComponent(alert.chain)}/${encodeURIComponent(alert.address)})`,
  );
  return lines.join("\n");
}

async function sendTelegram(
  env: Env,
  chatId: number,
  text: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const send = (parseMode?: string) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TG_TIMEOUT_MS),
    });

  try {
    const res = await send("Markdown");
    if (res.ok) return;
    // Odd symbols can break legacy Markdown — retry once as plain text.
    const retry = await send();
    if (!retry.ok) {
      console.error("sendMessage failed", chatId, retry.status, await retry.text());
    }
  } catch (err) {
    console.error("sendMessage error", chatId, err);
  }
}

async function broadcast(env: Env, alert: Alert, receipt?: Receipt): Promise<void> {
  const subs = (await kvJson<number[]>(env.MEMESCANNER_CACHE, "tg:subs")) ?? [];
  if (subs.length === 0) return;
  const text = formatAlertCard(alert, receipt);
  await Promise.allSettled(subs.map((chatId) => sendTelegram(env, chatId, text)));
}

// --- Per-token processing ---

// Fetches fresh state, updates the snapshot, and returns an alert when a
// rule fired. Never throws — callers still wrap in try/catch defensively.
async function processToken(
  entry: WatchEntry,
  env: Env,
  now: number,
): Promise<Alert | null> {
  const kv = env.MEMESCANNER_CACHE;
  const snapKey = `watch:snap:${entry.chain}:${entry.address.toLowerCase()}`;

  const [curr, prev] = await Promise.all([
    fetchMarketState(entry.address),
    kvJson<Snapshot>(kv, snapKey),
  ]);

  // Update the snapshot every run (48h TTL), before any early return.
  const snap: Snapshot = {
    liquidityUsd: curr.liquidityUsd,
    priceUsd: curr.priceUsd,
    ts: now,
  };
  await kv.put(snapKey, JSON.stringify(snap), { expirationTtl: SNAPSHOT_TTL_S });

  // First sighting — no baseline yet, just store it.
  if (!prev) return null;
  // Snapshot is fresh/unchanged — nothing to alert on.
  if (prev.liquidityUsd === curr.liquidityUsd) return null;

  return evaluate(entry, prev, curr, now);
}

// --- The run ---

async function run(env: Env): Promise<void> {
  const kv = env.MEMESCANNER_CACHE;
  const list = (await kvJson<WatchEntry[]>(kv, "watch:list")) ?? [];

  // Rotate a ≤25-token slice per run to stay under subrequest limits.
  let cursor = Number((await kv.get("watch:cursor")) ?? "0");
  if (!Number.isFinite(cursor) || cursor < 0 || cursor >= list.length) cursor = 0;
  const slice = list.slice(cursor, cursor + SLICE_SIZE);
  const nextCursor = cursor + SLICE_SIZE >= list.length ? 0 : cursor + SLICE_SIZE;
  await kv.put("watch:cursor", String(nextCursor));

  if (slice.length === 0) return;
  const now = Date.now();

  const results = await Promise.all(
    slice.map(async (entry) => {
      try {
        return await processToken(entry, env, now);
      } catch (err) {
        // Per-token isolation: one bad token never kills the run.
        console.error("watch failed", entry.chain, entry.address, err);
        return null;
      }
    }),
  );

  const alerts = results
    .filter((a): a is Alert => a !== null)
    .sort((a, b) => b.ts - a.ts);
  if (alerts.length === 0) return;

  // Prepend to alerts:recent (newest first, cap 100, 7d TTL).
  const recent = (await kvJson<Alert[]>(kv, "alerts:recent")) ?? [];
  const updated = [...alerts, ...recent].slice(0, ALERTS_CAP);
  await kv.put("alerts:recent", JSON.stringify(updated), {
    expirationTtl: ALERTS_TTL_S,
  });

  // Called It receipts: only on rug, only when the flag preceded it.
  const receipts: Receipt[] = [];
  for (const alert of alerts) {
    if (alert.severity !== "rug") continue;
    const entry = slice.find(
      (e) => e.chain === alert.chain && e.address === alert.address,
    );
    if (!entry) continue;
    const flagged =
      entry.lastBand === "AVOID" ||
      entry.lastBand === "CAUTION" ||
      entry.honeypot;
    if (!flagged) continue;
    receipts.push({
      chain: entry.chain,
      address: entry.address,
      symbol: entry.symbol,
      // Watch metadata timestamp is the receipt.
      flaggedBand: entry.lastBand ?? (entry.honeypot ? "HONEYPOT" : null),
      flaggedAt: entry.addedAt,
      ruggedAt: now,
      rule: alert.rule,
    });
  }
  if (receipts.length > 0) {
    const existing = (await kvJson<Receipt[]>(kv, "calledit:list")) ?? [];
    const updatedReceipts = [...existing, ...receipts].slice(0, RECEIPTS_CAP);
    await kv.put("calledit:list", JSON.stringify(updatedReceipts)); // permanent, no TTL
  }

  for (const alert of alerts) {
    const receipt = receipts.find(
      (r) => r.chain === alert.chain && r.address === alert.address,
    );
    await broadcast(env, alert, receipt);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      let watched = 0;
      try {
        const list = await kvJson<WatchEntry[]>(env.MEMESCANNER_CACHE, "watch:list");
        watched = list?.length ?? 0;
      } catch (err) {
        console.error("health check watch:list read failed", err);
      }
      return new Response(`watch-worker OK — watching ${watched} tokens`, {
        status: 200,
      });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller, env, ctx) {
    console.log("deathwatch tick", new Date().toISOString());
    try {
      await env.MEMESCANNER_CACHE.put(
        "watch:lastrun",
        new Date().toISOString(),
      );
      console.log("heartbeat written");
    } catch (err) {
      console.error("heartbeat failed", String(err));
    }
    ctx.waitUntil(
      run(env).catch((err) => console.error("deathwatch run failed", err)),
    );
  },
} satisfies ExportedHandler<Env>;
