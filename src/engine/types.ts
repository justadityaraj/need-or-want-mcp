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
  P1?: "a" | "b" | "c" | "d";
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
  lastWaitUntil: string | null;
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
  oneOffs90: { count: number; total: number } | null;
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
