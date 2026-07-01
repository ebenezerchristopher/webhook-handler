import { Redis } from "@upstash/redis";
import type { IngestStore, EventInput, ClaimResult, StoredEvent } from "./types.ts";

const DEDUP_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days (audit/replay window)

// Lua script: atomically claim an event id (SET NX equivalent) and store
// the event record, updating all indexes. Single round trip = no race
// window between dedup-check and store. Returns {status, event_json}.
//   status = "accepted"  -> new event, just stored
//   status = "duplicate" -> already exists, returns the original record
const CLAIM_LUA = `
local existing = redis.call('GET', KEYS[2])
if existing then
  return {'duplicate', existing}
end
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[5]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[6]))
if ARGV[3] ~= '' then
  redis.call('ZADD', KEYS[4], tonumber(ARGV[3]), ARGV[2])
  local cur = redis.call('GET', KEYS[3])
  if not cur or tonumber(ARGV[3]) > tonumber(cur) then
    redis.call('SET', KEYS[3], ARGV[3])
  end
end
redis.call('ZADD', KEYS[5], tonumber(ARGV[4]), ARGV[2])
return {'accepted', ARGV[1]}
`;

function keysFor(eventId: string, source: string) {
  return {
    dedup: `wh:dedup:${source}:${eventId}`,
    event: `wh:event:${eventId}`,
    sourceMax: `wh:source:${source}:seq:max`,
    sourceSeqs: `wh:source:${source}:seqs`,
    recent: `wh:events:recent`,
  };
}

export function createRedisStore(redis: Redis): IngestStore {
  return {
    async claimAndStore(input: EventInput): Promise<ClaimResult> {
      const k = keysFor(input.eventId, input.source);
      const result = (await redis.eval(
        CLAIM_LUA,
        [k.dedup, k.event, k.sourceMax, k.sourceSeqs, k.recent],
        [
          JSON.stringify(input),
          input.eventId,
          input.seq == null ? "" : String(input.seq),
          String(input.receivedAt),
          String(DEDUP_TTL_SECONDS),
          String(EVENT_TTL_SECONDS),
        ],
      )) as [string, string];

      const [status, json] = result;
      const event = JSON.parse(json) as StoredEvent;
      return { status: status as "accepted" | "duplicate", event };
    },

    async maxSeqForSource(source: string): Promise<number | null> {
      const v = await redis.get<string>(`wh:source:${source}:seq:max`);
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },

    async listByTime(limit: number): Promise<StoredEvent[]> {
      const ids = (await redis.zrange("wh:events:recent", 0, limit - 1, {
        rev: true,
      })) as string[];
      if (ids.length === 0) return [];
      const keys = ids.map((id) => `wh:event:${id}`);
      const records = (await redis.mget(...keys)) as (string | null)[];
      const out: StoredEvent[] = [];
      for (const r of records) {
        if (r) out.push(JSON.parse(r) as StoredEvent);
      }
      return out;
    },

    async getEvent(eventId: string): Promise<StoredEvent | null> {
      const r = await redis.get<string>(`wh:event:${eventId}`);
      if (!r) return null;
      return JSON.parse(r) as StoredEvent;
    },
  };
}

// Lazily build the Redis client so missing env vars fail at request time
// (with a clear message) rather than at module load.
let cached: IngestStore | null = null;
export function getStore(): IngestStore {
  if (cached) return cached;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (Vercel Marketplace -> Upstash Redis).",
    );
  }
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  cached = createRedisStore(redis);
  return cached;
}
