# Need or Want MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MCP server described in `docs/DESIGN.md`: a deterministic purchase-check engine with a fixed MCQ need test, structured challenges, local logs and 30/90-day reviews.

**Architecture:** A pure engine (`src/engine/*`, no I/O, no clock reads, no randomness) computes every verdict. `src/store.ts` is the only module that touches disk. `src/server.ts` wires both into five MCP tools and two prompts. Data lives in `~/.need-or-want/`.

**Tech Stack:** TypeScript (NodeNext ESM), Node ≥ 22, `@modelcontextprotocol/sdk` 1.32, `zod` 3.25, tests on built-in `node:test`.

**House rules for every task:**
- No code comments. The only allowed comment is the one `ponytail:` marker in Task 8.
- No Claude attribution in commits or PRs.
- Work in a worktree off `origin/main`, never in `~/code/my-mcps/need-or-want-mcp` itself.
- `main` is reached only through PRs, and each merge waits for the owner's OK.

**PR split:**

| PR | Branch | Tasks |
|---|---|---|
| 1 | `feat/engine` (off `origin/main`) | 1–7 |
| 2 | `feat/store-config` (off `feat/engine`) | 8–9 |
| 3 | `feat/server` (off `feat/store-config`) | 10–11 |

**File map:**

| File | Responsibility |
|---|---|
| `src/engine/types.ts` | All shared types |
| `src/engine/util.ts` | Small numeric and date helpers |
| `src/engine/defaults.ts` | `DEFAULT_CONFIG` |
| `src/engine/questions.ts` | The MCQ bank and question tiers |
| `src/engine/score.ts` | Need score, the five components, vetoes, wait, `decide` |
| `src/engine/explain.ts` | "What would change this", argument replies, verdict message |
| `src/engine/challenge.ts` | Challenge rules |
| `src/engine/history.ts` | Turns the event log into a `History` |
| `src/engine/stats.ts` | Reviews due and accuracy |
| `src/config.ts` | Load and validate config, hash, delayed loosening |
| `src/store.ts` | Data folder I/O |
| `src/server.ts` | MCP tools, prompts, instructions |
| `src/index.ts` | stdio entry point |
| `test/fixtures.ts` | Shared test data (a made-up person) |
| `test/*.test.ts` | One test file per module |

---

## PR 1: the engine

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `test/smoke.test.ts`

- [ ] **Step 1: Create the worktree**

```bash
cd ~/code/my-mcps/need-or-want-mcp && git fetch origin
git worktree add ~/code/wt/need-or-want/engine -b feat/engine origin/main
cd ~/code/wt/need-or-want/engine && git branch --unset-upstream
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "need-or-want-mcp",
  "version": "0.1.0",
  "mcpName": "io.github.justadityaraj/need-or-want-mcp",
  "description": "Stop impulse buying: an MCP server that checks whether a purchase is a need or a want, with deterministic verdicts and local data",
  "type": "module",
  "main": "dist/src/index.js",
  "bin": {
    "need-or-want-mcp": "dist/src/index.js"
  },
  "files": [
    "dist/src",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc && chmod +x dist/src/index.js",
    "test": "tsc && node --test \"dist/test/*.test.js\"",
    "start": "node dist/src/index.js"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "impulse-buying",
    "need-vs-want",
    "personal-finance",
    "claude"
  ],
  "author": "Aditya Raj Singh <https://adityarajsingh.com/>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/justadityaraj/need-or-want-mcp.git"
  },
  "engines": {
    "node": ">=22"
  }
}
```

The `build` script's `chmod` needs `src/index.ts`, which arrives in Task 10. Until then use `npm test`, which runs `tsc` on its own.

- [ ] **Step 3: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk@^1.32.2 zod@^3.25.76
npm install -D typescript@^5.7.2 @types/node@^22.10.0
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Write a smoke test**

`test/smoke.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("the test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: `# pass 1`, `# fail 0`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json test/smoke.test.ts
git commit -m "chore: scaffold TypeScript project with node:test"
```

### Task 2: Types, helpers, defaults and the question bank

**Files:**
- Create: `src/engine/types.ts`, `src/engine/util.ts`, `src/engine/defaults.ts`, `src/engine/questions.ts`, `test/questions.test.ts`, `test/fixtures.ts`
- Delete: `test/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

`test/questions.test.ts`:

```ts
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
  assert.equal(QUESTIONS.P1.options?.length, 5);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/engine/questions.js'`

- [ ] **Step 3: Write `src/engine/types.ts`**

```ts
export const CATEGORIES = [
  "consumable",
  "health",
  "work_tool",
  "home",
  "electronics",
  "clothing",
  "hobby",
  "subscription",
  "experience",
  "gift",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Recurring = "none" | "monthly" | "yearly";
export type Verdict = "BUY" | "WAIT" | "SKIP" | "NOT_PERSONAL";
export type NeedLabel = "NEED" | "MIXED" | "WANT";
export type Choice4 = "a" | "b" | "c" | "d";

export interface Answers {
  N1?: Choice4;
  N2?: Choice4;
  N3?: "a" | "b" | "c";
  N4?: string;
  U1?: number;
  U2?: number;
  U3?: number;
  S1?: Choice4;
  S2?: Choice4;
  P1?: "a" | "b" | "c" | "d" | "e";
  O1?: boolean;
  SP?: number;
  STILL_WANT?: boolean;
}

export interface PurchaseInput {
  item: string;
  price: number;
  category: Category;
  recurring: Recurring;
  productKey?: string;
  merchant?: string;
  spentThisMonth?: number;
  sellerClaims?: string[];
  runningCostPerMonth?: number;
  resaleValue?: number;
}

export interface WaitBand {
  upTo: number | null;
  hours: number;
}

export interface CategoryDefaults {
  lifespanMonths: number | null;
  lambda: number;
}

export type CardPolicy = "allow" | "block" | { onlyMerchants: string[] };

export interface Config {
  currency: string;
  budget: { monthly: number; schedule: Record<string, number> };
  vetoes: {
    debt: boolean;
    creditCard: CardPolicy;
    blockedCategories: { category: Category; until: string }[];
  };
  oneOffs: { mode: "count" | "cap"; yearlyCap: number };
  weights: { need: number; budget: number; costPerUse: number; history: number; deal: number };
  thresholds: { buy: number; wait: number };
  waitBands: WaitBand[];
  realReturn: number;
  hourlyIncome: number | null;
  loosenDelayDays: number;
  categories: Record<Category, CategoryDefaults>;
}

export interface PricePoint {
  price: number;
  ts: string;
}

export interface KeyedPrice extends PricePoint {
  key: string;
}

export interface History {
  boughtThisMonth: number;
  spentElsewhere: number | null;
  oneOffs90: { count: number; total: number };
  oneOffsThisYear: number;
  category: { regret: number; n: number };
  usage: { actual: number; predicted: number; n: number };
  prices: PricePoint[];
  firstCheckTs: string | null;
}

export interface Components {
  need: number;
  budget: number;
  costPerUse: number;
  history: number;
  deal: number;
}

export interface Numbers {
  cost: number;
  remaining: number;
  budgetDays: number;
  hoursOfWork: number | null;
  costPerUse: number | null;
  effectiveUses: number | null;
  fv10: number;
  fv20: number;
  monthlyEquivalent: number;
  yearlyCommitment: number | null;
  waitHours: number;
  waitUntil: string | null;
}

export type Veto = "blocked" | "debt" | "card" | "over_budget" | "oneoff_cap";

export interface Decision {
  verdict: Verdict;
  needLabel: NeedLabel;
  score: number;
  emergency: boolean;
  marginal: boolean;
  faded: boolean;
  components: Components;
  vetoes: Veto[];
  numbers: Numbers;
}

export interface DecisionSummary {
  verdict: Verdict;
  score: number;
  needLabel: NeedLabel;
  cost: number;
  waitUntil: string | null;
}

export type ChallengeStatus = "applied" | "repeat" | "estimate_used" | "none";

export interface VerdictEvent {
  type: "verdict";
  id: string;
  ts: string;
  key: string;
  input: PurchaseInput;
  answers: Answers;
  decision: DecisionSummary;
  configHash: string;
  engineVersion: string;
}

export interface ChallengeEvent {
  type: "challenge";
  id: string;
  ts: string;
  field: string;
  newValue: unknown;
  effectiveValue: unknown;
  status: ChallengeStatus;
  note?: string;
  argumentType?: string;
  input: PurchaseInput;
  answers: Answers;
  decision: DecisionSummary;
}

export interface OutcomeEvent {
  type: "outcome";
  id: string;
  ts: string;
  bought: boolean;
  price: number | null;
  override: boolean;
}

export interface ReviewEvent {
  type: "review";
  id: string;
  ts: string;
  day: 30 | 90;
  uses?: number;
  worthIt?: "yes" | "meh" | "no";
  missIt?: "yes" | "no" | "other";
}

export type LogEvent = VerdictEvent | ChallengeEvent | OutcomeEvent | ReviewEvent;
```

- [ ] **Step 4: Write `src/engine/util.ts`**

```ts
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const round4 = (x: number): number => Math.round(x * 10000) / 10000;

const pad = (n: number): string => String(n).padStart(2, "0");

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function isoDate(d: Date): string {
  return `${monthKey(d)}-${pad(d.getDate())}`;
}

export function localTime(iso: string): string {
  const d = new Date(iso);
  return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
```

- [ ] **Step 5: Write `src/engine/defaults.ts`**

```ts
import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  currency: "USD",
  budget: { monthly: 0, schedule: {} },
  vetoes: { debt: true, creditCard: "allow", blockedCategories: [] },
  oneOffs: { mode: "count", yearlyCap: 0 },
  weights: { need: 0.4, budget: 0.25, costPerUse: 0.2, history: 0.1, deal: 0.05 },
  thresholds: { buy: 70, wait: 50 },
  waitBands: [
    { upTo: 0.02, hours: 0 },
    { upTo: 0.05, hours: 24 },
    { upTo: 0.25, hours: 168 },
    { upTo: 1, hours: 720 },
    { upTo: null, hours: 1440 },
  ],
  realReturn: 0.04,
  hourlyIncome: null,
  loosenDelayDays: 7,
  categories: {
    consumable: { lifespanMonths: 1, lambda: 0 },
    health: { lifespanMonths: 6, lambda: 0 },
    work_tool: { lifespanMonths: 36, lambda: 0.01 },
    home: { lifespanMonths: 60, lambda: 0.01 },
    electronics: { lifespanMonths: 36, lambda: 0.08 },
    clothing: { lifespanMonths: 24, lambda: 0.06 },
    hobby: { lifespanMonths: 24, lambda: 0.1 },
    subscription: { lifespanMonths: 12, lambda: 0.05 },
    experience: { lifespanMonths: null, lambda: 0 },
    gift: { lifespanMonths: null, lambda: 0 },
    other: { lifespanMonths: 12, lambda: 0.05 },
  },
};
```

