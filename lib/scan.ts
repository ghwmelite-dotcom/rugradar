// Scan orchestrator: fan out to providers in parallel, normalize into a
// TokenReport, cache per the doc's TTLs, and score.
//
// Degradation rules (design doc):
//   - Providers never throw into the caller; a failed provider is recorded in
//     `providers` and its categories become unavailable (excluded from score).
//   - Solana fallback ordering: RugCheck -> GoPlus Solana -> DexScreener-only.
//   - A category counts as "has data" only if its critical check is present.

import { isEvmChain, type Chain } from "./chains";
import { getCache, TTL } from "./cache";
import {
  getTokenPairs,
  type DexPair,
} from "./providers/dexscreener";
import {
  getEvmTokenSecurity,
  getSolanaTokenSecurity,
  type GoplusEvmSecurity,
  type GoplusSolanaSecurity,
} from "./providers/goplus";
import {
  getRugcheckReport,
  type RugcheckReport,
} from "./providers/rugcheck";
import type { Result } from "./providers/fetch";
import { providerAvailable, recordProviderCall } from "./quota";
import { scoreToken, type ScoreResult } from "./scoring";
import { getDeployerProfile, type DeployerProfile } from "./deployer";
import type { ProviderStatus, TokenReport } from "./types";

export interface ScanResult {
  report: TokenReport;
  score: ScoreResult;
  // F5: deployer rap sheet; null when no provider exposed a creator address.
  deployer: DeployerProfile | null;
}

// ---------- market data (DexScreener, 60s TTL) ----------

interface MarketSlice {
  pairs: DexPair[];
  status: ProviderStatus;
}

async function getMarketSlice(chain: Chain, address: string): Promise<MarketSlice> {
  const cache = getCache();
  const key = `market:${chain}:${address.toLowerCase()}`;
  const cached = await cache.get<MarketSlice>(key);
  if (cached) return cached;

  let result: Result<DexPair[]>;
  if (!providerAvailable("dexscreener")) {
    result = { ok: false, error: "daily quota exhausted" };
  } else {
    recordProviderCall("dexscreener");
    result = await getTokenPairs(chain, [address]);
  }
  const slice: MarketSlice = {
    pairs: result.ok ? result.data : [],
    status: result.ok
      ? { provider: "dexscreener", ok: true }
      : { provider: "dexscreener", ok: false, error: result.error },
  };
  // Only cache successes — a transient failure shouldn't be sticky.
  if (result.ok) await cache.set(key, slice, TTL.MARKET);
  return slice;
}

// ---------- security data (GoPlus / RugCheck, 15min TTL) ----------

