import type { Chain } from "./chains";

// Normalized token report — the single shape the scoring engine and UI consume.
// Every signal is `T | null`: null means "we don't know" and is NEVER scored
// as pass or fail (design doc, Premise 3).
export interface TokenReport {
  // identity
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  // Deployer/creator address (roadmap F5): GoPlus creator_address on EVM,
  // RugCheck creator on Solana. Optional+null so pre-F5 fixtures stay valid;
  // consumers treat undefined as null. null when unknown — never guessed.
  deployerAddress?: string | null;

  // market data (informational context only — never moves the score)
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  pairAgeHours: number | null;
  dexCount: number | null;

  // contract-safety signals
  honeypot: boolean | null;
  mintable: boolean | null;
  freezable: boolean | null;
  proxy: boolean | null;
  ownershipRenounced: boolean | null;
  buyTax: number | null; // percent, e.g. 5 means 5%
  sellTax: number | null; // percent
  hiddenModifiableTax: boolean | null;
  contractVerified: boolean | null;

  // liquidity signals
  lpLockedOrBurned: boolean | null;
  lpLockDays: number | null; // days remaining on the lock; null if burned/unknown

  // holder signals
  top10HolderPct: number | null; // 0-100
  devWalletPct: number | null; // 0-100
  holderCount: number | null;

  // Per-category availability flags (design doc: data-completeness rule).
  // A category counts as "has data" only if its critical check is present:
  //   Contract Safety -> honeypot check; Liquidity -> LP lock/burn status;
  //   Holders -> top-holder distribution.
  availability: {
    contractSafety: boolean;
    liquidity: boolean;
    holders: boolean;
  };

  providers: ProviderStatus[];
  scannedAt: string; // ISO timestamp
}

export interface ProviderStatus {
  provider: "dexscreener" | "goplus" | "rugcheck";
  ok: boolean;
  error?: string;
}
