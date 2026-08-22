// Public Viral Radar board (/viral). Server-rendered from getViralPicks()
// (KV-cached 15min) — the same detection engine that powers the admin
// vault, minus the copy tooling. Every card links to the token's full
// report, so each share of the board unfurls into branded score cards.

import Link from "next/link";
import { proxiedImage } from "@/lib/imageProxy";
import type { ViralPick, ViralRadarData } from "@/lib/viral";

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

function verdictBadge(pick: ViralPick) {
  const v = pick.verdict;
  if (!v || v.band === null) {
    return (
      <span className="inline-block rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-zinc-400">
        {v ? "UNSCORED" : "SCAN PENDING"}
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded-full border px-3 py-1 text-[11px] font-bold ${BAND_STYLES[v.band]}`}
    >
      {v.score ?? "—"}/100 · {v.honeypot ? "HONEYPOT" : BAND_TEXT[v.band]}
    </span>
  );
}

function heatBarColor(heat: number): string {
  if (heat >= 70) return "bg-gradient-to-r from-orange-400 to-red-500";
  if (heat >= 40) return "bg-gradient-to-r from-yellow-400 to-orange-400";
  return "bg-yellow-500/70";
}

function PickCard({ pick }: { pick: ViralPick }) {
  const icon = proxiedImage(pick.imageUrl);
  const topFlag = pick.verdict?.flags[0] ?? null;

  return (
    <Link
      href={`/report/${pick.chain}/${pick.address}`}
      className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-zinc-900/50 p-4 transition-colors hover:border-brand-cyan/40"
    >
      <div className="flex items-center gap-3">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={icon}
            alt=""
            className="h-10 w-10 rounded-full border border-white/10"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-xs text-zinc-500">
            ?
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {pick.name ?? "Unknown token"}
          </p>
          <p className="text-xs text-zinc-500">
            {pick.symbol ? `$${pick.symbol} · ` : ""}
            <span className="capitalize">{pick.chain}</span>
          </p>
        </div>
        {verdictBadge(pick)}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="uppercase tracking-wider text-zinc-500">
            Viral heat
          </span>
          <span className="font-semibold text-zinc-300">{pick.heat}/100</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full ${heatBarColor(pick.heat)}`}
            style={{ width: `${pick.heat}%` }}
          />
        </div>
        {pick.drivers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {pick.drivers.map((d) => (
              <span
                key={d}
                className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-zinc-400"
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>

      {topFlag && (
        <p className="text-xs leading-relaxed text-zinc-400">
          <span className="text-red-400/90">⚑</span> {topFlag.split(" — ")[0]}
        </p>
      )}

      <span className="mt-auto text-xs font-medium text-brand-cyan/80 transition-colors group-hover:text-brand-cyan">
        Full risk report →
      </span>
    </Link>
  );
}

export function ViralBoardView({ data }: { data: ViralRadarData }) {
  if (data.picks.length === 0) {
    return (
      <div className="rounded-xl border border-white/8 bg-zinc-900/50 p-8 text-center">
        <p className="text-sm text-zinc-400">
          Quiet horizon — nothing is heating up above the noise floor right
          now. The radar sweeps every 15 minutes.
        </p>
      </div>
    );
  }

  const flagged = data.picks.filter(
    (p) => p.verdict && (p.verdict.honeypot || p.verdict.band !== "LOWER_RISK"),
  ).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        {data.picks.length} tokens heating up ·{" "}
        <span className={flagged > 0 ? "text-red-400" : "text-emerald-400"}>
          {flagged} flagged
        </span>{" "}
        · updated {new Date(data.generatedAt).toLocaleTimeString()} (radar
        sweeps every 15 min)
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.picks.map((pick) => (
          <PickCard key={`${pick.chain}:${pick.address}`} pick={pick} />
        ))}
      </div>
    </div>
  );
}
