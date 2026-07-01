import { createHash } from "node:crypto";
import type { IngestStore, EventInput, ClaimResult, OrderStatus } from "./types.ts";

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
}): Promise<ClaimResult> {
  const headers = normalizeHeaders(input.headers);
  const eventId = deriveEventId({ headers, body: input.body });
  const source = (input.source && input.source.trim()) || deriveSource({ headers });
  const seq = deriveSeq({ headers, body: input.body });

  let orderStatus: OrderStatus = "no_seq";
  if (seq != null) {
    const max = await input.store.maxSeqForSource(source);
    if (max == null) orderStatus = "in_order";
    else if (seq <= max) orderStatus = "late";
    else if (seq === max + 1) orderStatus = "in_order";
    else orderStatus = "gap_detected";
  }

  const eventInput: EventInput = {
    eventId,
    source,
    seq,
    body: input.body,
    orderStatus,
    receivedAt: Date.now(),
    headers,
  };

  return input.store.claimAndStore(eventInput);
}

function normalizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
