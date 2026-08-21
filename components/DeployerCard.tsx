// Deployer rap sheet card (roadmap F5): shown on the report page when a
// provider exposed the token's deployer/creator address. Prior-token history
// is "previously seen by RugRadar" only — the copy below must never imply a
// complete on-chain history.

import Link from "next/link";
import type { Chain } from "@/lib/chains";
import type { DeployerProfile } from "@/lib/deployer";
import type { Band } from "@/lib/scoring";

const BAND_STYLES: Record<Band, string> = {
  AVOID: "bg-red-500/15 text-red-400 border-red-500/40",
  CAUTION: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
  LOWER_RISK: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
};

const BAND_TEXT: Record<Band, string> = {
  AVOID: "AVOID",
  CAUTION: "CAUTION",
  LOWER_RISK: "LOWER RISK",
};

function explorerUrl(chain: Chain, address: string): string {
  switch (chain) {
    case "solana":
      return `https://solscan.io/account/${address}`;
    case "ethereum":
      return `https://etherscan.io/address/${address}`;
    case "bsc":
      return `https://bscscan.com/address/${address}`;
    case "base":
      return `https://basescan.org/address/${address}`;
    case "arbitrum":
      return `https://arbiscan.io/address/${address}`;
    case "polygon":
      return `https://polygonscan.com/address/${address}`;
  }
}

function truncateAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  if (n > 0 && n < 0.1) return "<0.1%";
  return `${n.toFixed(1)}%`;
}

export function DeployerCard({
  profile,
  chain,
}: {
  profile: DeployerProfile;
  chain: Chain;
}) {
  const avoidCount = profile.priorTokens.filter(
    (t) => t.band === "AVOID",
  ).length;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Deployer
      </h2>
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        {profile.serialRugger && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-400">
            Serial deployer — {avoidCount} prior tokens scored AVOID.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-zinc-500">Address</div>
            <a
              href={explorerUrl(chain, profile.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-emerald-400 hover:underline"
              title={profile.address}
            >
              {truncateAddress(profile.address)} ↗
            </a>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Dev wallet share of supply</div>
            <div className="text-sm font-medium">
              {fmtPct(profile.devWalletPct)}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-zinc-500">
            Prior tokens seen by RugRadar ({profile.priorTokens.length})
          </div>
          {profile.priorTokens.length > 0 ? (
            <ul className="space-y-1.5">
              {profile.priorTokens.map((t) => (
                <li key={`${t.chain}:${t.address}`}>
                  <Link
                    href={`/report/${t.chain}/${t.address}`}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm transition-colors hover:border-emerald-500/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-200">
                      {t.name ?? "Unknown token"}{" "}
                      <span className="text-zinc-500">
                        {t.symbol ?? truncateAddress(t.address)} · {t.chain}
                      </span>
                    </span>
                    {t.band ? (
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${BAND_STYLES[t.band]}`}
                      >
                        {t.score !== null ? `${t.score} ` : ""}
                        {BAND_TEXT[t.band]}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs font-bold text-zinc-300">
                        UNSCORED
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">
              No prior tokens seen by RugRadar from this deployer.
            </p>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          History covers tokens previously seen by RugRadar (last 24h) — not a
          complete on-chain history of this deployer.
        </p>
      </div>
    </section>
  );
}
