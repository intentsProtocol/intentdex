/**
 * Number and address formatting. Amounts are bigint base units everywhere outside this file; a float never
 * holds a balance.
 */

/** Base units → decimal string, trailing zeros removed. `formatUnits(1500000n, 6)` → "1.5". */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (decimals === 0) return `${negative ? '-' : ''}${abs}`;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Decimal string → base units. Throws on anything that is not a plain non-negative decimal. */
export function parseUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === '' || v === '.') throw new Error('Enter a valid amount');
  const [whole, frac = ''] = v.split('.');
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** True when `value` can be parsed as an amount with these decimals and is above zero. */
export function isAmount(value: string, decimals: number): boolean {
  try { return parseUnits(value, decimals) > 0n; } catch { return false; }
}

/** A balance for display: at most `maxFrac` fraction digits, grouped thousands, never scientific notation. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6): string {
  const s = formatUnits(value, decimals);
  const [whole, frac = ''] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cut = frac.slice(0, maxFrac).replace(/0+$/, '');
  if (!cut && frac && whole === '0' && value !== 0n) return `<0.${'0'.repeat(Math.max(0, maxFrac - 1))}1`;
  return cut ? `${grouped}.${cut}` : grouped;
}

export function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

/**
 * A rate or price (not a balance) to a few significant figures, never in scientific notation:
 * `formatSig(12.3456)` → "12.35", `formatSig(0.0000123)` → "0.0000123", `formatSig(1234.5)` → "1,235".
 */
export function formatSig(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const decimals = Math.min(12, Math.max(0, digits - 1 - Math.floor(Math.log10(abs))));
  const fixed = abs.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const [whole, frac] = fixed.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatUsd(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function shortAddr(s: string | null | undefined, head = 6, tail = 4): string {
  if (!s) return '—';
  // Keep a cashaddr's prefix out of the head count so the visible part is the address itself.
  const i = s.indexOf(':');
  const prefix = i > 0 && i < 14 ? s.slice(0, i + 1) : '';
  const body = prefix ? s.slice(i + 1) : s;
  if (body.length <= head + tail + 1) return s;
  return `${prefix}${body.slice(0, head)}…${body.slice(-tail)}`;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export const hostOf = (origin: string) => origin.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** A sentence for the user from whatever was thrown. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const any = e as { shortMessage?: string; reason?: string; message?: string } | undefined;
  const raw = any?.shortMessage || any?.reason || any?.message || (typeof e === 'string' ? e : '');
  if (!raw) return fallback;
  if (/insufficient funds|insufficient balance/i.test(raw)) return 'Not enough funds to cover the amount and the network fee.';
  if (/failed to fetch|networkerror|network request failed/i.test(raw)) return 'Network unreachable. Check your connection and try again.';
  const line = raw.split('\n')[0].slice(0, 220);
  return line.charAt(0).toUpperCase() + line.slice(1);
}
