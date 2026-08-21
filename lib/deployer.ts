// Deployer rap sheet (roadmap F5): cross-reference the F3 scan log for other
// tokens previously scanned that share this deployer address.
//
// Honest scope: without an indexer this is "previously seen by RugRadar"
// only (the last-24h, ≤100-entry scanlog window) — never a complete on-chain
// history. UI copy must say exactly that.
//
// Best-effort contract, same as the scan log itself: getDeployerProfile
// NEVER throws — a failure loses the deployer card, never the scan.

import { getCache } from "./cache";
import type { Chain } from "./chains";
import type { Band } from "./scoring";
import { SCANLOG_RECENT_KEY, type ScanLogEntry } from "./scanlog";

export interface PriorToken {
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  score: number | null;
  band: Band | null;
  scannedAt: string; // ISO timestamp
}

export interface DeployerProfile {
  address: string;
  devWalletPct: number | null; // deployer's share of the current token's supply
  priorTokens: PriorToken[]; // previously seen by RugRadar, newest first
  serialRugger: boolean; // >= SERIAL_RUGGER_MIN_AVOID prior tokens scored AVOID
}

export const SERIAL_RUGGER_MIN_AVOID = 2;

// devWalletPct belongs to the current token's report, not the log — pass it
// in so the profile is self-contained for the UI. Optional to keep the core
// lookup callable as getDeployerProfile(address, chain, address).
export async function getDeployerProfile(
  deployerAddress: string,
  currentChain: Chain,
  currentAddress: string,
  devWalletPct: number | null = null,
): Promise<DeployerProfile> {
  let priorTokens: PriorToken[] = [];
  try {
    const recent =
      (await getCache().get<ScanLogEntry[]>(SCANLOG_RECENT_KEY)) ?? [];
    const deployer = deployerAddress.toLowerCase();
    const currentKey = `${currentChain}:${currentAddress.toLowerCase()}`;
    // Dedupe by token (a rescan is not a new deploy), keeping the newest
    // entry — scanlog:recent is stored newest-first.
    const seen = new Map<string, PriorToken>();
    for (const e of recent) {
      // Entries logged before F5 simply lack deployerAddress — skip them.
      if (!e.deployerAddress) continue;
      if (e.deployerAddress.toLowerCase() !== deployer) continue;
      const key = `${e.chain}:${e.address.toLowerCase()}`;
      if (key === currentKey) continue; // the token being reported isn't a "prior"
      if (seen.has(key)) continue;
      seen.set(key, {
        chain: e.chain,
        address: e.address,
        name: e.name,
        symbol: e.symbol,
        score: e.score,
        band: e.band,
        scannedAt: e.scannedAt,
      });
    }
    priorTokens = [...seen.values()];
  } catch {
    // Profile lookup must never break a scan.
  }
  const avoidCount = priorTokens.filter((t) => t.band === "AVOID").length;
  return {
    address: deployerAddress,
    devWalletPct,
    priorTokens,
    serialRugger: avoidCount >= SERIAL_RUGGER_MIN_AVOID,
  };
}
