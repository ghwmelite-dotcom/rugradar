"use client";

// Thread Studio — dedicated thread generator for the /admin vault. Five
// data-driven thread types (see lib/admin-content.ts); types whose data is
// missing are disabled with the reason shown. Flow: pick a type, review
// the X-style preview, Post to X opens post 1 in the composer, the operator
// continues the chain manually and drops the link reply under post 1.

import { useMemo, useState } from "react";
import {
  generateThread,
  intentUrl,
  THREAD_TYPE_META,
  threadUnavailableReason,
  type AdminData,
  type ThreadType,
} from "@/lib/admin-content";

// Green within the comfortable zone, amber approaching the cap, red over
// (generators should never produce red — the color exists to catch regressions).
function countClass(len: number): string {
  if (len > 280) return "text-red-400";
  if (len > 260) return "text-amber-400";
  return "text-emerald-400";
}

function StudioCopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function ThreadStudio({
  data,
  refreshing,
  onRefresh,
}: {
  data: AdminData | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<ThreadType>("anatomy");

  const thread = useMemo(
    () => (data ? generateThread(selected, data) : null),
    [selected, data],
  );
  const unavailable = threadUnavailableReason(selected, data);

  return (
    <div className="space-y-4">
      {/* type selector */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {THREAD_TYPE_META.map((meta) => {
          const reason = threadUnavailableReason(meta.type, data);
          const active = selected === meta.type;
          return (
            <button
              key={meta.type}
              type="button"
              disabled={reason !== null}
              onClick={() => setSelected(meta.type)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <div className="text-xs font-semibold text-zinc-100">
                {meta.title}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {reason ?? meta.blurb}
              </div>
            </button>
          );
        })}
      </div>

      {thread ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-zinc-300">
              {thread.title} — {thread.posts.length} posts
            </h3>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Regenerate"}
              </button>
              <StudioCopyButton
                text={thread.posts.join("\n\n")}
                label="Copy entire thread"
              />
              <a
                href={intentUrl(thread.posts[0])}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
              >
                Post to X
              </a>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500">
            Post to X opens post 1 in the composer — post it, then reply to
            your own tweet with 2/, 3/… to build the chain. Drop the link
            reply under post 1 when you&apos;re done.
          </p>

          {/* X-style preview */}
          <div className="space-y-2">
            {thread.posts.map((post, i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
              >
                <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">
                  {post}
                </pre>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium ${countClass(post.length)}`}
                  >
                    {post.length}/280
                  </span>
                  <StudioCopyButton text={post} label={`Copy ${i + 1}/`} />
                </div>
              </div>
            ))}

            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-3">
              <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-400">
                {thread.linkReply}
              </pre>
              <div className="mt-2">
                <StudioCopyButton
                  text={thread.linkReply}
                  label="Copy link reply"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-500">
          {unavailable ?? "Loading…"}
        </p>
      )}
    </div>
  );
}