- [ ] **Step 6: Write `src/engine/questions.ts`**

```ts
import type { Answers } from "./types.js";

export type QuestionId = keyof Answers;

export interface Option {
  key: string;
  label: string;
  value: number;
}

export interface Question {
  id: QuestionId;
  kind: "choice" | "number" | "date" | "boolean";
  text: string;
  options?: Option[];
}

const choice = (id: QuestionId, text: string, options: [string, number][]): Question => ({
  id,
  kind: "choice",
  text,
  options: options.map(([label, value], i) => ({ key: "abcde"[i], label, value })),
});

export const QUESTIONS: Record<QuestionId, Question> = {
  N1: choice("N1", "What's prompting this purchase?", [
    ["Something I rely on broke, ran out or no longer fits", 1],
    ["A problem I've had again and again for 2+ weeks", 0.7],
    ["An upgrade: what I have still works", 0.2],
    ["I saw it (ad, video, friend, deal) and want it", 0],
  ]),
  N2: choice("N2", "Do you already own something that does this job?", [
    ["No", 1],
    ["Yes, but it's broken or unusable", 0.9],
    ["Yes, it works but is clearly worse for this job", 0.4],
    ["Yes, it works fine", 0],
  ]),
  N3: choice("N3", "If you couldn't buy this for 30 days, what would happen?", [
    ["Real harm: health, safety, income, or a cost that keeps growing", 1],
    ["Things get noticeably harder, but I'd manage", 0.5],
    ["Nothing much. I'd just keep wanting it", 0],
  ]),
  N4: {
    id: "N4",
    kind: "date",
    text: "Is there a real date you need it by? Give it as YYYY-MM-DD, or say none. A sale ending doesn't count.",
  },
  U1: { id: "U1", kind: "number", text: "How many times a month will you use it?" },
  U2: { id: "U2", kind: "number", text: "For how many months will you keep using it?" },
  U3: {
    id: "U3",
    kind: "number",
    text: "Anything else you'll need to buy for it (accessories, installation, a subscription)? Total cost, or 0.",
  },
  S1: choice("S1", "When did you first want this?", [
    ["2+ weeks ago", 1],
    ["This week", 1],
    ["Today", 1.5],
    ["In the last hour", 2],
  ]),
  S2: choice("S2", "Right now you're mostly...", [
    ["Calm, this was planned", 1],
    ["Bored or scrolling", 1.25],
    ["Stressed, sad or tired", 1.25],
    ["Excited, celebrating or just got money", 1.25],
  ]),
  P1: choice("P1", "How will you pay?", [
    ["Bank transfer, UPI, debit or cash, in full", 0],
    ["Credit card, paid in full on the next bill", 0],
    ["EMI, pay-later or no-cost EMI", 0],
    ["A new card or a new credit line", 0],
    ["My business pays and books it as a business expense", 0],
  ]),
  O1: { id: "O1", kind: "boolean", text: "Is this a one-time expense?" },
  SP: {
    id: "SP",
    kind: "number",
    text: "Roughly how much have you spent this month that these checks don't know about?",
  },
  STILL_WANT: { id: "STILL_WANT", kind: "boolean", text: "The wait is over. Do you still want it?" },
};

export type Tier = "micro" | "standard" | "big";

const TIERS: Record<Tier, QuestionId[]> = {
  micro: ["N1", "P1"],
  standard: ["N1", "N2", "N3", "U1", "S1", "S2", "P1", "O1"],
  big: ["N1", "N2", "N3", "N4", "U1", "U2", "U3", "S1", "S2", "P1", "O1"],
};

export function tierFor(share: number): Tier {
  if (share < 0.02) return "micro";
  return share <= 0.25 ? "standard" : "big";
}

export function questionsFor(tier: Tier): QuestionId[] {
  return TIERS[tier];
}

export function optionValue(id: QuestionId, key: unknown): number | undefined {
  return QUESTIONS[id].options?.find((o) => o.key === key)?.value;
}
```

- [ ] **Step 7: Write `test/fixtures.ts`** (shared by later tasks)

```ts
import { DEFAULT_CONFIG } from "../src/engine/defaults.js";
import type { DecideArgs } from "../src/engine/score.js";
import type {
  Answers,
  Category,
  Config,
  History,
  OutcomeEvent,
  PurchaseInput,
  ReviewEvent,
  Verdict,
  VerdictEvent,
} from "../src/engine/types.js";
import { DAY } from "../src/engine/util.js";

export const NOW = new Date(2026, 10, 10, 14, 0);
export const cfg: Config = { ...DEFAULT_CONFIG, budget: { monthly: 2000, schedule: {} } };

export const emptyHistory = (over: Partial<History> = {}): History => ({
  boughtThisMonth: 0,
  spentElsewhere: null,
  oneOffs90: { count: 0, total: 0 },
  oneOffsThisYear: 0,
  category: { regret: 0, n: 0 },
  usage: { actual: 0, predicted: 0, n: 0 },
  prices: [],
  firstCheckTs: null,
  ...over,
});

export const headphones: PurchaseInput = {
  item: "Wireless headphones",
  price: 300,
  category: "electronics",
  recurring: "none",
  spentThisMonth: 900,
};

export const wantAnswers: Answers = { N1: "c", N2: "d", N3: "c", U1: 20, S1: "c", S2: "a", P1: "a", O1: false };

export const args = (
  over: { input?: Partial<PurchaseInput>; answers?: Partial<Answers>; cfg?: Config; history?: History; now?: Date } = {},
): DecideArgs => ({
  input: { ...headphones, ...over.input },
  answers: { ...wantAnswers, ...over.answers } as Answers,
  cfg: over.cfg ?? cfg,
  history: over.history ?? emptyHistory(),
  now: over.now ?? NOW,
});

export const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
export const daysAgo = (d: number): string => new Date(NOW.getTime() - d * DAY).toISOString();

export const verdictEvent = (
  id: string,
  ago: number,
  over: { key?: string; category?: Category; O1?: boolean; U1?: number; verdict?: Verdict; score?: number; cost?: number } = {},
): VerdictEvent => ({
  type: "verdict",
  id,
  ts: daysAgo(ago),
  key: over.key ?? id,
  input: { item: id, price: over.cost ?? 100, category: over.category ?? "other", recurring: "none" },
  answers: { O1: over.O1 ?? false, U1: over.U1 },
  decision: { verdict: over.verdict ?? "BUY", score: over.score ?? 70, needLabel: "MIXED", cost: over.cost ?? 100, waitUntil: null },
  configHash: "test",
  engineVersion: "test",
});

export const outcomeEvent = (id: string, ago: number, bought = true, override = false): OutcomeEvent => ({
  type: "outcome",
  id,
  ts: daysAgo(ago),
  bought,
  price: null,
  override,
});

export const reviewEvent = (id: string, ago: number, day: 30 | 90, extra: Partial<ReviewEvent> = {}): ReviewEvent => ({
  type: "review",
  id,
  ts: daysAgo(ago),
  day,
  ...extra,
});
```

`fixtures.ts` imports `DecideArgs` from `score.ts`, which doesn't exist until Task 3. Leave `fixtures.ts` uncommitted until Task 3, or create it in Task 3 Step 3. Here: create it in this task but `git add` it in Task 3.

- [ ] **Step 8: Delete the smoke test, move `fixtures.ts` aside, run the questions test**

```bash
rm test/smoke.test.ts
mv test/fixtures.ts /tmp/need-or-want-fixtures.ts
npm test
```
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 9: Commit**

```bash
git add src/engine/types.ts src/engine/util.ts src/engine/defaults.ts src/engine/questions.ts test/questions.test.ts
git rm --cached test/smoke.test.ts 2>/dev/null; git add -A test
git commit -m "feat(engine): add types, defaults and the fixed question bank"
```

### Task 3: Scoring and the verdict

**Files:**
- Create: `src/engine/score.ts`, `test/score.test.ts`
- Restore: `test/fixtures.ts`

- [ ] **Step 1: Restore fixtures**

```bash
mv /tmp/need-or-want-fixtures.ts test/fixtures.ts
```

- [ ] **Step 2: Write the failing test**

`test/score.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decide, effectiveUses, historyScore, dealScore, needScore, pendingQuestions, realism } from "../src/engine/score.js";
import { NOW, args, cfg, emptyHistory, headphones, hoursAgo, daysAgo } from "./fixtures.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

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
  assert.equal(dealScore(300, [{ price: 400, ts: daysAgo(3) }, { price: 400, ts: daysAgo(2) }, { price: 400, ts: daysAgo(1) }], NOW), 0.5);
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
  assert.equal(first.numbers.waitUntil, new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString());
  const later = decide(args({ answers: { N1: "a", N2: "b", N3: "b" }, history: emptyHistory({ firstCheckTs: hoursAgo(25) }) }));
  assert.equal(later.verdict, "BUY");
});

test("hot-state answers lengthen the wait, capped at 2x", () => {
  const hot = { N1: "c", N2: "a", N3: "b", S1: "c", S2: "b" } as const;
  const d = decide(args({ answers: hot }));
  assert.equal(d.score, 63);
  assert.equal(d.verdict, "WAIT");
  assert.equal(d.marginal, true);
  assert.equal(d.numbers.waitHours, 630);
  const night = decide(args({ answers: hot, now: new Date(2026, 10, 10, 23, 30) }));
  assert.equal(night.numbers.waitHours, 672);
});

test("a real deadline caps the wait", () => {
  const d = decide(args({ answers: { N1: "c", N2: "a", N3: "b", S1: "c", S2: "b", N4: "2026-11-14" } }));
  assert.equal(d.numbers.waitHours, 58);
});

test("marginal items buy only if you still want them after the wait", () => {
  const hot = { N1: "c", N2: "a", N3: "b", S1: "c", S2: "b" } as const;
  const faded = decide(args({ answers: { ...hot, STILL_WANT: false }, history: emptyHistory({ firstCheckTs: hoursAgo(400) }) }));
  assert.equal(faded.verdict, "SKIP");
  assert.equal(faded.faded, true);
  const kept = decide(args({ answers: { ...hot, STILL_WANT: true }, history: emptyHistory({ firstCheckTs: hoursAgo(700) }) }));
  assert.equal(kept.verdict, "BUY");
  assert.equal(kept.marginal, true);
});

test("debt and card vetoes label the verdict without changing the score", () => {
  const debt = decide(args({ answers: { P1: "c" } }));
  assert.deepEqual(debt.vetoes, ["debt"]);
  assert.equal(debt.score, 46);
  const policy = { ...cfg, vetoes: { ...cfg.vetoes, creditCard: { onlyMerchants: ["amazon.in"] } } };
  assert.deepEqual(decide(args({ cfg: policy, answers: { P1: "b" }, input: { merchant: "flipkart.com" } })).vetoes, ["card"]);
  assert.deepEqual(decide(args({ cfg: policy, answers: { P1: "b" }, input: { merchant: "amazon.in" } })).vetoes, []);
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/engine/score.js'`

