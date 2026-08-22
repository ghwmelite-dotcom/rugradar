// GET /api/admin/viral
// Auth-gated Viral Radar payload for the /admin vault: today's hottest
// tokens (DexScreener boosts), each scanned and captioned, plus the
// combined digest post. The whole payload is KV-cached for 15 minutes
// (see lib/viral.ts) so reloads are free.

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getViralPicks } from "@/lib/viral";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const data = await getViralPicks();
    return NextResponse.json(data);
  } catch {
    // Provider outage — the vault must never hard-fail; the UI shows the
    // empty state and the operator can retry after the 15min cache window.
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        today: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        picks: [],
        digest: null,
      },
      { status: 200 },
    );
  }
}
