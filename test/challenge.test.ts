import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyChallenge, isValidValue } from "../src/engine/challenge.js";
import { headphones, wantAnswers } from "./fixtures.js";

test("an estimate revised after the verdict counts at 50%, once", () => {
  const r = applyChallenge(headphones, wantAnswers, "U1", 60, []);
  assert.equal(r.status, "applied");
  assert.equal(r.answers.U1, 40);
  assert.equal(r.effectiveValue, 40);
  const again = applyChallenge(headphones, r.answers, "U1", 90, [{ field: "U1", newValue: 60, status: "applied" }]);
  assert.equal(again.status, "estimate_used");
  assert.equal(again.answers.U1, 40);
});

test("an estimate that was never asked counts at 50% of the new value", () => {
  assert.equal(applyChallenge(headphones, { N1: "d" }, "U1", 30, []).answers.U1, 15);
});

test("repeating a point changes nothing", () => {
  const r = applyChallenge(headphones, wantAnswers, "N1", "a", [{ field: "N1", newValue: "a", status: "applied" }]);
  assert.equal(r.status, "repeat");
  assert.equal(r.answers.N1, "c");
});

test("facts count in full", () => {
  assert.equal(applyChallenge(headphones, wantAnswers, "price", 250, []).input.price, 250);
  assert.equal(applyChallenge(headphones, wantAnswers, "spentThisMonth", 100, []).input.spentThisMonth, 100);
  assert.equal(applyChallenge(headphones, wantAnswers, "N1", "a", []).answers.N1, "a");
});

test("no field means no change", () => {
  const r = applyChallenge(headphones, wantAnswers, "none", undefined, []);
  assert.equal(r.status, "none");
  assert.deepEqual(r.answers, wantAnswers);
});

test("values are validated against the question bank", () => {
  assert.equal(isValidValue("N1", "a"), true);
  assert.equal(isValidValue("N1", "z"), false);
  assert.equal(isValidValue("P1", "e"), true);
  assert.equal(isValidValue("N4", "2026-12-01"), true);
  assert.equal(isValidValue("N4", "none"), true);
  assert.equal(isValidValue("N4", "soon"), false);
  assert.equal(isValidValue("price", -5), false);
  assert.equal(isValidValue("U1", "ten"), false);
  assert.equal(isValidValue("spentThisMonth", 0), true);
});
