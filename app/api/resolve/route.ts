// GET /api/resolve?q=<input>
// Classifies the search-box input and resolves it to a chain+address or a
// disambiguation picker, per the design doc's input-handling rules.

import { NextRequest, NextResponse } from "next/server";
import { resolveInput } from "@/lib/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ error: "Empty query." }, { status: 400 });
  }
  try {
    const result = await resolveInput(q);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { kind: "error", error: err instanceof Error ? err.message : "Resolve failed." },
      { status: 500 },
    );
  }
}
