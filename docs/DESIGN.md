# RugRadar — Design Doc (reconstructed)

> This document was reverse-engineered from the implementation on 2026-08-21.
> The original spec lived only in chat; the code comments in `lib/` reference
> it ("design doc: Input Handling", "v0 rubric", etc.). This file is now the
> canonical spec. Where code and this doc disagree, the code was the source
> for this reconstruction — update both when changing behavior.

## Premise

Paste a contract address or coin name → instant plain-English risk report.
The tool flags red flags; it never says "safe" and never predicts price.
Bands are named AVOID / CAUTION / LOWER RISK for exactly that reason
(Premise 3: a check can pass or fail, but passing checks ≠ safe).

## v1 Chain Support

A chain is enabled only when DexScreener **and** at least one security
provider cover it:

- Solana (RugCheck primary, GoPlus Solana fallback)
- Ethereum, BSC, Base, Arbitrum, Polygon (GoPlus)

DexScreener chain ids match our ids 1:1. GoPlus numeric ids in `lib/chains.ts`.

## Input Handling

Single search box. Classification (`lib/input.ts`):

1. **Solana address** → scan directly.
2. **EVM address** → batched DexScreener token lookups across all v1 EVM
   chains in parallel. One hit → go straight to report. Multiple hits →
   disambiguation picker ranked by total liquidity. None → error.
3. **Coin name** → DexScreener search → picker ranked by liquidity, top 10.
4. **Invalid** → error, zero upstream calls.

## Scan Pipeline

`lib/scan.ts` orchestrates: providers fan out in parallel, results normalize
into a `TokenReport`, get cached, then scored.

### Providers

| Provider    | Role                                              |
| ----------- | ------------------------------------------------- |
| DexScreener | Market data, pair discovery, name search, trending |
| GoPlus      | EVM contract security; Solana fallback            |
| RugCheck    | Solana primary: honeypot, LP lock, holders, dev %  |

### Degradation rules

- Providers never throw into the caller. A failed provider is recorded in
  `report.providers` and its categories become unavailable (excluded from
  score, shown as "data unavailable").
- Solana fallback ordering: RugCheck → GoPlus Solana → DexScreener-only.
- A category counts as "has data" only if its critical check is present
  (contractSafety needs `honeypot`, liquidity needs `lpLockedOrBurned`,
  holders needs `top10HolderPct`).
- Only successful slices are cached — transient failures are not sticky.
- Per-provider daily quota circuit breakers (`lib/quota.ts`).

### Cache TTLs (`lib/cache.ts`)

- Market data: 60s
- Security data: 15min
- Trending: 5min

KV binding `MEMESCANNER_CACHE` in production, in-memory Map in dev.

## Scoring — v0 Rubric

Pure function (`lib/scoring/index.ts`). Composite = weighted average over
categories **that have data**: Contract Safety 40%, Liquidity 35%, Holders
25%. Each category starts at 100 and deducts. Threshold tiers within one
check are mutually exclusive (highest matching deduction only).

### Contract Safety (40%)

- Mintable −30 · Freezable −25 · Upgradeable proxy w/ active owner −20
- Ownership not renounced −15
- Hidden modifiable tax −30 (wins over high-tax tier) · buy/sell tax >10% −20
- Contract source unverified −10

### Liquidity (35%)

- LP not locked/burned −40 · locked <30 days −15 (mutually exclusive)
- Liquidity <$10k −30 · <$50k −15 (mutually exclusive)
- Single DEX pair −10 · pair <24h old −10

### Holders (25%)

- Top-10 >50% −30 · >30% −15 (mutually exclusive)
- Dev wallet >10% −25 · >5% −10 (mutually exclusive)
- <100 holders −20

### Composite rules

- **Honeypot override**: score forced to 0 / AVOID, regardless of all else.
- **Coverage caps**: 3/3 categories → cap 100, 2/3 → 75, 1/3 → 50.
- **0/3 coverage** → unscored (no numeric score, never lands in a band).
- **Bands**: 0–39 AVOID, 40–69 CAUTION, 70–100 LOWER RISK.
- Every deduction emits a plain-language flag for the UI.

## Trending Feed

DexScreener `/token-boosts/top/v1` → filter v1 chains → batch-hydrate pairs
per chain (≤30 addresses per call) → merge → rank by boost amount → top 20.
Cached globally 5min.

## Rate Limiting

30 scans/min per IP via the Workers `SCAN_RATE_LIMITER` binding; in-memory
token bucket fallback in dev. Applied to `/api/scan` only.

## Image Proxy

`/api/image?u=` proxies token icons same-origin (ad-blockers block
cdn.dexscreener.com). SSRF guard: https + host allowlist + image
content-type check. 24h cache.

## Stack

Next.js 15 (App Router) + React 19 + Tailwind 4 on Cloudflare Workers via
`@opennextjs/cloudflare`. pnpm 9.15.0 pinned (`packageManager`). Vitest.
Deploy: `pnpm run deploy` (note: bare `pnpm deploy` hits pnpm's built-in).
