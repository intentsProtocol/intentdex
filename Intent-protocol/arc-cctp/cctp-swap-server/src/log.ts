/** Minimal line logger: `2026-09-28T17:00:00.000Z INFO  [scope] message {json}`. */
type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const ORDER: Record<Level, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const MIN = ORDER[(process.env.LOG_LEVEL?.toUpperCase() as Level) || 'INFO'] ?? 20;

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
    if (ORDER[level] < MIN) return;
    const tail = extra && Object.keys(extra).length ? ' ' + JSON.stringify(extra, bigintSafe) : '';
    const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}${tail}`;
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line);
}

function bigintSafe(_k: string, v: unknown) {
    return typeof v === 'bigint' ? v.toString() : v;
}

export function logger(scope: string) {
    return {
        debug: (m: string, e?: Record<string, unknown>) => emit('DEBUG', scope, m, e),
        info: (m: string, e?: Record<string, unknown>) => emit('INFO', scope, m, e),
        warn: (m: string, e?: Record<string, unknown>) => emit('WARN', scope, m, e),
        error: (m: string, e?: Record<string, unknown>) => emit('ERROR', scope, m, e),
    };
}

export function errMsg(e: unknown): string {
    const any = e as any;
    return (any?.shortMessage || any?.reason || any?.message || String(e)).toString().split('\n')[0].slice(0, 300);
}
