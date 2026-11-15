import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DAY } from "../src/engine/util.js";
import { createServer } from "../src/server.js";
import { Store } from "../src/store.js";
import { NOW } from "./fixtures.js";

async function connect(clock: () => Date) {
  const server = createServer(new Store(mkdtempSync(join(tmpdir(), "need-or-want-"))), clock);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      return JSON.parse((r.content as { text: string }[])[0].text);
    },
  };
}

const headphones = { item: "Wireless headphones", price: 300, category: "electronics", spentThisMonth: 900 };
const answers = { N1: "c", N2: "d", N3: "c", U1: 20, S1: "c", S2: "a", P1: "a", O1: false };

test("the full flow: setup, questions, verdict, challenges, outcome, status", async () => {
  let now = NOW;
  const { call, client } = await connect(() => now);
  assert.equal((await call("check_purchase", headphones)).status, "setup_needed");
  assert.equal((await call("setup", { currency: "USD", monthlyBudget: 2000 })).status, "ready");

  const q = await call("check_purchase", headphones);
  assert.equal(q.status, "questions");
  assert.deepEqual(
    q.questions.map((x: { id: string }) => x.id),
    ["N1", "N2", "N3", "U1", "S1", "S2", "P1", "O1"],
  );

  const v = await call("check_purchase", { ...headphones, answers });
  assert.equal(v.verdict, "SKIP");
  assert.equal(v.score, 46);
  assert.ok(v.message.startsWith("SKIP. This is a WANT"));

  const c1 = await call("challenge_verdict", { decisionId: v.decisionId, field: "U1", newValue: 60 });
  assert.equal(c1.status, "applied");
  assert.equal(c1.effectiveValue, 40);
  assert.equal(c1.after.verdict, "SKIP");
  assert.equal((await call("challenge_verdict", { decisionId: v.decisionId, field: "U1", newValue: 90 })).status, "estimate_used");
  const c3 = await call("challenge_verdict", { decisionId: v.decisionId, field: "none", argumentType: "deserve" });
  assert.equal(c3.status, "none");
  assert.equal(c3.moved, false);
  assert.equal((await call("challenge_verdict", { decisionId: v.decisionId, field: "N1", newValue: "z" })).status, "error");

  const o = await call("record_outcome", { decisionId: v.decisionId, event: "bought" });
  assert.equal(o.override, true);

  now = new Date(NOW.getTime() + 31 * DAY);
  const s = await call("get_status");
  assert.equal(s.reviewsDue.length, 1);
  assert.equal(s.reviewsDue[0].day, 30);

  const prompts = await client.listPrompts();
  assert.deepEqual(prompts.prompts.map((p) => p.name).sort(), ["review", "should-i-buy"]);
});

test("loosening the budget through setup waits 7 days", async () => {
  let now = NOW;
  const { call } = await connect(() => now);
  await call("setup", { currency: "USD", monthlyBudget: 2000 });
  const up = await call("setup", { monthlyBudget: 3000 });
  assert.equal(up.config.budget.monthly, 2000);
  assert.ok(up.pending);
  now = new Date(NOW.getTime() + 7 * DAY);
  assert.equal((await call("setup")).config.budget.monthly, 3000);
});
