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
