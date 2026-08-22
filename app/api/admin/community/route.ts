// GET  /api/admin/community — the Community Beacon pack for the configured
//        champion token ($CATE): verdict, champion/contrast/rally posts,
//        raid replies, card + report URLs. { config: null } when unset.
// POST /api/admin/community — save the champion config { chain, address,
//        label }. Auth-gated both ways; the address is operator-supplied
//        (we never guess a community's contract).

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { isChain } from "@/lib/chains";
import {
  getCommunityConfig,
  getCommunityPack,
  saveCommunityConfig,
} from "@/lib/community";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const config = await getCommunityConfig();
  if (!config) {
    return NextResponse.json({ config: null, pack: null });
  }
  try {
    const pack = await getCommunityPack();
    return NextResponse.json({ config, pack });
  } catch {
    return NextResponse.json({
      config,
      pack: null,
      error: "Failed to build the community pack — try again shortly.",
    });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { chain?: string; address?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const chain = body.chain ?? "";
  const address = (body.address ?? "").trim();
  const label = (body.label ?? "").trim() || "$CATE";

  if (!isChain(chain)) {
    return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });
  }
  if (address.length < 20 || address.length > 64 || /\s/.test(address)) {
    return NextResponse.json(
      { error: "That doesn't look like a contract address." },
      { status: 400 },
    );
  }
  if (label.length > 24) {
    return NextResponse.json({ error: "Label too long." }, { status: 400 });
  }

  await saveCommunityConfig({ chain, address, label });
  return NextResponse.json({ ok: true, config: { chain, address, label } });
}
