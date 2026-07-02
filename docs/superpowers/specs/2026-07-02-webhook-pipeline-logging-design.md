# Webhook pipeline logging

Date: 2026-07-02
Status: approved (pending user review of written spec)

## Problem

The webhook handler is deployed to Vercel but is effectively a black box from
the operator's seat. Production has surfaced errors that are hard to diagnose
from the response alone — e.g. a `store_unconfigured` 503 even when Upstash
Redis *is* configured, and a `JSON.parse` failure from the Redis Lua-script
result path. Vercel logs show the symptom but not the pipeline step that
produced it.

The goal is to make every stage of the request pipeline observable in Vercel
logs with a single per-request `requestId` that ties all the lines together,
without leaking request bodies, signature values, or webhook secrets.

## Non-goals

- No log shipping to Datadog / Sentry / etc. Vercel's built-in log viewer is
  the destination.
- No log level env var. `info` / `warn` / `error` is enough; can revisit if
  logs get noisy.
- No redaction-rules library. Safety is enforced at the call site: the
  logger is never passed the raw body, signature value, secret, or token.
- No request_id in response headers. Operators find the id in Vercel logs
  and grep by it there.

## Approach

A small hand-rolled JSON logger (`lib/log.ts`) injected as an optional
parameter into the parts of the pipeline that already take a store. The HTTP
route generates a per-request id and passes a logger bound to it. `ingest()`
takes a logger and emits lines at every step. Errors during logging must
never break a request.

Zero new dependencies. No changes to `lib/store.ts`, `lib/verify.ts`,
`lib/types.ts`, or `package.json`.

## New module: `lib/log.ts`

```ts
export type LogLevel = "info" | "warn" | "error";
export type Logger = {
  info(stage: string, msg: string, extra?: Record<string, unknown>): void;
  warn(stage: string, msg: string, extra?: Record<string, unknown>): void;
  error(stage: string, msg: string, extra?: Record<string, unknown>): void;
};
export function createLogger(opts: { requestId: string }): Logger;
export const noopLogger: Logger;
```

**Emitted line shape** (one line, valid JSON):
```
{"ts":"2026-07-02T01:23:45.678Z","level":"info","requestId":"...","stage":"...","msg":"...","...":...}
```

**Contract:**
- `info` / `warn` write to `console.log`; `error` writes to `console.error`.
  Vercel surfaces these at the matching level in its log UI.
- `requestId` is always present.
- Reserved keys (`ts`, `level`, `requestId`, `stage`, `msg`) cannot be
  overridden by `extra`. If `extra` contains a reserved key, it is skipped
  and the rest of the extras are emitted.
- The logger never throws. If `JSON.stringify` on extras throws (e.g.
  circular reference) the call falls back to a minimal line containing
  `{"ts":...,"level":...,"requestId":...,"stage":...,"msg":...,"loggingError":"..."}`.
- The logger never logs the raw body, the signature header value, the
  `WEBHOOK_SECRET`, or the Upstash token. This is a contract on callers,
  not enforced by the module.

## Log event catalog

One log line per call. Stage names are stable — they are what the operator
filters on in Vercel.

| Stage | Level | When | Extras |
|---|---|---|---|
| `webhook.request_received` | info | POST hits `/api/webhook` | `method`, `contentLength`, `signaturePresent` (boolean) |
| `webhook.hmac_ok` | info | HMAC signature verified | — |
| `webhook.hmac_failed` | warn | HMAC mismatch | `reason`: `"missing_header"` \| `"bad_signature"` |
| `webhook.store_unconfigured` | error | `getStore()` threw | `error` (message only) |
| `ingest.start` | info | `ingest()` called | `eventId`, `source`, `seq` (`number` or `null`), `bodyLength` |
| `ingest.order_classified` | info | order status determined | `orderStatus`, `maxSeq` (`number` or `null`) |
| `ingest.claim` | info | `claimAndStore` returned | `status` (`"accepted"` \| `"duplicate"`), `durationMs` |
| `ingest.redis_error` | error | Redis call threw | `error`, `op` (`"maxSeqForSource"` \| `"claimAndStore"`) |
| `webhook.completed` | info | route returning 200 | `status`, `totalDurationMs` |
| `events.list` | info | GET `/api/events` finished | `limit`, `count`, `durationMs` |
| `events.store_unconfigured` | error | GET `/api/events` store missing | `error` |
| `home.list` | info | home page store probe finished | `count`, `durationMs` (only on success) |
| `home.list_error` | warn | home page store probe failed | `error` |
| `webhook.get_hint` | info | GET `/api/webhook` hint probe | — |

`webhook.completed` and `ingest.claim` are tied to the request's start by
`requestId` — Vercel's `requestId:<uuid>` filter shows the full timeline.

