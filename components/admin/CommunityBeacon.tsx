"use client";

// Community Beacon — the vault's champion-token section ($CATE). One-time
// setup (chain + CA, saved server-side in KV), then every load renders a
// full content pack: daily radar-check post, contrast post vs the viral
// field, community rally post, raid replies, and the token's score card.
//
// Credibility rule is visible in the UI: when the champion flags, the
// section says so and the copy shifts to honest watch mode — the vault
// never shills through red flags.

import { useCallback, useEffect, useState } from "react";
import type { CommunityPack } from "@/lib/community";
import { CopyButton, PostBlock, Section } from "./ui";

const CHAIN_OPTIONS = [
  "solana",
  "ethereum",
  "bsc",
  "base",
  "arbitrum",
  "polygon",
] as const;

function SetupForm({
  initial,
  onSaved,
}: {
  initial: { chain: string; address: string; label: string } | null;
  onSaved: () => void;
}) {
  const [chain, setChain] = useState(initial?.chain ?? "solana");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [label, setLabel] = useState(initial?.label ?? "$CATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/community", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain, address: address.trim(), label }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px]">
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Chain</span>
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          >
            {CHAIN_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Contract address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Paste the $CATE contract address"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !address.trim()}
        className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save & generate"}
      </button>
    </form>
  );
}

function VerdictBanner({ pack }: { pack: CommunityPack }) {
  const v = pack.verdict;
  if (!v) {
    return (
      <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
        {pack.note ?? "Scan incomplete — posts are limited until the scan succeeds."}
      </p>
    );
  }
  const clean = !v.honeypot && v.band === "LOWER_RISK";
  const style = clean
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
    : "border-red-500/40 bg-red-500/10 text-red-400";
  return (
    <p className={`rounded-md border px-3 py-2 text-xs ${style}`}>
      {clean
        ? `${pack.config.label} is clean right now — ${v.score}/100, LOWER RISK. Champion mode active.`
        : `${pack.config.label} currently flags ${v.honeypot ? "HONEYPOT" : `${v.score}/100, ${(v.band ?? "UNSCORED").replace("_", " ")}`} — watch mode: copy stays honest, contrast post suppressed.`}
    </p>
  );
}

export function CommunityBeacon() {
  const [configured, setConfigured] = useState<{
    chain: string;
    address: string;
    label: string;
  } | null>(null);
  const [pack, setPack] = useState<CommunityPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/community")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as {
          config: { chain: string; address: string; label: string } | null;
          pack: CommunityPack | null;
        };
      })
      .then((d) => {
        setConfigured(d.config);
        setPack(d.pack);
        setEditing(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showSetup = !configured || editing;

  return (
    <Section
      title={`Community Beacon — ${configured?.label ?? "$CATE"}`}
      hint="Champion content for the $CATE movement: daily radar check, contrast vs today's viral field, rally post, and raid replies the community can paste — every one leads back to the public report. The copy follows the real scan verdict, always."
    >
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          Failed to load: {error}
        </p>
      )}
      {loading && !pack && (
        <p className="text-sm text-zinc-400">Loading community pack…</p>
      )}

      {showSetup && !loading && (
        <SetupForm initial={configured} onSaved={load} />
      )}

      {!showSetup && pack && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <VerdictBanner pack={pack} />
          </div>

          {pack.champion && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-zinc-300">
                1. Daily radar check
              </h3>
              <PostBlock post={pack.champion} />
            </div>
          )}

          {pack.contrast ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-zinc-300">
                2. {pack.config.label} vs today&apos;s viral field
              </h3>
              <PostBlock post={pack.contrast} />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Contrast post unlocks when {pack.config.label} is clean AND at
              least one viral token flags red.
            </p>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-300">
              3. Community rally
            </h3>
            <PostBlock post={pack.rally} />
          </div>

          {pack.raidReplies.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-zinc-300">
                4. Raid replies — paste under {pack.config.label} posts (these
                carry the report link by design)
              </h3>
              <div className="grid gap-2 lg:grid-cols-3">
                {pack.raidReplies.map((r, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
                  >
                    <pre className="whitespace-pre-wrap break-all font-sans text-xs text-zinc-300">
                      {r}
                    </pre>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500">
                        {r.length}/240
                      </span>
                      <CopyButton text={r} label="Copy reply" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
            <a
              href={pack.cardUrl}
              download={`rugradar-${pack.config.label.replace(/^\$/, "")}-card.png`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
            >
              Download {pack.config.label} score card
            </a>
            <a
              href={pack.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
            >
              Open public report
            </a>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
            >
              Change token
            </button>
          </div>

          <p className="text-[10px] text-zinc-600">
            Generated {new Date(pack.generatedAt).toLocaleTimeString()} ·
            verdict from the live scan (15min provider cache).
          </p>
        </div>
      )}
    </Section>
  );
}
