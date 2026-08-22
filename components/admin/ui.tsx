"use client";

// Shared presentational primitives for the /admin vault sections.

import { useState } from "react";
import { intentUrl, type Post } from "@/lib/admin-content";

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
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
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function PostToXButton({ text }: { text: string }) {
  return (
    <a
      href={intentUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
    >
      Post to X
    </a>
  );
}

// One generated post: preview, char count, copy, intent link, and the
// paired first-reply that carries the outbound link (never the main post —
// the X algo suppresses those).
export function PostBlock({ post }: { post: Post }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">
        {post.text}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-zinc-500">
          {post.text.length}/240
        </span>
        <CopyButton text={post.text} label="Copy caption" />
        <PostToXButton text={post.text} />
      </div>
      {post.reply && (
        <div className="space-y-2 border-t border-zinc-800 pt-2">
          <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-400">
            {post.reply}
          </pre>
          <CopyButton text={post.reply} label="Copy link reply" />
        </div>
      )}
    </div>
  );
}
