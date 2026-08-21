// v1 chain support. A chain is enabled only when DexScreener + at least one
// security provider covers it (design doc: "v1 Chain Support").

export const CHAINS = [
  "solana",
  "ethereum",
  "bsc",
  "base",
  "arbitrum",
  "polygon",
] as const;

export type Chain = (typeof CHAINS)[number];

export const EVM_CHAINS: readonly Chain[] = [
  "ethereum",
  "bsc",
  "base",
  "arbitrum",
  "polygon",
];

// DexScreener uses the same chain ids as our Chain type — no mapping needed.

// GoPlus numeric chain ids (EVM only; Solana uses a separate endpoint).
export const GOPLUS_CHAIN_IDS: Partial<Record<Chain, string>> = {
  ethereum: "1",
  bsc: "56",
  polygon: "137",
  arbitrum: "42161",
  base: "8453",
};

export function isChain(value: string): value is Chain {
  return (CHAINS as readonly string[]).includes(value);
}

export function isEvmChain(chain: Chain): boolean {
  return chain !== "solana";
}
