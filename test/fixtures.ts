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
import { DAY, HOUR } from "../src/engine/util.js";

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
  lastWaitUntil: null,
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

export const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * HOUR).toISOString();
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
