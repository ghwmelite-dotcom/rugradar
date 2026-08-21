// RugCheck adapter — Solana only, no API key required.
// Field names verified against the live API on 2026-08-21.

import { fetchJson, type Result } from "./fetch";

const BASE = "https://api.rugcheck.xyz";

export interface RugcheckReport {
  mint: string;
  token?: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply?: number;
    decimals?: number;
  };
  tokenMeta?: { name?: string; symbol?: string; mutable?: boolean };
  creator?: string;
  creatorBalance?: number;
  score?: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: { name: string; value?: string; description?: string; level?: string }[];
  topHolders?: { address: string; pct: number; insider?: boolean }[] | null;
  totalHolders?: number;
  totalMarketLiquidity?: number;
  lockers?: Record<
    string,
    { unlockDate?: number; usdcLocked?: number; owner?: string }
  > | null;
  markets?:
    | {
        marketType: string;
        lp?: {
          lpLocked?: number;
          lpLockedPct?: number;
          lpLockedUSD?: number;
          currentSupply?: number;
        };
      }[]
    | null;
}

// GET /v1/tokens/{mint}/report
export async function getRugcheckReport(
  mint: string,
): Promise<Result<RugcheckReport>> {
  const res = await fetchJson<RugcheckReport>(
    `${BASE}/v1/tokens/${mint}/report`,
  );
  if (!res.ok) return res;
  if (!res.data || res.data.mint === undefined) {
    return { ok: false, error: "malformed rugcheck response" };
  }
  return { ok: true, data: res.data };
}
