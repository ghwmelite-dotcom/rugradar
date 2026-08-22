// Pure scoring engine — implements the v1 rubric (docs/SCORING-V1.md).
//
//   Composite = weighted average over categories that HAVE DATA:
//     Contract Safety 40%, Liquidity 35%, Holders 25%
//   Each category starts at 100 and deducts per the rubric below.
//   Threshold tiers within a single check are mutually exclusive
//   (highest matching deduction only — e.g. $8k liquidity costs -30, not -45).
//   LP lock tiers are mutually exclusive.
//   Honeypot is a composite-level override: score forced to 0 / AVOID.
//   Coverage caps: 3/3 -> 100, 2/3 -> 75, 1/3 -> 50.
//   0/3 coverage -> unscored (no numeric score, never lands in a band).
//   Bands: 0-39 AVOID, 40-69 CAUTION, 70-100 LOWER RISK (never "safe"/"buy").
//   Every deduction emits a plain-language flag for the UI.
//
//   v1 (fresh-launch credibility fix):
//   - Age gate (composite cap): <24h old -> cap 69; 24h-7d -> cap 84.
//     No token under 24h has earned "LOWER RISK". Combines with coverage
//     caps by taking the min.
//   - Liquidity-depth deductions double when the pair is < 7 days old
//     (<$10k: -60, <$50k: -30) — a $2k pool on a 2h-old token is an exit
//     trap, not just "thin".
//   - Top-10 >50% concentration costs -45 (from -30) when < 7 days old —
//     fresh concentration has had no time to distribute organically.
//   - Age never guessed: pairAgeHours null -> no gate, no scaling.

import type { TokenReport } from "../types";

export type Band = "AVOID" | "CAUTION" | "LOWER_RISK";

export type CategoryKey = "contractSafety" | "liquidity" | "holders";

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  contractSafety: "Contract Safety",
  liquidity: "Liquidity",
  holders: "Holders",
};

const WEIGHTS: Record<CategoryKey, number> = {
  contractSafety: 0.4,
  liquidity: 0.35,
  holders: 0.25,
};

const COVERAGE_CAPS: Record<number, number> = { 3: 100, 2: 75, 1: 50 };

const HOURS_DAY = 24;
const HOURS_WEEK = 24 * 7;

// v1 age gate: composite caps by pair age. null age -> no cap (never guess).
function ageCapFor(pairAgeHours: number | null): number | null {
  if (pairAgeHours === null) return null;
  if (pairAgeHours < HOURS_DAY) return 69; // CAUTION ceiling
  if (pairAgeHours < HOURS_WEEK) return 84;
  return null;
}

// v1 age scaling applies under 7 days.
function isYoung(pairAgeHours: number | null): boolean {
  return pairAgeHours !== null && pairAgeHours < HOURS_WEEK;
}

