/**
 * Keeps a screen out of screenshots, screen recordings and the recent-apps preview while it is mounted. Used
 * where the recovery phrase is on screen. Android honours this fully (FLAG_SECURE); iOS blanks recordings.
 */
import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

export function useSecureScreen(active = true) {
  useEffect(() => {
    if (!active) return;
    const key = 'recovery-phrase';
    ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
    return () => { ScreenCapture.allowScreenCaptureAsync(key).catch(() => {}); };
  }, [active]);
}
