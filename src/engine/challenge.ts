import { optionValue } from "./questions.js";
import { CATEGORIES, type Answers, type ChallengeStatus, type PurchaseInput } from "./types.js";

export const CHALLENGE_FIELDS = ["price", "category", "U3", "N1", "N2", "N3", "N4", "spentThisMonth", "P1", "U1", "U2", "none"] as const;
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
  if (field === "category") return (CATEGORIES as readonly unknown[]).includes(value);
  if (field === "N4") return value === "none" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (field === "N1" || field === "N2" || field === "N3" || field === "P1") return optionValue(field, value) !== undefined;
  return typeof value === "number" && Number.isFinite(value) && (field === "price" || field === "U2" ? value > 0 : value >= 0);
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
  if (field === "price" || field === "spentThisMonth" || field === "category") {
    const v = field === "category" ? newValue : Number(newValue);
    return { status: "applied", input: { ...input, [field]: v } as PurchaseInput, answers, effectiveValue: v };
  }
  const v = field === "U3" ? Number(newValue) : newValue;
  return { status: "applied", input, answers: { ...answers, [field]: v } as Answers, effectiveValue: v };
}
