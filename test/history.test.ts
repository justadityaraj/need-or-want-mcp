import { strict as assert } from "node:assert";
import { test } from "node:test";
import { summarize } from "../src/engine/history.js";
import { accuracy, reviewsDue } from "../src/engine/stats.js";
import type { LogEvent } from "../src/engine/types.js";
import { DAY } from "../src/engine/util.js";
import { NOW, headphones, outcomeEvent, reviewEvent, verdictEvent } from "./fixtures.js";

const log: LogEvent[] = [
  verdictEvent("A", 40, { category: "electronics", O1: true, U1: 10, cost: 300 }),
  outcomeEvent("A", 40),
  reviewEvent("A", 10, 30, { uses: 5, worthIt: "no" }),
  verdictEvent("B", 5, { category: "clothing", O1: true, cost: 100 }),
  outcomeEvent("B", 5),
  verdictEvent("C", 3, { key: "wireless headphones", verdict: "WAIT", score: 60 }),
];

test("summarize turns the log into a history", () => {
  const h = summarize(log, [], headphones, "wireless headphones", null, NOW);
  assert.equal(h.boughtThisMonth, 100);
  assert.deepEqual(h.oneOffs90, { count: 2, total: 400 });
  assert.equal(h.oneOffsThisYear, 400);
  assert.deepEqual(h.category, { regret: 1, n: 1 });
  assert.deepEqual(h.usage, { actual: 5, predicted: 10, n: 1 });
  assert.equal(h.firstCheckTs, log[5].type === "verdict" ? log[5].ts : null);
});

test("reviews come due at 30 and 90 days", () => {
  assert.deepEqual(reviewsDue(log, NOW), []);
  const later = new Date(NOW.getTime() + 28 * DAY);
  assert.deepEqual(reviewsDue(log, later), [
    { id: "B", item: "B", day: 30, kind: "bought" },
    { id: "C", item: "C", day: 30, kind: "skipped" },
  ]);
});

test("accuracy: Brier score, skill and override split", () => {
  const events: LogEvent[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `p${i}`;
    events.push(verdictEvent(id, 60, { score: i < 5 ? 80 : 40 }));
    events.push(outcomeEvent(id, 60, true, i >= 5));
    events.push(reviewEvent(id, 30, 30, { worthIt: i < 5 ? "yes" : "no" }));
  }
  events.push(verdictEvent("s", 40, { verdict: "SKIP", score: 30, cost: 120 }), outcomeEvent("s", 39, false));
  const a = accuracy(events);
  assert.equal(a.reviewed, 10);
  assert.equal(a.brier, 0.1);
  assert.equal(a.skill, 0.6);
  assert.equal(a.followed, 5);
  assert.equal(a.followedWorth, 1);
  assert.equal(a.overrides, 5);
  assert.equal(a.overrideWorth, 0);
  assert.equal(a.moneyNotSpent, 120);
  assert.deepEqual(a.suggestions, []);
});
