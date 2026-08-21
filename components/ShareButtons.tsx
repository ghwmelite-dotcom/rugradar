"use client";

// One-tap share buttons for the report page (roadmap F2): X intent,
// Telegram share, copy link. Emoji live only inside the precomposed share
// text — never in the UI chrome.

import { useState } from "react";
import type { ScanResult } from "@/lib/scan";
import type { Band } from "@/lib/scoring";

const SITE_URL = "https://rugradar.ghwmelite.workers.dev";

export function canonicalReportUrl(chain: string, address: string): string {
  return `${SITE_URL}/report/${chain}/${address}`;
}

const VERDICTS: Record<Band, { emoji: string; label: string }> = {
  AVOID: { emoji: "🚨", label: "AVOID" },
  CAUTION: { emoji: "⚠️", label: "CAUTION" },
  LOWER_RISK: { emoji: "✅", label: "LOWER RISK" },
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Precomposed text: verdict emoji + band, $SYMBOL, score/100, strongest
// flag summary (honeypot override gets the strongest wording), CTA.
export function buildShareText(data: ScanResult): string {
  const { report, score } = data;
  const verdict = score.band
    ? VERDICTS[score.band]
    : { emoji: "⚠️", label: "UNSCORED" };
  const symbol = report.symbol
    ? `$${report.symbol}`
    : (report.name ?? "This token");
  const scoreText = score.score !== null ? `${score.score}/100` : "unscored";

  let flag = "";
  if (score.honeypotOverride) {
    flag = "Honeypot detected — buyers cannot sell.";
  } else if (score.flags.length > 0) {
    const strongest = score.flags.reduce((a, b) =>
      b.deduction > a.deduction ? b : a,
    );
    flag = strongest.text;
  }
  const flagText = flag ? ` Top flag: ${truncate(flag, 90)}` : "";

  return `${verdict.emoji} ${verdict.label} ${symbol} — ${scoreText} on RugRadar.${flagText} Scan before you ape:`;
}

const BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 p-2 text-zinc-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-400";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ShareButtons({
  url,
  data,
}: {
  url: string;
  data: ScanResult;
}) {
  const [copied, setCopied] = useState(false);
  const text = buildShareText(data);
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — nothing to do.
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        className={BUTTON_CLASS}
        title="Share on X"
        aria-label="Share on X"
      >
        <XIcon />
      </a>
      <a
        href={telegramHref}
        target="_blank"
        rel="noopener noreferrer"
        className={BUTTON_CLASS}
        title="Share on Telegram"
        aria-label="Share on Telegram"
      >
        <TelegramIcon />
      </a>
      <button
        type="button"
        onClick={copyLink}
        className={`${BUTTON_CLASS} ${copied ? "border-emerald-500/40 text-emerald-400" : ""}`}
        title={copied ? "Copied" : "Copy link"}
        aria-label={copied ? "Link copied" : "Copy link"}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </button>
    </div>
  );
}
