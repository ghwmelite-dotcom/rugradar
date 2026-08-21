// GET /api/image?u=<url>
// Same-origin proxy for token images. Browsers with ad-blockers/privacy
// shields block third-party crypto CDNs (cdn.dexscreener.com), which broke
// trending/report token icons. Proxying through our own origin avoids that.
//
// SSRF guard: only https URLs on an explicit host allowlist are fetched.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set(["cdn.dexscreener.com"]);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid image URL." }, { status: 400 });
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: "Host not allowed." }, { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}.` },
        { status: 502 },
      );
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "Upstream did not return an image." },
        { status: 502 },
      );
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        // Token icons change rarely; cache at the edge and in the browser.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image fetch failed." }, { status: 502 });
  }
}
