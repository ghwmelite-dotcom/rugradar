// RugRadar — content script.
//
// Injects a compact risk-score badge onto token pages on dexscreener.com,
// pump.fun and axiom.trade. Everything here is best-effort: any failure is
// caught and the badge either degrades to a gray "scan unavailable" state or
// is hidden — we never throw into the host page.

(function () {
  "use strict";

  const API_BASE = "https://rugradar.ghwmelite.workers.dev";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — respects the 30 scans/min site rate limit
  const FETCH_TIMEOUT_MS = 10000;
  const HOST_ID = "rugradar-badge-host";

  // Chains RugRadar v1 supports. DexScreener URL slugs use the same ids.
  const SUPPORTED_CHAINS = new Set([
    "solana",
    "ethereum",
    "bsc",
    "base",
    "arbitrum",
    "polygon",
  ]);

  const SOL_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0/O/I/l
  const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  // Returns { chain, address, approx } or null when the page is not a
  // scannable token page. `approx: true` means the address is a DexScreener
  // PAIR address, not a token address (see the dexscreener extractor).
  function detect() {
    const host = location.hostname.replace(/^www\./, "");
    try {
      if (host === "dexscreener.com") return detectDexscreener();
      if (host === "pump.fun") return detectPumpFun();
      if (host === "axiom.trade") return detectAxiom();
    } catch {
      // never break the page
    }
    return null;
  }

  // --- dexscreener.com -------------------------------------------------------
  //
  // Token pages look like https://dexscreener.com/<chain>/<pairAddress>.
  // IMPORTANT: the URL segment is the *pair* (pool) address, not the token
  // address. RugRadar's /api/scan takes token addresses, so we try hard to
  // recover the token address from the page. Heuristics, in order:
  //
  //   1. Anchors to token profiles (a[href*="/token/"]) — DexScreener renders
  //      these on some layouts/experiments.
  //   2. The Next.js bootstrap JSON (script#__NEXT_DATA__) — we walk it for a
  //      pair object whose pairAddress matches the URL and take its
  //      baseToken.address (DexScreener's base token is the traded meme token
  //      in the canonical pair orientation).
  //   3. Any inline script JSON containing "baseToken":{"address":...} — same
  //      idea, regex-based, in case the bootstrap element is renamed.
  //
  // If all DOM extraction fails we fall back to the pair address itself and
  // mark the detection `approx`. The scan is still attempted (the backend
  // normalizes via DexScreener so a pair address *may* resolve); if it
  // errors, the badge hides instead of showing stale garbage.
  function detectDexscreener() {
    const m = location.pathname.match(/^\/([a-z0-9-]+)\/([A-Za-z0-9]{20,64})\/?$/i);
    if (!m) return null;
    const chain = m[1].toLowerCase();
    if (!SUPPORTED_CHAINS.has(chain)) return null;
    const pairAddress = m[2];

    const token = extractDexscreenerTokenAddress(pairAddress, chain);
    if (token) return { chain, address: token, approx: false };
    return { chain, address: pairAddress, approx: true };
  }

  function extractDexscreenerTokenAddress(pairAddress, chain) {
    // 1. Token profile links.
    for (const a of document.querySelectorAll('a[href*="/token/"]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/token\/([A-Za-z0-9]{20,64})/);
      if (m && plausibleAddress(chain, m[1])) return m[1];
    }

    // 2. Structured walk of the Next.js bootstrap JSON.
    const nextData = document.getElementById("__NEXT_DATA__");
    if (nextData && nextData.textContent) {
      const fromJson = findPairBaseToken(nextData.textContent, pairAddress);
      if (fromJson) return fromJson;
    }

    // 3. Regex over inline scripts for embedded pair payloads.
    const re = /"pairAddress"\s*:\s*"([^"]+)"[\s\S]{0,2000}?"baseToken"\s*:\s*\{[^{}]*?"address"\s*:\s*"([^"]+)"/;
    for (const s of document.querySelectorAll("script:not([src])")) {
      const text = s.textContent || "";
      if (!text.includes('"pairAddress"')) continue;
      const m = re.exec(text);
      if (m && m[1].toLowerCase() === pairAddress.toLowerCase() && plausibleAddress(chain, m[2])) {
        return m[2];
      }
    }
    return null;
  }

  function findPairBaseToken(jsonText, pairAddress) {
    let root;
    try {
      root = JSON.parse(jsonText);
    } catch {
      return null;
    }
    const target = pairAddress.toLowerCase();
    let found = null;
    const walk = (node) => {
      if (found || !node || typeof node !== "object") return;
      if (
        typeof node.pairAddress === "string" &&
        node.pairAddress.toLowerCase() === target &&
        node.baseToken &&
        typeof node.baseToken.address === "string"
      ) {
        found = node.baseToken.address;
        return;
      }
      for (const key of Object.keys(node)) walk(node[key]);
    };
    walk(root);
    return found;
  }

  // --- pump.fun --------------------------------------------------------------
  //
  // Token pages: https://pump.fun/coin/<mint> — the mint is the Solana token
  // address, straight from the URL.
  function detectPumpFun() {
    const m = location.pathname.match(/^\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (!m) return null;
    return { chain: "solana", address: m[1], approx: false };
  }

  // --- axiom.trade -----------------------------------------------------------
  //
  // Token pages live under /meme/... but the URL segment is an internal
  // pair/position id, not a mint. Best-effort DOM extraction of a base58
  // Solana mint, in order:
  //   1. Links out to known Solana explorers/trackers (solscan /token/...,
  //      pump.fun /coin/..., dexscreener solana/...) — high confidence.
  //   2. A "CA: <mint>"-style label in visible text — traders' UIs usually
  //      render the contract address this way.
  // Only runs on /meme/ pages so we don't badge non-token screens.
  function detectAxiom() {
    if (!location.pathname.toLowerCase().includes("/meme")) return null;

    const linkRes = [
      /pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
      /solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
      /solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
    ];
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      for (const re of linkRes) {
        const m = re.exec(href);
        if (m) return { chain: "solana", address: m[1], approx: false };
      }
    }

    const text = (document.body && document.body.innerText) || "";
    const ca = /\b(?:CA|ca)\s*[:：]?\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/.exec(text);
    if (ca) return { chain: "solana", address: ca[1], approx: false };

    return null;
  }

  function plausibleAddress(chain, addr) {
    return chain === "solana" ? SOL_MINT_RE.test(addr) : EVM_ADDR_RE.test(addr);
  }

  // ---------------------------------------------------------------------------
  // API + cache
  // ---------------------------------------------------------------------------

  function cacheKey(chain, address) {
    return `scan:${chain}:${address.toLowerCase()}`;
  }

  async function getCached(chain, address) {
    try {
      const key = cacheKey(chain, address);
      const store = await chrome.storage.session.get(key);
      const entry = store && store[key];
      if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.result;
    } catch {
      // storage unavailable — just fetch
    }
    return null;
  }

  async function setCached(chain, address, result) {
    try {
      await chrome.storage.session.set({
        [cacheKey(chain, address)]: { at: Date.now(), result },
      });
    } catch {
      // ignore
    }
  }

  // Direct fetch first (needs the CORS header on /api/scan — see README).
  // If that fails (typically a CORS block, which surfaces as a TypeError),
  // relay through the extension's service worker, which is exempt via
  // host_permissions.
  async function fetchScan(chain, address) {
    const url = `${API_BASE}/api/scan?chain=${encodeURIComponent(
      chain,
    )}&address=${encodeURIComponent(address)}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (directErr) {
      try {
        const relayed = await chrome.runtime.sendMessage({
          type: "rugradar:scan",
          chain,
          address,
        });
        if (relayed && relayed.ok) return relayed.data;
        throw new Error(relayed && relayed.error ? relayed.error : `HTTP ${relayed && relayed.status}`);
      } catch {
        throw directErr;
      }
    }
  }

  function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } }).finally(
      () => clearTimeout(t),
    );
  }

  // ---------------------------------------------------------------------------
  // Badge UI (shadow-DOM isolated so host page CSS can't break it)
  // ---------------------------------------------------------------------------

  const BADGE_CSS = `
    :host { all: initial; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f4f4f5; background: #27272a; border: 1px solid #3f3f46;
      border-radius: 9999px; padding: 5px 10px; cursor: pointer;
      user-select: none; white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,.45);
    }
    .pill:hover { filter: brightness(1.15); }
    .dot { width: 8px; height: 8px; border-radius: 9999px; flex: none; }
    .score { font-size: 13px; font-weight: 700; }
    .band { opacity: .85; font-weight: 600; letter-spacing: .02em; }
    .brand { opacity: .55; font-weight: 600; }
    .avoid { background: #450a0a; border-color: #991b1b; } .avoid .dot { background: #ef4444; }
    .caution { background: #451a03; border-color: #b45309; } .caution .dot { background: #f59e0b; }
    .lower { background: #022c22; border-color: #047857; } .lower .dot { background: #10b981; }
    .gray { background: #27272a; border-color: #3f3f46; } .gray .dot { background: #71717a; }
    .fixed {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    }
  `;

  function reportUrl(chain, address) {
    return `${API_BASE}/report/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
  }

  function bandLabel(band) {
    if (band === "AVOID") return "AVOID";
    if (band === "CAUTION") return "CAUTION";
    if (band === "LOWER_RISK") return "LOWER RISK";
    return "UNSCORED";
  }

  function bandClass(band) {
    if (band === "AVOID") return "avoid";
    if (band === "CAUTION") return "caution";
    if (band === "LOWER_RISK") return "lower";
    return "gray";
  }

  // Renders (or re-renders) the badge. `state` is one of:
  //   { kind: "loading" }
  //   { kind: "error" }                         — gray "scan unavailable"
  //   { kind: "result", data, chain, address }  — scan payload
  //   { kind: "hidden" }                        — remove the badge entirely
  function renderBadge(state) {
    lastState = state;
    let host = document.getElementById(HOST_ID);

    if (state.kind === "hidden") {
      if (host) host.remove();
      return;
    }

    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = BADGE_CSS;
      const pill = document.createElement("div");
      pill.className = "pill gray";
      shadow.appendChild(style);
      shadow.appendChild(pill);
      mountHost(host);
    }

    const pill = host.shadowRoot.querySelector(".pill");
    const newHost = state.kind === "result" || state.kind === "error";

    if (state.kind === "loading") {
      pill.className = pillClass("gray");
      pill.innerHTML = `<span class="dot"></span><span class="band">RugRadar scanning…</span>`;
      pill.title = "RugRadar is scanning this token";
      pill.onclick = null;
    } else if (state.kind === "error") {
      pill.className = pillClass("gray");
      pill.innerHTML = `<span class="dot"></span><span class="band">RugRadar scan unavailable</span>`;
      pill.title = "RugRadar scan failed or was rate-limited";
      pill.onclick = null;
    } else if (state.kind === "result") {
      const { data, chain, address } = state;
      const score = data && data.score ? data.score : {};
      const report = data && data.report ? data.report : {};
      const honeypot = !!score.honeypotOverride;
      const hasScore = typeof score.score === "number";
      const cls = honeypot ? "avoid" : bandClass(score.band);
      const label = honeypot ? "HONEYPOT" : bandLabel(score.band);
      const scoreText = hasScore ? String(score.score) : "—";
      pill.className = pillClass(cls);
      pill.innerHTML =
        `<span class="dot"></span>` +
        (honeypot ? `<span class="score">🚨</span>` : "") +
        `<span class="score">${escapeHtml(scoreText)}</span>` +
        `<span class="band">${escapeHtml(label)}</span>` +
        `<span class="brand">RugRadar</span>`;
      const name = report.symbol || report.name || "this token";
      pill.title = `${name} — RugRadar risk score ${scoreText}/100 (${label}). Click for the full report. Flags red flags; not financial advice.`;
      const url = reportUrl(chain, address);
      pill.onclick = () => window.open(url, "_blank", "noopener");
    }

    // Re-check placement only when the host got detached by SPA re-renders.
    if (newHost && !host.isConnected) mountHost(host);

    function pillClass(cls) {
      const fixed = host.dataset.fixed === "1" ? " fixed" : "";
      return `pill ${cls}${fixed}`;
    }
  }

  // Preferred placement: inline next to the page's token title (first h1).
  // Fallback: fixed bottom-right pill.
  function mountHost(host) {
    const h1 = document.querySelector("h1");
    if (h1 && h1.parentElement) {
      host.dataset.fixed = "0";
      host.style.display = "inline-block";
      host.style.verticalAlign = "middle";
      host.style.marginLeft = "8px";
      h1.appendChild(host);
    } else {
      host.dataset.fixed = "1";
      document.documentElement.appendChild(host);
    }
    const pill = host.shadowRoot && host.shadowRoot.querySelector(".pill");
    if (pill) pill.classList.toggle("fixed", host.dataset.fixed === "1");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  // ---------------------------------------------------------------------------
  // Orchestration + SPA survival
  // ---------------------------------------------------------------------------

  let currentTokenKey = null; // "chain:address" of the last scan issued
  let lastUrl = location.href;
  let lastState = { kind: "hidden" }; // last badge state, for re-mounts

  async function update() {
    try {
      const det = detect();
      if (!det) {
        currentTokenKey = null;
        renderBadge({ kind: "hidden" });
        return;
      }

      const key = `${det.chain}:${det.address.toLowerCase()}`;
      if (key === currentTokenKey) {
        // Same token — just make sure the badge survived re-renders.
        const host = document.getElementById(HOST_ID);
        if (!host || !host.isConnected) {
          // Re-mount the real state after an SPA wipe. "hidden" means the
          // scan failed on an approximate detection — stay hidden, don't
          // re-create a badge that would sit on "scanning…" forever.
          if (lastState.kind !== "hidden") renderBadge(lastState);
        } else if (host.dataset.fixed === "1" && document.querySelector("h1")) {
          // We fell back to the fixed pill before the SPA rendered its title;
          // upgrade to the inline placement now that an h1 exists.
          mountHost(host);
        }
        return;
      }
      currentTokenKey = key;

      const cached = await getCached(det.chain, det.address);
      if (cached) {
        renderBadge({ kind: "result", data: cached, chain: det.chain, address: det.address });
        return;
      }

      renderBadge({ kind: "loading" });
      try {
        const data = await fetchScan(det.chain, det.address);
        if (currentTokenKey !== key) return; // user navigated mid-flight
        await setCached(det.chain, det.address, data);
        renderBadge({ kind: "result", data, chain: det.chain, address: det.address });
      } catch {
        if (currentTokenKey !== key) return;
        // Approximate (pair-address) detections hide on failure rather than
        // showing a misleading error on a page we may have misread.
        if (det.approx) renderBadge({ kind: "hidden" });
        else renderBadge({ kind: "error" });
      }
    } catch {
      // absolute last-resort guard: never throw into the host page
    }
  }

  // DexScreener/pump.fun/Axiom are all SPAs: they rewrite the DOM and swap
  // history entries without reloads. Two cheap watchers keep the badge alive:
  //   1. URL polling — catches client-side navigation.
  //   2. MutationObserver (debounced) — catches the badge being wiped by a
  //      re-render and catches token addresses appearing in the DOM after
  //      async hydration.
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentTokenKey = null;
      update();
    }
  }, 1000);

  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(update, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  update();
})();
