import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dealScore, decide, effectiveUses, historyScore, needScore, pendingQuestions, realism } from "../src/engine/score.js";
import { HOUR } from "../src/engine/util.js";
import { NOW, args, cfg, daysAgo, emptyHistory, headphones, hoursAgo } from "./fixtures.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const hot = { N1: "c", N2: "a", N3: "b", S1: "c", S2: "b" } as const;

test("worked example: headphones you don't need score 46 and SKIP", () => {
  const d = decide(args());
  assert.equal(d.needLabel, "WANT");
  assert.equal(d.components.need, 0.08);
  near(d.components.budget, 0.528926);
  assert.equal(d.components.costPerUse, 1);
  near(d.components.history, 0.7);
  assert.equal(d.components.deal, 0.5);
  assert.equal(d.score, 46);
  assert.equal(d.verdict, "SKIP");
  assert.deepEqual(d.numbers, {
    cost: 300,
    remaining: 1100,
    budgetDays: 4.5,
    hoursOfWork: null,
    costPerUse: 2.54,
    effectiveUses: 117.98,
    fv10: 444.07,
    fv20: 657.34,
    monthlyEquivalent: 8.33,
    yearlyCommitment: null,
    waitHours: 0,
    waitUntil: null,
  });
});

test("need score is re-weighted over the questions asked", () => {
  assert.deepEqual(needScore({ N1: "b" }), { score: 0.7, label: "NEED", emergency: false });
  assert.deepEqual(needScore({ N1: "a", N3: "a" }), { score: 1, label: "NEED", emergency: true });
  assert.equal(needScore({}).label, "WANT");
});

test("effective uses decay with lambda and are discounted by realism", () => {
  near(effectiveUses(20, 36, 0.08, 0.5), 117.9831, 1e-3);
  assert.equal(effectiveUses(10, 6, 0, 0.5), 30);
});

test("realism shrinks your record towards 0.5", () => {
  assert.equal(realism(emptyHistory()), 0.5);
  assert.equal(realism(emptyHistory({ usage: { actual: 10, predicted: 40, n: 5 } })), 0.375);
});

test("one-off pressure lowers the history score", () => {
  near(historyScore({ O1: true }, emptyHistory({ oneOffs90: { count: 4, total: 400 } })), 0.42);
  near(historyScore({ O1: false }, emptyHistory({ oneOffs90: { count: 4, total: 400 } })), 0.7);
});

test("deal score uses only your own price history", () => {
  const prices = [
    { price: 400, ts: daysAgo(9) },
    { price: 390, ts: daysAgo(6) },
    { price: 410, ts: daysAgo(2) },
  ];
  assert.equal(dealScore(300, prices, NOW), 1);
  near(dealScore(440, prices, NOW), 0.25);
  assert.equal(dealScore(300, prices.slice(1), NOW), 0.5);
  const sameWeek = [3, 2, 1].map((d) => ({ price: 400, ts: daysAgo(d) }));
  assert.equal(dealScore(300, sameWeek, NOW), 0.5);
});

test("emergency buys now", () => {
  const d = decide(args({ answers: { N1: "a", N2: "b", N3: "a" } }));
  assert.equal(d.verdict, "BUY");
  assert.equal(d.emergency, true);
  assert.equal(d.numbers.waitHours, 0);
});

test("a replacement waits 24 hours, then buys", () => {
  const first = decide(args({ answers: { N1: "a", N2: "b", N3: "b" } }));
  assert.equal(first.score, 75);
  assert.equal(first.verdict, "WAIT");
  assert.equal(first.numbers.waitHours, 24);
  assert.equal(first.numbers.waitUntil, new Date(NOW.getTime() + 24 * HOUR).toISOString());
  const later = decide(args({ answers: { N1: "a", N2: "b", N3: "b" }, history: emptyHistory({ firstCheckTs: hoursAgo(25) }) }));
  assert.equal(later.verdict, "BUY");
});

test("hot-state answers lengthen the wait, capped at 2x", () => {
  const d = decide(args({ answers: hot }));
  assert.equal(d.score, 63);
  assert.equal(d.verdict, "WAIT");
  assert.equal(d.marginal, true);
  assert.equal(d.numbers.waitHours, 630);
  const night = decide(args({ answers: hot, now: new Date(2026, 10, 10, 23, 30) }));
  assert.equal(night.numbers.waitHours, 672);
});

test("a real deadline caps the wait", () => {
  assert.equal(decide(args({ answers: { ...hot, N4: "2026-11-14" } })).numbers.waitHours, 58);
});