- [ ] **Step 4: Write `src/engine/score.ts`**

```ts
import { optionValue, questionsFor, tierFor, type QuestionId } from "./questions.js";
import type {
  Answers,
  CardPolicy,
  Components,
  Config,
  Decision,
  History,
  NeedLabel,
  PricePoint,
  PurchaseInput,
  Verdict,
  Veto,
} from "./types.js";
import { DAY, HOUR, clamp, daysInMonth, isoDate, localDate, median, monthKey, round2, round4, startOfNextMonth } from "./util.js";

const NEED_WEIGHTS = { N1: 0.4, N2: 0.25, N3: 0.35 } as const;
const PRIOR_RHO = 0.5;
const PRIOR_REGRET = 0.3;
const SHRINK = 5;

export interface DecideArgs {
  input: PurchaseInput;
  answers: Answers;
  cfg: Config;
  history: History;
  now: Date;
}

export interface CostPerUse {
  score: number;
  cpu: number | null;
  uses: number | null;
  months: number | null;
}

export function needScore(a: Answers): { score: number; label: NeedLabel; emergency: boolean } {
  let total = 0;
  let weight = 0;
  for (const id of ["N1", "N2", "N3"] as const) {
    const v = optionValue(id, a[id]);
    if (v === undefined) continue;
    total += NEED_WEIGHTS[id] * v;
    weight += NEED_WEIGHTS[id];
  }
  const score = weight === 0 ? 0 : round4(total / weight);
  const label: NeedLabel = score >= 0.7 ? "NEED" : score >= 0.35 ? "MIXED" : "WANT";
  return { score, label, emergency: a.N1 === "a" && a.N3 === "a" };
}

export function monthBudget(cfg: Config, now: Date): number {
  return cfg.budget.schedule[monthKey(now)] ?? cfg.budget.monthly;
}

export function spentSoFar(input: PurchaseInput, a: Answers, h: History): number {
  return input.spentThisMonth ?? h.boughtThisMonth + (a.SP ?? h.spentElsewhere ?? 0);
}

export function costNow(input: PurchaseInput, a: Answers): number {
  return input.price + (a.U3 ?? 0);
}

export function budgetFit(cost: number, remaining: number): number {
  if (remaining <= 0) return 0;
  return clamp(1 - cost / remaining) ** 2;
}

export function realism(h: History): number {
  const observed = h.usage.n > 0 && h.usage.predicted > 0 ? h.usage.actual / h.usage.predicted : PRIOR_RHO;
  return clamp((h.usage.n * observed + SHRINK * PRIOR_RHO) / (h.usage.n + SHRINK), 0.2, 1);
}

export function effectiveUses(usesPerMonth: number, months: number, lambda: number, rho: number): number {
  if (lambda <= 0) return usesPerMonth * rho * months;
  return (usesPerMonth * rho * (1 - Math.exp(-lambda * months))) / lambda;
}

export function cpuScore(costPerUse: number, daily: number): number {
  const q = costPerUse / daily;
  if (q <= 0) return 1;
  return clamp(Math.log10(1 / q) / Math.log10(20));
}

export function monthlyPrice(input: PurchaseInput): number | null {
  if (input.recurring === "monthly") return input.price;
  if (input.recurring === "yearly") return input.price / 12;
  return null;
}

export function costPerUse(input: PurchaseInput, a: Answers, cfg: Config, h: History, daily: number): CostPerUse {
  const defaults = cfg.categories[input.category];
  if (defaults.lifespanMonths === null) return { score: 0.5, cpu: null, uses: null, months: null };
  const months = a.U2 ?? defaults.lifespanMonths;
  if (a.U1 === undefined) return { score: 0.5, cpu: null, uses: null, months };
  const uses = effectiveUses(a.U1, months, defaults.lambda, realism(h));
  if (uses <= 0) return { score: 0, cpu: null, uses: 0, months };
  const perMonth = monthlyPrice(input);
  const addOns = a.U3 ?? 0;
  const total =
    perMonth === null
      ? input.price + addOns + (input.runningCostPerMonth ?? 0) * months - (input.resaleValue ?? 0)
      : perMonth * months + addOns;
  const cpu = total / uses;
  return { score: cpuScore(cpu, daily), cpu, uses, months };
}

export function historyScore(a: Answers, h: History): number {
  const regret = (h.category.regret + SHRINK * PRIOR_REGRET) / (h.category.n + SHRINK);
  const pressure = a.O1 ? Math.min(h.oneOffs90.count / 5, 1) * 0.5 : 0;
  return (1 - regret) * (1 - pressure);
}

export function dealScore(price: number, prices: PricePoint[], now: Date): number {
  const recent = prices.filter((p) => now.getTime() - Date.parse(p.ts) <= 90 * DAY);
  if (recent.length < 3) return 0.5;
  const times = recent.map((p) => Date.parse(p.ts));
  if (Math.max(...times) - Math.min(...times) < 7 * DAY) return 0.5;
  const m = median(recent.map((p) => p.price));
  return clamp(0.5 + (m - price) / m / 0.4);
}

export function futureValue(input: PurchaseInput, a: Answers, r: number, years: number): number {
  const lump = (input.recurring === "none" ? input.price : 0) + (a.U3 ?? 0);
  const perMonth = monthlyPrice(input);
  const i = (1 + r) ** (1 / 12) - 1;
  const annuity = perMonth === null ? 0 : i === 0 ? perMonth * 12 * years : perMonth * (((1 + i) ** (12 * years) - 1) / i);
  return round2(lump * (1 + r) ** years + annuity);
}

export function lateNight(now: Date): boolean {
  const h = now.getHours();
  return h >= 23 || h < 5;
}

export function baseWaitHours(share: number, cfg: Config): number {
  const band = cfg.waitBands.find((b) => b.upTo === null || share < b.upTo) ?? cfg.waitBands[cfg.waitBands.length - 1];
  return band.hours;
}

export function waitHours(share: number, a: Answers, cfg: Config, now: Date): number {
  const base = baseWaitHours(share, cfg);
  if (a.N1 === "a") return Math.min(base, 24);
  const m = Math.min(2, (optionValue("S1", a.S1) ?? 1) * (optionValue("S2", a.S2) ?? 1) * (lateNight(now) ? 1.25 : 1));
  return Math.ceil(base * m);
}

export function capByDeadline(hours: number, a: Answers, now: Date): number {
  if (!a.N4 || a.N4 === "none") return hours;
  const left = (localDate(a.N4).getTime() - now.getTime()) / HOUR - 24;
  return Math.max(0, Math.min(hours, Math.floor(left)));
}

export function pendingQuestions(input: PurchaseInput, a: Answers, cfg: Config, h: History, now: Date): QuestionId[] {
  const share = costNow(input, a) / monthBudget(cfg, now);
  const ids = questionsFor(tierFor(share)).filter((id) => a[id] === undefined);
  if (input.spentThisMonth === undefined && h.spentElsewhere === null && a.SP === undefined) ids.push("SP");
  if (h.firstCheckTs !== null && a.STILL_WANT === undefined) ids.push("STILL_WANT");
  return ids;
}

export function scoreOf(c: Components, cfg: Config): number {
  const w = cfg.weights;
  return Math.round(100 * (w.need * c.need + w.budget * c.budget + w.costPerUse * c.costPerUse + w.history * c.history + w.deal * c.deal));
}

function cardAllowed(policy: CardPolicy, merchant: string | undefined): boolean {
  if (policy === "allow") return true;
  if (policy === "block") return false;
  return merchant !== undefined && policy.onlyMerchants.includes(merchant.toLowerCase());
}

const hoursBetween = (from: Date, to: Date): number => Math.ceil((to.getTime() - from.getTime()) / HOUR);

export function decide({ input, answers: a, cfg, history: h, now }: DecideArgs): Decision {
  const budget = monthBudget(cfg, now);
  const daily = budget / daysInMonth(now);
  const cost = costNow(input, a);
  const remaining = budget - spentSoFar(input, a, h);
  const need = needScore(a);
  const cpu = costPerUse(input, a, cfg, h, daily);
  const components: Components = {
    need: need.score,
    budget: budgetFit(cost, remaining),
    costPerUse: cpu.score,
    history: historyScore(a, h),
    deal: dealScore(input.price, h.prices, now),
  };
  const score = scoreOf(components, cfg);
  const perMonth = monthlyPrice(input);
  const vetoes: Veto[] = [];
  const finish = (verdict: Verdict, wait: number, until: Date | null, extra: { marginal?: boolean; faded?: boolean } = {}): Decision => ({
    verdict,
    needLabel: need.label,
    score,
    emergency: need.emergency,
    marginal: extra.marginal ?? false,
    faded: extra.faded ?? false,
    components,
    vetoes,
    numbers: {
      cost: round2(cost),
      remaining: round2(remaining),
      budgetDays: round2(cost / daily),
      hoursOfWork: cfg.hourlyIncome ? round2(cost / cfg.hourlyIncome) : null,
      costPerUse: cpu.cpu === null ? null : round2(cpu.cpu),
      effectiveUses: cpu.uses === null ? null : round2(cpu.uses),
      fv10: futureValue(input, a, cfg.realReturn, 10),
      fv20: futureValue(input, a, cfg.realReturn, 20),
      monthlyEquivalent: round2(perMonth ?? (cpu.months ? cost / cpu.months : cost)),
      yearlyCommitment: perMonth === null ? null : round2(perMonth * 12),
      waitHours: wait,
      waitUntil: until ? until.toISOString() : null,
    },
  });
  const waitOrSkip = (veto: Veto, until: Date): Decision => {
    vetoes.push(veto);
    return score >= cfg.thresholds.wait ? finish("WAIT", hoursBetween(now, until), until) : finish("SKIP", 0, null);
  };

  if (a.P1 === "e") return finish("NOT_PERSONAL", 0, null);
  if (cfg.vetoes.debt && (a.P1 === "c" || a.P1 === "d")) vetoes.push("debt");
  if (a.P1 === "b" && !cardAllowed(cfg.vetoes.creditCard, input.merchant)) vetoes.push("card");
  if (need.emergency) return finish("BUY", 0, null);
  if (cfg.vetoes.blockedCategories.some((b) => b.category === input.category && isoDate(now) <= b.until)) {
    vetoes.push("blocked");
    return finish("SKIP", 0, null);
  }
  if (cost > remaining) return waitOrSkip("over_budget", startOfNextMonth(now));
  if (cfg.oneOffs.mode === "cap" && a.O1 && h.oneOffsThisYear + cost > cfg.oneOffs.yearlyCap) {
    return waitOrSkip("oneoff_cap", new Date(now.getFullYear() + 1, 0, 1));
  }
  if (score < cfg.thresholds.wait) return finish("SKIP", 0, null);
  if (a.STILL_WANT === false) return finish("SKIP", 0, null, { faded: true });
  const marginal = score < cfg.thresholds.buy;
  const w = waitHours(cost / budget, a, cfg, now);
  const required = capByDeadline(marginal ? Math.max(2 * w, 24) : w, a, now);
  const start = h.firstCheckTs ? new Date(h.firstCheckTs) : now;
  const until = new Date(start.getTime() + required * HOUR);
  if (now.getTime() < until.getTime() || (marginal && a.STILL_WANT !== true)) return finish("WAIT", required, until, { marginal });
  return finish("BUY", required, null, { marginal });
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass. If a number is off, fix the code, not the expected value: every expected value is hand-worked in `docs/DESIGN.md` §6.12 or in the test name.

- [ ] **Step 6: Commit**

```bash
git add src/engine/score.ts test/score.test.ts test/fixtures.ts
git commit -m "feat(engine): compute the score, vetoes, wait and verdict"
```

### Task 4: What would change this, and the verdict message

**Files:**
- Create: `src/engine/explain.ts`, `test/explain.test.ts`

- [ ] **Step 1: Write the failing test**

`test/explain.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ARGUMENT_REPLIES, render, whatWouldChange } from "../src/engine/explain.js";
import { ARGUMENT_TYPES } from "../src/engine/challenge.js";
import { decide } from "../src/engine/score.js";
import { args, cfg } from "./fixtures.js";

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
  assert.ok(m.startsWith("SKIP. This is a WANT (score 46/100)."));
  assert.ok(m.includes("USD 300 is 4.5 days of your budget"));
  assert.ok(m.includes("To reach BUY:"));
  assert.ok(m.endsWith("You can still buy it. It will be logged as an override."));
});

