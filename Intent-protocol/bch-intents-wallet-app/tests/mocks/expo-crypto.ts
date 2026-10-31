// A stand-in for expo-crypto's random bytes, backed by Node's.
import { randomBytes } from 'node:crypto';

export const getRandomBytesAsync = async (length: number) => new Uint8Array(randomBytes(length));