interface SecuritySlice {
  // partial TokenReport fields
  fields: Partial<TokenReport>;
  statuses: ProviderStatus[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

function asBool(v: string | undefined): boolean | null {
  if (v === undefined || v === "") return null;
  return v === "1";
}

// GoPlus taxes are string fractions ("0.05" = 5%); values > 1 are already %.
function asTaxPct(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function sumTop10Pct(
  holders: { percent: string }[] | undefined,
): number | null {
  if (!holders || holders.length === 0) return null;
  const top = holders.slice(0, 10);
  return top.reduce((sum, h) => sum + parseFloat(h.percent || "0") * 100, 0);
}

function mergeEvmGoplus(sec: GoplusEvmSecurity): Partial<TokenReport> {
  const owner = (sec.owner_address ?? "").toLowerCase();
  const takeBack = sec.can_take_back_ownership === "1";
  const renounced =
    sec.owner_address !== undefined
      ? (owner === "" || owner === ZERO_ADDRESS) && !takeBack
      : null;

  // LP lock: locked share + burned share of LP tokens.
  let lpLockedOrBurned: boolean | null = null;
  if (sec.lp_holders && sec.lp_holders.length > 0) {
    const lockedPct = sec.lp_holders.reduce((sum, h) => {
      const pct = parseFloat(h.percent || "0") * 100;
      const locked =
        h.is_locked === 1 || BURN_ADDRESSES.has(h.address.toLowerCase());
      return sum + (locked ? pct : 0);
    }, 0);
    lpLockedOrBurned = lockedPct >= 50;
  }

  return {
    honeypot: asBool(sec.is_honeypot),
    mintable: asBool(sec.is_mintable),
    freezable: null, // GoPlus EVM exposes no freeze-authority signal
    proxy: asBool(sec.is_proxy),
    ownershipRenounced: renounced,
    buyTax: asTaxPct(sec.buy_tax),
    sellTax: asTaxPct(sec.sell_tax),
    hiddenModifiableTax: asBool(sec.slippage_modifiable),
    contractVerified: asBool(sec.is_open_source),
    lpLockedOrBurned,
    lpLockDays: null, // GoPlus gives no unlock dates; a locked LP is scored as the -0 tier
    top10HolderPct: sumTop10Pct(sec.holders),
    devWalletPct: asTaxPct(sec.creator_percent),
    holderCount: sec.holder_count ? parseInt(sec.holder_count, 10) : null,
    deployerAddress: sec.creator_address || null,
  };
}

function mergeRugcheck(rep: RugcheckReport): Partial<TokenReport> {
  // Honeypot: rugcheck has no explicit field; a transfer-blocking risk would
  // surface here. Report presence alone counts as "honeypot check performed".
  const honeypot = (rep.risks ?? []).some((r) =>
    /honeypot|cannot sell|non.?transferable/i.test(r.name),
  );

  // LP lock: max of pool-level locked pct, locker USD coverage, is combined
  // with GoPlus burn_percent by the caller.
  let lockedPct = 0;
  for (const m of rep.markets ?? []) {
    lockedPct = Math.max(lockedPct, m.lp?.lpLockedPct ?? 0);
  }
  const lockers = Object.values(rep.lockers ?? {});
  const lockerUsd = lockers.reduce((s, l) => s + (l.usdcLocked ?? 0), 0);
  if (lockerUsd > 0 && (rep.totalMarketLiquidity ?? 0) > 0) {
    lockedPct = Math.max(
      lockedPct,
      (lockerUsd / (rep.totalMarketLiquidity as number)) * 100,
    );
  }
  const hasLpInfo =
    (rep.markets ?? []).length > 0 || lockers.length > 0;

  // Longest lock horizon across lockers.
  let lpLockDays: number | null = null;
  for (const l of lockers) {
    if (l.unlockDate) {
      const days = (l.unlockDate * 1000 - Date.now()) / 86_400_000;
      lpLockDays = Math.max(lpLockDays ?? 0, days);
    }
  }

  const supply = rep.token?.supply;
  const devWalletPct =
    rep.creatorBalance !== undefined && supply && supply > 0
      ? (rep.creatorBalance / supply) * 100
      : null;

  return {
    honeypot,
    mintable:
      rep.token !== undefined ? rep.token.mintAuthority !== null : null,
    freezable:
      rep.token !== undefined ? rep.token.freezeAuthority !== null : null,
    top10HolderPct:
      rep.topHolders && rep.topHolders.length > 0
        ? rep.topHolders.slice(0, 10).reduce((s, h) => s + h.pct, 0)
        : null,
    holderCount:
      rep.totalHolders && rep.totalHolders > 0 ? rep.totalHolders : null,
    devWalletPct,
    lpLockedOrBurned: hasLpInfo ? lockedPct >= 50 : null,
    lpLockDays,
    deployerAddress: rep.creator || null,
  };
}

function mergeSolanaGoplus(sec: GoplusSolanaSecurity): Partial<TokenReport> {
  // LP burn: max burn_percent across listed pools.
  const burnPct = (sec.dex ?? []).reduce(
    (max, d) => Math.max(max, d.burn_percent ?? 0),
    0,
  );
  const holders = (sec.holders ?? []).map((h) => ({ percent: h.percent }));
  return {
    honeypot: sec.non_transferable === "1",
    mintable: sec.mintable?.status === "1",
    freezable: sec.freezable?.status === "1",
    hiddenModifiableTax:
      sec.transfer_fee_upgradable?.status === "1" ? true : null,
    lpLockedOrBurned: burnPct >= 50 ? true : null, // <50 stays unknown, not "unlocked"
    top10HolderPct: sumTop10Pct(holders),
    holderCount: sec.holder_count ? parseInt(sec.holder_count, 10) : null,
  };
}

async function getSecuritySlice(
  chain: Chain,
  address: string,
): Promise<SecuritySlice> {
  const cache = getCache();
  const key = `security:${chain}:${address.toLowerCase()}`;
  const cached = await cache.get<SecuritySlice>(key);
  if (cached) return cached;

  const statuses: ProviderStatus[] = [];
  let fields: Partial<TokenReport> = {};

  if (isEvmChain(chain)) {
    let result: Result<GoplusEvmSecurity>;
    if (!providerAvailable("goplus")) {
      result = { ok: false, error: "daily quota exhausted" };
    } else {
      recordProviderCall("goplus");
      result = await getEvmTokenSecurity(chain, address);
    }
    statuses.push(
      result.ok
        ? { provider: "goplus", ok: true }
        : { provider: "goplus", ok: false, error: result.error },
    );
    if (result.ok) fields = mergeEvmGoplus(result.data);
  } else {
    // Solana fallback ordering: RugCheck -> GoPlus Solana.
    const [rug, goplus] = await Promise.all([
      providerAvailable("rugcheck")
        ? (recordProviderCall("rugcheck"), getRugcheckReport(address))
        : Promise.resolve<Result<RugcheckReport>>({
            ok: false,
            error: "daily quota exhausted",
          }),
      providerAvailable("goplus")
        ? (recordProviderCall("goplus"), getSolanaTokenSecurity(address))
        : Promise.resolve<Result<GoplusSolanaSecurity>>({
            ok: false,
            error: "daily quota exhausted",
          }),
    ]);
    statuses.push(
      rug.ok
        ? { provider: "rugcheck", ok: true }
        : { provider: "rugcheck", ok: false, error: rug.error },
      goplus.ok
        ? { provider: "goplus", ok: true }
        : { provider: "goplus", ok: false, error: goplus.error },
    );
    const rugFields = rug.ok ? mergeRugcheck(rug.data) : {};
    const gpFields = goplus.ok ? mergeSolanaGoplus(goplus.data) : {};
    // RugCheck wins where it has data; GoPlus fills the gaps.
    fields = { ...gpFields };
    for (const [k, v] of Object.entries(rugFields)) {
      if (v !== null && v !== undefined) {
        (fields as Record<string, unknown>)[k] = v;
      }
    }
    // LP: GoPlus burn>=50 can upgrade an "unknown" to locked/burned.
    if (fields.lpLockedOrBurned == null && gpFields.lpLockedOrBurned === true) {
      fields.lpLockedOrBurned = true;
    }
  }

  const slice: SecuritySlice = { fields, statuses };
  if (statuses.some((s) => s.ok)) await cache.set(key, slice, TTL.SECURITY);
  return slice;
}

// ---------- orchestration ----------

function pickBestPair(pairs: DexPair[]): DexPair | undefined {
  return pairs.reduce<DexPair | undefined>((best, p) => {
    if (!best) return p;
    return (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best;
  }, undefined);
}

export async function scanToken(
  chain: Chain,
  address: string,
): Promise<ScanResult> {
  const [market, security] = await Promise.all([
    getMarketSlice(chain, address),
    getSecuritySlice(chain, address),
  ]);

  const best = pickBestPair(market.pairs);
  const pairCreatedAts = market.pairs
    .map((p) => p.pairCreatedAt)
    .filter((t): t is number => typeof t === "number");
  const oldest = pairCreatedAts.length > 0 ? Math.min(...pairCreatedAts) : null;

  const f = security.fields;
  const report: TokenReport = {
    chain,
    address,
    name: best?.baseToken.name ?? null,
    symbol: best?.baseToken.symbol ?? null,
    imageUrl: best?.info?.imageUrl ?? null,
    priceUsd: best?.priceUsd ? parseFloat(best.priceUsd) : null,
    liquidityUsd:
      market.pairs.length > 0
        ? market.pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0)
        : null,
    volume24h:
      market.pairs.length > 0
        ? market.pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0)
        : null,
    pairAgeHours: oldest ? (Date.now() - oldest) / 3_600_000 : null,
    dexCount: market.pairs.length > 0 ? market.pairs.length : null,

    honeypot: f.honeypot ?? null,
    mintable: f.mintable ?? null,
    freezable: f.freezable ?? null,
    proxy: f.proxy ?? null,
    ownershipRenounced: f.ownershipRenounced ?? null,
    buyTax: f.buyTax ?? null,
    sellTax: f.sellTax ?? null,
    hiddenModifiableTax: f.hiddenModifiableTax ?? null,
    contractVerified: f.contractVerified ?? null,
    lpLockedOrBurned: f.lpLockedOrBurned ?? null,
    lpLockDays: f.lpLockDays ?? null,
    top10HolderPct: f.top10HolderPct ?? null,
    devWalletPct: f.devWalletPct ?? null,
    holderCount: f.holderCount ?? null,
    deployerAddress: f.deployerAddress ?? null,

    // Data-completeness rule: a category has data only if its critical
    // check is present.
    availability: {
      contractSafety: f.honeypot != null,
      liquidity: f.lpLockedOrBurned != null,
      holders: f.top10HolderPct != null,
    },

    providers: [market.status, ...security.statuses],
    scannedAt: new Date().toISOString(),
  };

  // F5: deployer rap sheet. Reads the scan log as it was BEFORE this scan is
  // recorded (the route records after scanToken returns), so the current
  // token only appears on repeat scans — getDeployerProfile excludes it.
  const deployer = report.deployerAddress
    ? await getDeployerProfile(
        report.deployerAddress,
        chain,
        address,
        report.devWalletPct,
      )
    : null;

  return { report, score: scoreToken(report), deployer };
}