test("every argument type has a fixed reply", () => {
  for (const t of ARGUMENT_TYPES) assert.ok(ARGUMENT_REPLIES[t].length > 20, t);
});
```

This test imports `ARGUMENT_TYPES` from `challenge.ts` (Task 5). Write Task 5's `challenge.ts` file first if running this test alone; otherwise run both tasks' tests together after Task 5. The order below writes `explain.ts` now and runs the suite in Task 5 Step 4.

- [ ] **Step 2: Write `src/engine/explain.ts`**

```ts
import { QUESTIONS } from "./questions.js";
import { decide, type DecideArgs } from "./score.js";
import type { Answers, Config, Decision, Veto } from "./types.js";
import { localTime, round2 } from "./util.js";

type FactId = "N1" | "N2" | "N3";

export interface Change {
  changes: Partial<Record<FactId, string>>;
  score: number;
}

export interface WhatWouldChange {
  nextBand: Change | null;
  toBuy: Change | null;
}

const band = (score: number, cfg: Config): number => (score >= cfg.thresholds.buy ? 2 : score >= cfg.thresholds.wait ? 1 : 0);

export function whatWouldChange(args: DecideArgs, current: number): WhatWouldChange {
  const ids = (["N1", "N2", "N3"] as const).filter((id) => args.answers[id] !== undefined);
  const from = band(current, args.cfg);
  const best: WhatWouldChange = { nextBand: null, toBuy: null };
  const better = (n: number, s: number, c: Change | null): boolean =>
    c === null || n < Object.keys(c.changes).length || (n === Object.keys(c.changes).length && s > c.score);
  const visit = (i: number, picked: Partial<Record<FactId, string>>): void => {
    if (i < ids.length) {
      for (const o of QUESTIONS[ids[i]].options ?? []) visit(i + 1, { ...picked, [ids[i]]: o.key });
      return;
    }
    const changes = Object.fromEntries(
      Object.entries(picked).filter(([id, key]) => args.answers[id as FactId] !== key),
    ) as Partial<Record<FactId, string>>;
    const n = Object.keys(changes).length;
    if (n === 0) return;
    const s = decide({ ...args, answers: { ...args.answers, ...picked } as Answers }).score;
    const b = band(s, args.cfg);
    if (b > from && better(n, s, best.nextBand)) best.nextBand = { changes, score: s };
    if (b === 2 && from < 2 && better(n, s, best.toBuy)) best.toBuy = { changes, score: s };
  };
  visit(0, {});
  if (best.toBuy && best.nextBand && JSON.stringify(best.toBuy) === JSON.stringify(best.nextBand)) best.toBuy = null;
  return best;
}

export const ARGUMENT_REPLIES: Record<string, string> = {
  deserve:
    "Feeling you've earned it is a known bias, the licensing effect. It isn't a fact about this purchase, so the verdict stands.",
  scarcity:
    "\"Only a few left\" and countdown timers are pressure, not facts. Regulators class false urgency as a dark pattern. The verdict stands.",
  sale: "A discount against MRP or a list price is an anchor. Only this product's own price history counts here. The verdict stands.",
  one_time:
    "Every one-time purchase feels like an exception. People spend almost twice what they expect on them. Your one-off record is already in the score. The verdict stands.",
  social: "Other people owning it doesn't change what it does for you. The verdict stands.",
  mood: "The feeling is real, but it isn't a fact about this purchase. The verdict stands.",
  sunk: "Time already spent researching is gone either way. It doesn't make the purchase better. The verdict stands.",
  future_use:
    "How often you'll use it is an estimate. Change it with the U1 field: after a verdict a revised estimate counts at 50%, and only once.",
  other:
    "Which fact changed? Price, add-on cost, what's prompting it, what you own, what happens if you wait, a real deadline, money spent this month, or how you'll pay.",
};

const VETO_TEXT: Record<Veto, string> = {
  blocked: "This category is blocked in your settings.",
  debt: "Only if paid in full. EMI, pay-later and new credit are never allowed.",
  card: "Not on a credit card here. Your card policy doesn't allow it for this merchant.",
  over_budget: "It costs more than what's left this month.",
  oneoff_cap: "Your yearly one-off cap is used up.",
};

const money = (x: number, currency: string): string => `${currency} ${Number.isInteger(x) ? x : x.toFixed(2)}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function componentLines(d: Decision, cfg: Config): string[] {
  const c = d.components;
  const n = d.numbers;
  const cur = cfg.currency;
  const lines: [number, number, string][] = [
    [cfg.weights.need, c.need, `Need score ${c.need} of 1, so this is a ${d.needLabel}.`],
    [
      cfg.weights.budget,
      c.budget,
      n.remaining > 0
        ? `It uses ${pct(n.cost / n.remaining)} of what's left this month (${money(n.remaining, cur)}).`
        : "Nothing is left in this month's budget.",
    ],
    [
      cfg.weights.costPerUse,
      c.costPerUse,
      n.costPerUse === null
        ? "Cost per use doesn't apply here or wasn't asked."
        : `About ${money(n.costPerUse, cur)} per use, after allowing for the usual overestimate of use.`,
    ],
    [cfg.weights.history, c.history, `Your record with similar purchases scores ${round2(c.history)} of 1.`],
    [
      cfg.weights.deal,
      c.deal,
      c.deal === 0.5
        ? "The price is at its usual level, or there's no price history yet."
        : c.deal > 0.5
          ? "The price is below its usual level."
          : "The price is above its usual level.",
    ],
  ];
  const weightOf = ([w, s]: [number, number, string]): number => (d.verdict === "BUY" ? w * s : w * (1 - s));
  return [...lines].sort((x, y) => weightOf(y) - weightOf(x)).slice(0, 2).map((l) => l[2]);
}

function describe(ch: Change): string {
  return Object.entries(ch.changes)
    .map(([id, key]) => {
      const q = QUESTIONS[id as FactId];
      return `${q.text} → "${q.options?.find((o) => o.key === key)?.label}"`;
    })
    .join(" and ");
}

