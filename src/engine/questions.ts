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
    ["EMI, pay-later, no-cost EMI, or a new card or credit line", 0],
    ["My business pays and books it as a business expense", 0],
  ]),
  O1: { id: "O1", kind: "boolean", text: "Is this a one-time expense?" },
  SP: {
    id: "SP",
    kind: "number",
    text: "How much else have you spent this month from the same budget, outside these checks? A rough total is fine, or 0.",
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
  return [...TIERS[tier]];
}

export const NEED_IDS = ["N1", "N2", "N3"] as const;

export function option(id: QuestionId, key: unknown): Option | undefined {
  return QUESTIONS[id].options?.find((o) => o.key === key);
}

export function optionValue(id: QuestionId, key: unknown): number | undefined {
  return option(id, key)?.value;
}
