import { strict as assert } from "node:assert";
import { test } from "node:test";
import { configHash, deepMerge, isTightening, loadConfig, resolveConfig, stableStringify } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/engine/defaults.js";
import { DAY } from "../src/engine/util.js";

const day0 = new Date(2026, 10, 1, 12, 0);
const plus = (days: number) => new Date(day0.getTime() + days * DAY);
const withBudget = (monthly: number) => loadConfig({ budget: { monthly } });

test("an empty file loads the defaults", () => {
  assert.deepEqual(loadConfig({}), DEFAULT_CONFIG);
});

test("a partial file merges over the defaults", () => {
  const c = loadConfig({ budget: { monthly: 500 }, vetoes: { creditCard: { onlyMerchants: ["amazon.in"] } } });
  assert.equal(c.budget.monthly, 500);
  assert.deepEqual(c.budget.schedule, {});
  assert.deepEqual(c.vetoes.creditCard, { onlyMerchants: ["amazon.in"] });
  assert.equal(c.vetoes.debt, true);
});

test("weights must add up to 1", () => {
  assert.throws(() => loadConfig({ weights: { need: 0.9 } }));
});

test("the hash ignores key order", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.equal(configHash(withBudget(100)), configHash(deepMerge(withBudget(100), {})));
});

test("tightening is recognised", () => {
  assert.equal(isTightening(withBudget(2000), withBudget(1800)), true);
  assert.equal(isTightening(withBudget(2000), withBudget(2500)), false);
  const blocked = loadConfig({ budget: { monthly: 2000 }, vetoes: { blockedCategories: [{ category: "electronics", until: "2027-03-31" }] } });
  assert.equal(isTightening(withBudget(2000), blocked), true);
  assert.equal(isTightening(blocked, withBudget(2000)), false);
  assert.equal(isTightening(withBudget(2000), loadConfig({ budget: { monthly: 2000 }, vetoes: { debt: false } })), false);
});

test("first setup applies at once; tightening applies at once", () => {
  const first = resolveConfig(withBudget(2000), { applied: null, pending: null }, day0);
  assert.equal(first.inForce.budget.monthly, 2000);
  const down = resolveConfig(withBudget(1800), first.state, day0);
  assert.equal(down.inForce.budget.monthly, 1800);
  assert.equal(down.state.pending, null);
});

test("loosening waits 7 days and restarts if the change changes", () => {
  let r = resolveConfig(withBudget(2000), { applied: null, pending: null }, day0);
  r = resolveConfig(withBudget(2500), r.state, day0);
  assert.equal(r.inForce.budget.monthly, 2000);
  assert.equal(r.state.pending?.since, day0.toISOString());
  assert.equal(resolveConfig(withBudget(2500), r.state, plus(6)).inForce.budget.monthly, 2000);
  const restarted = resolveConfig(withBudget(2600), r.state, plus(6));
  assert.equal(restarted.state.pending?.since, plus(6).toISOString());
  const applied = resolveConfig(withBudget(2500), r.state, plus(7));
  assert.equal(applied.inForce.budget.monthly, 2500);
  assert.equal(applied.state.pending, null);
});
