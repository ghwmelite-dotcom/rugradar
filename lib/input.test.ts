import { describe, expect, it } from "vitest";
import { classifyInput, isValidEip55 } from "./input";

describe("classifyInput", () => {
  it("classifies a lowercase EVM address with no warning", () => {
    const r = classifyInput("0x6982508145454ce325ddbe47a25d4ec3d2311933");
    expect(r.kind).toBe("evm-address");
    expect(r.warning).toBeUndefined();
  });

  it("classifies an all-uppercase EVM address with no warning", () => {
    const r = classifyInput("0x6982508145454CE325DDBE47A25D4EC3D2311933");
    expect(r.kind).toBe("evm-address");
    expect(r.warning).toBeUndefined();
  });

  it("accepts a valid EIP-55 checksummed address with no warning", () => {
    const r = classifyInput("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(r.kind).toBe("evm-address");
    expect(r.warning).toBeUndefined();
  });

  it("warns but proceeds on a mixed-case EIP-55-invalid address", () => {
    const r = classifyInput("0x5aaeB6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(r.kind).toBe("evm-address");
    expect(r.warning).toMatch(/checksum/i);
  });

  it("classifies a Solana base58 address", () => {
    const r = classifyInput("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(r.kind).toBe("solana-address");
    expect(r.warning).toBeUndefined();
  });

  it("classifies a plain coin name", () => {
    expect(classifyInput("pepe").kind).toBe("name");
    expect(classifyInput("dogwifhat").kind).toBe("name");
    expect(classifyInput("HarryPotterObamaSonic10Inu").kind).toBe("name");
  });

  it("trims surrounding whitespace", () => {
    const r = classifyInput("  pepe  ");
    expect(r.kind).toBe("name");
    expect(r.value).toBe("pepe");
  });

  it("rejects invalid input (no API fan-out)", () => {
    expect(classifyInput("").kind).toBe("invalid");
    expect(classifyInput("   ").kind).toBe("invalid");
    expect(classifyInput("0x123").kind).toBe("invalid");
    expect(classifyInput("!!!").kind).toBe("invalid");
    expect(classifyInput("0xZZ82508145454Ce325dDbE47a25d4ec3d2311933").kind).toBe("invalid");
  });
});

describe("isValidEip55", () => {
  it("validates known EIP-55 test vectors", () => {
    expect(isValidEip55("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(true);
    expect(isValidEip55("0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")).toBe(true);
    expect(isValidEip55("0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB")).toBe(true);
    expect(isValidEip55("0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb")).toBe(true);
  });
});
