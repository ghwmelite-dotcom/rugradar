"use client";

import { useState } from "react";

// Posts to /api/admin/login; on success the session cookie is set and we
// hard-navigate to /admin (full reload so the server component re-gates).
export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        window.location.href = "/admin";
        return;
      }
      setError(body.error ?? `Login failed (HTTP ${res.status}).`);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-bold tracking-tight">
          Rug<span className="text-emerald-400">Radar</span>{" "}
          <span className="text-zinc-400 font-normal">content vault</span>
        </h1>
        <p className="text-xs text-zinc-500">
          Private. Unlisted. Operators only.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-zinc-400">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}
