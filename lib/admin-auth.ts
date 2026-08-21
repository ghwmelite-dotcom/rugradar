// Admin session auth for the /admin content vault (hidden, unlinked URL).
//
// Model: a single shared password in the ADMIN_PASSWORD Worker secret
// (`pnpm wrangler secret put ADMIN_PASSWORD` in prod; `.dev.vars` in dev —
// OpenNext dev also surfaces it on process.env). A correct login mints a
// stateless session cookie: `${expiryMs}.${hmac}` where hmac is
// HMAC-SHA256(hex) of the expiry string, keyed with ADMIN_PASSWORD. No
// server-side session store; rotation of the secret invalidates all
// sessions, which is the desired behavior for a single-operator vault.
//
// The sign/verify/compare helpers below are pure (secret passed in) so they
// run under vitest without a request context; isAdmin() is the only piece
// that touches next/headers.

import { getCloudflareContext } from "@opennextjs/cloudflare";

export const ADMIN_COOKIE = "rr_admin";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// HMAC-SHA256 of `message` keyed with `secret`, hex-encoded. Web Crypto
// only — runs identically on Workers (nodejs_compat) and in Node >= 19.
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

// Constant-time-ish string compare: fixed-length inputs only (callers hash
// first), and no early exit on the first differing byte.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Length-normalizing password check: both sides are HMAC'd with a fixed
// (non-secret) key first, so neither the password's length nor its content
// leaks through timing, and the compare runs on equal-length hex digests.
export async function passwordsMatch(
  input: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    hmacHex("rr-admin-password-compare", input),
    hmacHex("rr-admin-password-compare", expected),
  ]);
  return constantTimeEqual(a, b);
}

// Mint a session cookie value. `now` is injectable for tests.
export async function signSession(
  secret: string,
  now: number = Date.now(),
): Promise<{ value: string; expiresAt: number }> {
  const expiresAt = now + SESSION_TTL_MS;
  const sig = await hmacHex(secret, String(expiresAt));
  return { value: `${expiresAt}.${sig}`, expiresAt };
}

// Verify a session cookie value: shape, expiry, and HMAC. `now` injectable.
export async function verifySession(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expiryText = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = await hmacHex(secret, expiryText);
  return constantTimeEqual(sig, expected);
}

// Resolve ADMIN_PASSWORD: Worker secret via the Cloudflare context first,
// process.env fallback (OpenNext dev populates it from .dev.vars).
export function getAdminSecret(): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as {
      ADMIN_PASSWORD?: string;
    };
    if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
  } catch {
    // Not in a Cloudflare request context (plain node, tests).
  }
  return process.env.ADMIN_PASSWORD || undefined;
}

// Server-side gate for /admin pages and /api/admin/* routes. Returns false
// when the secret is not configured (vault closed) or the cookie is
// missing/invalid/expired.
export async function isAdmin(): Promise<boolean> {
  const secret = getAdminSecret();
  if (!secret) return false;
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return verifySession(store.get(ADMIN_COOKIE)?.value, secret);
  } catch {
    return false;
  }
}
