import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { translate } from '@/lib/i18n';
import { en, zhCN } from '@/lib/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('catalogues', () => {
  it('Chinese has exactly the English keys', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });
  it('every translation keeps the placeholders of its source', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zhCN[key]), key).toEqual(placeholders(en[key]));
    }
  });
  it('no translation is empty', () => {
    for (const [key, value] of Object.entries(zhCN)) expect(value.trim().length, key).toBeGreaterThan(0);
  });
  it('every key in the catalogue is used somewhere, so none goes stale', () => {
    // Keys are used by the extension's screens and by the shared package (routing reasons, address problems).
    const code = [...sources('src'), ...sources('../bch-intents-wallet-core/src')]
      .filter(f => !f.includes('i18n')).map(f => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter(k => !code.includes(`'${k}'`));
    expect(unused).toEqual([]);
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'send.balance', { amount: '1.5', symbol: 'BCH' })).toBe('Balance: 1.5 BCH');
    expect(translate('zh-CN', 'send.balance', { amount: '1.5', symbol: 'BCH' })).toBe('余额：1.5 BCH');
  });
  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(translate('en', 'send.balance', { amount: '1' })).toBe('Balance: 1 {symbol}');
  });
});
