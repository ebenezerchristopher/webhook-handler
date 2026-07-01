import { NextRequest, NextResponse } from "next/server";
import { ingest } from "../../../lib/ingest.ts";
import { getStore } from "../../../lib/store.ts";
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
  const rawBody = await req.text();
  const headers = headersToObject(req);

  // Optional HMAC verification. If WEBHOOK_SECRET is set, the sender must
  // sign the raw body with sha256 and put it in X-Webhook-Signature.
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const sig = headers["x-webhook-signature"] ?? null;
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json(
        { error: "invalid_signature" },
        { status: 401 },
      );
    }
  }

  let store;
  try {
    store = getStore();
  } catch (e) {
    return NextResponse.json(
      { error: "store_unconfigured", message: (e as Error).message },
      { status: 503 },
    );
  }

  const result = await ingest({
    store,
    headers,
    body: rawBody,
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
  return NextResponse.json({
    ok: true,
    hint: "POST a webhook to this URL. See / for the strategy.",
  });
}
