/**
 * Amounts as people say them ("half", "25%", "all", "0.2", "a quarter of my BCH"), turned into base units by
 * code, never by the model. A small model is poor at arithmetic and good at copying words, so tools take words.
 */
import { parseUnits } from '../format';

export type AmountResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: 'invalid' | 'zero' | 'exceeds' };

const FRACTIONS: Record<string, [bigint, bigint]> = {
  all: [1n, 1n], max: [1n, 1n], everything: [1n, 1n], full: [1n, 1n], whole: [1n, 1n],
  half: [1n, 2n], quarter: [1n, 4n], third: [1n, 3n], tenth: [1n, 10n],
  // Swahili: yote (all), nusu (half), robo (quarter)
  yote: [1n, 1n], nusu: [1n, 2n], robo: [1n, 4n],
};

/** Base units of `text` against a balance. Fractions and percentages are of the balance. */
export function resolveAmount(text: unknown, balance: bigint, decimals: number): AmountResult {
  const raw = String(text ?? '').toLowerCase().trim();
  if (!raw) return { ok: false, reason: 'invalid' };

  const pct = /(\d+(?:[.,]\d+)?)\s*(%|percent\b|pct\b|asilimia\b)/.exec(raw);
  if (pct) {
    const bps = BigInt(Math.round(Number(pct[1]!.replace(',', '.')) * 100));
    if (bps <= 0n) return { ok: false, reason: 'zero' };
    if (bps > 10_000n) return { ok: false, reason: 'exceeds' };
    return check((balance * bps) / 10_000n, balance);
  }

  const num = /(?:^|[^\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)(?![\w.])/.exec(` ${raw}`);
  if (num) {
    // "1,000" groups thousands; "0,5" is a decimal comma.
    const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(num[1]!) ? num[1]!.replace(/,/g, '') : num[1]!.replace(',', '.');
    let value: bigint;
    try { value = parseUnits(plain.replace(/^\./, '0.'), decimals); } catch { return { ok: false, reason: 'invalid' }; }
    return check(value, balance);
  }

  for (const word of raw.split(/[^a-z]+/)) {
    const f = FRACTIONS[word];
    if (f) return check((balance * f[0]) / f[1], balance);
  }
  return { ok: false, reason: 'invalid' };
}

function check(value: bigint, balance: bigint): AmountResult {
  if (value <= 0n) return { ok: false, reason: 'zero' };
  if (value > balance) return { ok: false, reason: 'exceeds' };
  return { ok: true, value };
}

export interface DesiredAmountResult {
  ok: boolean;
  value: bigint;
  exceeds: boolean;
  reason?: 'invalid' | 'zero';
}

/**
 * Resolves the amount intended by the user. If the amount exceeds available balance or if the
 * balance is zero (for fractions), it still computes the intended target amount and marks `exceeds: true`,
 * allowing underfunded drafts to be built and topped up rather than rejected.
 */
export function resolveDesiredAmount(
  text: unknown,
  balance: bigint,
  decimals: number,
  fallbackIfZero?: bigint,
): DesiredAmountResult {
  const raw = String(text ?? '').toLowerCase().trim();
  if (!raw) return { ok: false, value: 0n, exceeds: false, reason: 'invalid' };

  const pct = /(\d+(?:[.,]\d+)?)\s*(%|percent\b|pct\b|asilimia\b)/.exec(raw);
  if (pct) {
    const bps = BigInt(Math.round(Number(pct[1]!.replace(',', '.')) * 100));
    if (bps <= 0n) return { ok: false, value: 0n, exceeds: false, reason: 'zero' };
    const base = balance > 0n ? balance : (fallbackIfZero ?? 0n);
    if (base <= 0n) return { ok: false, value: 0n, exceeds: true, reason: 'zero' };
    const val = (base * bps) / 10_000n;
    return { ok: val > 0n, value: val, exceeds: val > balance };
  }

  const num = /(?:^|[^\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)(?![\w.])/.exec(` ${raw}`);
  if (num) {
    const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(num[1]!) ? num[1]!.replace(/,/g, '') : num[1]!.replace(',', '.');
    let value: bigint;
    try { value = parseUnits(plain.replace(/^\./, '0.'), decimals); } catch { return { ok: false, value: 0n, exceeds: false, reason: 'invalid' }; }
    if (value <= 0n) return { ok: false, value: 0n, exceeds: false, reason: 'zero' };
    return { ok: true, value, exceeds: value > balance };
  }

  for (const word of raw.split(/[^a-z]+/)) {
    const f = FRACTIONS[word];
    if (f) {
      const base = balance > 0n ? balance : (fallbackIfZero ?? 0n);
      if (base <= 0n) return { ok: false, value: 0n, exceeds: true, reason: 'zero' };
      const val = (base * f[0]) / f[1];
      return { ok: val > 0n, value: val, exceeds: val > balance };
    }
  }

  return { ok: false, value: 0n, exceeds: false, reason: 'invalid' };
}
