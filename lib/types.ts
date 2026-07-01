export type OrderStatus = "in_order" | "late" | "gap_detected" | "no_seq";

export type StoredEvent = {
  eventId: string;
  source: string;
  seq: number | null;
  body: string;
  orderStatus: OrderStatus;
  receivedAt: number;
  headers: Record<string, string>;
};

export type EventInput = {
  eventId: string;
  source: string;
  seq: number | null;
  body: string;
  orderStatus: OrderStatus;
  receivedAt: number;
  headers: Record<string, string>;
};

export type ClaimResult = {
  status: "accepted" | "duplicate";
  event: StoredEvent;
};

export type IngestStore = {
  claimAndStore(input: EventInput): Promise<ClaimResult>;
  maxSeqForSource(source: string): Promise<number | null>;
  listByTime(limit: number): Promise<StoredEvent[]>;
  getEvent(eventId: string): Promise<StoredEvent | null>;
};
