// GoPlus Security adapter — no API key required.
// Field names verified against the live API on 2026-08-21.
// EVM:    GET /api/v1/token_security/{chain_id}?contract_addresses={addr}
// Solana: GET /api/v1/solana/token_security?contract_addresses={addr}

import { GOPLUS_CHAIN_IDS, type Chain } from "../chains";
import { fetchJson, type Result } from "./fetch";

const BASE = "https://api.gopluslabs.io";

// GoPlus encodes booleans as "0"/"1" strings and percents as string fractions
// (e.g. "0.085" = 8.5%). Result map keys are the lowercased address.
export interface GoplusEvmSecurity {
  is_honeypot?: string;
  is_mintable?: string;
  is_proxy?: string;
  is_open_source?: string;
  owner_address?: string;
  hidden_owner?: string;
  can_take_back_ownership?: string;
  buy_tax?: string;
  sell_tax?: string;
  slippage_modifiable?: string;
  holder_count?: string;
  holders?: { address: string; percent: string; is_locked?: number }[];
  lp_holders?: {
    address: string;
    percent: string;
    is_locked?: number;
    is_contract?: number;
  }[];
  creator_address?: string;
  creator_percent?: string;
}

export interface GoplusSolanaSecurity {
  mintable?: { status?: string };
  freezable?: { status?: string };
  non_transferable?: string;
  default_account_state?: string;
  metadata_mutable?: { status?: string };
  transfer_fee_upgradable?: { status?: string };
  holder_count?: string;
  holders?: { account: string; percent: string; is_locked?: number }[];
  dex?: { dex_name: string; burn_percent: number | null }[];
  creators?: { address: string; percent?: string }[];
}

interface GoplusEnvelope<T> {
  code: number;
  message: string;
  result: Record<string, T>;
}

export async function getEvmTokenSecurity(
  chain: Chain,
  address: string,
): Promise<Result<GoplusEvmSecurity>> {
  const chainId = GOPLUS_CHAIN_IDS[chain];
  if (!chainId) return { ok: false, error: `GoPlus does not cover ${chain}` };
  const res = await fetchJson<GoplusEnvelope<GoplusEvmSecurity>>(
    `${BASE}/api/v1/token_security/${chainId}?contract_addresses=${address}`,
  );
  if (!res.ok) return res;
  const entry = res.data.result?.[address.toLowerCase()];
  if (!entry) return { ok: false, error: "token not found by GoPlus" };
  return { ok: true, data: entry };
}

export async function getSolanaTokenSecurity(
  address: string,
): Promise<Result<GoplusSolanaSecurity>> {
  const res = await fetchJson<GoplusEnvelope<GoplusSolanaSecurity>>(
    `${BASE}/api/v1/solana/token_security?contract_addresses=${address}`,
  );
  if (!res.ok) return res;
  const entry = res.data.result?.[address];
  if (!entry) return { ok: false, error: "token not found by GoPlus" };
  return { ok: true, data: entry };
}
