import { strict as assert } from "node:assert";
import { test } from "node:test";
import { QUESTIONS, optionValue, questionsFor, tierFor } from "../src/engine/questions.js";

test("tiers follow the share of the monthly budget", () => {
  assert.equal(tierFor(0.019), "micro");
  assert.equal(tierFor(0.02), "standard");
  assert.equal(tierFor(0.25), "standard");
  assert.equal(tierFor(0.251), "big");
});

test("each tier asks a fixed list of questions", () => {
  assert.deepEqual(questionsFor("micro"), ["N1", "P1"]);
  assert.deepEqual(questionsFor("standard"), ["N1", "N2", "N3", "U1", "S1", "S2", "P1", "O1"]);
  assert.equal(questionsFor("big").length, 11);
});

test("options carry fixed values", () => {
  assert.equal(optionValue("N1", "a"), 1);
  assert.equal(optionValue("N1", "d"), 0);
  assert.equal(optionValue("N2", "b"), 0.9);
  assert.equal(optionValue("S1", "d"), 2);
  assert.equal(optionValue("N1", "z"), undefined);
  for (const q of Object.values(QUESTIONS)) assert.ok((q.options?.length ?? 0) <= 4, `${q.id} has more than 4 options`);
});
