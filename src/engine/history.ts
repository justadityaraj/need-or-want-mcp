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
