# Deploy to Vercel

The app is ready. Two paths — pick one:

## Path A — One-click via GitHub (no CLI, no token)

1. **Push this repo to GitHub** (it's already a git repo pointing at `Jppblue/ai-builder-starter`).
   ```bash
   git push origin master
   ```
2. **Import into Vercel**: open https://vercel.com/new, sign in, click "Import" next to `Jppblue/ai-builder-starter`. Accept the framework preset (Next.js). **Do not deploy yet** — first add the storage:
3. **Provision Upstash Redis**:
   - In the Vercel project screen, open the **Storage** tab → **Create Database** → **Redis** → pick **Upstash** from the marketplace.
   - Pick a region close to your function region. Free tier is fine.
   - Vercel will auto-bind two env vars: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Confirm they appear in **Settings → Environment Variables** before deploying.
4. **(Optional) Add a webhook secret** for HMAC: in **Settings → Environment Variables**, add `WEBHOOK_SECRET` = any random string. Send `X-Webhook-Signature: sha256=<hex>` from the sender.
5. Click **Deploy**. Vercel assigns a URL like `https://ai-builder-starter-<hash>.vercel.app`. That's the live URL.

## Path B — Vercel CLI (if you want me to drive it)

If you'd rather I do it, paste a Vercel token in the chat:
1. Get one at https://vercel.com/account/tokens (Create Token, scope: Full Account).
2. Send it to me.
3. I'll `vercel deploy --prod --yes` and read back the URL.

## After deploy

Verify the bar:
```bash
URL=https://ai-builder-starter-<hash>.vercel.app

# 1) First delivery — accepted
curl -s -X POST "$URL/api/webhook" \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Id: evt_42' \
  -H 'X-Webhook-Source: github' \
  -H 'X-Webhook-Sequence: 1' \
  -d '{"action":"opened"}'
# -> {"status":"accepted",...}

# 2) Same event again — duplicate, same record
curl -s -X POST "$URL/api/webhook" \
  -H 'X-Webhook-Id: evt_42' \
  -H 'X-Webhook-Source: github' \
  -H 'X-Webhook-Sequence: 1' \
  -d '{"action":"opened"}'
# -> {"status":"duplicate",...}

# 3) Out-of-order
curl -s -X POST "$URL/api/webhook" -H 'X-Webhook-Id: ooo_a' -H 'X-Webhook-Source: demo' -H 'X-Webhook-Sequence: 5' -d '{}'
curl -s -X POST "$URL/api/webhook" -H 'X-Webhook-Id: ooo_b' -H 'X-Webhook-Source: demo' -H 'X-Webhook-Sequence: 3' -d '{}'
# ooo_b should be tagged "late"

# 4) Persistence: hit the events UI
open "$URL/events"
```

## Submission

When it's live, the URL to submit is the root: `https://<your-app>.vercel.app/`.
The webhook endpoint itself is `https://<your-app>.vercel.app/api/webhook`.
