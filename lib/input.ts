// Input classification for the single search box (design doc: "Input Handling").
// Classified in order: EVM address -> Solana address -> coin name -> invalid.

import { keccak_256 } from "js-sha3";

export type InputKind = "evm-address" | "solana-address" | "name" | "invalid";

export interface ClassifiedInput {
  kind: InputKind;
  value: string; // normalized input (trimmed)
  warning?: string; // e.g. EIP-55 checksum mismatch — warn but proceed
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s\-_.$()]{0,49}$/u;

// EIP-55: an address containing both cases must match its checksum casing.
// All-lowercase or all-uppercase addresses carry no checksum and are fine.
export function isValidEip55(address: string): boolean {
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = keccak_256(hex.toLowerCase());
  for (let i = 0; i < 40; i++) {
    const char = hex[i];
    if (/[a-zA-Z]/.test(char)) {
      const shouldBeUpper = parseInt(hash[i], 16) >= 8;
      if (shouldBeUpper !== (char === char.toUpperCase())) return false;
    }
  }
  return true;
}

export function classifyInput(raw: string): ClassifiedInput {
  const value = raw.trim();
  if (!value) return { kind: "invalid", value };

  if (EVM_ADDRESS_RE.test(value)) {
    const valid = isValidEip55(value);
    return {
      kind: "evm-address",
      value,
      warning: valid
        ? undefined
        : "Address checksum looks invalid (EIP-55) — double-check for typos. Proceeding anyway.",
    };
  }

  // Anything that looks like an attempted 0x address but isn't valid hex is
  // rejected outright — never treated as a coin name.
  if (/^0x/i.test(value)) {
    return { kind: "invalid", value };
  }

  if (SOLANA_ADDRESS_RE.test(value)) {
    return { kind: "solana-address", value };
  }

  if (NAME_RE.test(value)) {
    return { kind: "name", value };
  }

  return { kind: "invalid", value };
}