export function render(d: Decision, cfg: Config, wwc: WhatWouldChange): string {
  if (d.verdict === "NOT_PERSONAL") return "This isn't a personal purchase. Check it against the business budget.";
  const n = d.numbers;
  const cur = cfg.currency;
  const until = localTime(n.waitUntil ?? new Date(0).toISOString());
  const label = `This is a ${d.needLabel} (score ${d.score}/100).`;
  const lines = [d.verdict === "WAIT" ? `WAIT until ${until}. ${label}` : `${d.verdict}. ${label}`];
  if (d.emergency) lines.push("Emergency: buy the cheapest option that fixes the problem.");
  if (d.marginal && d.verdict === "BUY") lines.push("Marginal: it passed because you still wanted it after the wait.");
  if (d.faded) lines.push("You no longer wanted it after the wait.");
  const figures = [`${money(n.cost, cur)} is ${n.budgetDays} days of your budget`];
  if (n.hoursOfWork !== null) figures.push(`${n.hoursOfWork} hours of work`);
  if (n.costPerUse !== null) figures.push(`${money(n.costPerUse, cur)} per use`);
  figures.push(`${money(n.fv10, cur)} in 10 years or ${money(n.fv20, cur)} in 20 if invested (today's money)`);
  figures.push(
    n.yearlyCommitment !== null ? `${money(n.yearlyCommitment, cur)} a year` : `${money(n.monthlyEquivalent, cur)} a month over its life`,
  );
  lines.push(figures.join(" · "));
  for (const v of d.vetoes) lines.push(VETO_TEXT[v]);
  lines.push(...componentLines(d, cfg));
  if (wwc.nextBand) lines.push(`What would change this: ${describe(wwc.nextBand)} (score ${wwc.nextBand.score}).`);
  if (wwc.toBuy) lines.push(`To reach BUY: ${describe(wwc.toBuy)} (score ${wwc.toBuy.score}).`);
  if (d.verdict === "WAIT") lines.push(`If you still want it on ${until}, check again.`);
  if (d.verdict !== "BUY") lines.push("You can still buy it. It will be logged as an override.");
  return lines.join("\n");
}
```

- [ ] **Step 3: Commit after Task 5's test run passes** (Task 5 Step 5 commits both).

### Task 5: Challenge rules

**Files:**
- Create: `src/engine/challenge.ts`, `test/challenge.test.ts`

- [ ] **Step 1: Write the failing test**

`test/challenge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/engine/challenge.js'`

- [ ] **Step 3: Write `src/engine/challenge.ts`**

```ts
import { QUESTIONS } from "./questions.js";
import type { Answers, ChallengeStatus, PurchaseInput } from "./types.js";

export const FACT_FIELDS = ["price", "U3", "N1", "N2", "N3", "N4", "spentThisMonth", "P1"] as const;
export const ESTIMATE_FIELDS = ["U1", "U2"] as const;
export const CHALLENGE_FIELDS = [...FACT_FIELDS, ...ESTIMATE_FIELDS, "none"] as const;
export type ChallengeField = (typeof CHALLENGE_FIELDS)[number];
export const ARGUMENT_TYPES = ["deserve", "scarcity", "sale", "one_time", "social", "mood", "sunk", "future_use", "other"] as const;

export interface Prior {
  field: string;
  newValue: unknown;
  status: ChallengeStatus;
}

export interface ChallengeResult {
  status: ChallengeStatus;
  input: PurchaseInput;
  answers: Answers;
  effectiveValue: unknown;
}

export function isValidValue(field: ChallengeField, value: unknown): boolean {
  if (field === "none") return true;
  if (field === "N4") return value === "none" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (field === "N1" || field === "N2" || field === "N3" || field === "P1") {
    return (QUESTIONS[field].options ?? []).some((o) => o.key === value);
  }
  return typeof value === "number" && Number.isFinite(value) && (field === "price" ? value > 0 : value >= 0);
}

export function applyChallenge(
  input: PurchaseInput,
  answers: Answers,
  field: ChallengeField,
  newValue: unknown,
  priors: Prior[],
): ChallengeResult {
  const unchanged: ChallengeResult = { status: "none", input, answers, effectiveValue: undefined };
  if (field === "none") return unchanged;
  if (priors.some((p) => p.field === field && JSON.stringify(p.newValue) === JSON.stringify(newValue))) {
    return { ...unchanged, status: "repeat" };
  }
  if (field === "U1" || field === "U2") {
    if (priors.some((p) => p.field === field && p.status === "applied")) return { ...unchanged, status: "estimate_used" };
    const original = answers[field];
    const n = Number(newValue);
    const effective = original === undefined ? 0.5 * n : original + 0.5 * (n - original);
    return { status: "applied", input, answers: { ...answers, [field]: effective }, effectiveValue: effective };
  }
  if (field === "price" || field === "spentThisMonth") {
    const v = Number(newValue);
    return { status: "applied", input: { ...input, [field]: v }, answers, effectiveValue: v };
  }
  const v = field === "U3" ? Number(newValue) : newValue;
  return { status: "applied", input, answers: { ...answers, [field]: v } as Answers, effectiveValue: v };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass, including `test/explain.test.ts` from Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/engine/explain.ts src/engine/challenge.ts test/explain.test.ts test/challenge.test.ts
git commit -m "feat(engine): add challenge rules, counterfactuals and the verdict message"
```

### Task 6: History and stats from the event log

**Files:**
- Create: `src/engine/history.ts`, `src/engine/stats.ts`, `test/history.test.ts`

- [ ] **Step 1: Write the failing test**

`test/history.test.ts`:

```ts
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
  assert.equal(h.firstCheckTs, log[5].ts);
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/engine/history.js'`

- [ ] **Step 3: Write `src/engine/history.ts`**

```ts
import type {
  Answers,
  ChallengeEvent,
  DecisionSummary,
  History,
  KeyedPrice,
  LogEvent,
  OutcomeEvent,
  PurchaseInput,
  ReviewEvent,
  VerdictEvent,
} from "./types.js";
import { DAY, monthKey } from "./util.js";

export const WORTH = { yes: 1, meh: 0.5, no: 0 } as const;

export interface Latest {
  input: PurchaseInput;
  answers: Answers;
  decision: DecisionSummary;
}

export interface Indexed {
  verdicts: Map<string, VerdictEvent>;
  latest: Map<string, Latest>;
  challenges: Map<string, ChallengeEvent[]>;
  outcomes: Map<string, OutcomeEvent>;
  reviews: Map<string, ReviewEvent[]>;
}

export function index(events: LogEvent[]): Indexed {
  const ix: Indexed = { verdicts: new Map(), latest: new Map(), challenges: new Map(), outcomes: new Map(), reviews: new Map() };
  for (const e of events) {
    if (e.type === "verdict") {
      ix.verdicts.set(e.id, e);
      ix.latest.set(e.id, { input: e.input, answers: e.answers, decision: e.decision });
    } else if (e.type === "challenge") {
      ix.challenges.set(e.id, [...(ix.challenges.get(e.id) ?? []), e]);
      if (e.status === "applied") ix.latest.set(e.id, { input: e.input, answers: e.answers, decision: e.decision });
    } else if (e.type === "outcome") {
      ix.outcomes.set(e.id, e);
    } else {
      ix.reviews.set(e.id, [...(ix.reviews.get(e.id) ?? []), e]);
    }
  }
  return ix;
}

export function latestReview(rs: ReviewEvent[] | undefined): ReviewEvent | undefined {
  if (!rs?.length) return undefined;
  return [...rs].sort((a, b) => a.day - b.day || Date.parse(a.ts) - Date.parse(b.ts)).at(-1);
}

export function summarize(
  events: LogEvent[],
  prices: KeyedPrice[],
  input: PurchaseInput,
  key: string,
  spentElsewhere: number | null,
  now: Date,
): History {
  const ix = index(events);
  const h: History = {
    boughtThisMonth: 0,
    spentElsewhere,
    oneOffs90: { count: 0, total: 0 },
    oneOffsThisYear: 0,
    category: { regret: 0, n: 0 },
    usage: { actual: 0, predicted: 0, n: 0 },
    prices: prices.filter((p) => p.key === key).map(({ price, ts }) => ({ price, ts })),
    firstCheckTs: null,
  };
  for (const [id, v] of ix.verdicts) {
    if (v.key === key && (h.firstCheckTs === null || Date.parse(v.ts) < Date.parse(h.firstCheckTs))) h.firstCheckTs = v.ts;
    const o = ix.outcomes.get(id);
    if (!o?.bought) continue;
    const paid = o.price ?? (ix.latest.get(id) as Latest).decision.cost;
    const t = new Date(o.ts);
    if (monthKey(t) === monthKey(now)) h.boughtThisMonth += paid;
    if (v.answers.O1) {
      if (now.getTime() - t.getTime() <= 90 * DAY) {
        h.oneOffs90.count++;
        h.oneOffs90.total += paid;
      }
      if (t.getFullYear() === now.getFullYear()) h.oneOffsThisYear += paid;
    }
    const r = latestReview(ix.reviews.get(id));
    if (r?.worthIt && v.input.category === input.category) {
      h.category.regret += 1 - WORTH[r.worthIt];
      h.category.n++;
    }
    if (r?.uses !== undefined && v.answers.U1 !== undefined) {
      h.usage.actual += r.uses;
      h.usage.predicted += v.answers.U1 * (r.day / 30);
      h.usage.n++;
    }
  }
  return h;
}
```

- [ ] **Step 4: Write `src/engine/stats.ts`**

```ts
import { WORTH, index, latestReview } from "./history.js";
import type { LogEvent } from "./types.js";
import { DAY, round2, round4 } from "./util.js";

export interface DueReview {
  id: string;
  item: string;
  day: 30 | 90;
  kind: "bought" | "skipped";
}

export interface Accuracy {
  reviewed: number;
  brier: number | null;
  skill: number | null;
  followed: number;
  followedWorth: number | null;
  overrides: number;
  overrideWorth: number | null;
  skippedReviewed: number;
  falseSkip: number | null;
  moneyNotSpent: number;
  suggestions: string[];
}

export function reviewsDue(events: LogEvent[], now: Date): DueReview[] {
  const ix = index(events);
  const due: DueReview[] = [];
  for (const [id, v] of ix.verdicts) {
    const done = new Set((ix.reviews.get(id) ?? []).map((r) => r.day));
    const o = ix.outcomes.get(id);
    if (o?.bought) {
      for (const day of [30, 90] as const) {
        if (!done.has(day) && now.getTime() - Date.parse(o.ts) >= day * DAY) due.push({ id, item: v.input.item, day, kind: "bought" });
      }
    } else if (ix.latest.get(id)?.decision.verdict !== "BUY" && !done.has(30) && now.getTime() - Date.parse(v.ts) >= 30 * DAY) {
      due.push({ id, item: v.input.item, day: 30, kind: "skipped" });
    }
  }
  return due;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function accuracy(events: LogEvent[]): Accuracy {
  const ix = index(events);
  const pairs: { p: number; o: number; override: boolean }[] = [];
  let missYes = 0;
  let missN = 0;
  let notSpent = 0;
  for (const [id] of ix.verdicts) {
    const latest = ix.latest.get(id);
    if (!latest) continue;
    const o = ix.outcomes.get(id);
    const r = latestReview(ix.reviews.get(id));
    if (o?.bought && r?.worthIt) pairs.push({ p: latest.decision.score / 100, o: WORTH[r.worthIt], override: o.override });
    if (!o?.bought && latest.decision.verdict !== "BUY") {
      const miss = (ix.reviews.get(id) ?? []).find((x) => x.missIt);
      if (miss) {
        missN++;
        if (miss.missIt === "yes") missYes++;
      }
      if ((o && !o.bought) || miss) notSpent += latest.decision.cost;
    }
  }
  const brier = mean(pairs.map((x) => (x.p - x.o) ** 2));
  const base = mean(pairs.map((x) => x.o));
  const ref = base === null ? null : mean(pairs.map((x) => (base - x.o) ** 2));
  const enough = pairs.length >= 10;
  const followed = pairs.filter((x) => !x.override);
  const overrides = pairs.filter((x) => x.override);
  const overrideRate = mean(overrides.map((x) => x.o)) ?? 0;
  const suggestions: string[] = [];
  if (overrides.length >= 10 && overrideRate >= 0.7) {
    suggestions.push("Your overrides were judged worth it at least 70% of the time. Consider lowering thresholds.buy by 5.");
  }
  if (missN >= 10 && missYes / missN > 0.3) {
    suggestions.push("You still missed more than 30% of the items you skipped. Consider lowering thresholds.wait by 5.");
  }
  return {
    reviewed: pairs.length,
    brier: enough && brier !== null ? round4(brier) : null,
    skill: enough && brier !== null && ref ? round4(1 - brier / ref) : null,
    followed: followed.length,
    followedWorth: followed.length >= 5 ? mean(followed.map((x) => x.o)) : null,
    overrides: overrides.length,
    overrideWorth: overrides.length >= 5 ? mean(overrides.map((x) => x.o)) : null,
    skippedReviewed: missN,
    falseSkip: missN >= 5 ? missYes / missN : null,
    moneyNotSpent: round2(notSpent),
    suggestions,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/history.ts src/engine/stats.ts test/history.test.ts
git commit -m "feat(engine): derive history, reviews due and accuracy from the log"
```