function fmtAgeHours(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

export interface Flag {
  category: CategoryKey | null; // null = composite-level (honeypot override)
  text: string;
  deduction: number;
}

export interface CategoryResult {
  available: boolean;
  score: number | null; // null when unavailable
  flags: Flag[];
}

export interface ScoreResult {
  scored: boolean;
  score: number | null; // 0-100 integer, null when unscored
  band: Band | null;
  coverage: number; // 0-3 categories with data
  cap: number | null; // effective cap (min of coverage cap and age cap)
  ageCap: number | null; // v1 age gate cap, null when mature/unknown age
  honeypotOverride: boolean;
  categories: Record<CategoryKey, CategoryResult>;
  flags: Flag[]; // all flags, composite-level first
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function scoreContractSafety(r: TokenReport): CategoryResult {
  const flags: Flag[] = [];
  if (!r.availability.contractSafety) {
    return { available: false, score: null, flags };
  }
  const add = (deduction: number, text: string) =>
    flags.push({ category: "contractSafety", text, deduction });

  let score = 100;

  if (r.mintable === true) {
    score -= 30;
    add(30, "Mint authority active — the deployer can print unlimited new tokens and dilute holders.");
  }
  if (r.freezable === true) {
    score -= 25;
    add(25, "Freeze authority active — the deployer can freeze token accounts so they cannot sell.");
  }
  // "Upgradeable/proxy contract with unverified owner": proxy whose ownership
  // has not been renounced (a renounced proxy can't be upgraded).
  if (r.proxy === true && r.ownershipRenounced === false) {
    score -= 20;
    add(20, "Upgradeable proxy contract with an active owner — the code can be swapped out at any time.");
  }
  if (r.ownershipRenounced === false) {
    score -= 15;
    add(15, "Ownership not renounced — the owner can change contract parameters after launch.");
  }
  // Tax check: tiers mutually exclusive — hidden modifiable tax wins over high tax.
  const buyTax = r.buyTax ?? 0;
  const sellTax = r.sellTax ?? 0;
  if (r.hiddenModifiableTax === true) {
    score -= 30;
    add(30, "Hidden modifiable tax — the trading tax can be raised (even to 100%) at any time.");
  } else if (buyTax > 10 || sellTax > 10) {
    score -= 20;
    add(
      20,
      `High trading tax — buy ${buyTax}% / sell ${sellTax}% (above the 10% threshold).`,
    );
  }
  if (r.contractVerified === false) {
    score -= 10;
    add(10, "Contract source code not verified — the deployed code cannot be audited.");
  }

  return { available: true, score: clamp(score), flags };
}

function scoreLiquidity(r: TokenReport): CategoryResult {
  const flags: Flag[] = [];
  if (!r.availability.liquidity) {
    return { available: false, score: null, flags };
  }
  const add = (deduction: number, text: string) =>
    flags.push({ category: "liquidity", text, deduction });

  let score = 100;

  // LP lock tiers — mutually exclusive, apply at most one.
  if (r.lpLockedOrBurned === false) {
    score -= 40;
    add(40, "Liquidity pool not locked or burned — the deployer can drain the liquidity at any time (classic rug).");
  } else if (r.lpLockDays !== null && r.lpLockDays < 30) {
    score -= 15;
    add(15, `Liquidity locked for less than 30 days (${Math.max(0, Math.round(r.lpLockDays))} days remaining).`);
  }
  // locked >= 30d or burned -> -0, no flag.

  // Liquidity-depth tiers — mutually exclusive, highest matching only.
  // v1: deductions double when the pair is < 7 days old — a tiny pool on a
  // fresh token is an exit trap, not merely "thin".
  if (r.liquidityUsd !== null) {
    const young = isYoung(r.pairAgeHours);
    if (r.liquidityUsd < 10_000) {
      const d = young ? 60 : 30;
      score -= d;
      add(
        d,
        young
          ? `Very low liquidity (${fmtUsd(r.liquidityUsd)} — under $10k) on a pair less than 7 days old — an exit trap: no way out without moving the price.`
          : `Very low liquidity (${fmtUsd(r.liquidityUsd)} — under $10k) — hard to exit without moving the price.`,
      );
    } else if (r.liquidityUsd < 50_000) {
      const d = young ? 30 : 15;
      score -= d;
      add(
        d,
        young
          ? `Low liquidity (${fmtUsd(r.liquidityUsd)} — under $50k) on a pair less than 7 days old.`
          : `Low liquidity (${fmtUsd(r.liquidityUsd)} — under $50k).`,
      );
    }
  }
  if (r.dexCount === 1) {
    score -= 10;
    add(10, "Trades on a single DEX pair only — no secondary market if that pool is pulled.");
  }
  if (r.pairAgeHours !== null && r.pairAgeHours < 24) {
    score -= 10;
    add(10, "Trading pair is less than 24 hours old — brand-new pairs carry extra risk.");
  }

  return { available: true, score: clamp(score), flags };
}

function scoreHolders(r: TokenReport): CategoryResult {
  const flags: Flag[] = [];
  if (!r.availability.holders) {
    return { available: false, score: null, flags };
  }
  const add = (deduction: number, text: string) =>
    flags.push({ category: "holders", text, deduction });

  let score = 100;

  // Top-10 concentration tiers — mutually exclusive.
  // v1: the >50% tier scales to -45 when the pair is < 7 days old — fresh
  // concentration has had no time for organic distribution.
  if (r.top10HolderPct !== null) {
    if (r.top10HolderPct > 50) {
      const d = isYoung(r.pairAgeHours) ? 45 : 30;
      score -= d;
      add(
        d,
        isYoung(r.pairAgeHours)
          ? `Top 10 holders own ${r.top10HolderPct.toFixed(1)}% of supply on a pair less than 7 days old — extreme fresh concentration, classic dump setup.`
          : `Top 10 holders own ${r.top10HolderPct.toFixed(1)}% of supply — extreme concentration, dump risk.`,
      );
    } else if (r.top10HolderPct > 30) {
      score -= 15;
      add(15, `Top 10 holders own ${r.top10HolderPct.toFixed(1)}% of supply — high concentration.`);
    }
  }
  // Dev wallet tiers — mutually exclusive.
  if (r.devWalletPct !== null) {
    if (r.devWalletPct > 10) {
      score -= 25;
      add(25, `Deployer wallet holds ${r.devWalletPct.toFixed(1)}% of supply — they can crash the price alone.`);
    } else if (r.devWalletPct > 5) {
      score -= 10;
      add(10, `Deployer wallet holds ${r.devWalletPct.toFixed(1)}% of supply.`);
    }
  }
  if (r.holderCount !== null && r.holderCount < 100) {
    score -= 20;
    add(20, `Fewer than 100 holders (${r.holderCount}) — thin, easily manipulated ownership.`);
  }

  return { available: true, score: clamp(score), flags };
}

export function bandForScore(score: number): Band {
  if (score <= 39) return "AVOID";
  if (score <= 69) return "CAUTION";
  return "LOWER_RISK";
}

export function scoreToken(report: TokenReport): ScoreResult {
  const categories: Record<CategoryKey, CategoryResult> = {
    contractSafety: scoreContractSafety(report),
    liquidity: scoreLiquidity(report),
    holders: scoreHolders(report),
  };

  const available = (Object.keys(categories) as CategoryKey[]).filter(
    (k) => categories[k].available,
  );
  const coverage = available.length;

  const categoryFlags = available.flatMap((k) => categories[k].flags);

  // Composite-level honeypot override: forced 0 / AVOID regardless of all else.
  if (report.honeypot === true) {
    const flag: Flag = {
      category: null,
      text: "Honeypot detected — buyers cannot sell this token.",
      deduction: 100,
    };
    return {
      scored: true,
      score: 0,
      band: "AVOID",
      coverage,
      cap: COVERAGE_CAPS[coverage] ?? null,
      ageCap: null,
      honeypotOverride: true,
      categories,
      flags: [flag, ...categoryFlags],
    };
  }

  // 0-of-3 coverage -> unscored; never lands in a band.
  if (coverage === 0) {
    return {
      scored: false,
      score: null,
      band: null,
      coverage: 0,
      cap: null,
      ageCap: null,
      honeypotOverride: false,
      categories,
      flags: [],
    };
  }

  const weightSum = available.reduce((sum, k) => sum + WEIGHTS[k], 0);
  const weighted = available.reduce(
    (sum, k) => sum + (categories[k].score ?? 0) * WEIGHTS[k],
    0,
  );
  const composite = weighted / weightSum;
  const coverageCap = COVERAGE_CAPS[coverage];
  const ageCap = ageCapFor(report.pairAgeHours);
  const cap = ageCap !== null ? Math.min(coverageCap, ageCap) : coverageCap;
  const uncapped = clamp(Math.round(composite));
  const score = Math.min(uncapped, cap);

  // When the age gate binds, it explains itself as a composite-level flag.
  const flags = [...categoryFlags];
  if (ageCap !== null && ageCap <= coverageCap && uncapped > ageCap) {
    flags.unshift({
      category: null,
      text: `Score capped at ${ageCap} — the pair is only ${fmtAgeHours(report.pairAgeHours!)} old. Brand-new pairs can't earn trust yet.`,
      deduction: Math.max(1, uncapped - score),
    });
  }

  return {
    scored: true,
    score,
    band: bandForScore(score),
    coverage,
    cap,
    ageCap,
    honeypotOverride: false,
    categories,
    flags,
  };
}
