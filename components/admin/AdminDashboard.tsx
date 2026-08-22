"use client";

// /admin content vault dashboard. All copy is generated client-side from
// /api/admin/data via the pure functions in lib/admin-content.ts. Sharing
// is deliberately manual: X intent links open the composer with precomposed
// text, the operator attaches the downloaded card PNG and posts.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanResult } from "@/lib/scan";
import { ThreadStudio } from "./ThreadStudio";
import { ViralRadar } from "./ViralRadar";
import { CopyButton, PostBlock, Section } from "./ui";
import {
  caReplyVerdict,
  dailyReportPost,
  milestonePost,
  reportUrl,
  rugAnatomyThread,
  telegramFunnelPost,
  type AdminData,
} from "@/lib/admin-content";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Section A — editable card fields (auto-filled from the feed aggregate).
  const [date, setDate] = useState("");
  const [scanned, setScanned] = useState("0");
  const [honeypots, setHoneypots] = useState("0");
  const [flagCount, setFlagCount] = useState("0");
  const [riskiestName, setRiskiestName] = useState("");
  const [riskiestLine, setRiskiestLine] = useState("");

  // Initial load fills the editable card fields; refreshes (Thread Studio
  // "Regenerate") only swap the data so the operator's edits survive.
  const load = useCallback((initial: boolean) => {
    if (!initial) setRefreshing(true);
    fetch("/api/admin/data")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as AdminData;
      })
      .then((d) => {
        setData(d);
        if (!initial) return;
        setDate(d.today);
        setScanned(String(d.scanned));
        setHoneypots(String(d.honeypots));
        setFlagCount(String(d.riskiest?.flagCount ?? 0));
        setRiskiestName(
          d.riskiest
            ? (d.riskiest.symbol
                ? `$${d.riskiest.symbol}`
                : d.riskiest.name) ?? ""
            : "",
        );
        setRiskiestLine(d.riskiest?.line ?? "");
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // Debounce the preview so typing doesn't fire an ImageResponse per key.
  const previewParams = useDebounced(
    { date, scanned, honeypots, flagCount, riskiestName, riskiestLine },
    400,
  );
  const cardUrl = useMemo(() => {
    const p = new URLSearchParams({
      date: previewParams.date,
      scanned: previewParams.scanned,
      honeypots: previewParams.honeypots,
      flagcount: previewParams.flagCount,
      riskiest: previewParams.riskiestName,
      riskline: previewParams.riskiestLine,
    });
    return `/api/admin/card.png?${p.toString()}`;
  }, [previewParams]);

  const daily = useMemo(
    () =>
      dailyReportPost({
        date,
        scanned: Number(scanned) || 0,
        honeypots: Number(honeypots) || 0,
        flagCount: Number(flagCount) || 0,
        riskiestName: riskiestName || null,
        riskiestLine,
      }),
    [date, scanned, honeypots, flagCount, riskiestName, riskiestLine],
  );

  const thread = useMemo(() => {
    const r = data?.riskiest;
    if (!r || r.flags.length === 0) return null;
    return rugAnatomyThread({
      name: r.name,
      symbol: r.symbol,
      score: r.score,
      flags: r.flags,
      url: r.url,
    });
  }, [data]);

  const tgPost = useMemo(() => telegramFunnelPost(), []);
  const milestone = useMemo(
    () =>
      milestonePost({
        scanned: data?.scanned ?? 0,
        flaggedPct: data?.flaggedPct ?? 0,
        window: data?.window ?? "24 hours",
      }),
    [data],
  );

  // Section C — CA Reply Ammo.
  const [ca, setCa] = useState("");
  const [caBusy, setCaBusy] = useState(false);
  const [caError, setCaError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);

  async function buildVerdict(e: React.FormEvent) {
    e.preventDefault();
    setCaBusy(true);
    setCaError(null);
    setVerdict(null);
    try {
      const resolveRes = await fetch(
        `/api/resolve?q=${encodeURIComponent(ca.trim())}`,
      );
      const resolved = await resolveRes.json();
      let chain: string;
      let address: string;
      if (resolved.kind === "resolved") {
        chain = resolved.chain;
        address = resolved.address;
      } else if (resolved.kind === "picker" && resolved.options?.length) {
        // Ranked by liquidity server-side — take the top hit.
        chain = resolved.options[0].chain;
        address = resolved.options[0].address;
      } else {
        throw new Error(resolved.error ?? "Could not resolve that input.");
      }

      const scanRes = await fetch(
        `/api/scan?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`,
      );
      const scan = await scanRes.json();
      if (!scanRes.ok) throw new Error(scan.error ?? `HTTP ${scanRes.status}`);
      const result = scan as ScanResult;

      setVerdict(
        caReplyVerdict({
          score: result.score.score,
          band: result.score.band,
          name: result.report.name,
          symbol: result.report.symbol,
          flags: result.score.flags.map((f) => f.text),
          url: reportUrl(chain, address),
        }),
      );
    } catch (err) {
      setCaError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setCaBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold tracking-tight">Content vault</h1>
          <p className="text-xs text-zinc-500">
            Ready-to-post X content from the live feed.
            {data && (
              <>
                {" "}
                Window: last {data.window} · generated{" "}
                {new Date(data.generatedAt).toLocaleTimeString()}.
              </>
            )}
          </p>
        </div>
        <a
          href="/api/admin/logout"
          className="text-xs text-zinc-500 transition-colors hover:text-red-400"
        >
          Log out
        </a>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          Failed to load feed data: {loadError}
        </p>
      )}
      {!data && !loadError && (
        <p className="text-sm text-zinc-400">Loading feed data…</p>
      )}

      {/* Viral Radar — trend-riding engine, the flagship */}
      <ViralRadar />

      {/* A. Daily Rug Report */}
      <Section
        title="Daily Rug Report"
        hint="Edit any field — the card preview and caption update live. Download the PNG, then Post to X and attach it."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Date" value={date} onChange={setDate} />
          <Field
            label="Tokens scanned"
            value={scanned}
            onChange={setScanned}
          />
          <Field
            label="Honeypots caught"
            value={honeypots}
            onChange={setHoneypots}
          />
          <Field
            label="Red flags on riskiest token"
            value={flagCount}
            onChange={setFlagCount}
          />
          <Field
            label="Riskiest token"
            value={riskiestName}
            onChange={setRiskiestName}
          />
        </div>
        <Field
          label="Riskiest one-liner"
          value={riskiestLine}
          onChange={setRiskiestLine}
        />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardUrl}
          alt="Daily Rug Report card preview"
          className="w-full rounded-lg border border-zinc-800"
        />

        <div className="flex flex-wrap gap-2">
          <a
            href={cardUrl}
            download="rugradar-daily-rug-report.png"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
          >
            Download PNG
          </a>
        </div>

        <PostBlock post={daily} />
      </Section>

      {/* Thread Studio */}
      <Section
        title="Thread Studio"
        hint="Five thread types built from the live window. Disabled cards say why. Links live in the reply, never in the thread body."
      >
        <ThreadStudio
          data={data}
          refreshing={refreshing}
          onRefresh={() => load(false)}
        />
      </Section>

      {/* B. Post generator */}
      <Section
        title="Post generator"
        hint="Four variants. Main posts never carry a link (algo) — post the link text as the first reply. Attach the card PNG to the Daily Rug Report."
      >
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-300">
            1. Daily Rug Report caption
          </h3>
          <PostBlock post={daily} />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-300">
            2. Rug Anatomy thread
          </h3>
          {thread ? (
            <>
              {thread.posts.map((p, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
                >
                  <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">
                    {p}
                  </pre>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500">
                      {p.length}/280
                    </span>
                    <CopyButton text={p} label={`Copy ${i + 1}/`} />
                  </div>
                </div>
              ))}
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-400">
                  {thread.linkReply}
                </pre>
                <CopyButton text={thread.linkReply} label="Copy link reply" />
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              No flagged token with scannable flags in the current window —
              thread unlocks once the feed catches a rug.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-300">
            3. Telegram funnel
          </h3>
          <PostBlock post={tgPost} />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-300">
            4. Milestone / social proof
          </h3>
          <PostBlock post={milestone} />
        </div>
      </Section>

      {/* C. CA Reply Ammo */}
      <Section
        title="CA Reply Ammo"
        hint="Paste any contract address from a viral post. You get a reply-ready verdict with the report link — it unfurls the OG score card under their tweet."
      >
        <form onSubmit={buildVerdict} className="flex gap-2">
          <input
            value={ca}
            onChange={(e) => setCa(e.target.value)}
            placeholder="0x… or Solana address"
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={caBusy || !ca.trim()}
            className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {caBusy ? "Scanning…" : "Scan"}
          </button>
        </form>
        {caError && <p className="text-xs text-red-400">{caError}</p>}
        {verdict && (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">
              {verdict}
            </pre>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500">
                {verdict.length}/280
              </span>
              <CopyButton text={verdict} label="Copy reply" />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
