// POST /api/admin/login { password }
// On match, mints the rr_admin session cookie (HttpOnly, Secure,
// SameSite=Lax, 7 days — see lib/admin-auth.ts). Returns 503 when
// ADMIN_PASSWORD is not configured so the operator gets a clear message
// instead of a mysteriously always-failing login.

import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  getAdminSecret,
  passwordsMatch,
  signSession,
} from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Throttle login attempts (30/min per IP via the Workers binding, in-memory
// fallback in dev) — the shared-password model must not be brute-forceable.
async function loginLimited(ip: string): Promise<boolean> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as {
      SCAN_RATE_LIMITER?: RateLimitBinding;
    };
    if (env.SCAN_RATE_LIMITER) {
      const { success } = await env.SCAN_RATE_LIMITER.limit({
        key: `login:${ip}`,
      });
      return !success;
    }
  } catch {
    // fall through to in-memory
  }
  return !checkRateLimit(`login:${ip}`).allowed;
}

export async function POST(req: NextRequest) {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "ADMIN_PASSWORD is not configured on this server. Set it with `pnpm wrangler secret put ADMIN_PASSWORD` (prod) or in .dev.vars (dev).",
      },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (await loginLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts — try again in a minute." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body: unknown = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as { password?: unknown }).password === "string"
    ) {
      password = (body as { password: string }).password;
    }
  } catch {
    // Malformed JSON — treated as a failed login below.
  }

  if (!password || !(await passwordsMatch(password, secret))) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const { value, expiresAt } = await signSession(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
  return res;
}