No `debug` level. `info` covers the happy path, `warn` covers recoverable
issues, `error` covers failures.

## Changes per file

### `lib/ingest.ts` (modified)

- Add `logger?: Logger` parameter to the `ingest()` input. Default to
  `noopLogger` when omitted (so existing callers and tests are unchanged).
- Wrap `store.maxSeqForSource` in a try/catch: on throw, log
  `ingest.redis_error` with `op: "maxSeqForSource"` and re-throw (caller
  handles the response).
- Wrap `store.claimAndStore` in a try/catch: on throw, log
  `ingest.redis_error` with `op: "claimAndStore"` and re-throw.
- Before the `maxSeqForSource` call, log `ingest.start` with the derived
  `eventId` / `source` / `seq` / `bodyLength`.
- After the order-status decision, log `ingest.order_classified` with
  `orderStatus` and `maxSeq`.
- After `claimAndStore` returns, log `ingest.claim` with `status` and
  `durationMs` measured around that call only.

### `app/api/webhook/route.ts` (modified)

- At the top of `POST`, generate `requestId = crypto.randomUUID()` and
  build a logger via `createLogger({ requestId })`.
- Read the body, compute `contentLength = rawBody.length`, and log
  `webhook.request_received` with `method: "POST"`, `contentLength`, and
  `signaturePresent: Boolean(headers["x-webhook-signature"])`.
- After HMAC verify: log `webhook.hmac_ok` or `webhook.hmac_failed` with
  `reason`. Use the same `reason` taxonomy as the catalog.
- Around the `getStore()` call, catch the throw, log
  `webhook.store_unconfigured`, then return 503 as today.
- After `ingest()` resolves, log `webhook.completed` with `status` and
  `totalDurationMs` measured from the start of the handler.
- `GET` (the hint probe) gets one `webhook.get_hint` info log so the
  endpoint is not silent.

### `app/api/events/route.ts` (modified)

- Generate a `requestId` and logger at the top of `GET`.
- Catch `getStore()` throw, log `events.store_unconfigured`, return 503 as
  today.
- Log `events.list` with `limit`, `count`, and `durationMs`.

### `app/page.tsx` (modified)

- Server-rendered per request. Generate a `requestId` and logger the same
  way the API routes do.
- In the try block, log `home.list` with `count` and `durationMs`.
- In the catch block, log `home.list_error` with `error`.

### `lib/log.ts` (new, ~40 lines)

Per the API above. One file. No exports beyond the four listed.

### `test/log.test.ts` (new, ~40 lines)

- `createLogger` emits a line that parses as JSON and contains `ts`,
  `level`, `requestId`, `stage`, `msg`.
- `createLogger` merges `extra` keys into the top-level JSON.
- `createLogger` skips reserved keys supplied via `extra`.
- `error` writes to `console.error`; `info` and `warn` write to
  `console.log`. (Stub the console methods and assert.)
- `noopLogger` is callable and produces no output.

### `test/ingest.test.ts` (extended, ~20 lines added)

- One new test: with a capturing logger (an object that pushes to an
  array), call `ingest()` and assert the array contains at least
  `ingest.start`, `ingest.order_classified`, and `ingest.claim` in that
  order. Existing tests continue to pass `logger` omitted.

## Error handling

- The logger never throws. All `JSON.stringify` paths are wrapped; on
  failure the call emits a minimal line and continues.
- A logging failure does not abort a request. The route handlers and
  `ingest()` catch any unexpected throw from the logger and continue.
- Existing error responses are preserved: 401 on bad HMAC, 503 on
  unconfigured store, 500 on Redis errors. The new logs make the cause
  visible, but the response code and body are unchanged.

## Next.js 16 notes

`AGENTS.md` flags that this is not the Next.js I know. Before writing code
I will read the relevant guide in `node_modules/next/dist/docs/` for
route handler logging and runtime conventions, and adjust the
implementation (e.g. if Next 16 prefers `request.headers` access patterns
I have not seen, or if the recommended logging integration has shifted).
The spec above is framework-agnostic on purpose — the logger is plain
Node `console` and the route changes are a few `await` boundaries apart.
No spec changes are expected from the doc read; only call-site
adjustments.

## Out of scope (YAGNI) — restated

- No log shipping. Vercel log viewer only.
- No `LOG_LEVEL` env var. Three fixed levels.
- No redaction library. Caller discipline.
- No `requestId` echo in response headers. Vercel-only correlation.
- No structured spans or trace IDs beyond the per-request UUID.
- No changes to `app/events/page.tsx` or `app/events/event-tester.tsx`
  (client UI; nothing to log server-side that isn't already on
  `app/api/events`).
