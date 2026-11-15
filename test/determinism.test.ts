import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../src/engine/score.js";
import { args } from "./fixtures.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ALLOWED = [/^\.\.?\//, /^node:(fs|path|os|crypto)$/, /^@modelcontextprotocol\/sdk\//, /^zod$/];

const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));

const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

test("source imports nothing that can reach the network", () => {
  assert.ok(files(join(SRC, "engine")).length >= 8, "the scan found no engine files");
  for (const f of files(SRC)) {
    for (const m of imports(f)) assert.ok(ALLOWED.some((r) => r.test(m)), `${f} imports ${m}`);
    assert.ok(!/\bfetch\s*\(/.test(readFileSync(f, "utf8")), `${f} calls fetch`);
  }
});

test("the engine imports only itself", () => {
  for (const f of files(join(SRC, "engine"))) for (const m of imports(f)) assert.ok(m.startsWith("./"), `${f} imports ${m}`);
});

test("the engine never reads the clock or randomness", () => {
  for (const f of files(join(SRC, "engine"))) {
    assert.ok(!/Date\.now\(|new Date\(\)|Math\.random|randomUUID/.test(readFileSync(f, "utf8")), f);
  }
});

test("the same inputs give the same decision, even after a JSON round trip", () => {
  const a = args();
  const copy = {
    ...JSON.parse(JSON.stringify({ input: a.input, answers: a.answers, cfg: a.cfg, history: a.history })),
    now: new Date(a.now.getTime()),
  };
  assert.deepEqual(decide(a), decide(a));
  assert.deepEqual(decide(a), decide(copy));
});