### Task 7: Determinism guarantees, then open PR 1

**Files:**
- Create: `test/determinism.test.ts`

- [ ] **Step 1: Write the test**

`test/determinism.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../src/engine/score.js";
import { args } from "./fixtures.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ALLOWED = [/^\.\.?\//, /^node:(fs|path|os|crypto)$/, /^@modelcontextprotocol\/sdk\//, /^zod$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

test("source imports nothing that can reach the network", () => {
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
  const copy = { ...JSON.parse(JSON.stringify({ input: a.input, answers: a.answers, cfg: a.cfg, history: a.history })), now: new Date(a.now.getTime()) };
  assert.deepEqual(decide(a), decide(a));
  assert.deepEqual(decide(a), decide(copy));
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit, push, open PR 1**

```bash
git add test/determinism.test.ts
git commit -m "test: guard determinism and the no-network rule"
git push -u origin HEAD:feat/engine
gh pr create --base main --head feat/engine --title "feat: deterministic purchase-check engine" --body "<summary of tasks 1–7 and the test count>"
```

---

## PR 2: config and store

### Task 8: Config loading, hashing and delayed loosening

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Create the stacked worktree**

```bash
cd ~/code/my-mcps/need-or-want-mcp && git fetch origin
git worktree add ~/code/wt/need-or-want/store -b feat/store-config origin/feat/engine
cd ~/code/wt/need-or-want/store && git branch --unset-upstream && npm install
```

- [ ] **Step 2: Write the failing test**

`test/config.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/config.js'`

- [ ] **Step 4: Write `src/config.ts`**

