# RugRadar — browser extension

Manifest V3 extension that overlays RugRadar risk scores directly on the memecoin
pages traders already use. Framework-free vanilla JS, no build step — the files
in this directory are the extension.

## Load unpacked (Chrome / Edge / Brave / Arc)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` directory.
4. Browse to a token page on a supported site — a RugRadar pill appears next to
   the token name (or fixed at the bottom-right as a fallback).

After editing any file here, hit the reload button on the extension card in
`chrome://extensions` and reload the tab.

## Supported sites

- `dexscreener.com` — pair pages `/<chain>/<pairAddress>`
- `pump.fun` — coin pages `/coin/<mint>`
- `axiom.trade` — `/meme/...` pages (best effort)

## How detection works

- **pump.fun**: the mint comes straight from the URL (`/coin/<mint>`) — chain is
  always `solana`.
- **dexscreener.com**: the URL segment is the **pair address, not the token
  address**, so the extension tries to recover the real token address from the
  page, in order: (1) `a[href*="/token/"]` links, (2) the `__NEXT_DATA__`
  bootstrap JSON walked for the pair object whose `pairAddress` matches the URL
  (takes its `baseToken.address`), (3) a regex over inline scripts for embedded
  `"pairAddress"`/`"baseToken"` payloads. If all of these fail it falls back to
  the pair address; if that scan errors, the badge hides instead of showing a
  misleading state. Only RugRadar-supported chains are badged (solana, ethereum,
  bsc, base, arbitrum, polygon).
- **axiom.trade**: the `/meme/<id>` URL segment is an internal id, so the
  extension scans the DOM for outbound links containing a base58 mint
  (solscan `/token/`, pump.fun `/coin/`, dexscreener `solana/…`), then falls
  back to a `CA: <mint>`-style label in visible text.

Once detected, it calls
`GET https://rugradar.ghwmelite.workers.dev/api/scan?chain=…&address=…` and
renders a color-coded pill: red AVOID (🚨 prefix on honeypot override), amber
CAUTION, green LOWER RISK, gray UNSCORED, gray "scan unavailable" on API
error/rate-limit. Clicking opens the full report at
`/report/<chain>/<address>` in a new tab.

Results are cached in `chrome.storage.session` for 5 minutes, so the extension
issues at most one scan per token per 5 minutes — well under the site's
30 scans/min rate limit. The badge is shadow-DOM isolated (site CSS cannot restyle
it) and survives SPA navigation via URL polling plus a debounced
`MutationObserver`.

## Privacy

The extension has host permissions only for the three DEX sites and
`rugradar.ghwmelite.workers.dev`. It contacts the RugRadar API **only** when you
are viewing a detected token page on a supported site, and sends only the
chain + token address (the same public data anyone can paste into the web
scanner). No analytics, no tracking, no other network calls.

## ⚠️ Server requirement: CORS on `/api/scan`

`fetch()` from a content script runs with the **page's** origin, so Chrome
applies CORS. `/api/scan` responses must include:

```
Access-Control-Allow-Origin: *
```

(`/api/scan` is public, read-only token data — a wildcard origin is acceptable.)
The handler should also answer `OPTIONS` preflights if any non-simple headers
get added later; the current request is a simple GET with an `Accept` header,
so no preflight is sent today.

Until that header ships, the extension still works: the content script falls
back to relaying the request through its background service worker
(`background.js`), which fetches with the extension's origin and is authorized
by `host_permissions` — no CORS involved. The CORS header is still worth adding
because the direct path is faster and simpler.

## Known limitations

- Axiom detection is heuristic — it can pick the wrong mint or none at all on
  layouts with no explorer links and no `CA:` label.
- DexScreener's pair→token extraction depends on their current page structure
  (`__NEXT_DATA__`); if they change it, the extension degrades to the pair
  address and hides the badge if the scan then fails.
- The badge anchors to the page's first `h1`; on layouts without one it uses
  the fixed bottom-right pill.
