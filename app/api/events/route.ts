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
