import { describe, expect, it } from 'vitest';
import { errorMessage, formatAmount, formatUnits, formatUsd, hostOf, isAmount, parseUnits, shortAddr } from '@/lib/format';

describe('formatUnits / parseUnits', () => {
  it('round-trips without floating point', () => {
    for (const [value, decimals] of [['1.5', 6], ['0.00000001', 8], ['123456789.123456789012345678', 18], ['0', 9], ['42', 0]] as const) {
      expect(formatUnits(parseUnits(value, decimals), decimals)).toBe(value);
    }
  });
  it('parses the forms a user types', () => {
    expect(parseUnits('.5', 8)).toBe(50_000_000n);
    expect(parseUnits('5.', 8)).toBe(500_000_000n);
    expect(parseUnits('  1  ', 2)).toBe(100n);
  });
  it('refuses what is not a plain decimal', () => {
    for (const bad of ['', '.', '1e3', '-1', '1,5', 'abc', '1.2.3']) expect(() => parseUnits(bad, 8)).toThrow();
  });
  it('refuses more fraction digits than the token has', () => {
    expect(() => parseUnits('1.0000001', 6)).toThrow(/6 decimal/);
    expect(() => parseUnits('1.5', 0)).toThrow();
  });
  it('isAmount is true only above zero', () => {
    expect(isAmount('0.1', 8)).toBe(true);
    expect(isAmount('0', 8)).toBe(false);
    expect(isAmount('x', 8)).toBe(false);
  });
});

describe('formatAmount', () => {
  it('groups thousands and trims zeros', () => {
    expect(formatAmount(123456789000000n, 8)).toBe('1,234,567.89');
    expect(formatAmount(100000000n, 8)).toBe('1');
  });
  it('never shows a non-zero balance as zero', () => {
    expect(formatAmount(1n, 18)).toBe('<0.000001');
    expect(formatAmount(0n, 18)).toBe('0');
  });
  it('cuts, never rounds up, so a balance is not overstated', () => {
    expect(formatAmount(1999999n, 6, 2)).toBe('1.99');
  });
});

describe('display helpers', () => {
  it('formatUsd', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(undefined)).toBe('—');
  });
  it('shortAddr keeps a cashaddr prefix out of the count', () => {
    expect(shortAddr('bchtest:qzabcdefghijklmnopqrstuvwxyz0123456789abcd', 6, 4)).toBe('bchtest:qzabcd…abcd');
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddr(null)).toBe('—');
  });
  it('hostOf', () => expect(hostOf('https://app.example.com')).toBe('app.example.com'));
  it('errorMessage turns common failures into sentences', () => {
    expect(errorMessage(new Error('insufficient funds for gas * price + value'))).toMatch(/Not enough funds/);
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/Network unreachable/);
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
