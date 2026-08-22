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
const CYAN = "#00e5ff";
const GREEN = "#00ff9d";

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

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toPrecision(3)}`;
}

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m old`;
  if (hours < 48) return `${Math.round(hours)}h old`;
  const days = hours / 24;
  if (days >= 365) return `${(days / 365).toFixed(1)}y old`;
  return `${Math.round(days)}d old`;
}

// Concentric radar rings behind the score — the brand mark, faded back.
function RadarRings({ color }: { color: string }) {
  const sizes = [560, 400, 240];
  return (
    <div
      style={{
        position: "absolute",
        right: -140,
        top: -100,
        width: 560,
        height: 560,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {sizes.map((s) => (
        <div
          key={s}
          style={{
            position: "absolute",
            width: s,
            height: s,
            borderRadius: 9999,
            border: `2px solid ${color}`,
            opacity: 0.12,
          }}
        />
      ))}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        border: "1px solid #27272a",
        backgroundColor: "#0b0f16",
        padding: "10px 18px",
        gap: 2,
      }}
    >
      <div style={{ display: "flex", fontSize: 18, color: "#52525b" }}>
        {label}
      </div>
      <div
        style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#e4e4e7" }}
      >
        {value}
      </div>
    </div>
  );
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
  // Up to 2 top flags as plain text; the composite honeypot flag is always
  // first in score.flags, so the strongest warning leads the card.
  const flags = score.flags.slice(0, 2).map((f) => truncate(f.text, 100));
  const lines =
    flags.length > 0
      ? flags
      : score.scored
        ? ["No red flags detected in the available data — not the same as safe."]
        : ["Security data unavailable — no numeric score."];

  // Market stat chips — only the stats we actually have.
  const chips: { label: string; value: string }[] = [];
  if (report.priceUsd != null) chips.push({ label: "PRICE", value: fmtPrice(report.priceUsd) });
  if (report.liquidityUsd != null)
    chips.push({ label: "LIQUIDITY", value: fmtUsd(report.liquidityUsd) });
  if (report.volume24h != null)
    chips.push({ label: "VOLUME 24H", value: fmtUsd(report.volume24h) });
  if (report.pairAgeHours != null)
    chips.push({ label: "AGE", value: fmtAge(report.pairAgeHours) });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        padding: 56,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      {/* Brand gradient bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundImage: `linear-gradient(90deg, ${CYAN}, ${GREEN})`,
        }}
      />
      <RadarRings color={CYAN} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Wordmark fontSize={38} />
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
          gap: 40,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 18,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 800,
              color: bandColor,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {report.symbol
              ? truncate(`$${report.symbol}`, 14)
              : truncate(report.name ?? "Unknown token", 16)}
          </div>
          {report.symbol && report.name ? (
            <div
              style={{ display: "flex", fontSize: 28, color: "#71717a", marginTop: -8 }}
            >
              {truncate(report.name, 30)}
            </div>
          ) : null}
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                borderRadius: 999,
                border: `2px solid ${bandColor}`,
                backgroundColor: `${bandColor}1a`,
                color: bandColor,
                padding: "8px 26px",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {bandText}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lines.map((line, i) => (
              <div
                key={i}
                style={{ display: "flex", fontSize: 23, color: "#a1a1aa" }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Score ring */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 230,
              height: 230,
              borderRadius: 9999,
              border: `10px solid ${bandColor}`,
              backgroundColor: "#0b0f16",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 96,
                fontWeight: 800,
                color: bandColor,
                lineHeight: 1,
              }}
            >
              {score.score ?? "—"}
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#52525b" }}>
              / 100
            </div>
          </div>
        </div>
      </div>

      {chips.length > 0 ? (
        <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
          {chips.slice(0, 4).map((c) => (
            <StatChip key={c.label} label={c.label} value={c.value} />
          ))}
        </div>
      ) : null}

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