```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_CONFIG } from "./engine/defaults.js";
import { CATEGORIES, type CardPolicy, type Config } from "./engine/types.js";
import { DAY } from "./engine/util.js";

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge((base as Json)[k], v) : v;
  return out as T;
}

export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(",")}]`;
  if (isObj(x)) {
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

export const configHash = (c: Config): string => createHash("sha256").update(stableStringify(c)).digest("hex").slice(0, 16);

const share = z.number().min(0);
const schema = z.object({
  currency: z.string().min(1),
  budget: z.object({
    monthly: z.number().nonnegative(),
    schedule: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().nonnegative()),
  }),
  vetoes: z.object({
    debt: z.boolean(),
    creditCard: z.union([z.literal("allow"), z.literal("block"), z.object({ onlyMerchants: z.array(z.string()) })]),
    blockedCategories: z.array(z.object({ category: z.enum(CATEGORIES), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  }),
  oneOffs: z.object({ mode: z.enum(["count", "cap"]), yearlyCap: z.number().nonnegative() }),
  weights: z
    .object({ need: share, budget: share, costPerUse: share, history: share, deal: share })
    .refine((w) => Math.abs(w.need + w.budget + w.costPerUse + w.history + w.deal - 1) < 1e-6, "weights must add up to 1"),
  thresholds: z
    .object({ buy: z.number().min(0).max(100), wait: z.number().min(0).max(100) })
    .refine((t) => t.wait <= t.buy, "thresholds.wait must not be above thresholds.buy"),
  waitBands: z.array(z.object({ upTo: z.number().positive().nullable(), hours: z.number().nonnegative() })).min(1),
  realReturn: z.number().min(-0.5).max(0.5),
  hourlyIncome: z.number().positive().nullable(),
  loosenDelayDays: z.number().int().min(0),
  categories: z.record(z.string(), z.object({ lifespanMonths: z.number().positive().nullable(), lambda: z.number().min(0) })),
});

export function loadConfig(raw: unknown): Config {
  return schema.parse(deepMerge(DEFAULT_CONFIG, raw)) as Config;
}

const cardRank = (p: CardPolicy): number => (p === "block" ? 0 : p === "allow" ? 2 : 1);

function cardTighter(old: CardPolicy, next: CardPolicy): boolean {
  if (cardRank(next) !== cardRank(old)) return cardRank(next) < cardRank(old);
  if (typeof old === "string" || typeof next === "string") return true;
  return next.onlyMerchants.every((m) => old.onlyMerchants.includes(m));
}

export function isTightening(old: Config, next: Config): boolean {
  const months = new Set([...Object.keys(old.budget.schedule), ...Object.keys(next.budget.schedule)]);
  const budgetOk =
    next.budget.monthly <= old.budget.monthly &&
    [...months].every((k) => (next.budget.schedule[k] ?? next.budget.monthly) <= (old.budget.schedule[k] ?? old.budget.monthly));
  const blocksOk = old.vetoes.blockedCategories.every((b) =>
    next.vetoes.blockedCategories.some((n) => n.category === b.category && n.until >= b.until),
  );
  const oneOffOk = next.oneOffs.mode === "count" || (old.oneOffs.mode === "cap" && next.oneOffs.yearlyCap <= old.oneOffs.yearlyCap);
  const bandsOk =
    next.waitBands.length === old.waitBands.length &&
    next.waitBands.every((b, i) => b.upTo === old.waitBands[i].upTo && b.hours >= old.waitBands[i].hours);
  const fixed = (c: Config) => stableStringify([c.weights, c.categories, c.realReturn, c.hourlyIncome, c.currency]);
  return (
    budgetOk &&
    (next.vetoes.debt || !old.vetoes.debt) &&
    cardTighter(old.vetoes.creditCard, next.vetoes.creditCard) &&
    blocksOk &&
    oneOffOk &&
    bandsOk &&
    next.thresholds.buy >= old.thresholds.buy &&
    next.thresholds.wait >= old.thresholds.wait &&
    next.loosenDelayDays >= old.loosenDelayDays &&
    fixed(next) === fixed(old)
  );
}

export interface ConfigState {
  applied: Config | null;
  pending: { config: Config; since: string } | null;
}

// ponytail: a change that mixes tightening and loosening waits as a whole; split it per field if that ever annoys anyone
export function resolveConfig(file: Config, st: ConfigState, now: Date): { inForce: Config; state: ConfigState } {
  const applyNow = { inForce: file, state: { applied: file, pending: null } };
  if (st.applied === null) return applyNow;
  const same = (a: Config, b: Config) => stableStringify(a) === stableStringify(b);
  if (same(file, st.applied) || isTightening(st.applied, file)) return applyNow;
  const pending = st.pending && same(st.pending.config, file) ? st.pending : { config: file, since: now.toISOString() };
  if (now.getTime() - Date.parse(pending.since) >= st.applied.loosenDelayDays * DAY) return applyNow;
  return { inForce: st.applied, state: { applied: st.applied, pending } };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: load and validate config, make loosening wait 7 days"
```

### Task 9: The store, then open PR 2

**Files:**
- Create: `src/store.ts`, `test/store.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { appendFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";

const fresh = () => new Store(mkdtempSync(join(tmpdir(), "need-or-want-")));

test("JSON files round-trip and leave no temp file", () => {
  const s = fresh();
  assert.deepEqual(s.readJson("state.json", { a: 0 }), { a: 0 });
  s.writeJson("state.json", { a: 1 });
  assert.deepEqual(s.readJson("state.json", {}), { a: 1 });
  assert.equal(existsSync(join(s.dir, "state.json.tmp")), false);
});

test("logs are append-only and skip corrupt lines without failing", () => {
  const s = fresh();
  s.append("decisions.jsonl", { n: 1 });
  appendFileSync(join(s.dir, "decisions.jsonl"), "{not json\n");
  s.append("decisions.jsonl", { n: 2 });
  assert.deepEqual(s.readLines("decisions.jsonl"), { items: [{ n: 1 }, { n: 2 }], skipped: 1 });
  assert.deepEqual(s.readLines("missing.jsonl"), { items: [], skipped: 0 });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/store.js'`

- [ ] **Step 3: Write `src/store.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDir(): string {
  return process.env.NEED_OR_WANT_HOME ?? join(homedir(), ".need-or-want");
}

export class Store {
  constructor(readonly dir: string = defaultDir()) {
    mkdirSync(dir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  exists(name: string): boolean {
    return existsSync(this.file(name));
  }

  readJson<T>(name: string, fallback: T): T {
    if (!this.exists(name)) return fallback;
    return JSON.parse(readFileSync(this.file(name), "utf8")) as T;
  }

  writeJson(name: string, value: unknown): void {
    const tmp = this.file(`${name}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, this.file(name));
  }

  append(name: string, value: unknown): void {
    appendFileSync(this.file(name), `${JSON.stringify(value)}\n`);
  }

  readLines<T>(name: string): { items: T[]; skipped: number } {
    if (!this.exists(name)) return { items: [], skipped: 0 };
    const items: T[] = [];
    let skipped = 0;
    for (const line of readFileSync(this.file(name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        items.push(JSON.parse(line) as T);
      } catch {
        skipped++;
      }
    }
    return { items, skipped };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit, push, open PR 2 (stacked on PR 1)**

```bash
git add src/store.ts test/store.test.ts
git commit -m "feat: add the local data store with atomic writes and append-only logs"
git push -u origin HEAD:feat/store-config
gh pr create --base feat/engine --head feat/store-config --title "feat: config and local store" --body "<summary>"
```

---

## PR 3: the MCP server

### Task 10: Tools, prompts and instructions

**Files:**
- Create: `src/server.ts`, `src/index.ts`, `test/server.test.ts`

- [ ] **Step 1: Create the stacked worktree**

```bash
cd ~/code/my-mcps/need-or-want-mcp && git fetch origin
git worktree add ~/code/wt/need-or-want/server -b feat/server origin/feat/store-config
cd ~/code/wt/need-or-want/server && git branch --unset-upstream && npm install
```

- [ ] **Step 2: Write the failing test**

`test/server.test.ts`:

```ts
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
  assert.deepEqual(q.questions.map((x: { id: string }) => x.id), ["N1", "N2", "N3", "U1", "S1", "S2", "P1", "O1"]);

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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: tsc error `Cannot find module '../src/server.js'`

- [ ] **Step 4: Write `src/server.ts`**

```ts
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { configHash, deepMerge, loadConfig, resolveConfig, type ConfigState } from "./config.js";
import { ARGUMENT_TYPES, CHALLENGE_FIELDS, applyChallenge, isValidValue } from "./engine/challenge.js";
import { ARGUMENT_REPLIES, render, whatWouldChange } from "./engine/explain.js";
import { index, summarize } from "./engine/history.js";
import { QUESTIONS } from "./engine/questions.js";
import { decide, monthBudget, pendingQuestions } from "./engine/score.js";
import { accuracy, reviewsDue } from "./engine/stats.js";
import { CATEGORIES, type Config, type Decision, type DecisionSummary, type KeyedPrice, type LogEvent, type PurchaseInput } from "./engine/types.js";
import { DAY, isoDate, monthKey } from "./engine/util.js";
import { Store } from "./store.js";

export const ENGINE_VERSION = "0.1.0";

export const INSTRUCTIONS = `Need or Want checks purchases before they happen. Its verdicts come from fixed arithmetic, not from you.
1. When the user wants to buy something, or compares or price-checks something with intent to buy, call check_purchase before helping them buy.
2. Ask the questions it returns as multiple choice, word for word, with the given options. Then call check_purchase again with every answer.
3. Never give your own verdict. Relay the tool's message.
4. If the user pushes back, ask which fact changed and call challenge_verdict with that field. If nothing changed, call it with field "none" and the closest argumentType, and relay the reply.
5. When the user buys it or decides not to, call record_outcome. If a response shows reviewsDue above 0, offer to run the reviews.`;

interface State extends ConfigState {
  spentElsewhere: { date: string; amount: number } | null;
}

interface Ctx {
  now: Date;
  cfg: Config;
  st: State;
  events: LogEvent[];
  prices: KeyedPrice[];
  warnings: string[];
  reviewsDue: number;
}

interface Problem {
  status: string;
  message: string;
}

const SETUP: Problem = {
  status: "setup_needed",
  message: "Run setup first: tell me your currency and your monthly spending budget.",
};

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const keyFor = (input: PurchaseInput): string => (input.productKey ?? input.item).trim().toLowerCase();
const summary = (d: Decision): DecisionSummary => ({
  verdict: d.verdict,
  score: d.score,
  needLabel: d.needLabel,
  cost: d.numbers.cost,
  waitUntil: d.numbers.waitUntil,
});

const answersSchema = z.object({
  N1: z.enum(["a", "b", "c", "d"]).optional(),
  N2: z.enum(["a", "b", "c", "d"]).optional(),
  N3: z.enum(["a", "b", "c"]).optional(),
  N4: z.string().optional(),
  U1: z.number().nonnegative().optional(),
  U2: z.number().positive().optional(),
  U3: z.number().nonnegative().optional(),
  S1: z.enum(["a", "b", "c", "d"]).optional(),
  S2: z.enum(["a", "b", "c", "d"]).optional(),
  P1: z.enum(["a", "b", "c", "d", "e"]).optional(),
  O1: z.boolean().optional(),
  SP: z.number().nonnegative().optional(),
  STILL_WANT: z.boolean().optional(),
});

export function createServer(store = new Store(), clock: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: "need-or-want", version: ENGINE_VERSION }, { instructions: INSTRUCTIONS });

  const load = (): Ctx | Problem => {
    const now = clock();
    if (!store.exists("config.json")) return SETUP;
    let file: Config;
    try {
      file = loadConfig(store.readJson("config.json", {}));
    } catch (e) {
      return { status: "config_error", message: `config.json is invalid: ${(e as Error).message}` };
    }
    const saved = store.readJson<State>("state.json", { applied: null, pending: null, spentElsewhere: null });
    const { inForce, state } = resolveConfig(file, saved, now);
    const st: State = { ...saved, ...state };
    store.writeJson("state.json", st);
    if (monthBudget(inForce, now) <= 0) return SETUP;
    const log = store.readLines<LogEvent>("decisions.jsonl");
    const prices = store.readLines<KeyedPrice>("prices.jsonl");
    const skipped = log.skipped + prices.skipped;
    return {
      now,
      cfg: inForce,
      st,
      events: log.items,
      prices: prices.items,
      warnings: skipped ? [`${skipped} unreadable log line(s) were skipped. The files were not changed.`] : [],
      reviewsDue: reviewsDue(log.items, now).length,
    };
  };
  const isCtx = (x: Ctx | Problem): x is Ctx => "cfg" in x;
  const spentToday = (ctx: Ctx): number | null =>
    ctx.st.spentElsewhere?.date === isoDate(ctx.now) ? ctx.st.spentElsewhere.amount : null;
  const dueNow = (now: Date): number => reviewsDue(store.readLines<LogEvent>("decisions.jsonl").items, now).length;

  server.registerTool(
    "setup",
    {
      title: "Set up or show settings",
      description:
        "First-time setup, or show the current settings when called with no arguments. Tightening a setting applies at once. Loosening one (higher budget, card allowed) applies only after 7 days.",
      inputSchema: {
        currency: z.string().min(1).optional(),
        monthlyBudget: z.number().positive().optional(),
        schedule: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().positive()).optional(),
        creditCard: z.enum(["allow", "block"]).optional(),
        onlyMerchants: z.array(z.string()).optional(),
        hourlyIncome: z.number().positive().optional(),
      },
    },
    async (a) => {
      const patch: Record<string, unknown> = {};
      if (a.currency) patch.currency = a.currency;
      if (a.monthlyBudget || a.schedule) {
        patch.budget = { ...(a.monthlyBudget ? { monthly: a.monthlyBudget } : {}), ...(a.schedule ? { schedule: a.schedule } : {}) };
      }
      if (a.onlyMerchants) patch.vetoes = { creditCard: { onlyMerchants: a.onlyMerchants.map((m) => m.toLowerCase()) } };
      else if (a.creditCard) patch.vetoes = { creditCard: a.creditCard };
      if (a.hourlyIncome) patch.hourlyIncome = a.hourlyIncome;
      if (Object.keys(patch).length) store.writeJson("config.json", deepMerge(store.readJson("config.json", {}), patch));
      const ctx = load();
      if (!isCtx(ctx)) return text({ ...ctx, dataFolder: store.dir });
      return text({ status: "ready", dataFolder: store.dir, config: ctx.cfg, pending: ctx.st.pending });
    },
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Check a purchase",
      description:
        "Call this BEFORE helping the user buy anything, or when they compare or price-check something with intent to buy. The first call returns multiple-choice questions: ask them word for word, then call again with every answer in `answers`. The verdict comes from fixed arithmetic: relay its message, never your own opinion. Pass merchant (domain) and productKey (ASIN or URL) when known. Pass spentThisMonth only if a budgeting tool gives it.",
      inputSchema: {
        item: z.string().min(1),
        price: z.number().positive(),
        category: z.enum(CATEGORIES),
        recurring: z.enum(["none", "monthly", "yearly"]).default("none"),
        productKey: z.string().optional(),
        merchant: z.string().optional(),
        spentThisMonth: z.number().nonnegative().optional(),
        sellerClaims: z.array(z.string()).optional(),
        runningCostPerMonth: z.number().nonnegative().optional(),
        resaleValue: z.number().nonnegative().optional(),
        answers: answersSchema.optional(),
      },
    },
    async ({ answers = {}, ...rest }) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const input: PurchaseInput = { ...rest, merchant: rest.merchant?.toLowerCase() };
      const key = keyFor(input);
      if (answers.SP !== undefined) {
        ctx.st.spentElsewhere = { date: isoDate(ctx.now), amount: answers.SP };
        store.writeJson("state.json", ctx.st);
      }
      const history = summarize(ctx.events, ctx.prices, input, key, spentToday(ctx), ctx.now);
      const missing = pendingQuestions(input, answers, ctx.cfg, history, ctx.now);
      if (missing.length) {
        return text({
          status: "questions",
          instructions: "Ask each question as multiple choice, word for word, then call check_purchase again with every answer.",
          questions: missing.map((id) => QUESTIONS[id]),
          reviewsDue: ctx.reviewsDue,
          warnings: ctx.warnings,
        });
      }
      const decideArgs = { input, answers, cfg: ctx.cfg, history, now: ctx.now };
      const d = decide(decideArgs);
      const wwc = whatWouldChange(decideArgs, d.score);
      const id = randomUUID();
      const ts = ctx.now.toISOString();
      store.append("prices.jsonl", { key, price: input.price, ts });
      store.append("decisions.jsonl", {
        type: "verdict",
        id,
        ts,
        key,
        input,
        answers,
        decision: summary(d),
        configHash: configHash(ctx.cfg),
        engineVersion: ENGINE_VERSION,
      });
      return text({
        status: "verdict",
        decisionId: id,
        ...d,
        whatWouldChange: wwc,
        sellerClaimsIgnored: input.sellerClaims ?? [],
        message: render(d, ctx.cfg, wwc),
        reviewsDue: ctx.reviewsDue,
        warnings: ctx.warnings,
      });
    },
  );

  server.registerTool(
    "challenge_verdict",
    {
      title: "Challenge a verdict",
      description:
        "Use when the user pushes back on a verdict. Name the ONE input that changed (field) and its new value. If no fact changed, use field 'none' with the closest argumentType. The verdict only moves when a fact changes; estimates (U1, U2) revised after a verdict count at 50%, once.",
      inputSchema: {
        decisionId: z.string(),
        field: z.enum(CHALLENGE_FIELDS),
        newValue: z.union([z.number(), z.string(), z.boolean()]).optional(),
        note: z.string().optional(),
        argumentType: z.enum(ARGUMENT_TYPES).optional(),
      },
    },
    async ({ decisionId, field, newValue, note, argumentType }) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const ix = index(ctx.events);
      const v = ix.verdicts.get(decisionId);
      const latest = ix.latest.get(decisionId);
      if (!v || !latest) return text({ status: "error", message: `No decision with id ${decisionId}.` });
      if (!isValidValue(field, newValue)) return text({ status: "error", message: `${String(newValue)} is not a valid value for ${field}.` });
      const priors = (ix.challenges.get(decisionId) ?? []).map((c) => ({ field: c.field, newValue: c.newValue, status: c.status }));
      const r = applyChallenge(latest.input, latest.answers, field, newValue, priors);
      const before = latest.decision;
      let after = before;
      let message: string;
      if (r.status === "applied") {
        const history = summarize(ctx.events, ctx.prices, r.input, v.key, spentToday(ctx), ctx.now);
        const decideArgs = { input: r.input, answers: r.answers, cfg: ctx.cfg, history, now: ctx.now };
        const d = decide(decideArgs);
        after = summary(d);
        message = render(d, ctx.cfg, whatWouldChange(decideArgs, d.score));
      } else if (r.status === "repeat") {
        message = "You've already made this exact point. Repeating it changes nothing. The verdict stands.";
      } else if (r.status === "estimate_used") {
        message = "This estimate was already revised once after the verdict. It can't be revised again. The verdict stands.";
      } else {
        message = ARGUMENT_REPLIES[argumentType ?? "other"];
      }
      store.append("decisions.jsonl", {
        type: "challenge",
        id: decisionId,
        ts: ctx.now.toISOString(),
        field,
        newValue,
        effectiveValue: r.effectiveValue,
        status: r.status,
        note,
        argumentType,
        input: r.input,
        answers: r.answers,
        decision: after,
      });
      return text({
        status: r.status,
        before,
        after,
        moved: before.verdict !== after.verdict || before.score !== after.score,
        effectiveValue: r.effectiveValue,
        message,
        reviewsDue: ctx.reviewsDue,
      });
    },
  );

  server.registerTool(
    "record_outcome",
    {
      title: "Record what happened",
      description:
        "Record that the user bought or didn't buy a checked item, or record a 30- or 90-day review. Buying against a non-BUY verdict is logged as an override, with no other friction.",
      inputSchema: {
        decisionId: z.string(),
        event: z.enum(["bought", "not_bought", "review"]),
        price: z.number().positive().optional(),
        day: z.union([z.literal(30), z.literal(90)]).optional(),
        uses: z.number().nonnegative().optional(),
        worthIt: z.enum(["yes", "meh", "no"]).optional(),
        missIt: z.enum(["yes", "no", "other"]).optional(),
      },
    },
    async (a) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const latest = index(ctx.events).latest.get(a.decisionId);
      if (!latest) return text({ status: "error", message: `No decision with id ${a.decisionId}.` });
      const ts = ctx.now.toISOString();
      if (a.event === "review") {
        if (!a.day) return text({ status: "error", message: "A review needs day: 30 or 90." });
        store.append("decisions.jsonl", { type: "review", id: a.decisionId, ts, day: a.day, uses: a.uses, worthIt: a.worthIt, missIt: a.missIt });
        return text({ status: "recorded", reviewsDue: dueNow(ctx.now) });
      }
      const bought = a.event === "bought";
      const override = bought && latest.decision.verdict !== "BUY";
      store.append("decisions.jsonl", { type: "outcome", id: a.decisionId, ts, bought, price: a.price ?? null, override });
      return text({
        status: "recorded",
        override,
        message: override ? "Logged as an override. It will be reviewed in 30 and 90 days like any other purchase." : "Logged.",
        reviewsDue: dueNow(ctx.now),
      });
    },
  );

  server.registerTool(
    "get_status",
    {
      title: "Status and accuracy",
      description: "Money left this month, waits ending, reviews due, pending setting changes, and how accurate past verdicts were.",
    },
    async () => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const ix = index(ctx.events);
      const budget = monthBudget(ctx.cfg, ctx.now);
      const h = summarize(ctx.events, ctx.prices, { item: "", price: 0, category: "other", recurring: "none" }, "", spentToday(ctx), ctx.now);
      const spent = h.boughtThisMonth + (h.spentElsewhere ?? 0);
      const waits = [...ix.latest.entries()]
        .filter(([id, l]) => l.decision.verdict === "WAIT" && !ix.outcomes.has(id))
        .map(([id, l]) => ({
          decisionId: id,
          item: l.input.item,
          waitUntil: l.decision.waitUntil,
          ready: l.decision.waitUntil !== null && Date.parse(l.decision.waitUntil) <= ctx.now.getTime(),
        }));
      const pending = ctx.st.pending;
      return text({
        currency: ctx.cfg.currency,
        month: monthKey(ctx.now),
        budget,
        spent,
        remaining: budget - spent,
        waits,
        reviewsDue: reviewsDue(ctx.events, ctx.now),
        pendingConfig:
          pending && ctx.st.applied
            ? {
                since: pending.since,
                appliesAt: new Date(Date.parse(pending.since) + ctx.st.applied.loosenDelayDays * DAY).toISOString(),
              }
            : null,
        accuracy: accuracy(ctx.events),
        warnings: ctx.warnings,
      });
    },
  );

  server.registerPrompt(
    "should-i-buy",
    { title: "Should I buy it?", description: "Check a purchase before you make it.", argsSchema: { item: z.string(), price: z.string() } },
    ({ item, price }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'm thinking of buying ${item} for ${price}. Run check_purchase on it, ask me its questions as multiple choice, then give me the verdict exactly as the tool returns it.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt("review", { title: "Review past purchases", description: "Run the 30- and 90-day reviews that are due." }, () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Call get_status, then ask me the review questions for every review that is due, and record each answer with record_outcome.",
        },
      },
    ],
  }));

  return server;
}
```

- [ ] **Step 5: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
```

