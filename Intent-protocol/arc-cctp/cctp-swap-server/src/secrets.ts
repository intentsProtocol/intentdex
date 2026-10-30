/**
 * secrets.ts — the single choke point for loading solver secrets.
 *
 * In production these resolve from `process.env`, which the deploy platform
 * injects as SEALED secrets (Railway sealed variables / cloud secret manager) —
 * NOT a committed or on-disk `.env` file. `.env` is for LOCAL DEV ONLY and is
 * gitignored. See SECRETS.md for the deploy + rotation runbook.
 *
 * This is the ONE place a real KMS/Vault backend (or KMS-backed signer) swaps in
 * later — see the "Full KMS/HSM signing" follow-up in the trusted-launch plan.
 *
 * NEVER log the returned value. Use `redact()` for any diagnostic output.
 */

const loaded = new Set<string>();

/**
 * Resolve a named secret. Returns '' when absent and not required (preserves the
 * legacy `process.env.X || ''` behaviour). Throws when `required` and missing.
 */
export function getSecret(name: string, opts: { required?: boolean } = {}): string {
    const v = process.env[name] ?? '';
    if (!v && opts.required) {
        throw new Error(
            `Missing required secret '${name}'. Provide it via the platform secret store ` +
            `(sealed env var), not an on-disk .env in production. See SECRETS.md.`,
        );
    }
    if (v) loaded.add(name);
    return v;
}

/** Names of secrets that were successfully loaded — for a redacted startup summary. */
export function loadedSecretNames(): string[] {
    return [...loaded];
}

/** Redact a secret-ish string so it is safe to log. */
export function redact(s: string | undefined | null): string {
    if (!s) return '<unset>';
    return s.length <= 8 ? '***' : `${s.slice(0, 3)}…${s.slice(-3)} (${s.length} chars)`;
}
