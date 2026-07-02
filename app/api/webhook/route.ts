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
