# Scoring v1 — the "fresh launch" credibility fix

> Status: SHIPPED (2026-08-22). Implemented in `lib/scoring/index.ts`,
> boundary-tested in `lib/scoring/scoring.test.ts`, rubric updated in
> `docs/DESIGN.md`. The doc's BABYCATE example is a live test case
> (75 LOWER_RISK under v0 → 61 CAUTION under v1).

## The problem

Observed live: a pump.fun token, 1 hour old, $0 locked liquidity visible,
top-10 wallets holding 72.4% of supply, single DEX pair — scored **75 /
LOWER RISK**. Any experienced trader calls that token a minefield. If
screenshots of verdicts like that circulate, RugRadar's credibility — the
entire product — dies.

Root cause, mechanically:

1. **Category floors compose upward.** Each category bottoms out at 0 but
   the composite is a weighted average; a perfect Contract Safety (100)
   drags a disastrous Liquidity (50) and Holders (70) up to 75.
2. **pump.fun launches get free liquidity points.** Their LP is burned by
   construction, so the single biggest liquidity deduction (−40 unlocked)
   never fires — even when the pool is minutes old and microscopic.
3. **Age deductions are trivially small** (−10 for <24h) relative to what
   age implies: unaudited behavior, no holder distribution time, no proof
   the "burned" LP matters when the dev holds the supply instead.

## v1 changes

### 1. Age gate (new composite-level rule)

| Pair age | Effect |
|---|---|
| < 24h | composite capped at **69** (CAUTION ceiling) |
| 24h–7d | composite capped at **84** |
| ≥ 7d | no cap |

Rationale: no token under 24h old has earned "LOWER RISK" — there has
been no time for the distribution to prove itself. Caps are honest and
explainable in one sentence, and the UI already knows how to show caps.

### 2. Liquidity depth hits harder when young

Existing tiers stay, but when pair age < 7 days the depth deductions
double: <$10k → −60 (from −30), <$50k → −30 (from −15). A $2k pool on a
mature token is thin; on a 2-hour-old token it's an exit trap.

### 3. Holder concentration scales with age

Top-10 >50%: −30 normally, −45 when pair < 7 days old. Fresh
concentration is far more dangerous than the same number on a
year-old token (no time for organic distribution).

### 4. Contract Safety weight reduction for unauditable freshness

No weight change — but when `contractVerified`/`honeypot` data is
unavailable AND pair age < 24h, coverage already drops the cap via the
existing 2/3 → 75 rule; combined with the age gate this stacks
correctly (min of caps).

## What does NOT change

- Bands and their names (AVOID / CAUTION / LOWER RISK), honeypot → 0
  override, coverage caps, plain-language flags, "never says safe".
- Category weights (40/35/25) — they were never the problem; floors were.

## Expected effect (today's examples)

- BABYCATE (1h old, $0 liq, top-10 72.4%): was 75 LOWER_RISK →
  liquidity 100−60(age-doubled <$10k)−10−10 = 20; holders 100−45 = 55;
  contract 100 → composite (40+7+13.75)/1.0 ≈ 61 → **61 CAUTION**,
  further age-gated ≤69. Honest.
- RIKA (93, mature-ish, LP locked): unchanged.
- LINK (79): unchanged.

## Migration

- Implement in `lib/scoring/index.ts` behind the same pure-function
  style; update `lib/scoring/scoring.test.ts` expectations; add age-gate
  tests (boundary 24h/7d), age-doubling tests.
- Update `docs/DESIGN.md` rubric section when shipped.
- Report page already renders caps ("capped at N for partial coverage")
  — extend flag copy so the age cap explains itself: "Score capped at 69
  — the pair is only 3 hours old. Brand-new pairs can't earn trust yet."
