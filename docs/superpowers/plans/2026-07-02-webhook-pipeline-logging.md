# Webhook Pipeline Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stage-level structured JSON logging across the webhook pipeline so the operator can trace a single request end-to-end in Vercel logs and diagnose failures like `store_unconfigured` and `JSON.parse` errors.

**Architecture:** A new `lib/log.ts` module exposes a tiny `Logger` interface and a `createLogger({ requestId })` factory. `ingest()` takes an optional `logger` parameter (defaulting to a no-op) and emits lines at every step. The two API routes and the home page generate a per-request `requestId` via `crypto.randomUUID()` and pass a logger into `ingest()` / their own try blocks. All log lines are one-line JSON written via `console.log` / `console.error`. No new dependencies.

**Tech Stack:** Next.js 16.2.6, TypeScript 5, Node's built-in test runner (`node --test`). Logger uses `crypto.randomUUID()` and `console.*` — both stdlib.

**Spec:** `docs/superpowers/specs/2026-07-02-webhook-pipeline-logging-design.md`

---

## File Structure

- **New** `lib/log.ts` — JSON logger module (~50 lines).
- **New** `test/log.test.ts` — unit tests for the logger (~70 lines).
- **Modified** `lib/ingest.ts` — add `logger?` parameter, emit `ingest.start` / `ingest.order_classified` / `ingest.claim` / `ingest.redis_error` events.
- **Modified** `test/ingest.test.ts` — one new test asserting the three info stages are emitted in order through a capturing logger.
- **Modified** `app/api/webhook/route.ts` — generate `requestId`, log request lifecycle.
- **Modified** `app/api/events/route.ts` — generate `requestId`, log request lifecycle.
- **Modified** `app/page.tsx` — generate `requestId`, log store probe.
- **Unchanged** `lib/store.ts`, `lib/verify.ts`, `lib/types.ts`, `app/events/page.tsx`, `app/events/event-tester.tsx`, `package.json`.

---

## Task 1: Logger module + unit tests

**Files:**
- Create: `lib/log.ts`
- Create: `test/log.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `test/log.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, noopLogger } from "../lib/log.ts";

test("createLogger emits one JSON line with required fields", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "req_123" });
    logger.info("test.stage", "hello");
  } finally {
    console.log = orig;
  }
  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.requestId, "req_123");
  assert.equal(parsed.stage, "test.stage");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "hello");
  assert.equal(typeof parsed.ts, "string");
});

test("createLogger merges extra into top-level JSON", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.info("s", "m", { foo: "bar", n: 42 });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.foo, "bar");
  assert.equal(parsed.n, 42);
});

test("createLogger skips reserved keys supplied via extra", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.info("s", "m", {
      requestId: "evil",
      level: "fake",
      stage: "fake",
      msg: "fake",
      ts: "fake",
      extra: "kept",
    });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.requestId, "r1");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.stage, "s");
  assert.equal(parsed.msg, "m");
  assert.equal(parsed.extra, "kept");
});

test("error level writes to console.error", () => {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (line: string) => { out.push(String(line)); };
  console.error = (line: string) => { err.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.error("e.stage", "boom");
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(out.length, 0);
  assert.equal(err.length, 1);
  const parsed = JSON.parse(err[0]);
  assert.equal(parsed.level, "error");
});

test("warn level writes to console.log", () => {
  const out: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { out.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.warn("w.stage", "watch out");
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.level, "warn");
});

test("noopLogger is callable and produces no output", () => {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => { out.push(String(line)); };
  console.error = (line: string) => { err.push(String(line)); };
  try {
    noopLogger.info("s", "m");
    noopLogger.warn("s", "m");
    noopLogger.error("s", "m");
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(out.length, 0);
  assert.equal(err.length, 0);
});

test("logger does not throw when extra contains a circular reference", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    logger.info("s", "m", { circ });
  } finally {
    console.log = orig;
  }
  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.loggingError, "stringify_failed");
});
```

- [ ] **Step 2: Run the test to verify it fails (module not found)**

Run: `npm test`
Expected: FAIL with `Error: Cannot find module '../lib/log.ts'` (or similar import resolution error).

- [ ] **Step 3: Implement `lib/log.ts`**

Create `lib/log.ts`:

```ts
const RESERVED_KEYS = new Set(["ts", "level", "requestId", "stage", "msg"]);

