// GET /api/trending — cached trending feed (5 min global TTL).

import { NextResponse } from "next/server";
import { getTrending } from "@/lib/trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getTrending();
  return NextResponse.json({ items });
}