- [ ] **Step 6: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all tests pass; `dist/src/index.js` exists and is executable.

- [ ] **Step 7: Manual check in Claude Code**

```bash
claude mcp add need-or-want-dev -e NEED_OR_WANT_HOME=/tmp/need-or-want-dev -- node ~/code/wt/need-or-want/server/dist/src/index.js
```
In a new Claude Code session: "Set up Need or Want with USD and a 2000 monthly budget", then "Should I buy $300 wireless headphones?". Expected: questions, then a verdict whose message starts with the verdict line. Remove afterwards: `claude mcp remove need-or-want-dev`.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: expose the engine as MCP tools and prompts"
```

### Task 11: README, then open PR 3

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

````markdown
# Need or Want

Stop impulse buying. Need or Want is an MCP server that checks a purchase before you make it: is it a need or a want, and should you buy it now, wait, or skip it?

It asks a few fixed multiple-choice questions, then computes a verdict with plain arithmetic. You can argue with it, but the verdict only changes when a fact changes, never because you push harder. Every decision is logged and reviewed at 30 and 90 days, so you can see whether it was right.

- **Deterministic:** same inputs, same verdict. No AI decides anything.
- **Local:** your data stays in `~/.need-or-want/`. No network calls, no accounts, no telemetry.
- **Honest:** it scores its own past verdicts and tells you how often it was right.

## Install

Claude Code:

```bash
claude mcp add --scope user need-or-want -- npx -y need-or-want-mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "need-or-want": { "command": "npx", "args": ["-y", "need-or-want-mcp"] } } }
```

Then tell Claude: "Set up Need or Want. My currency is USD and my monthly spending budget is 2000."

From source: `npm install && npm run build`, then point the client at `node /path/to/need-or-want-mcp/dist/src/index.js`.

## Use

Talk about buying something and Claude calls the check. Or use the `should-i-buy` prompt (a slash command in Claude Code, a menu item in Claude Desktop).

| Tool | What it does |
|---|---|
| `setup` | Currency, monthly budget (or a month-by-month schedule), credit card policy |
| `check_purchase` | Returns the questions, then the verdict: BUY, WAIT or SKIP, plus NEED, MIXED or WANT |
| `challenge_verdict` | Argue with the verdict by changing one fact |
| `record_outcome` | Bought, didn't buy, or a 30/90-day review |
| `get_status` | Money left this month, waits ending, reviews due, accuracy |

## How the verdict works

A score from 0 to 100: need 40%, budget fit 25%, honest cost per use 20%, your track record 10%, real discount 5%. 70+ is BUY after a wait, 50–69 is WAIT for twice as long, under 50 is SKIP. Vetoes (EMI, new credit, over budget, blocked category) come first. The full maths and the research behind it: [docs/DESIGN.md](docs/DESIGN.md).

## Settings

Edit `~/.need-or-want/config.json`. Tightening a setting applies at once. Loosening one waits 7 days, so you can't raise your own budget mid-craving.

## Optional: trigger on shopping tools in Claude Code

Add a hook to `~/.claude/settings.json`, with a matcher for your shopping MCP:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__amazon-in__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"The user is looking at a product. Before helping them buy it, run need-or-want check_purchase.\"}}'"
          }
        ]
      }
    ]
  }
}
```

## Privacy

Everything stays in the data folder on your machine. The server makes no network calls; a test fails the build if any source file could.

## License

MIT
````

- [ ] **Step 2: Commit, push, open PR 3 (stacked on PR 2)**

```bash
git add README.md
git commit -m "docs: add install, usage and privacy to the README"
git push -u origin HEAD:feat/server
gh pr create --base feat/store-config --head feat/server --title "feat: MCP server, prompts and README" --body "<summary>"
```

- [ ] **Step 3: Hand over**

Report the three PR links and the test count, and wait for the owner's OK before merging. Merge order: PR 1 into `main`, then retarget PR 2 to `main` and merge, then PR 3.
