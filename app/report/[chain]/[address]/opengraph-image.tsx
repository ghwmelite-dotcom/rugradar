// Dynamic OG score card for shared report links (roadmap F1).
// Rendered with next/og ImageResponse (Satori) — runs on Workers via
// OpenNext. The route must NEVER 500: any failure renders a generic
// branded card instead.

import { ImageResponse } from "next/og";
import { isChain } from "@/lib/chains";
import { scanToken, type ScanResult } from "@/lib/scan";
import type { Band } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const alt = "RugRadar token risk report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SITE_HOST = "rugradar.trademetricspro.com";
const BG = "#05080d";

const BAND_COLORS: Record<Band, string> = {
  AVOID: "#f87171",
  CAUTION: "#facc15",
  LOWER_RISK: "#34d399",
};

const BAND_TEXT: Record<Band, string> = {
  AVOID: "AVOID",
  CAUTION: "CAUTION",
  LOWER_RISK: "LOWER RISK",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Wordmark({ fontSize }: { fontSize: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize,
        fontWeight: 700,
        color: "#f4f4f5",
        letterSpacing: -1,
      }}
    >
      Rug<span style={{ color: "#34d399" }}>Radar</span>
    </div>
  );
}

function FooterRow() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 22,
        color: "#52525b",
      }}
    >
      <div>{SITE_HOST}</div>
      <div>Not financial advice</div>
    </div>
  );
}

function ScoreCard({ data }: { data: ScanResult }) {
  const { report, score } = data;
  const bandColor = score.band ? BAND_COLORS[score.band] : "#a1a1aa";
  const bandText = score.band ? BAND_TEXT[score.band] : "UNSCORED";
  // Up to 3 top flags as plain text; the composite honeypot flag is always
  // first in score.flags, so the strongest warning leads the card.
  const flags = score.flags.slice(0, 3).map((f) => truncate(f.text, 110));
  const lines =
    flags.length > 0
      ? flags
      : score.scored
        ? ["No red flags detected in the available data — not the same as safe."]
        : ["Security data unavailable — no numeric score."];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Wordmark fontSize={40} />
        <div
          style={{
            display: "flex",
            borderRadius: 8,
            border: "1px solid #3f3f46",
            padding: "6px 16px",
            fontSize: 22,
            color: "#d4d4d8",
          }}
        >
          {report.chain}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          gap: 48,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 24,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              color: "#fafafa",
            }}
          >
            {truncate(report.name ?? "Unknown token", 24)}
            {report.symbol ? (
              <span
                style={{ color: "#71717a", fontWeight: 400, marginLeft: 16 }}
              >
                {truncate(`$${report.symbol}`, 16)}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                borderRadius: 999,
                border: `2px solid ${bandColor}`,
                color: bandColor,
                padding: "10px 28px",
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              {bandText}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lines.map((line, i) => (
              <div
                key={i}
                style={{ display: "flex", fontSize: 24, color: "#a1a1aa" }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 200,
              fontWeight: 700,
              color: bandColor,
              lineHeight: 1,
            }}
          >
            {score.score ?? "—"}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#71717a" }}>
            / 100
          </div>
        </div>
      </div>

      <FooterRow />
    </div>
  );
}

// Generic branded card — used for invalid input, scan failure, or renderer
// fallback. No data dependencies, so it cannot fail on bad token data.
function FallbackCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
        }}
      >
        <Wordmark fontSize={72} />
        <div style={{ display: "flex", fontSize: 36, color: "#a1a1aa" }}>
          Memecoin risk scanner — scan before you ape.
        </div>
      </div>
      <FooterRow />
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;

  let data: ScanResult | null = null;
  if (isChain(chain) && address) {
    try {
      data = await scanToken(chain, address);
    } catch {
      data = null; // fall through to the generic branded card
    }
  }

  try {
    return new ImageResponse(
      data ? <ScoreCard data={data} /> : <FallbackCard />,
      { ...size },
    );
  } catch {
    // Last resort: the score card itself failed to render.
    return new ImageResponse(<FallbackCard />, { ...size });
  }
}
