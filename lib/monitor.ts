// Traffic-driven Deathwatch monitor (docs/DEATHWATCH.md).
//
// Cloudflare cron triggers on rugradar-watch fire unreliably (fires once
// after deploy, then silent), so the web app — which sees steady traffic
// via /api/scan and /api/alerts — kicks the monitor itself. kickMonitor()
// is throttled to one run per 90s via the `monitor:lastkick` KV key, so
// request volume doesn't translate into provider call volume.
//
// Storage keys (shared MEMESCANNER_CACHE namespace; direct binding access
// like lib/watchlist.ts, NOT the TTL'd cache lib):
//   monitor:lastkick              number (ms epoch) — throttle stamp
//   watch:cursor                  number — rotating slice cursor (shared
//                                 semantics with the watch-worker)
//   watch:snap:{chain}:{addr}     {liquidityUsd, priceUsd, ts} — 48h TTL
//   alerts:recent                 AlertEntry[], newest first, cap 100, 7d TTL
//   calledit:list                 ReceiptEntry[], cap 500, no TTL
//   tg:subs                       [chatId, ...] — Telegram subscribers
//
// kickMonitor NEVER throws — it runs detached from user requests
// (ctx.waitUntil), so a failure must lose a monitor pass, never a scan.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Chain } from "./chains";
import { getTokenPairs } from "./providers/dexscreener";
import { providerAvailable, recordProviderCall } from "./quota";
import {
  getAlerts,
  getReceipts,
  getWatchlist,
  ALERTS_KEY,
  RECEIPTS_KEY,
  type AlertEntry,
  type AlertSeverity,
  type ReceiptEntry,
  type WatchEntry,
} from "./watchlist";

const LASTKICK_KEY = "monitor:lastkick";
const CURSOR_KEY = "watch:cursor";
const SUBS_KEY = "tg:subs";

const THROTTLE_MS = 90_000; // one monitor pass per 90s across all traffic
const SLICE_SIZE = 6; // tokens checked per kick
const SNAP_TTL = 48 * 60 * 60; // 48h, per spec
const ALERTS_TTL = 7 * 24 * 60 * 60; // 7d, per spec
const MAX_ALERTS = 100;
const MAX_RECEIPTS = 500;
const DEDUPE_MS = 30 * 60_000; // same chain+address+rule within 30m = dupe

const RUG_LP_USD = 1_000; // LP < $1k (was ≥$1k) = rug confirmed
const CRITICAL_DROP = 0.5; // ≥50% LP drop
const WARNING_DROP = 0.25; // ≥25% LP drop

const REPORT_BASE = "https://rugradar.trademetricspro.com/report";

interface Snapshot {
  liquidityUsd: number;
  priceUsd: number | null;
  ts: string; // ISO
  // Breach confirmation: transient DexScreener pair-set variance can make a
  // summed-liquidity reading collapse for one pass (a blue-chip "rugging"
  // 99% is the canonical false positive). A rule only alerts after the
  // SAME breach is seen on two consecutive checks; passes are ~90s apart,
  // so real drains still alert within minutes.
  pendingRule?: string | null;
}

// Minimal structural type for the KV binding (avoids a workers-types dep).
interface KVBindingLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

// Same globalThis key as lib/watchlist.ts, so the dev/test fallback is one
// shared in-memory namespace — exactly like the single shared KV in prod.
const globalForMonitor = globalThis as unknown as {
  __memescanWatchState?: Map<string, unknown>;
};

function memoryStore(): Map<string, unknown> {
  if (!globalForMonitor.__memescanWatchState) {
    globalForMonitor.__memescanWatchState = new Map();
  }
  return globalForMonitor.__memescanWatchState;
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

function snapKey(chain: Chain, address: string): string {
  return `watch:snap:${chain}:${address.toLowerCase()}`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

// Resolve TELEGRAM_BOT_TOKEN: Worker secret via the Cloudflare context
// first, process.env fallback — mirrors lib/admin-auth.ts getAdminSecret.
function getTelegramToken(): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as {
      TELEGRAM_BOT_TOKEN?: string;
    };
    if (env.TELEGRAM_BOT_TOKEN) return env.TELEGRAM_BOT_TOKEN;
  } catch {
    // Not in a Cloudflare request context (plain node, tests).
  }
  return process.env.TELEGRAM_BOT_TOKEN || undefined;
}

