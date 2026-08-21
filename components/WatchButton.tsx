"use client";

// "Watch this token" — adds the reported token to the Deathwatch watchlist
// (POST /api/watch). Sits in the report footer next to ShareButtons.

import { useState } from "react";
import Link from "next/link";

type Status = "idle" | "loading" | "success" | "error";

export function WatchButton({
  chain,
  address,
}: {
  chain: string;
  address: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function watch() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain, address }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <span className="text-xs text-emerald-400">
        Watching — alerts on Telegram +{" "}
        <Link href="/alerts" className="hover:underline">
          /alerts
        </Link>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={watch}
        disabled={status === "loading"}
        className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "Adding…" : "Watch this token"}
      </button>
      {status === "error" && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </span>
  );
}
