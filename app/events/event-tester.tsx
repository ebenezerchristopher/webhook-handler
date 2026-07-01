"use client";

import { useState } from "react";

type SendResult = {
  status: "accepted" | "duplicate";
  event: { eventId: string; source: string; seq: number | null; orderStatus: string };
};

function randomId(): string {
  return "evt_" + Math.random().toString(36).slice(2, 10);
}

export function EventTester() {
  const [eventId, setEventId] = useState<string>(() => randomId());
  const [source, setSource] = useState("github");
  const [seq, setSeq] = useState("1");
  const [body, setBody] = useState('{"action":"opened"}');
  const [results, setResults] = useState<SendResult[]>([]);
  const [busy, setBusy] = useState(false);

  async function sendOne(): Promise<SendResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Id": eventId,
      "X-Webhook-Source": source,
      "X-Webhook-Sequence": seq,
    };
    const r = await fetch("/api/webhook", {
      method: "POST",
      headers,
      body,
    });
    return r.json();
  }

  async function onSend() {
    setBusy(true);
    try {
      const r = await sendOne();
      setResults((prev) => [r, ...prev].slice(0, 10));
    } finally {
      setBusy(false);
    }
  }

  async function onSendDuplicates() {
    setBusy(true);
    try {
      const out: SendResult[] = [];
      for (let i = 0; i < 3; i++) {
        out.push(await sendOne());
      }
      setResults((prev) => [...out, ...prev].slice(0, 10));
    } finally {
      setBusy(false);
    }
  }

  async function onSendOutOfOrder() {
    setBusy(true);
    try {
      const baseId = "ooo_" + Math.random().toString(36).slice(2, 8);
      const send = async (id: string, s: string) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Webhook-Id": id,
          "X-Webhook-Source": source,
          "X-Webhook-Sequence": s,
        };
        const r = await fetch("/api/webhook", { method: "POST", headers, body });
        return r.json() as Promise<SendResult>;
      };
      const out: SendResult[] = [];
      out.push(await send(`${baseId}_a`, "5"));
      out.push(await send(`${baseId}_b`, "3"));
      out.push(await send(`${baseId}_c`, "4"));
      setResults((prev) => [...out, ...prev].slice(0, 10));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs font-medium text-zinc-700">
          Event ID
          <div className="mt-1 flex gap-1">
            <input
              className="block w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setEventId(randomId())}
              className="rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium hover:bg-zinc-50"
              title="Generate a new event id"
            >
              ↻
            </button>
          </div>
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Source
          <input
            className="mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-zinc-700">
          Seq
          <input
            className="mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm"
            value={seq}
            onChange={(e) => setSeq(e.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            onClick={onSend}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            Send 1
          </button>
          <button
            onClick={onSendDuplicates}
            disabled={busy}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            title="Send the same event id 3 times — expect 1 accepted + 2 duplicates"
          >
            Send ×3
          </button>
          <button
            onClick={onSendOutOfOrder}
            disabled={busy}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            title="Send seq 5, 3, 4 — expect a gap and late arrivals"
          >
            OoO
          </button>
        </div>
      </div>
      <label className="block text-xs font-medium text-zinc-700">
        Body
        <textarea
          className="mt-1 block w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-xs"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {results.length > 0 && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Latest responses
          </div>
          <ul className="space-y-1 font-mono text-xs">
            {results.map((r, i) => (
              <li key={i}>
                <span
                  className={
                    r.status === "accepted"
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }
                >
                  {r.status.padEnd(10)}
                </span>{" "}
                id={r.event.eventId} seq={String(r.event.seq).padStart(3)} order={r.event.orderStatus}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
