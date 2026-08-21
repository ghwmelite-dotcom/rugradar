// DexScreener adapter — no API key required.
// Field names verified against the live API on 2026-08-21.
// Chain ids match our Chain type directly: solana, ethereum, bsc, base, arbitrum, polygon.

import type { Chain } from "../chains";
import { fetchJson, type Result } from "./fetch";

const BASE = "https://api.dexscreener.com";

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  txns?: { h24?: { buys: number; sells: number } };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  pairCreatedAt?: number; // ms epoch
  info?: { imageUrl?: string };
}

// GET /latest/dex/search?q=...  -> { schemaVersion, pairs: DexPair[] | null }
export async function searchPairs(query: string): Promise<Result<DexPair[]>> {
  const res = await fetchJson<{ pairs?: DexPair[] | null }>(
    `${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.pairs ?? [] };
}

// GET /tokens/v1/{chainId}/{addresses} (up to 30 comma-separated addresses)
// -> DexPair[] directly (NOT wrapped in an object).
export async function getTokenPairs(
  chain: Chain,
  addresses: string[],
): Promise<Result<DexPair[]>> {
  const joined = addresses.slice(0, 30).join(",");
  const res = await fetchJson<DexPair[] | null>(
    `${BASE}/tokens/v1/${chain}/${joined}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data ?? [] };
}

export interface DexBoost {
  chainId: string;
  tokenAddress: string;
  totalAmount: number; // boost count
  url?: string;
  description?: string;
  icon?: string;
}

// GET /token-boosts/top/v1 -> DexBoost[] (most-boosted tokens, ~30 items)
export async function getTopBoosts(): Promise<Result<DexBoost[]>> {
  const res = await fetchJson<DexBoost[]>(`${BASE}/token-boosts/top/v1`);
  if (!res.ok) return res;
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}
