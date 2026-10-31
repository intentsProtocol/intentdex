/**
 * Byte and text encodings the swap code needs, written out so the package depends on no chain library.
 */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58, for a Solana signature or address. */
export function base58(bytes: Uint8Array): string {
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '';
    for (const byte of bytes) { if (byte === 0) out += '1'; else break; }
    // A value of zero leaves one zero digit behind, which the leading-zero loop above has already written.
    const significant = digits.length === 1 && digits[0] === 0 ? 0 : digits.length;
    for (let i = significant - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without `atob`, which React Native's engine does not always have. */
export function fromBase64(b64: string): Uint8Array {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < clean.length; i += 4) {
        const a = B64.indexOf(clean[i]), b = B64.indexOf(clean[i + 1]);
        const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
        const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
        out[o++] = (a << 2) | (b >> 4);
        if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
        if (d >= 0) out[o++] = ((c & 3) << 6) | d;
    }
    return out.subarray(0, o);
}

export function toBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
        out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
        out += i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=';
        out += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return out;
}

export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/^0x/i, '');
    if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error('not hex');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

export function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}
