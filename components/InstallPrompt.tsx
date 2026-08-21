"use client";

// Subtle PWA install prompt. Detects users who haven't installed the app
// and nudges them at most once every N hours (localStorage-throttled).
// Chrome/Android: captures beforeinstallprompt for a one-tap install.
// iOS Safari: shows the Share → Add to Home Screen instruction instead.
// Never shows when already running installed (standalone).

import { useEffect, useState } from "react";

const DISMISS_KEY = "rr-install-dismissed-at";
const SNOOZE_MS = 4 * 60 * 60 * 1000; // re-prompt at most every 4 hours

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(navigator as unknown as { standalone?: boolean }).standalone
  );
}

function snoozed(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      // Let the page settle before nudging.
      setTimeout(() => !snoozed() && setVisible(true), 4000);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS never fires beforeinstallprompt — offer instructions instead.
    if (isIos()) {
      setIos(true);
      setTimeout(() => !snoozed() && setVisible(true), 6000);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
      setDeferred(null);
    } else {
      dismiss();
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 motion-safe:animate-[install-rise_0.4s_ease-out]">
      <div className="card flex w-full max-w-sm items-center gap-3 border-brand-cyan/20 bg-[#0a0f16]/95 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(0,229,255,0.08)] backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-8 w-8 shrink-0" />
        <p className="flex-1 text-xs leading-snug text-zinc-300">
          {ios ? (
            <>
              Install RugRadar: tap <span className="text-brand-cyan">Share</span>{" "}
              then <span className="text-brand-cyan">Add to Home Screen</span> —
              scans and rug alerts, one tap away.
            </>
          ) : (
            <>
              Install RugRadar — scans and{" "}
              <span className="text-brand-cyan">rug alerts</span>, one tap from
              your home screen.
            </>
          )}
        </p>
        {ios ? (
          <button
            onClick={dismiss}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-brand-cyan/40 hover:text-brand-cyan transition-colors"
          >
            Got it
          </button>
        ) : (
          <button
            onClick={install}
            className="btn-brand shrink-0 rounded-lg px-3 py-1.5 text-xs"
          >
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
