# rugradar-watch — Deathwatch cron worker

Cron monitor + alert engine for RugRadar Deathwatch. Every 2 minutes it
rotates through the shared KV watchlist (`watch:list`, ≤25 tokens per run,
cursor in `watch:cursor`), pulls fresh liquidity from DexScreener, diffs
against the last snapshot (`watch:snap:{chain}:{addr}`), and on a
warning/critical/rug event prepends to `alerts:recent`, broadcasts to all
Telegram subscribers (`tg:subs`), and writes `calledit:list` receipts when
a flag preceded the rug. Full KV schema: `docs/DEATHWATCH.md`.

## Deploy

```sh
cd watch-worker
npm install          # wrangler is the only devDependency
npx wrangler deploy
```

## Secrets

The bot token is never committed. Set it once after the first deploy:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Use the same bot token as `rugradar-bot` (alerts are delivered by the same
Telegram bot).

## Health check

```sh
curl https://rugradar-watch.<your-subdomain>.workers.dev
# → watch-worker OK — watching N tokens
```

## Notes

- Cron only runs when deployed — `wrangler dev` does not fire scheduled
  events on a timer (you can trigger one manually via
  `curl "http://localhost:8787/__scheduled?cron=*/2+*+*+*+*"` while
  `wrangler dev` is running).
- Local dev KV is an in-memory preview namespace, not the production one;
  real watchlist data only exists in production.
