import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  hmacHex,
  passwordsMatch,
  SESSION_TTL_MS,
  signSession,
  verifySession,
} from "./admin-auth";

const SECRET = "test-admin-secret";

describe("hmacHex", () => {
  it("produces a 64-char lowercase hex digest", async () => {
    const sig = await hmacHex(SECRET, "12345");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and key-sensitive", async () => {
    const a = await hmacHex(SECRET, "msg");
    expect(await hmacHex(SECRET, "msg")).toBe(a);
    expect(await hmacHex("other-secret", "msg")).not.toBe(a);
    expect(await hmacHex(SECRET, "msg2")).not.toBe(a);
  });
});

describe("signSession / verifySession", () => {
  const NOW = 1_800_000_000_000;

  it("round-trips a freshly signed session", async () => {
    const { value, expiresAt } = await signSession(SECRET, NOW);
    expect(expiresAt).toBe(NOW + SESSION_TTL_MS);
    expect(value).toBe(`${expiresAt}.${await hmacHex(SECRET, String(expiresAt))}`);
    await expect(verifySession(value, SECRET, NOW)).resolves.toBe(true);
  });

  it("rejects an expired session", async () => {
    const { value } = await signSession(SECRET, NOW);
    await expect(
      verifySession(value, SECRET, NOW + SESSION_TTL_MS),
    ).resolves.toBe(false);
  });

  it("rejects a session signed with a different secret", async () => {
    const { value } = await signSession(SECRET, NOW);
    await expect(verifySession(value, "wrong-secret", NOW)).resolves.toBe(
      false,
    );
  });

  it("rejects a tampered expiry (signature no longer matches)", async () => {
    const { value } = await signSession(SECRET, NOW);
    const tampered = value.replace(/^\d+/, String(NOW + 999_999_999));
    await expect(verifySession(tampered, SECRET, NOW)).resolves.toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const { value } = await signSession(SECRET, NOW);
    const flipped = `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
    await expect(verifySession(flipped, SECRET, NOW)).resolves.toBe(false);
  });

  it("rejects malformed values", async () => {
    await expect(verifySession(undefined, SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession("", SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession("no-dot-here", SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession(".sig", SECRET, NOW)).resolves.toBe(false);
    await expect(verifySession("abc.def", SECRET, NOW)).resolves.toBe(false);
    // Valid expiry but garbage (non-hex / wrong-length) signature.
    await expect(
      verifySession(`${NOW + 1000}.nothex`, SECRET, NOW),
    ).resolves.toBe(false);
  });
});

describe("passwordsMatch", () => {
  it("accepts the exact password", async () => {
    await expect(passwordsMatch("hunter2", "hunter2")).resolves.toBe(true);
  });

  it("rejects different passwords, including length-mismatched ones", async () => {
    await expect(passwordsMatch("hunter2", "hunter3")).resolves.toBe(false);
    await expect(passwordsMatch("hunter2", "hunter2-longer")).resolves.toBe(
      false,
    );
    await expect(passwordsMatch("", "hunter2")).resolves.toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("compares equal-length strings by content", () => {
    expect(constantTimeEqual("aaaa", "aaaa")).toBe(true);
    expect(constantTimeEqual("aaaa", "aaab")).toBe(false);
    expect(constantTimeEqual("aaaa", "aaaaa")).toBe(false);
  });
});
