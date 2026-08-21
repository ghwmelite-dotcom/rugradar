# RugRadar Telegram bot — setup

`rugradar-bot` is a standalone Cloudflare Worker, fully independent of the
Next.js web app (`rugradar`). The two workers only talk over the public
HTTP API: the bot receives Telegram webhooks, calls
`GET https://rugradar.trademetricspro.com/api/resolve` and `/api/scan`,
and replies with a formatted risk card linking to the full report page.
Deploying or breaking one worker never affects the other.

## 1. Create the bot with @BotFather

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a display name (e.g. `RugRadar`) and a username ending in `bot`
   (e.g. `@rugradar_bot`).
3. BotFather replies with the bot token (`123456:ABC-DEF…`). Keep it secret.

Optional but recommended for groups: send `/setprivacy` to @BotFather and
set it to **Disable** if you want the bot to see all group messages. With
privacy enabled (default), the bot only sees commands and replies to its own
messages — addresses pasted in free text won't reach it.

## 2. Store the token as a Worker secret

From this directory (`telegram-bot/`):

```sh
npm install
npx wrangler secret put TELEGRAM_BOT_TOKEN
# paste the BotFather token when prompted
```

Optionally set a webhook secret so only Telegram (which echoes it back in
the `X-Telegram-Bot-Api-Secret-Token` header) can post updates:

```sh
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# any long random string, e.g. `openssl rand -hex 32`
```

## 3. Deploy

```sh
npm run deploy        # == npx wrangler deploy
```

The worker goes live at `https://rugradar-bot.ghwmelite.workers.dev`.
`GET /` returns `rugradar-bot OK` as a health check.

## 4. Register the webhook with Telegram

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://rugradar-bot.ghwmelite.workers.dev",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

Omit `secret_token` if you skipped step 2's optional secret. Verify with:

```sh
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 5. Use it

Add the bot to a group (or DM it) and paste any token contract address —
EVM (`0x…` 40 hex chars) or Solana (base58, 32–44 chars) — anywhere in a
message. The bot scans up to 3 addresses per message and replies with a
card: name ($SYMBOL), chain, score/100 with band emoji (🚨 AVOID /
⚠️ CAUTION / ✅ LOWER RISK), a honeypot callout when detected, the top 3
risk flags, and a link to the full report.
