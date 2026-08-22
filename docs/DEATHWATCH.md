# Deathwatch — pre-rug early warning (spec, 2026-08-21)

"RugRadar texts you before the rug, not after." A passive, free, public
early-warning system: watch tokens, diff their state every few minutes,
scream in Telegram and on a public feed the moment liquidity starts
draining — and keep permanent public receipts when we called it first.

## Architecture

Three independent workers, one shared KV namespace (`MEMESCANNER_CACHE`,
id a4486b07fcce49f08ddee721bbef50e2):

- `rugradar` (Next.js web app) — watch UI, alerts pages, APIs, **and the
  monitor loop itself** (`lib/monitor.ts`, kicked by `/api/scan` and
  `/api/alerts` traffic, throttled to one pass per 90s, 6 tokens per pass,
  rotating `watch:cursor`).
- `rugradar-watch` — cron monitor (`*/2 * * * *`). ADVISORY ONLY as of
  2026-08-21: Cloudflare cron triggers on this account fire once after
  deploy then go silent (matches multiple 2026 community reports of
  platform scheduler outages). Kept deployed — if the platform recovers,
  it shares cursor/dedupe semantics with the web monitor, so no double
  alerts. Do not rely on it as the primary loop.
- `rugradar-bot` (Telegram) — subscriber registration (`/start`, `/stop`,
  `/watch`) + alert delivery target list (`tg:subs`).

Telegram broadcast on alert: the web app's monitor sends directly (it has
TELEGRAM_BOT_TOKEN as a secret); the watch-worker does the same when its
cron actually runs. Alert dedupe: same chain+address+rule within 30 min
is suppressed across both writers.

Alert confirmation (2026-08-21, web monitor only): a breach must be seen
on two consecutive checks before alerting — DexScreener pair-set variance
once produced a false "LINK liquidity dropped 99%" critical alert from a
single pass. While a breach is pending, the pre-breach baseline is kept.
KNOWN DIVERGENCE: watch-worker still uses single-pass alerting; port the
two-strike gate before ever relying on its cron.

### Shared KV schema

- `watch:list` → `[{chain, address, symbol, name, addedAt, lastScore,
  lastBand, honeypot}]`, cap 200, LRU-evict oldest when full. No TTL.
- `watch:snap:{chain}:{addrLower}` → `{liquidityUsd, priceUsd, ts}` — last
  seen market snapshot. 48h TTL.
- `alerts:recent` → `[{ts, chain, address, symbol, severity, rule, text}]`
  newest first, cap 100, 7d TTL. severity: `warning|critical|rug`.
- `calledit:list` → permanent receipts `[{chain, address, symbol,
  flaggedBand, flaggedAt, ruggedAt, rule}]`, cap 500, no TTL.
- `tg:subs` → `[chatId, ...]` Telegram subscriber list, no TTL.
- `admin:community` → `{chain, address, label}` Community Beacon champion
  token config ($CATE), no TTL (web app only — see ROADMAP F8).

## rugradar-watch worker (new dir `watch-worker/`)

- `wrangler.jsonc`: name `rugradar-watch`, same account_id, cron trigger
  `*/2 * * * *`, KV binding to the shared namespace, plain TS, wrangler
  only devDep.
- Each run: load `watch:list`, process a rotating slice of ≤25 tokens
  (persist a cursor key `watch:cursor`) to stay under subrequest limits.
- Per token: fresh DexScreener lookup (`api.dexscreener.com/latest/dex/
  tokens/{address}`), sum liquidity across pairs, compare to snapshot.
- Alert rules (MVP):
  - LP dropped ≥50% vs last snapshot → `critical` "liquidity draining fast"
  - LP dropped ≥25–50% → `warning`
  - LP now <$1k AND was ≥$1k → `rug` "liquidity gone — rug confirmed"
- On alert: prepend to `alerts:recent`, broadcast to all `tg:subs` via
  `https://api.telegram.org/bot<TOKEN>/sendMessage` (TELEGRAM_BOT_TOKEN
  secret on this worker too), formatted card with report link.
- On `rug`: if `lastBand` is AVOID/CAUTION or honeypot was true, append a
  `calledit:list` receipt (flaggedBand/flaggedAt from watch metadata).
- Never throw past the run; per-token try/catch. Update snapshot each run.

## rugradar-bot additions

- `/start` → add chat to `tg:subs`, reply with welcome + how alerts work.
- `/watch <address>` → resolve (EVM via web app /api/resolve, solana
  direct), add to `watch:list` (with the scan's current score/band as
  flag metadata), confirm.
- `/stop` → remove chat from `tg:subs`.
- Add KV binding to telegram-bot/wrangler.jsonc (same namespace id).

## Web app (rugradar) additions

- `lib/watchlist.ts` — read/write helpers for the shared KV keys above
  (via existing getCache()? NO — cache has TTL semantics and no list
  ops guarantee; use the KV binding directly via getCloudflareContext,
  in-memory fallback for dev, mirroring lib/cache.ts's pattern).
- `POST /api/watch {chain,address}` — add to watchlist with current scan
  metadata (run scanToken for score/band if not cached). Public, rate
  limited via SCAN_RATE_LIMITER (key prefix `watch:`).
- `GET /api/alerts` → `{alerts, calledIt, stats}` where stats =
  `{watched, receipts, avoidHitRate}` (receipts where flaggedBand was
  AVOID / total receipts — honest framing, see copy rules).
- `/alerts` page — "Deathwatch" live feed: alerts list (severity color
  coded), Called It ledger (receipts with time-to-rug), accuracy strip.
  Linked in the header next to "Live feed".
- Watch button on report pages (components/ReportView.tsx footer area):
  "Watch this token" → POST /api/watch → confirmation state.

## Copy rules (trust is the product)

- Never claim prediction. Language: "state changed" / "liquidity drained
  X% in N min" — observations, not prophecies.
- Accuracy stats must be honest: hit rate = confirmed rugs ÷ flagged
  tokens watched, with sample size always shown. Small n → say so.
- "Called It" receipts only when the flag preceded the rug — the watch
  metadata timestamp is the receipt.

## Non-goals (MVP)

- No auto-sell, no wallet connections, no bundle detection (later phase),
- no admin-vault integration yet (alerts as X content comes after launch).
