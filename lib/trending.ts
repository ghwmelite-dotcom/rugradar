// Trending feed (design doc: "Trending Feed").
// Source: DexScreener /token-boosts/top/v1, hydrated by batch token lookups
// (up to 30 addresses per call, grouped per chain), merged across v1 chains,
// ranked by boost count, top 20. Cached globally for 5 minutes.

import { type Chain, isChain } from "./chains";
import { getCache, TTL } from "./cache";
import { getTokenPairs, getTopBoosts } from "./providers/dexscreener";
import { providerAvailable, recordProviderCall } from "./quota";

export interface TrendingItem {
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  boostAmount: number;
}

const CACHE_KEY = "trending:global";

export async function getTrending(): Promise<TrendingItem[]> {
  const cache = getCache();
  const cached = await cache.get<TrendingItem[]>(CACHE_KEY);
  if (cached) return cached;

  if (!providerAvailable("dexscreener")) return [];
  recordProviderCall("dexscreener");
  const boosts = await getTopBoosts();
  if (!boosts.ok) return [];

  // Keep v1 chains only, group addresses per chain (max 30 per lookup call).
  const byChain = new Map<Chain, { address: string; boost: number }[]>();
  for (const b of boosts.data) {
    if (!isChain(b.chainId)) continue;
    const list = byChain.get(b.chainId) ?? [];
    if (list.length < 30) list.push({ address: b.tokenAddress, boost: b.totalAmount });
    byChain.set(b.chainId, list);
  }

  // Hydrate per chain in parallel.
  const boostMap = new Map<string, number>(); // `${chain}:${addrLower}` -> boost
  for (const [chain, list] of byChain) {
    for (const item of list) {
      boostMap.set(`${chain}:${item.address.toLowerCase()}`, item.boost);
    }
  }

  const hydrated = await Promise.all(
    [...byChain.entries()].map(async ([chain, list]) => {
      recordProviderCall("dexscreener");
      const res = await getTokenPairs(chain, list.map((i) => i.address));
      return { chain, pairs: res.ok ? res.data : [] };
    }),
  );

  const items = new Map<string, TrendingItem>();
  for (const { chain, pairs } of hydrated) {
    for (const p of pairs) {
      const addr = p.baseToken.address;
      const key = `${chain}:${addr.toLowerCase()}`;
      const boost = boostMap.get(key);
      if (boost === undefined) continue;
      const existing = items.get(key);
      const liq = p.liquidity?.usd ?? 0;
      const vol = p.volume?.h24 ?? 0;
      if (existing) {
        existing.liquidityUsd = (existing.liquidityUsd ?? 0) + liq;
        existing.volume24h = (existing.volume24h ?? 0) + vol;
        if ((existing.priceUsd ?? 0) === 0 && p.priceUsd) {
          existing.priceUsd = parseFloat(p.priceUsd);
        }
      } else {
        items.set(key, {
          chain,
          address: addr,
          name: p.baseToken.name ?? null,
          symbol: p.baseToken.symbol ?? null,
          imageUrl: p.info?.imageUrl ?? null,
          priceUsd: p.priceUsd ? parseFloat(p.priceUsd) : null,
          liquidityUsd: liq,
          volume24h: vol,
          boostAmount: boost,
        });
      }
    }
  }

  const result = [...items.values()]
    .sort((a, b) => b.boostAmount - a.boostAmount)
    .slice(0, 20);

  await cache.set(CACHE_KEY, result, TTL.TRENDING);
  return result;
}
