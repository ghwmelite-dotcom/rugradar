// Input resolution (design doc: "Input Handling").
// EVM address -> batched DexScreener token lookups across the v1 EVM chains
//   (one hit -> go; multiple -> picker ranked by liquidity; none -> error).
// Solana address -> scan directly.
// Anything else -> DexScreener name search -> picker ranked by liquidity.
// Invalid input -> error, no API fan-out (caller checks classifyInput first).

import { EVM_CHAINS, isChain, type Chain } from "./chains";
import { classifyInput } from "./input";
import { getTokenPairs, searchPairs, type DexPair } from "./providers/dexscreener";

export interface PickerOption {
  chain: Chain;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  liquidityUsd: number;
}

export type ResolveResult =
  | { kind: "resolved"; chain: Chain; address: string; warning?: string }
  | { kind: "picker"; options: PickerOption[]; warning?: string }
  | { kind: "error"; error: string; warning?: string };

function totalLiquidity(pairs: DexPair[]): number {
  return pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
}

function optionFromPairs(chain: Chain, pairs: DexPair[]): PickerOption | null {
  const best = pairs.reduce<DexPair | undefined>(
    (b, p) => (!b || (p.liquidity?.usd ?? 0) > (b.liquidity?.usd ?? 0) ? p : b),
    undefined,
  );
  if (!best) return null;
  return {
    chain,
    address: best.baseToken.address,
    name: best.baseToken.name ?? null,
    symbol: best.baseToken.symbol ?? null,
    imageUrl: best.info?.imageUrl ?? null,
    liquidityUsd: totalLiquidity(pairs),
  };
}

export async function resolveInput(raw: string): Promise<ResolveResult> {
  const input = classifyInput(raw);

  if (input.kind === "invalid") {
    return {
      kind: "error",
      error:
        "That doesn't look like a contract address or coin name. Paste a 0x… address, a Solana address, or a coin name.",
    };
  }

  if (input.kind === "solana-address") {
    return { kind: "resolved", chain: "solana", address: input.value };
  }

  if (input.kind === "evm-address") {
    const addr = input.value.toLowerCase();
    const lookups = await Promise.all(
      EVM_CHAINS.map(async (chain) => {
        const res = await getTokenPairs(chain, [input.value]);
        const pairs = res.ok
          ? res.data.filter(
              (p) => p.baseToken.address.toLowerCase() === addr,
            )
          : [];
        return { chain, pairs };
      }),
    );
    const hits = lookups.filter((l) => l.pairs.length > 0);
    if (hits.length === 0) {
      return {
        kind: "error",
        error: "Address not found on any supported EVM chain (Ethereum, BSC, Base, Arbitrum, Polygon).",
        warning: input.warning,
      };
    }
    if (hits.length === 1) {
      return {
        kind: "resolved",
        chain: hits[0].chain,
        address: input.value,
        warning: input.warning,
      };
    }
    const options = hits
      .map((h) => optionFromPairs(h.chain, h.pairs))
      .filter((o): o is PickerOption => o !== null)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return { kind: "picker", options, warning: input.warning };
  }

  // name search
  const res = await searchPairs(input.value);
  if (!res.ok) {
    return { kind: "error", error: `Search failed (${res.error}). Try again in a moment.` };
  }
  // Dedupe by chain+token, keep highest-liquidity pair set.
  const byToken = new Map<string, DexPair[]>();
  for (const p of res.data) {
    if (!isChain(p.chainId)) continue;
    const key = `${p.chainId}:${p.baseToken.address.toLowerCase()}`;
    const list = byToken.get(key) ?? [];
    list.push(p);
    byToken.set(key, list);
  }
  const options = [...byToken.entries()]
    .map(([key, pairs]) =>
      optionFromPairs(key.split(":")[0] as Chain, pairs),
    )
    .filter((o): o is PickerOption => o !== null)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, 10);

  if (options.length === 0) {
    return { kind: "error", error: `No tokens found for "${input.value}" on the supported chains.` };
  }
  return { kind: "picker", options };
}
