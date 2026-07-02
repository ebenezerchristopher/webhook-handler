// Unit tests for the ingest core. The fake store mimics the Lua-script
// contract (atomic claim + return existing record on duplicate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";

import { ingest, deriveEventId } from "../lib/ingest.ts";
import type { IngestStore, StoredEvent } from "../lib/types.ts";

// Minimal in-memory store that mirrors the Lua script's contract.
// A shared backing Map lets us simulate "process restart" — two store
// instances that read the same data behave the same as a single store
// after a Redis round-trip.
type FakeStore = IngestStore;
function makeFakeStore(shared?: {
  events: Map<string, unknown>;
  seqs: Map<string, number>;
}): FakeStore {
  const events = shared?.events ?? new Map<string, unknown>();
  const seqs = shared?.seqs ?? new Map<string, number>();
  return {
    async claimAndStore(input) {
      const key = `${input.source}:${input.eventId}`;
      if (events.has(key)) {
        return { status: "duplicate", event: events.get(key) as StoredEvent };
      }
      const stored: StoredEvent = { ...input, receivedAt: input.receivedAt ?? Date.now() };
      events.set(key, stored);
      if (typeof input.seq === "number" && Number.isFinite(input.seq)) {
        seqs.set(input.source, Math.max(seqs.get(input.source) ?? 0, input.seq));
      }
      return { status: "accepted", event: stored };
    },
    async maxSeqForSource(source: string) {
      return seqs.get(source) ?? null;
    },
    async listByTime(limit: number) {
      return Array.from(events.values())
        .sort(
          (a, b) => (b as { receivedAt: number }).receivedAt - (a as { receivedAt: number }).receivedAt,
        )
        .slice(0, limit) as never;
    },
    async getEvent(eventId: string) {
      for (const v of events.values()) {
        const e = v as { eventId: string };
        if (e.eventId === eventId) return e as never;
      }
      return null;
    },
  };
}

test("deriveEventId uses X-Webhook-Id when present", () => {
  const id = deriveEventId({
    headers: { "x-webhook-id": "evt_123" },
    body: '{"x":1}',
  });
  assert.equal(id, "evt_123");
});

test("deriveEventId falls back to X-GitHub-Delivery", () => {
  const id = deriveEventId({
    headers: { "x-github-delivery": "abcd-1234" },
    body: '{"x":1}',
  });
  assert.equal(id, "abcd-1234");
});

test("deriveEventId falls back to event_id in JSON body", () => {
  const id = deriveEventId({
    headers: {},
    body: JSON.stringify({ event_id: "in_body_1", type: "thing" }),
  });
  assert.equal(id, "in_body_1");
});

test("deriveEventId falls back to sha256 of raw body when no header/id", () => {
  const body = JSON.stringify({ type: "thing", n: 1 });
  const id = deriveEventId({ headers: {}, body });
  const expected = createHash("sha256").update(body).digest("hex");
  assert.equal(id, expected);
});

test("ingest: first call is accepted, second with same id is duplicate", async () => {
  const store = makeFakeStore();
  const r1 = await ingest({
    store,
    headers: { "x-webhook-id": "evt_1" },
    body: '{"x":1}',
    source: "github",
  });
  assert.equal(r1.status, "accepted");
  assert.equal(r1.event.eventId, "evt_1");

  const r2 = await ingest({
    store,
    headers: { "x-webhook-id": "evt_1" },
    body: '{"x":1}',
    source: "github",
  });
  assert.equal(r2.status, "duplicate");
  assert.equal(r2.event.eventId, "evt_1");
  assert.equal(r2.event.body, '{"x":1}');
});

test("ingest: payload hash dedupes identical bodies with no event id", async () => {
  const store = makeFakeStore();
  const body = '{"a":1}';
  const r1 = await ingest({ store, headers: {}, body, source: "unknown" });
  const r2 = await ingest({ store, headers: {}, body, source: "unknown" });
  assert.equal(r1.status, "accepted");
  assert.equal(r2.status, "duplicate");
  assert.equal(r1.event.eventId, r2.event.eventId);
});

test("ingest: out-of-order (late) event is accepted and tagged late", async () => {
  const store = makeFakeStore();
  await ingest({
    store,
    headers: { "x-webhook-id": "a", "x-webhook-sequence": "5" },
    body: "{}",
    source: "s",
  });
  const r = await ingest({
    store,
    headers: { "x-webhook-id": "b", "x-webhook-sequence": "3" },
    body: "{}",
    source: "s",
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.event.orderStatus, "late");
});

test("ingest: in-order next event is tagged in_order", async () => {
  const store = makeFakeStore();
  await ingest({
    store,
    headers: { "x-webhook-id": "a", "x-webhook-sequence": "5" },
    body: "{}",
    source: "s",
  });
  const r = await ingest({
    store,
    headers: { "x-webhook-id": "b", "x-webhook-sequence": "6" },
    body: "{}",
    source: "s",
  });
  assert.equal(r.event.orderStatus, "in_order");
});

test("ingest: gap (seq jumps by >1) is tagged gap_detected", async () => {
  const store = makeFakeStore();
  await ingest({
    store,
    headers: { "x-webhook-id": "a", "x-webhook-sequence": "5" },
    body: "{}",
    source: "s",
  });
  const r = await ingest({
    store,
    headers: { "x-webhook-id": "b", "x-webhook-sequence": "8" },
    body: "{}",
    source: "s",
  });
  assert.equal(r.event.orderStatus, "gap_detected");
});

test("ingest: dedup state survives a simulated restart (new store, shared backing)", async () => {
  const events = new Map<string, unknown>();
  const seqs = new Map<string, number>();
  const storeA = makeFakeStore({ events, seqs });
  await ingest({
    store: storeA,
    headers: { "x-webhook-id": "persist_1" },
    body: "{}",
    source: "s",
  });
  const storeB = makeFakeStore({ events, seqs });
  const r = await ingest({
    store: storeB,
    headers: { "x-webhook-id": "persist_1" },
    body: "{}",
    source: "s",
  });
  assert.equal(r.status, "duplicate");
});

test("ingest: source defaults to 'unknown' when no header", async () => {
  const store = makeFakeStore();
  const r = await ingest({ store, headers: {}, body: "{}", source: "" });
  assert.equal(r.event.source, "unknown");
});

test("verifySignature: matches when computed correctly", async () => {
  const { verifySignature } = await import("../lib/verify.ts");
  const secret = "shh";
  const body = '{"x":1}';
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(body, sig, secret), true);
});

test("verifySignature: rejects bad signature", async () => {
  const { verifySignature } = await import("../lib/verify.ts");
  assert.equal(verifySignature("{}", "sha256=deadbeef", "shh"), false);
});

test("ingest: emits start, order_classified, claim log stages in order", async () => {
  const events: Array<{ level: string; stage: string }> = [];
  const capturingLogger = {
    info(stage: string, msg: string) {
      void msg;
      events.push({ level: "info", stage });
    },
    warn(stage: string, msg: string) {
      void msg;
      events.push({ level: "warn", stage });
    },
    error(stage: string, msg: string) {
      void msg;
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
      headers: { "x-webhook-id": "err_1", "x-webhook-sequence": "1" },
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
