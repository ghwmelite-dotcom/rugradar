# RugRadar — Viral Feature Roadmap

Goal: turn the scanner into a viral loop — scan → share warning → card
spreads → new visitors → live feed keeps them → they scan their own bags.
Brand: RugRadar. Live at https://rugradar.ghwmelite.workers.dev.

## F1 — Dynamic OG score cards

Every report URL shared to X/Telegram/Discord unfurls a branded card.

- Route: `app/report/[chain]/[address]/opengraph-image.tsx` using Next's
  `ImageResponse` (works on Workers via OpenNext; verify at runtime, fall
  back to a static card if the edge renderer fails).
- Card content (1200×630): RugRadar logo, token icon+name+symbol+chain,
  score dial number, band badge (AVOID red / CAUTION amber / LOWER RISK
  green), top 3 red flags as plain text, "rugradar.ghwmelite.workers.dev"
  footer, "Not financial advice".
- Data: call `scanToken()` from `lib/scan.ts` directly (cached, so cheap).
  On scan failure render a generic branded card — never error the OG route.
- Also add `twitter:card: summary_large_image` metadata.

## F2 — One-tap share buttons

On the report page (`components/ReportView.tsx`), next to "share this URL":
an X (Twitter) intent button and a Telegram share button.

- X: `https://twitter.com/intent/tweet?text=…&url=…` — precomposed text
  includes verdict emoji (🚨/⚠️/✅), symbol, score, band, top flag summary.
  Honeypot override gets the strongest wording.
- Telegram: `https://t.me/share/url?url=…&text=…`.
- Copy-link button with "copied" feedback.
- Style: subtle icon buttons matching the zinc/emerald dark theme; no
  emoji in the UI chrome itself (emoji only inside the precomposed text).
- New file `components/ShareButtons.tsx`; keep ReportView diff minimal.

## F3 — Wall of Shame (live scan feed)

Public destination content: what the radar is catching right now.

- Store: on every completed `/api/scan`, append a compact record
  `{chain, address, name, symbol, imageUrl, score, band, honeypot, scannedAt}`
  to KV. Key scheme: `scanlog:<iso-minute>` with 24h TTL, plus a cached
  aggregate `feed:recent` (5min TTL). Keep it KV-only — no D1 yet.
- New lib: `lib/scanlog.ts` (record + query, best-effort — never let
  logging break a scan; wrap in try/catch, use `waitUntil` via
  `getCloudflareContext().ctx` so it doesn't block the response).
- API: `GET /api/feed` → `{ recent: [...], honeypots: [...], mostScanned: [...] }`.
- Page: `/feed` — three sections: "Honeypots caught", "Most scanned
  (last 24h)" with scan counts, "Latest scans". Each row links to the
  report. Add a "Live feed" link in the header.
- Scan counting: KV counter per token `scancount:<chain>:<addr>` (24h TTL),
  incremented via waitUntil.

## F4 — Telegram bot

Distribution where memecoin traders live. New worker `telegram-bot/` with
its own `wrangler.jsonc` (name `rugradar-bot`), separate from the web app.

- Webhook endpoint `POST /` handling Telegram updates. Message containing
  a Solana (base58, 32–44 chars) or EVM (0x40hex) address → call the web
  app's public `GET /api/scan`, reply with a formatted card: name, symbol,
  chain, score/100, band, top 3 flags, link to full report.
- Parse addresses out of free text (groups paste CAs inside messages).
- Plain `fetch` to `https://api.telegram.org/bot<token>/sendMessage`;
  token via `wrangler secret put TELEGRAM_BOT_TOKEN` — never committed.
- `pnpm run deploy` inside `telegram-bot/` (own package.json, wrangler only
  dep). Include a `setup.md` noting webhook registration:
  `POST /setWebhook?url=https://rugradar-bot.ghwmelite.workers.dev`.
- README section on how the two workers relate.

## F5 — Deployer rap sheet

Surface serial ruggers. Constrained to what free providers expose.

- GoPlus EVM security already returns `creator_address`/`creator_percent`;
  RugCheck exposes creator balance. Extend `lib/scan.ts` normalization to
  carry `deployerAddress` (EVM via GoPlus; Solana when available) into
  `TokenReport`.
- New lib `lib/deployer.ts`: given a deployer address, query DexScreener
  for other tokens associated with it where possible, and cross-reference
  the KV scan log (F3) for previously scanned tokens by the same deployer.
  Honest scope note: without an indexer this is best-effort — show
  "previously seen by RugRadar" plus on-chain creator stats, never claim
  complete history.
- Report page: new "Deployer" card — address (truncated, explorer link),
  dev wallet % of supply, prior tokens seen by RugRadar with their scores,
  "serial deployer" warning when ≥2 prior tokens scored AVOID.

## F6 — Browser extension badge

Overlay the score inside traders' existing tools. `extension/` folder,
Manifest V3, framework-free vanilla TS/JS.

- Content scripts for `dexscreener.com`, `pump.fun`, `axiom.trade`:
  extract chain+address from the page URL/DOM, fetch
  `https://rugradar.ghwmelite.workers.dev/api/scan`, inject a compact score
  badge (color-coded pill: score + band) near the token name; click → full
  report in a new tab.
- Cache results in `chrome.storage.session` for 5min to respect rate limits.
- `host_permissions` for our worker + the three DEX sites only.
- Include `extension/README.md` with load-unpacked instructions and a note
  on CORS: the web app must allow cross-origin `GET /api/scan` from the
  extension (add `Access-Control-Allow-Origin: *` header to `/api/scan`
  responses — public read-only data, acceptable).

## Cross-cutting

- All features must keep `pnpm test` and `pnpm build` green.
- Match existing style: zinc/emerald dark theme, plain `<img>` via
  `lib/imageProxy.ts`, no new runtime deps without justification.
- The score is never "safe"; copy always says "flags red flags".
