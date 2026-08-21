# RugRadar (formerly MemeScanner)

Paste a token contract address — or just a coin name — and get an instant,
plain-language risk report before you buy. Built for meme-coin due diligence
across Solana and the major EVM chains.

## What it does

- **Flexible input** — paste a Solana address, a `0x…` EVM address, or a coin
  name. EVM addresses are resolved across all supported chains at once; if a
  token exists on multiple chains you get a picker ranked by liquidity.
- **Risk report** — contract safety (honeypot, mint/freeze authority, proxy,
  ownership, taxes, verified source), liquidity (LP lock/burn, depth, pair
  age, DEX count), and holder concentration (top-10, dev wallet, holder
  count) — each finding explained in plain language.
- **Composite risk score** — 0–100 score in three bands: `AVOID` (0–39),
  `CAUTION` (40–69), `LOWER RISK` (70–100). A detected honeypot forces the
  score to 0. Scores are capped when data coverage is partial, and a token
  with no usable data is reported as unscored rather than guessed.
- **Trending feed** — top boosted tokens from DexScreener, hydrated with
  price/liquidity/volume, refreshed every 5 minutes.
- **Shareable verdict cards** — every report URL unfurls a dynamic OG score
  card on X/Telegram/Discord, with one-tap X/Telegram share buttons and
  precomposed warning text on the report page.
- **Wall of Shame** (`/feed`) — live public feed: honeypots caught, most
  scanned tokens (last 24h), latest scans.
- **Deployer rap sheet** — report pages show the deployer wallet, dev
  supply %, and prior tokens previously seen by RugRadar with their
  scores; serial deployers (≥2 prior AVOIDs) get a red warning.
- **Graceful degradation** — if a data provider fails or hits quota, the
  affected categories are marked unavailable and excluded from the score;
  the rest of the report still renders.

## Companions

- **Telegram bot** (`telegram-bot/`) — separate `rugradar-bot` Worker; paste
  a CA in any chat and get the score card inline. Setup: `telegram-bot/setup.md`.
- **Browser extension** (`extension/`) — Manifest V3 overlay that injects the
  score badge directly into DexScreener, pump.fun, and Axiom pages.
  Load-unpacked instructions: `extension/README.md`.

## Supported chains (v1)

Solana · Ethereum · BSC · Base · Arbitrum · Polygon

## Data providers

| Provider    | Used for                                             |
| ----------- | ---------------------------------------------------- |
| DexScreener | Market data, pair discovery, name search, trending   |
| GoPlus      | Contract security (EVM + Solana fallback)            |
| RugCheck    | Solana contract security (primary), LP lock, holders |

## Scoring model

Weighted average over the categories that have data — Contract Safety 40%,
Liquidity 35%, Holders 25%. Each category starts at 100 and deducts per a
fixed rubric (e.g. mintable −30, LP not locked −40, top-10 holders >50%
−30). Coverage caps: 3/3 categories → 100 max, 2/3 → 75, 1/3 → 50.
Every deduction emits a human-readable flag shown in the UI.

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **Tailwind CSS 4**
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **Cloudflare KV** for response caching (market 60s, security 15min,
  trending 5min) with an in-memory fallback in local dev
- **Cloudflare rate limiting** binding (30 scans/min per IP) with an
  in-memory token-bucket fallback
- **Vitest** for unit tests

## API

| Route                              | Description                                        |
| ---------------------------------- | -------------------------------------------------- |
| `GET /api/resolve?q=…`             | Classify input → chain+address or a picker         |
| `GET /api/scan?chain=…&address=…`  | Full scan: providers → normalize → score (rate-limited) |
| `GET /api/trending`                | Cached trending feed (5 min TTL)                   |
| `GET /api/feed`                    | Wall of Shame: honeypots, most scanned, latest     |
| `GET /api/image?u=…`               | Same-origin token-image proxy (allowlisted hosts)  |
| `/report/[chain]/[address]`        | Rendered risk-report page                          |

## Development

```bash
pnpm install
pnpm dev       # Next.js dev server
pnpm test      # vitest unit tests
pnpm build     # production build
pnpm preview   # build + run in the real Workers runtime (wrangler)
pnpm deploy    # build + deploy to Cloudflare
```

## Project structure

```
app/                  Next.js routes (pages + API)
components/           UI: SearchBox, ScoreDial, ReportView, TrendingFeed
lib/
  chains.ts           v1 chain registry + GoPlus chain-id mapping
  input.ts            input classification (solana / evm / name / invalid)
  resolve.ts          input → chain+address resolution & picker ranking
  scan.ts             scan orchestrator (providers → normalize → cache → score)
  trending.ts         trending feed assembly
  cache.ts            KV cache with in-memory fallback + TTLs
  quota.ts            per-provider daily quota guards
  ratelimit.ts        in-memory per-IP token bucket (dev fallback)
  providers/          dexscreener, goplus, rugcheck + shared fetch helper
  scoring/            pure scoring engine (rubric, bands, coverage caps)
```

## Notes

- No API keys required — all providers have free anonymous tiers, guarded by
  `lib/quota.ts`.
- The score is a risk heuristic, not financial advice. "LOWER RISK" never
  means "safe".
