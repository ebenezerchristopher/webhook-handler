import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, noopLogger } from "../lib/log.ts";

test("createLogger emits one JSON line with required fields", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "req_123" });
    logger.info("test.stage", "hello");
  } finally {
    console.log = orig;
  }
  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.requestId, "req_123");
  assert.equal(parsed.stage, "test.stage");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "hello");
  assert.equal(typeof parsed.ts, "string");
});

test("createLogger merges extra into top-level JSON", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.info("s", "m", { foo: "bar", n: 42 });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.foo, "bar");
  assert.equal(parsed.n, 42);
});

test("createLogger skips reserved keys supplied via extra", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.info("s", "m", {
      requestId: "evil",
      level: "fake",
      stage: "fake",
      msg: "fake",
      ts: "fake",
      extra: "kept",
    });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.requestId, "r1");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.stage, "s");
  assert.equal(parsed.msg, "m");
  assert.equal(parsed.extra, "kept");
});

test("error level writes to console.error", () => {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (line: string) => { out.push(String(line)); };
  console.error = (line: string) => { err.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.error("e.stage", "boom");
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(out.length, 0);
  assert.equal(err.length, 1);
  const parsed = JSON.parse(err[0]);
  assert.equal(parsed.level, "error");
});

test("warn level writes to console.log", () => {
  const out: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { out.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    logger.warn("w.stage", "watch out");
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.level, "warn");
});

test("noopLogger is callable and produces no output", () => {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (line: string) => { out.push(String(line)); };
  console.error = (line: string) => { err.push(String(line)); };
  try {
    noopLogger.info("s", "m");
    noopLogger.warn("s", "m");
    noopLogger.error("s", "m");
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(out.length, 0);
  assert.equal(err.length, 0);
});

test("logger does not throw when extra contains a circular reference", () => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (line: string) => { captured.push(String(line)); };
  try {
    const logger = createLogger({ requestId: "r1" });
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    logger.info("s", "m", { circ });
  } finally {
    console.log = orig;
  }
  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]);
  assert.equal(parsed.loggingError, "stringify_failed");
});
