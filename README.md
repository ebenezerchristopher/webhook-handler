# Reliable webhook handler

Webhook receiver that guarantees exactly-once delivery under retries, duplicates, and out-of-order events. Persisted in Upstash Redis, so a restart loses nothing.

- **Endpoint:** `POST /api/webhook` — see the homepage for live state.
- **Live event stream:** `/events` — and a built-in test sender.
- **Idempotency:** event_id from `X-Webhook-Id` / `X-GitHub-Delivery` / JSON body's `event_id` / `id`, or `sha256(raw_body)` as a last resort. A Lua script in Redis atomically claims the id and stores the event in a single round trip — no race window.
- **Out-of-order:** per-source `seq` (from `X-Webhook-Sequence` header or JSON body's `sequence`/`seq`). Every event is stored exactly once and tagged `in_order | late | gap_detected`. The handler does not buffer; ordering is a property of the stored data, not the processing.
- **Persistence:** everything lives in Upstash Redis (REST, REST-friendly). Dedup markers TTL = 30 days, event records TTL = 90 days. No in-memory state in the receiver.
- **Optional HMAC:** if `WEBHOOK_SECRET` is set, requests must carry `X-Webhook-Signature: sha256=<hex>` over the raw body. Bad/missing → 401.

## Strategy (short)

The dedup key is `{source}:{event_id}`. The Lua script does the claim + the write in a single round trip:

```lua
local existing = redis.call('GET', KEYS[2])   -- KEYS[2] = wh:event:{event_id}
if existing then return {'duplicate', existing} end
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[5]))   -- dedup marker
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[6]))  -- event record
if ARGV[3] ~= '' then
  redis.call('ZADD', KEYS[4], tonumber(ARGV[3]), ARGV[2])  -- by-seq index
  -- ... update high-water mark
end
redis.call('ZADD', KEYS[5], tonumber(ARGV[4]), ARGV[2])    -- by-time index
return {'accepted', ARGV[1]}
```

This is true exactly-once, even under concurrent retries of the same event: the claim and the write happen in the same atomic step. Out-of-order events get the same treatment — they have unique `event_id`s, so the dedup path doesn't trigger, and the seq-based index lets the UI reconstruct the true order on read.

## Local development

```bash
npm install
npm test        # 13 tests
npm run lint
npm run build
npm run dev
```

The dev server needs `KV_REST_API_URL` and `KV_REST_API_TOKEN` in the environment to be useful (otherwise `/api/webhook` returns 503 with `store_unconfigured`).

## Deploy

See [`DEPLOY.md`](./DEPLOY.md).
