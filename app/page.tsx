import Link from "next/link";
import { getStore } from "../lib/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEBHOOK_PATH = "/api/webhook";

function endpointUrl(path: string): string {
  // Best-effort display only. The real URL is whatever Vercel assigns.
  return `${path}`;
}

export default async function Home() {
  let storeStatus: "ok" | "unconfigured" = "ok";
  let storeMessage: string | null = null;
  let eventCount = 0;
  try {
    const events = await getStore().listByTime(1);
    eventCount = events.length;
  } catch (e) {
    storeStatus = "unconfigured";
    storeMessage = (e as Error).message;
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
