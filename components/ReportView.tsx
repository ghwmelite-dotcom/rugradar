"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ScoreDial } from "./ScoreDial";
import { SearchBox } from "./SearchBox";
import type { ScanResult } from "@/lib/scan";
import type { CategoryKey } from "@/lib/scoring";
import { CATEGORY_LABELS } from "@/lib/scoring";

const BAND_STYLES: Record<string, string> = {
  AVOID: "bg-red-500/15 text-red-400 border-red-500/40",
  CAUTION: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
  LOWER_RISK: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
};

const BAND_TEXT: Record<string, string> = {
  AVOID: "AVOID",
  CAUTION: "CAUTION",
  LOWER_RISK: "LOWER RISK",
};

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(4)}`;
}

function fmtAge(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = hours / 24;
  if (days < 365) return `${Math.round(days)}d`;
  return `${(days / 365).toFixed(1)}y`;
}

function CategoryBar({
  category,
  available,
  score,
}: {
  category: CategoryKey;
  available: boolean;
  score: number | null;
}) {
  const color =
    score === null
      ? "bg-zinc-700"
      : score >= 70
        ? "bg-emerald-400"
        : score >= 40
          ? "bg-yellow-400"
          : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-300">{CATEGORY_LABELS[category]}</span>
        <span className="text-zinc-500">
          {available && score !== null ? `${score}/100` : "data unavailable"}
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        {available && score !== null && (
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${score}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function ReportView({
  chain,
  address,
}: {
  chain: string;
  address: string;
}) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/scan?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as ScanResult;
      })
      .then((result) => !cancelled && setData(result))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [chain, address]);

  return (
    <div className="space-y-6">
      <SearchBox />

      {!data && !error && (
        <div className="text-center py-16 space-y-3">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
          <p className="text-sm text-zinc-400">
            Scanning {chain}… this can take a few seconds.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Scan failed: {error}
        </div>
      )}

      {data && <Report data={data} />}
    </div>
  );
}

function Report({ data }: { data: ScanResult }) {
  const { report, score } = data;
  const failed = report.providers.filter((p) => !p.ok);
  const categories: CategoryKey[] = ["contractSafety", "liquidity", "holders"];

  return (
    <div className="space-y-6">
      {failed.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Partial report — some data sources failed (
          {failed.map((p) => `${p.provider}: ${p.error}`).join("; ")}).
          Missing categories are excluded from the score.
        </div>
      )}

      {/* header */}
      <div className="flex items-center gap-3">
        {report.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={report.imageUrl} alt="" className="h-12 w-12 rounded-full" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-zinc-800" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">
            {report.name ?? "Unknown token"}{" "}
            <span className="text-zinc-500 font-normal">{report.symbol ?? ""}</span>
          </h1>
          <p className="text-xs text-zinc-500 truncate">{report.address}</p>
        </div>
        <span className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
          {report.chain}
        </span>
      </div>

      {/* score */}
      <div className="flex flex-col sm:flex-row items-center gap-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <ScoreDial score={score.score} band={score.band} />
        <div className="flex-1 space-y-3 text-center sm:text-left">
          {score.scored && score.band ? (
            <>
              <span
                className={`inline-block rounded-full border px-4 py-1 text-sm font-bold ${BAND_STYLES[score.band]}`}
              >
                {BAND_TEXT[score.band]}
              </span>
              {score.honeypotOverride && (
                <p className="text-sm font-semibold text-red-400">
                  Honeypot — score forced to 0.
                </p>
              )}
              <p className="text-xs text-zinc-500">
                Score based on {score.coverage} of 3 risk categories
                {score.cap !== null && score.cap < 100
                  ? ` (capped at ${score.cap} for partial coverage)`
                  : ""}
                . Never a recommendation to buy.
              </p>
            </>
          ) : (
            <>
              <span className="inline-block rounded-full border border-zinc-600 bg-zinc-800 px-4 py-1 text-sm font-bold text-zinc-300">
                UNSCORED
              </span>
              <p className="text-sm text-zinc-400">
                Security data unavailable — no numeric score. Market context
                below is informational only.
              </p>
            </>
          )}
          <div className="space-y-2 pt-1">
            {categories.map((c) => (
              <CategoryBar
                key={c}
                category={c}
                available={score.categories[c].available}
                score={score.categories[c].score}
              />
            ))}
          </div>
        </div>
      </div>

      {/* flags */}
      {score.flags.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Red flags ({score.flags.length})
          </h2>
          <ul className="space-y-1.5">
            {score.flags.map((f, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm"
              >
                <span className={f.deduction >= 25 ? "text-red-400" : "text-amber-400"}>
                  −{f.deduction}
                </span>
                <span className="text-zinc-200">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        score.scored && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            No red flags detected in the available data. That is not the same
            as safe — new risks can appear at any time.
          </p>
        )
      )}

      {/* market context */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Market context <span className="normal-case font-normal">(informational — never moves the score)</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ["Price", fmtPrice(report.priceUsd)],
            ["Liquidity", fmtUsd(report.liquidityUsd)],
            ["24h volume", fmtUsd(report.volume24h)],
            ["Pair age", fmtAge(report.pairAgeHours)],
            ["DEX pairs", report.dexCount?.toString() ?? "—"],
            [
              "Holders",
              report.holderCount !== null
                ? report.holderCount.toLocaleString()
                : "—",
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
            >
              <div className="text-xs text-zinc-500">{label}</div>
              <div className="text-sm font-medium">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-800 pt-4">
        <span>
          Scanned at {new Date(report.scannedAt).toLocaleString()} · share this
          URL to warn others
        </span>
        <Link href="/" className="text-emerald-400 hover:underline">
          Scan another
        </Link>
      </div>

      <p className="text-xs text-zinc-600">
        Not financial advice. MemeScanner flags red flags from public on-chain
        data — it cannot predict price.
      </p>
    </div>
  );
}