export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info(stage: string, msg: string, extra?: Record<string, unknown>): void;
  warn(stage: string, msg: string, extra?: Record<string, unknown>): void;
  error(stage: string, msg: string, extra?: Record<string, unknown>): void;
};

function emit(
  level: LogLevel,
  requestId: string,
  stage: string,
  msg: string,
  extra: Record<string, unknown> | undefined,
): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    requestId,
    stage,
    msg,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (RESERVED_KEYS.has(k)) continue;
      line[k] = v;
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(line);
  } catch {
    const fallback = {
      ts: line.ts,
      level,
      requestId,
      stage,
      msg,
      loggingError: "stringify_failed",
    };
    serialized = JSON.stringify(fallback);
  }
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function createLogger(opts: { requestId: string }): Logger {
  const { requestId } = opts;
  const safe =
    (level: LogLevel) =>
    (stage: string, msg: string, extra?: Record<string, unknown>) => {
      try {
        emit(level, requestId, stage, msg, extra);
      } catch {
        // never throw
      }
    };
  return {
    info: safe("info"),
    warn: safe("warn"),
    error: safe("error"),
  };
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: all 7 new tests pass; existing `ingest.test.ts` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/log.ts test/log.test.ts
git commit -m "feat(log): add hand-rolled JSON logger with noop fallback"
```

---

## Task 2: Extend `ingest()` with logger + log events

**Files:**
- Modify: `lib/ingest.ts`
- Modify: `test/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Append the following test to `test/ingest.test.ts` (after the last existing test, before the closing of the file):

```ts
test("ingest: emits start, order_classified, claim log stages in order", async () => {
  const events: Array<{ level: string; stage: string }> = [];
  const capturingLogger = {
    info(stage: string, msg: string) {
      events.push({ level: "info", stage });
    },
    warn(stage: string, msg: string) {
      events.push({ level: "warn", stage });
    },
    error(stage: string, msg: string) {
      events.push({ level: "error", stage });
    },
  };
  const store = makeFakeStore();
  await ingest({
    store,
    headers: { "x-webhook-id": "log_1" },
    body: "{}",
    source: "s",
    logger: capturingLogger,
  });
  const stages = events.map((e) => e.stage);
  const startIdx = stages.indexOf("ingest.start");
  const orderIdx = stages.indexOf("ingest.order_classified");
  const claimIdx = stages.indexOf("ingest.claim");
  assert.ok(startIdx >= 0, "ingest.start logged");
  assert.ok(orderIdx > startIdx, "ingest.order_classified after start");
  assert.ok(claimIdx > orderIdx, "ingest.claim after order_classified");
});

test("ingest: logs ingest.redis_error when store.maxSeqForSource throws", async () => {
  const events: Array<{ level: string; stage: string; op?: string }> = [];
  const capturingLogger = {
    info(stage: string) { events.push({ level: "info", stage }); },
    warn(stage: string) { events.push({ level: "warn", stage }); },
    error(stage: string, _msg: string, extra?: Record<string, unknown>) {
      events.push({ level: "error", stage, op: extra?.op as string | undefined });
    },
  };
  const store: IngestStore = {
    async claimAndStore() { throw new Error("should not be called"); },
    async maxSeqForSource() { throw new Error("redis down"); },
    async listByTime() { return []; },
    async getEvent() { return null; },
  };
  await assert.rejects(
    () => ingest({
      store,
      headers: { "x-webhook-id": "err_1" },
      body: "{}",
      source: "s",
      logger: capturingLogger,
    }),
    /redis down/,
  );
  const redisErr = events.find((e) => e.stage === "ingest.redis_error");
  assert.ok(redisErr, "ingest.redis_error logged");
  assert.equal(redisErr!.op, "maxSeqForSource");
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test`
Expected: the two new tests FAIL with `events.find` returning undefined (no log events emitted) and `assert.ok(redisErr)` failing.

- [ ] **Step 3: Modify `lib/ingest.ts`**

Replace the contents of `lib/ingest.ts` with:

```ts
import { createHash } from "node:crypto";
import type { IngestStore, EventInput, ClaimResult, OrderStatus } from "./types.ts";
import type { Logger } from "./log.ts";
import { noopLogger } from "./log.ts";

const ID_HEADERS = [
  "x-webhook-id",
  "x-github-delivery",
  "x-gitlab-event-uuid",
  "x-shopify-webhook-id",
  "x-stripe-event-id",
];

const SEQ_HEADERS = [
  "x-webhook-sequence",
  "x-webhook-seq",
  "x-github-sequence",
];

const SOURCE_HEADERS = [
  "x-webhook-source",
  "x-github-event",
  "x-gitlab-event",
  "x-shopify-topic",
];

function firstHeader(headers: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const v = headers[name];
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}

export function deriveEventId(input: { headers: Record<string, string>; body: string }): string {
  const fromHeader = firstHeader(input.headers, ID_HEADERS);
  if (fromHeader) return fromHeader;
  const fromBody = tryReadEventIdFromJson(input.body);
  if (fromBody) return fromBody;
  return createHash("sha256").update(input.body).digest("hex");
}

function tryReadEventIdFromJson(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["event_id", "id", "delivery_id"]) {
      const v = parsed[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
  } catch {
    return null;
  }
  return null;
}

function deriveSeq(input: { headers: Record<string, string>; body: string }): number | null {
  const h = firstHeader(input.headers, SEQ_HEADERS);
  if (h && /^\d+$/.test(h)) return parseInt(h, 10);
  const trimmed = input.body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["sequence", "seq", "sequence_number"]) {
        const v = parsed[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function deriveSource(input: { headers: Record<string, string> }): string {
  const h = firstHeader(input.headers, SOURCE_HEADERS);
  return h ?? "unknown";
}

export async function ingest(input: {
  store: IngestStore;
  headers: Record<string, string>;
  body: string;
  source?: string;
  logger?: Logger;
}): Promise<ClaimResult> {
  const logger = input.logger ?? noopLogger;
  const headers = normalizeHeaders(input.headers);
  const eventId = deriveEventId({ headers, body: input.body });
  const source = (input.source && input.source.trim()) || deriveSource({ headers });
  const seq = deriveSeq({ headers, body: input.body });

  logger.info("ingest.start", "ingest called", {
    eventId,
    source,
    seq,
    bodyLength: input.body.length,
  });

  let maxSeq: number | null = null;
  let orderStatus: OrderStatus = "no_seq";
  if (seq != null) {
    try {
      maxSeq = await input.store.maxSeqForSource(source);
    } catch (e) {
      logger.error("ingest.redis_error", "maxSeqForSource failed", {
        error: (e as Error).message,
        op: "maxSeqForSource",
      });
      throw e;
    }
    if (maxSeq == null) orderStatus = "in_order";
    else if (seq <= maxSeq) orderStatus = "late";
    else if (seq === maxSeq + 1) orderStatus = "in_order";
    else orderStatus = "gap_detected";
  }

  logger.info("ingest.order_classified", "order status determined", {
    orderStatus,
    maxSeq,
  });

  const eventInput: EventInput = {
    eventId,
    source,
    seq,
    body: input.body,
    orderStatus,
    receivedAt: Date.now(),
    headers,
  };

  const claimStart = Date.now();
  let result: ClaimResult;
  try {
    result = await input.store.claimAndStore(eventInput);
  } catch (e) {
    logger.error("ingest.redis_error", "claimAndStore failed", {
      error: (e as Error).message,
      op: "claimAndStore",
    });
    throw e;
  }
  const durationMs = Date.now() - claimStart;

  logger.info("ingest.claim", "claim completed", {
    status: result.status,
    durationMs,
  });

  return result;
}

function normalizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass (15 ingest tests + 7 log tests = 22 total).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest.ts test/ingest.test.ts
git commit -m "feat(ingest): emit structured log events at every step"
```

---

## Task 3: Wire logger into `app/api/webhook/route.ts`

**Files:**
- Modify: `app/api/webhook/route.ts`

- [ ] **Step 1: Replace the contents of `app/api/webhook/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ingest } from "../../../lib/ingest.ts";
import { getStore } from "../../../lib/store.ts";
import { createLogger } from "../../../lib/log.ts";
import { verifySignature } from "../../../lib/verify.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function headersToObject(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestStart = Date.now();
  const requestId = randomUUID();
  const logger = createLogger({ requestId });

  const rawBody = await req.text();
  const headers = headersToObject(req);
  const signaturePresent = Boolean(headers["x-webhook-signature"]);

  logger.info("webhook.request_received", "POST received", {
    method: "POST",
    contentLength: rawBody.length,
    signaturePresent,
  });

  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const sig = headers["x-webhook-signature"] ?? null;
    if (!verifySignature(rawBody, sig, secret)) {
      const reason = sig ? "bad_signature" : "missing_header";
      logger.warn("webhook.hmac_failed", "HMAC verification failed", { reason });
      return NextResponse.json(
        { error: "invalid_signature" },
        { status: 401 },
      );
    }
    logger.info("webhook.hmac_ok", "HMAC verified");
  }

  let store;
  try {
    store = getStore();
  } catch (e) {
    logger.error("webhook.store_unconfigured", "getStore threw", {
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "store_unconfigured", message: (e as Error).message },
      { status: 503 },
    );
  }

  const result = await ingest({
    store,
    headers,
    body: rawBody,
    logger,
  });

  logger.info("webhook.completed", "request completed", {
    status: result.status,
    totalDurationMs: Date.now() - requestStart,
  });

  return NextResponse.json(
    {
      status: result.status,
      event: {
        eventId: result.event.eventId,
        source: result.event.source,
        seq: result.event.seq,
        orderStatus: result.event.orderStatus,
        receivedAt: result.event.receivedAt,
      },
    },
    { status: 200 },
  );
}

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const logger = createLogger({ requestId });
  logger.info("webhook.get_hint", "GET hint probe");
  return NextResponse.json({
    ok: true,
    hint: "POST a webhook to this URL. See / for the strategy.",
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhook/route.ts
git commit -m "feat(webhook): emit lifecycle log events on POST/GET"
```

---

## Task 4: Wire logger into `app/api/events/route.ts`

**Files:**
- Modify: `app/api/events/route.ts`

- [ ] **Step 1: Replace the contents of `app/api/events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "../../../lib/store.ts";
import { createLogger } from "../../../lib/log.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const logger = createLogger({ requestId });
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);
  const start = Date.now();

  let store;
  try {
    store = getStore();
  } catch (e) {
    logger.error("events.store_unconfigured", "getStore threw", {
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "store_unconfigured", message: (e as Error).message },
      { status: 503 },
    );
  }

  const events = await store.listByTime(limit);
  logger.info("events.list", "events listed", {
    limit,
    count: events.length,
    durationMs: Date.now() - start,
  });
  return NextResponse.json({ events });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/events/route.ts
git commit -m "feat(events): emit lifecycle log events on GET /api/events"
```

---

## Task 5: Wire logger into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the logger to `app/page.tsx`**

Edit `app/page.tsx` to:
1. Add two imports at the top, after the `next/link` import:

```ts
import { randomUUID } from "node:crypto";
import { createLogger } from "../lib/log.ts";
```

2. Replace the body of `export default async function Home()` with the version below (keep the same `try/catch` shape, only add logger calls inside):

```tsx
export default async function Home() {
  const requestId = randomUUID();
  const logger = createLogger({ requestId });
  let storeStatus: "ok" | "unconfigured" = "ok";
  let storeMessage: string | null = null;
  let eventCount = 0;
  const start = Date.now();
  try {
    const events = await getStore().listByTime(1);
    eventCount = events.length;
    logger.info("home.list", "store probe ok", {
      count: eventCount,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    storeStatus = "unconfigured";
    storeMessage = (e as Error).message;
    logger.warn("home.list_error", "store probe failed", {
      error: (e as Error).message,
    });
  }

  return (
    <main className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Reliable webhook handler
          </h1>
          <p className="mt-2 text-zinc-600">
            Exactly-once delivery under retries, duplicates, and out-of-order events.
            Persisted in Redis, so a restart loses nothing.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              href="/events"
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              View events →
            </Link>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                storeStatus === "ok"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  storeStatus === "ok" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              {storeStatus === "ok" ? `Store OK · ${eventCount} recent` : "Store unconfigured"}
            </span>
          </div>
        </header>

        <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Endpoint</h2>
          <code className="mt-2 block rounded-md bg-zinc-100 px-3 py-2 font-mono text-sm">
            POST {endpointUrl(WEBHOOK_PATH)}
          </code>
          {storeMessage && (
            <p className="mt-3 text-sm text-red-700">{storeMessage}</p>
          )}
          <p className="mt-3 text-sm text-zinc-600">
            Sends a 200 for both first-time and duplicate deliveries. Duplicates
            are dropped at the door — only the original is stored.
          </p>
        </section>

        <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">How it works</h2>

          <div className="mt-4 space-y-5 text-sm leading-relaxed text-zinc-700">
            <div>
              <h3 className="font-semibold text-zinc-900">1. Idempotency</h3>
              <p className="mt-1">
                The receiver derives an <code>event_id</code> from the request —
                any of <code>X-Webhook-Id</code>, <code>X-GitHub-Delivery</code>,{" "}
                <code>event_id</code>/<code>id</code> in the JSON body, or as a
                last resort a SHA-256 of the raw body. A Lua script in Redis
                atomically claims the id (SET-IF-NOT-EXISTS) and writes the
                event record in a single round trip. If the id is already
                claimed, the script returns the original record — the duplicate
                is rejected with the same 200 OK the sender expects.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-zinc-900">2. Ordering</h3>
              <p className="mt-1">
                Events carry a per-source <code>seq</code> (header{" "}
                <code>X-Webhook-Sequence</code> or a <code>sequence</code> field
                in the body). Each event is tagged at accept time:{" "}
                <code>in_order</code> (the next expected), <code>late</code>{" "}
                (arrived after a higher seq), or <code>gap_detected</code>{" "}
                (higher than the next expected, so earlier events are missing).
                The handler does not buffer — every unique event is stored
                exactly once, and the UI sorts by seq to reconstruct the true
                order. This is the standard event-sourcing answer: out-of-order
                arrival is a property of the data, not the processing.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-zinc-900">3. Persistence</h3>
              <p className="mt-1">
                Everything lives in Upstash Redis (REST). Dedup markers carry
                a 30-day TTL; event records carry a 90-day TTL. The receiver
                process holds no in-memory state — restarts, redeploys, and
                cold starts all observe the same dedup state, so a retry
                mid-restart still gets exactly-once.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-zinc-900">4. Optional HMAC</h3>
              <p className="mt-1">
                If the <code>WEBHOOK_SECRET</code> env var is set, every request
                must include <code>X-Webhook-Signature: sha256=&lt;hex&gt;</code>{" "}
                over the raw body. Bad or missing signatures are rejected with
                401.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Try it</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Send the same event three times — the second and third are flagged
            as <code>duplicate</code>. Then send seq 5, 3, 4 — the late
            arrivals are tagged <code>late</code> and the gap is flagged.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md bg-zinc-900 px-4 py-3 font-mono text-xs text-zinc-100">
{`# First delivery — accepted
curl -X POST https://webhook-handler-zeta.vercel.app/api/webhook \\
  -H 'Content-Type: application/json' \\
  -H 'X-Webhook-Id: evt_42' \\
  -H 'X-Webhook-Source: github' \\
  -H 'X-Webhook-Sequence: 1' \\
  -d '{"action":"opened","issue":42}'

# Same event again — duplicate
curl -X POST https://webhook-handler-zeta.vercel.app/api/webhook \\
  -H 'X-Webhook-Id: evt_42' \\
  -H 'X-Webhook-Source: github' \\
  -H 'X-Webhook-Sequence: 1' \\
  -d '{"action":"opened","issue":42}'`}
          </pre>
          <div className="mt-4 flex gap-3">
            <Link
              href="/events"
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Open the live event stream
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): emit log events for store probe"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: 22 tests pass (15 in `test/ingest.test.ts`, 7 in `test/log.test.ts`).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: build succeeds. (If Next.js 16's `next build` rejects anything the route changes did, fix the smallest possible way and re-run; the spec is framework-agnostic on purpose but the build is the source of truth.)

- [ ] **Step 4: Commit (if anything was adjusted)**

```bash
git status
# If anything is dirty:
git add -A
git commit -m "chore: fix build/lint issues from logging rollout"
```

---

## Self-Review Notes

- **Spec coverage:** `lib/log.ts` and `test/log.test.ts` → Task 1. `ingest()` logger param + stages → Task 2. Webhook route → Task 3. Events route → Task 4. Home page → Task 5. Verification → Task 6. All 13 catalog stages are covered: `webhook.request_received`, `webhook.hmac_ok`, `webhook.hmac_failed`, `webhook.store_unconfigured`, `ingest.start`, `ingest.order_classified`, `ingest.claim`, `ingest.redis_error` (×2 ops), `webhook.completed`, `webhook.get_hint`, `events.list`, `events.store_unconfigured`, `home.list`, `home.list_error`.
- **Type consistency:** `Logger` defined once in `lib/log.ts` and imported in `lib/ingest.ts`. `noopLogger` is the default when `logger?` is omitted. The `ingest()` input type is extended with `logger?: Logger` (optional, no breaking change for existing callers).
- **Placeholders:** none. Every step has the actual code.
- **Build/lint:** the plan ends with a verification task that fixes any framework surprises (Next 16's `next build` is the source of truth).
