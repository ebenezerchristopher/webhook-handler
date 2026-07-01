import { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../lib/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

  let store;
  try {
    store = getStore();
  } catch (e) {
    return NextResponse.json(
      { error: "store_unconfigured", message: (e as Error).message },
      { status: 503 },
    );
  }

  const events = await store.listByTime(limit);
  return NextResponse.json({ events });
}
