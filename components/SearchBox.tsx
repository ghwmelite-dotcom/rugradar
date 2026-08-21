"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PickerOption, ResolveResult } from "@/lib/resolve";

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [options, setOptions] = useState<PickerOption[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setOptions(null);
    try {
      const res = await fetch(`/api/resolve?q=${encodeURIComponent(q)}`);
      const data: ResolveResult = await res.json();
      if (data.kind === "resolved") {
        if (data.warning) setWarning(data.warning);
        router.push(`/report/${data.chain}/${data.address}`);
      } else if (data.kind === "picker") {
        setOptions(data.options);
        if (data.warning) setWarning(data.warning);
      } else {
        setError(data.error);
        if (data.warning) setWarning(data.warning);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Contract address (0x… or Solana) or coin name"
          className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan"}
        </button>
      </form>

      {warning && (
        <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
          {warning}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {options && (
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800 overflow-hidden text-left">
          <p className="px-4 py-2 text-xs text-zinc-500 bg-zinc-900">
            Multiple matches — pick one (ranked by liquidity):
          </p>
          {options.map((o) => (
            <button
              key={`${o.chain}:${o.address}`}
              onClick={() => router.push(`/report/${o.chain}/${o.address}`)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900 transition-colors"
            >
              {o.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.imageUrl} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-zinc-800" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {o.name ?? "Unknown"}{" "}
                  <span className="text-zinc-500">{o.symbol ?? ""}</span>
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {o.address}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                  {o.chain}
                </span>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {fmtUsd(o.liquidityUsd)} liq
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