// Send the alert card to every Telegram subscriber. Caller-bot style:
// branded OG score card as the photo, HTML caption (severity headline,
// what happened, tap-to-copy CA), Chart/Report buttons. Fallback chain:
// photo+HTML -> message+HTML -> plain text. Best-effort per chat:
// allSettled + 10s abort timeouts; failures lose a message, never a kick.
async function broadcast(kv: KVBindingLike, alert: AlertEntry): Promise<void> {
  const token = getTelegramToken();
  if (!token) return;
  const subs = await kv.get(SUBS_KEY, "json");
  if (!Array.isArray(subs) || subs.length === 0) return;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const emoji =
    alert.severity === "rug" ? "💀" : alert.severity === "critical" ? "🚨" : "⚠️";
  const headline =
    alert.severity === "rug"
      ? "RUG PULL"
      : alert.severity === "critical"
        ? "CRITICAL DRAIN"
        : "DRAIN WARNING";
  const label = alert.symbol ? `$${alert.symbol}` : "Unknown token";
  const reportUrl = `${REPORT_BASE}/${alert.chain}/${alert.address}`;
  const photo = `${reportUrl}/opengraph-image`;
  const chartUrl = `https://dexscreener.com/${encodeURIComponent(alert.chain)}/${encodeURIComponent(alert.address)}`;

  const html = [
    `${emoji} <b>${headline} — ${esc(label)}</b>`,
    `${esc(alert.chain)} · ${esc(alert.text)}`,
    "",
    `<code>${esc(alert.address)}</code>`,
  ].join("\n");
  const plain = [
    `${emoji} ${headline} — ${label}`,
    `${alert.chain} · ${alert.text}`,
    alert.address,
    reportUrl,
  ].join("\n");
  const buttons = {
    inline_keyboard: [
      [
        { text: "📊 Chart", url: chartUrl },
        { text: "🔍 Full report", url: reportUrl },
      ],
    ],
  };

  await Promise.allSettled(
    subs.map(async (chatId) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const post = (method: string, body: object) =>
        fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, ...body }),
          signal: ctrl.signal,
        });
      try {
        const photoRes = await post("sendPhoto", {
          photo,
          caption: html.slice(0, 1024),
          parse_mode: "HTML",
          reply_markup: buttons,
        });
        if (photoRes.ok) return;
        const htmlRes = await post("sendMessage", {
          text: html,
          parse_mode: "HTML",
          reply_markup: buttons,
          disable_web_page_preview: false,
        });
        if (htmlRes.ok) return;
        await post("sendMessage", { text: plain });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

// Fresh market data -> snapshot diff -> maybe alert (+ receipt + broadcast).
async function checkToken(kv: KVBindingLike, entry: WatchEntry): Promise<void> {
  if (!providerAvailable("dexscreener")) return;
  recordProviderCall("dexscreener");
  const result = await getTokenPairs(entry.chain, [entry.address]);
  if (!result.ok) return;

  const liquidityUsd = result.data.reduce(
    (sum, p) => sum + (p.liquidity?.usd ?? 0),
    0,
  );
  const firstPrice = result.data[0]?.priceUsd;
  const priceUsd = firstPrice ? parseFloat(firstPrice) : null;

  const now = Date.now();
  const key = snapKey(entry.chain, entry.address);
  const prev = (await kv.get(key, "json")) as Snapshot | null;

  // Snapshot is written on every check — including the first-ever one,
  // which establishes the baseline and never alerts.
  await kv.put(
    key,
    JSON.stringify({ liquidityUsd, priceUsd, ts: new Date(now).toISOString() }),
    { expirationTtl: SNAP_TTL },
  );
  if (!prev || typeof prev.liquidityUsd !== "number") return;

  const drop =
    prev.liquidityUsd > 0
      ? (prev.liquidityUsd - liquidityUsd) / prev.liquidityUsd
      : 0;

  let severity: AlertSeverity | null = null;
  let rule: string | null = null;
  if (liquidityUsd < RUG_LP_USD && prev.liquidityUsd >= RUG_LP_USD) {
    severity = "rug";
    rule = "liquidity-gone";
  } else if (drop >= CRITICAL_DROP) {
    severity = "critical";
    rule = "lp-drain";
  } else if (drop >= WARNING_DROP) {
    severity = "warning";
    rule = "lp-drop";
  }

  // Breach confirmation gate: on a first breach, keep the PRE-breach
  // baseline values and just record pendingRule — if the next check still
  // breaches against that same baseline, it's real and alerts; if the
  // reading recovers, it was pair-set noise and clears silently.
  if (rule && prev.pendingRule === rule) {
    // confirmed — fall through to alert with a fresh baseline
    await kv.put(
      key,
      JSON.stringify({ liquidityUsd, priceUsd, ts: new Date(now).toISOString(), pendingRule: null }),
      { expirationTtl: SNAP_TTL },
    );
  } else if (rule) {
    await kv.put(
      key,
      JSON.stringify({ liquidityUsd: prev.liquidityUsd, priceUsd: prev.priceUsd, ts: prev.ts, pendingRule: rule }),
      { expirationTtl: SNAP_TTL },
    );
    return; // first sighting — hold the alert for confirmation
  } else if (prev.pendingRule) {
    await kv.put(
      key,
      JSON.stringify({ liquidityUsd, priceUsd, ts: new Date(now).toISOString(), pendingRule: null }),
      { expirationTtl: SNAP_TTL },
    );
  }
  if (!severity || !rule || prev.pendingRule !== rule) return;

  // Dedupe: same token + same rule within 30 min -> skip write + broadcast.
  const alerts = await getAlerts();
  const isDupe = alerts.some(
    (a) =>
      a.chain === entry.chain &&
      a.address.toLowerCase() === entry.address.toLowerCase() &&
      a.rule === rule &&
      now - new Date(a.ts).getTime() < DEDUPE_MS,
  );
  if (isDupe) return;

  // Observational language only — state changed, never "will rug".
  const mins = Math.max(
    1,
    Math.round((now - new Date(prev.ts).getTime()) / 60_000),
  );
  const pct = Math.round(drop * 100);
  const alert: AlertEntry = {
    ts: new Date(now).toISOString(),
    chain: entry.chain,
    address: entry.address,
    symbol: entry.symbol,
    severity,
    rule,
    text: `Liquidity dropped ${pct}% in ~${mins} min (${fmtUsd(prev.liquidityUsd)} → ${fmtUsd(liquidityUsd)})`,
  };
  await kv.put(ALERTS_KEY, JSON.stringify([alert, ...alerts].slice(0, MAX_ALERTS)), {
    expirationTtl: ALERTS_TTL,
  });

  // Receipt: only when the flag preceded the rug — the watch entry's band /
  // honeypot flag and addedAt timestamp are the proof.
  if (
    severity === "rug" &&
    (entry.lastBand === "AVOID" ||
      entry.lastBand === "CAUTION" ||
      entry.honeypot)
  ) {
    const receipts = await getReceipts();
    const receipt: ReceiptEntry = {
      chain: entry.chain,
      address: entry.address,
      symbol: entry.symbol,
      flaggedBand: entry.lastBand ?? "HONEYPOT",
      flaggedAt: entry.addedAt,
      ruggedAt: alert.ts,
      rule,
    };
    receipts.push(receipt);
    await kv.put(
      RECEIPTS_KEY,
      JSON.stringify(receipts.slice(-MAX_RECEIPTS)),
    );
  }

  await broadcast(kv, alert);
}

// One throttled monitor pass: stamp the throttle FIRST (so concurrent
// requests don't pile up), then check a rotating slice of the watchlist.
export async function kickMonitor(): Promise<void> {
  try {
    const kv = store();

    const last = await kv.get(LASTKICK_KEY, "json");
    const now = Date.now();
    if (typeof last === "number" && now - last < THROTTLE_MS) return;
    await kv.put(LASTKICK_KEY, JSON.stringify(now));

    const watchlist = await getWatchlist();
    if (watchlist.length === 0) return;

    // Rotating slice, shared `watch:cursor` semantics with the watch-worker:
    // read int, take up to SLICE_SIZE entries wrapping around, write next.
    const cursorRaw = await kv.get(CURSOR_KEY, "json");
    const start =
      typeof cursorRaw === "number" && cursorRaw >= 0
        ? cursorRaw % watchlist.length
        : 0;
    const slice: WatchEntry[] = [];
    for (let i = 0; i < Math.min(SLICE_SIZE, watchlist.length); i++) {
      slice.push(watchlist[(start + i) % watchlist.length]);
    }
    await kv.put(
      CURSOR_KEY,
      JSON.stringify((start + slice.length) % watchlist.length),
    );

    // Per-token isolation: one bad token must not sink the pass.
    for (const entry of slice) {
      try {
        await checkToken(kv, entry);
      } catch {
        // Next token.
      }
    }
  } catch {
    // The monitor runs detached from user requests — never throw into them.
  }
}

// Fire-and-forget kick from a request route: ctx.waitUntil on Workers,
// detached promise elsewhere — exactly the scheduleScanLog pattern.
export function scheduleMonitorKick(): void {
  const kicked = kickMonitor();
  try {
    getCloudflareContext().ctx.waitUntil(kicked);
  } catch {
    void kicked.catch(() => {});
  }
}