test("marginal items buy only if you still want them after the wait", () => {
  const faded = decide(args({ answers: { ...hot, STILL_WANT: false }, history: emptyHistory({ firstCheckTs: hoursAgo(400) }) }));
  assert.equal(faded.verdict, "SKIP");
  assert.equal(faded.faded, true);
  const kept = decide(args({ answers: { ...hot, STILL_WANT: true }, history: emptyHistory({ firstCheckTs: hoursAgo(700) }) }));
  assert.equal(kept.verdict, "BUY");
  assert.equal(kept.marginal, true);
  const unasked = decide(args({ answers: hot, history: emptyHistory({ firstCheckTs: hoursAgo(700) }) }));
  assert.equal(unasked.verdict, "WAIT");
});

test("debt and card vetoes label the verdict without changing the score", () => {
  const debt = decide(args({ answers: { P1: "c" } }));
  assert.deepEqual(debt.vetoes, ["debt"]);
  assert.equal(debt.score, 46);
  const policy = { ...cfg, vetoes: { ...cfg.vetoes, creditCard: { onlyMerchants: ["amazon.in"] } } };
  assert.deepEqual(decide(args({ cfg: policy, answers: { P1: "b" }, input: { merchant: "flipkart.com" } })).vetoes, ["card"]);
  assert.deepEqual(decide(args({ cfg: policy, answers: { P1: "b" }, input: { merchant: "amazon.in" } })).vetoes, []);
  const mixedCase = { ...cfg, vetoes: { ...cfg.vetoes, creditCard: { onlyMerchants: ["Amazon.in"] } } };
  assert.deepEqual(decide(args({ cfg: mixedCase, answers: { P1: "b" }, input: { merchant: "AMAZON.IN" } })).vetoes, []);
});

test("a blocked category skips", () => {
  const blocked = { ...cfg, vetoes: { ...cfg.vetoes, blockedCategories: [{ category: "electronics" as const, until: "2027-03-31" }] } };
  const d = decide(args({ cfg: blocked, answers: { N1: "a", N2: "b", N3: "b" } }));
  assert.equal(d.verdict, "SKIP");
  assert.deepEqual(d.vetoes, ["blocked"]);
});

test("over budget waits until next month when the score allows", () => {
  const d = decide(args({ input: { spentThisMonth: 1900 }, answers: { N1: "b", N2: "a", N3: "b" } }));
  assert.equal(d.score, 58);
  assert.equal(d.verdict, "WAIT");
  assert.deepEqual(d.vetoes, ["over_budget"]);
  assert.equal(d.numbers.waitUntil, new Date(2026, 11, 1).toISOString());
  assert.equal(decide(args({ input: { spentThisMonth: 1900 } })).verdict, "SKIP");
});

test("the one-off cap waits until next year", () => {
  const capped = { ...cfg, oneOffs: { mode: "cap" as const, yearlyCap: 500 } };
  const d = decide(args({ cfg: capped, answers: { N1: "a", N2: "b", N3: "b", O1: true }, history: emptyHistory({ oneOffsThisYear: 300 }) }));
  assert.equal(d.verdict, "WAIT");
  assert.deepEqual(d.vetoes, ["oneoff_cap"]);
  assert.equal(d.numbers.waitUntil, new Date(2027, 0, 1).toISOString());
});

test("a business purchase is out of scope", () => {
  assert.equal(decide(args({ answers: { P1: "e" } })).verdict, "NOT_PERSONAL");
});

test("micro purchases ask two questions and an impulse want skips", () => {
  const micro = { ...headphones, price: 30 };
  assert.deepEqual(pendingQuestions(micro, {}, cfg, emptyHistory(), NOW), ["N1", "P1"]);
  const d = decide({ input: micro, answers: { N1: "d", P1: "a" }, cfg, history: emptyHistory(), now: NOW });
  assert.equal(d.score, 43);
  assert.equal(d.verdict, "SKIP");
});

test("pending questions add SP and STILL_WANT when needed", () => {
  assert.equal(pendingQuestions(headphones, {}, cfg, emptyHistory(), NOW).length, 8);
  const noSpend = { ...headphones, spentThisMonth: undefined };
  assert.ok(pendingQuestions(noSpend, {}, cfg, emptyHistory(), NOW).includes("SP"));
  assert.ok(pendingQuestions(headphones, {}, cfg, emptyHistory({ firstCheckTs: hoursAgo(5) }), NOW).includes("STILL_WANT"));
});

test("a higher price never raises the score", () => {
  let last = Infinity;
  for (let price = 50; price <= 2000; price += 50) {
    const s = decide(args({ input: { price, spentThisMonth: 0 } })).score;
    assert.ok(s <= last, `score rose at price ${price}`);
    last = s;
  }
});

test("owning a better substitute never raises need", () => {
  const scores = (["a", "b", "c", "d"] as const).map((k) => needScore({ ...args().answers, N2: k }).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] <= scores[i - 1]);
});
