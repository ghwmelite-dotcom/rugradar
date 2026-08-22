"use client";

// Viral Radar — the vault's trend-riding engine. Pulls /api/admin/viral
// (KV-cached 15min server-side): tokens heating up on DexScreener right
// now, each with a heat score, the radar's verdict, a ready-to-post
// caption and the token's OG score card as the attachable image.
//
// Flow per pick: Download card PNG → Post to X → attach PNG → post the
// link reply underneath. Links never live in the main post (X algo).

import { useEffect, useState } from "react";
import type { ViralPick, ViralRadarData } from "@/lib/viral";
import { PostBlock, Section } from "./ui";

function verdictStyle(pick: ViralPick): { text: string; className: string } {
  const v = pick.verdict;
  if (!v) {
    return {
      text: "SCAN INCOMPLETE",
      className: "border-zinc-600 text-zinc-400",
    };
  }
  if (v.honeypot || v.band === "AVOID") {
    return {
      text: `${v.score ?? "—"}/100 · AVOID`,
      className: "border-red-500/60 text-red-400",
    };
  }
  if (v.band === "CAUTION") {
    return {
      text: `${v.score ?? "—"}/100 · CAUTION`,
      className: "border-yellow-500/60 text-yellow-400",
    };
  }
  if (v.band === "LOWER_RISK") {
    return {
      text: `${v.score ?? "—"}/100 · LOWER RISK`,
      className: "border-emerald-500/60 text-emerald-400",
    };
  }
  return { text: "UNSCORED", className: "border-zinc-600 text-zinc-400" };
}

function heatColor(heat: number): string {
  if (heat >= 70) return "bg-red-500";
  if (heat >= 40) return "bg-orange-400";
  return "bg-yellow-500";
}

function PickCard({ pick }: { pick: ViralPick }) {
  const verdict = verdictStyle(pick);
  const tokenIcon = pick.imageUrl
    ? `/api/image?u=${encodeURIComponent(pick.imageUrl)}`
    : null;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-3">
        {tokenIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tokenIcon}
            alt=""
            className="h-9 w-9 rounded-full border border-zinc-800"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 text-xs text-zinc-500">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {pick.name ?? "Unknown"}
            {pick.symbol && (
              <span className="ml-1.5 font-normal text-zinc-500">
                ${pick.symbol}
              </span>
            )}
          </p>
          <p className="text-[11px] capitalize text-zinc-500">{pick.chain}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${verdict.className}`}
        >
          {verdict.text}
        </span>
      </div>

      {/* Heat meter + drivers */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Viral heat</span>
          <span className="font-semibold text-zinc-300">{pick.heat}/100</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full ${heatColor(pick.heat)}`}
            style={{ width: `${pick.heat}%` }}
          />
        </div>
        {pick.drivers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {pick.drivers.map((d) => (
              <span
                key={d}
                className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-400"
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      <PostBlock post={pick.post} />

      <div className="flex flex-wrap gap-2">
        <a
          href={pick.cardUrl}
          download={`rugradar-${pick.symbol ?? pick.address}-card.png`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
        >
          Download score card
        </a>
        <a
          href={pick.reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
        >
          Open report
        </a>
      </div>
    </div>
  );
}

export function ViralRadar() {
  const [data, setData] = useState<ViralRadarData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/viral")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as ViralRadarData;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Section
      title="Viral Radar"
      hint="Tokens going viral right now, auto-scanned and captioned. Ride the wave: download the score card, Post to X, attach it, then drop the link reply underneath. Refreshes every 15 minutes."
    >
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          Failed to load Viral Radar: {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-zinc-400">Scanning the trend horizon…</p>
      )}
      {data && data.picks.length === 0 && !error && (
        <p className="text-xs text-zinc-500">
          Nothing heating up above the noise floor right now — check back in
          15 minutes.
        </p>
      )}

      {data && data.digest && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300">
            Today&apos;s heat-check digest
          </h3>
          <PostBlock post={data.digest} />
        </div>
      )}

      {data && data.picks.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.picks.map((pick) => (
            <PickCard key={`${pick.chain}:${pick.address}`} pick={pick} />
          ))}
        </div>
      )}

      {data && (
        <p className="text-[10px] text-zinc-600">
          Generated {new Date(data.generatedAt).toLocaleTimeString()} · cached
          15 min · heat = promotion + volume + momentum + buy pressure +
          freshness.
        </p>
      )}
    </Section>
  );
}
