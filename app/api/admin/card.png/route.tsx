// GET /api/admin/card.png?date=…&scanned=…&honeypots=…&flagcount=…&riskiest=…&riskline=…
// Daily Rug Report card (1200×675, X-optimized) for the /admin content
// vault. Ported from outputs/x/daily-card.html to next/og ImageResponse
// (Satori): inline styles only, no external fonts/images — the radar glyph
// is drawn with bordered divs instead of the SVG icon. Auth-gated: the
// card can quote internal feed stats, so it shares the vault's session.

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 675 };

const BG = "#05080d";
const CYAN = "#00e5ff";
const GREEN = "#00ff9d";
const RED = "#ff5c5c";
const AMBER = "#facc15";

// Card params come from editable dashboard fields — clamp hard: no
// newlines (Satori lays out whatever it gets), collapsed whitespace,
// capped lengths so a paste accident can't wreck the layout.
function cleanText(value: string | null, max: number): string {
  return (value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanInt(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 99999);
}

interface CardProps {
  date: string;
  scanned: number;
  honeypots: number;
  flagCount: number;
  riskiest: string;
  riskline: string;
}

function RadarGlyph() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 52,
        height: 52,
        borderRadius: 999,
        border: `2px solid ${CYAN}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: 999,
          border: "2px solid rgba(0,229,255,.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: GREEN,
          }}
        />
      </div>
    </div>
  );
}

function StatTile({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        backgroundColor: "#0b0f14",
        border: "1px solid #1f2937",
        borderRadius: 16,
        padding: 28,
      }}
    >
      <div
        style={{ display: "flex", fontSize: 64, fontWeight: 900, color }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 19,
          color: "#a1a1aa",
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Card({ date, scanned, honeypots, flagCount, riskiest, riskline }: CardProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        color: "#e4e4e7",
        fontFamily: "sans-serif",
        padding: "56px 64px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* radar ring decor */}
      <div
        style={{
          position: "absolute",
          right: -150,
          top: -150,
          width: 500,
          height: 500,
          borderRadius: 999,
          border: "2px solid rgba(0,229,255,.25)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -80,
          top: -80,
          width: 360,
          height: 360,
          borderRadius: 999,
          border: "2px solid rgba(0,229,255,.15)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -10,
          top: -10,
          width: 220,
          height: 220,
          borderRadius: 999,
          border: "2px solid rgba(0,229,255,.08)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 60,
          width: 22,
          height: 22,
          borderRadius: 999,
          backgroundColor: RED,
          boxShadow: `0 0 24px ${RED}`,
        }}
      />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <RadarGlyph />
        <div
          style={{
            display: "flex",
            fontSize: 34,
            fontWeight: 900,
            color: "#f4f4f5",
          }}
        >
          Rug<span style={{ color: GREEN }}>Radar</span>
        </div>
        <div
          style={{
            display: "flex",
            marginLeft: "auto",
            fontSize: 20,
            color: "#a1a1aa",
            letterSpacing: 2,
          }}
        >
          DAILY RUG REPORT
        </div>
      </div>

      <div
        style={{
          display: "flex",
          marginTop: 18,
          fontSize: 22,
          color: "#71717a",
        }}
      >
        {date}
      </div>

      {/* stats row */}
      <div style={{ display: "flex", gap: 28, marginTop: 44 }}>
        <StatTile value={scanned} label="tokens scanned (24h)" color={CYAN} />
        <StatTile value={honeypots} label="honeypots caught" color={RED} />
        <StatTile
          value={flagCount}
          label="red flags on riskiest token"
          color={AMBER}
        />
      </div>

      {/* worst offender */}
      <div
        style={{
          display: "flex",
          marginTop: 40,
          backgroundColor: "rgba(255,92,92,.08)",
          border: "1px solid rgba(255,92,92,.35)",
          borderRadius: 16,
          padding: "24px 28px",
        }}
      >
        {riskiest ? (
          <div style={{ display: "flex", fontSize: 22, color: "#d4d4d8" }}>
            <span style={{ fontWeight: 700, color: RED, fontSize: 24 }}>
              {`Riskiest today: ${riskiest}`}
            </span>
            <span>{riskline ? ` — ${riskline}.` : "."}</span>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 22, color: "#d4d4d8" }}>
            <span style={{ fontWeight: 700, color: RED, fontSize: 24 }}>
              Quiet window
            </span>
            <span> — no scored tokens in the feed yet.</span>
          </div>
        )}
      </div>

      {/* footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "auto",
          fontSize: 20,
          color: "#71717a",
        }}
      >
        <div style={{ display: "flex" }}>
          Scan before you ape —{" "}
          <span style={{ color: GREEN }}>rugradar.trademetricspro.com</span>
        </div>
        <div style={{ display: "flex" }}>Not financial advice</div>
      </div>
    </div>
  );
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const props: CardProps = {
    date: cleanText(sp.get("date"), 40) || "Today",
    scanned: cleanInt(sp.get("scanned")),
    honeypots: cleanInt(sp.get("honeypots")),
    flagCount: cleanInt(sp.get("flagcount")),
    riskiest: cleanText(sp.get("riskiest"), 24),
    riskline: cleanText(sp.get("riskline"), 160),
  };

  return new ImageResponse(<Card {...props} />, { ...SIZE });
}
