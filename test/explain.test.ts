import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ARGUMENT_TYPES } from "../src/engine/challenge.js";
import { ARGUMENT_REPLIES, render, whatWouldChange } from "../src/engine/explain.js";
import { decide } from "../src/engine/score.js";
import { args, cfg, emptyHistory } from "./fixtures.js";

test("finds the smallest fact change to the next band and to BUY", () => {
  const a = args();
  const w = whatWouldChange(a, decide(a).score);
  assert.deepEqual(w.nextBand, { changes: { N3: "a" }, score: 60 });
  assert.deepEqual(w.toBuy, { changes: { N1: "a", N3: "a" }, score: 73 });
});

test("a BUY has nothing to change", () => {
  const a = args({ answers: { N1: "a", N2: "b", N3: "b" } });
  assert.deepEqual(whatWouldChange(a, decide(a).score), { nextBand: null, toBuy: null });
});

test("the message leads with the verdict and keeps the override open", () => {
  const a = args();
  const d = decide(a);
  const m = render(d, cfg, whatWouldChange(a, d.score));
  assert.ok(m.startsWith("SKIP. This is a WANT (score 46/100)."), m);
  assert.ok(m.includes("USD 300 is 4.5 days of your budget"), m);
  assert.ok(m.includes("To reach BUY:"), m);
  assert.ok(m.endsWith("You can still buy it. It will be logged as an override."), m);
});

test("a WAIT names the re-check time", () => {
  const a = args({ answers: { N1: "a", N2: "b", N3: "b" } });
  const d = decide(a);
  const m = render(d, cfg, whatWouldChange(a, d.score));
  assert.ok(m.includes("If you still want it on 2026-11-11 14:00, check again."));
  assert.ok(m.includes("Why this date: the normal cooling-off for this price."));
});

test("a marginal wait explains why it is longer", () => {
  const a = args({ answers: { N1: "c", N2: "a", N3: "b", S1: "c", S2: "b" } });
  const d = decide(a);
  assert.ok(render(d, cfg, whatWouldChange(a, d.score)).includes("twice the normal cooling-off"));
});

test("a one-off shows your one-off record", () => {
  const a = args({ answers: { O1: true }, history: emptyHistory({ oneOffs90: { count: 3, total: 900 } }) });
  const d = decide(a);
  assert.ok(render(d, cfg, whatWouldChange(a, d.score)).includes("One-time purchases in the last 90 days: 3 (USD 900)."));
});

test("every argument type has a fixed reply", () => {
  for (const t of ARGUMENT_TYPES) assert.ok(ARGUMENT_REPLIES[t].length > 20, t);
});
