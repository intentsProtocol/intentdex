/**
 * Fingerprint and face unlock, through the phone's own prompt. The app never sees the biometric: it gets yes or
 * no. The PIN always works as well, so a phone without biometrics, or a finger that will not scan, is not locked
 * out.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import type { Key } from '@/i18n';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

/** The catalogue key that names each kind of biometric. */
export const BIOMETRIC_NAME: Record<Exclude<BiometricKind, 'none'>, Key> = {
  face: 'biometric.face', fingerprint: 'biometric.fingerprint', iris: 'biometric.iris',
};

export interface BiometricSupport {
  /** The phone has the hardware and at least one biometric enrolled. */
  available: boolean;
  kind: BiometricKind;
}

export async function biometricSupport(): Promise<BiometricSupport> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const T = LocalAuthentication.AuthenticationType;
    const kind: BiometricKind = types.includes(T.FACIAL_RECOGNITION) ? 'face' : types.includes(T.FINGERPRINT) ? 'fingerprint' : types.includes(T.IRIS) ? 'iris' : 'none';
    return { available: hardware && enrolled && kind !== 'none', kind };
  } catch {
    return { available: false, kind: 'none' };
  }
}

/** Ask for a fingerprint or face. Resolves false when the user cancels or it does not match. */
export async function askBiometric(promptMessage: string, cancelLabel: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: true });
    return result.success;
  } catch {
    return false;
  }
}
