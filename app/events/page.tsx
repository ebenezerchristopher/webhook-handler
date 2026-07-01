import { getStore } from "../../lib/store.ts";
import { EventTester } from "./event-tester.tsx";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
}

function statusColor(s: string): string {
  switch (s) {
    case "in_order":
      return "bg-emerald-100 text-emerald-800";
    case "late":
      return "bg-amber-100 text-amber-800";
    case "gap_detected":
      return "bg-red-100 text-red-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

export default async function EventsPage() {
  let events: Awaited<ReturnType<ReturnType<typeof getStore>["listByTime"]>> = [];
  let error: string | null = null;
  try {
    events = await getStore().listByTime(50);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Recent events</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Most recent first. Duplicate deliveries are rejected at the door — the count below
              is the count of <em>unique</em> events.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-white"
          >
            ← Back
          </Link>
        </div>

        <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Send a test webhook
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            POSTs to <code className="rounded bg-zinc-100 px-1.5 py-0.5">/api/webhook</code>.
            Use it to verify dedup, ordering, and persistence.
          </p>
          <div className="mt-4">
            <EventTester />
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            <strong>Store not configured:</strong> {error}
          </div>
        )}

        {!error && events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
            No events yet. Send a test webhook above to see it land here.
          </div>
        )}

        {!error && events.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Event ID</th>
                  <th className="px-4 py-3">Seq</th>
                  <th className="px-4 py-3">Order</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.eventId} className="border-t border-zinc-100 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {fmtTime(e.receivedAt)}
                    </td>
                    <td className="px-4 py-3">{e.source}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="max-w-xs truncate" title={e.eventId}>
                        {e.eventId}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{e.seq ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(e.orderStatus)}`}
                      >
                        {e.orderStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
