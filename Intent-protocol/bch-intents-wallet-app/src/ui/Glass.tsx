/**
 * The glass surface: cards, bars and sheets sit on it.
 *
 * Three renderings, best first:
 *   iOS 26 and later   the system's Liquid Glass (expo-glass-effect), which refracts what is behind it
 *   older iOS          a blurred backdrop (expo-blur) under a translucent fill
 *   Android            a translucent fill with a highlight edge. A live blur on Android redraws the whole
 *                      screen every frame, which costs more battery and frame rate than it is worth.
 *
 * All three keep the same shape, border and content, so a layout never depends on which one was drawn.
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { radius as R, useTheme } from './theme';

let liquid: boolean | null = null;
/** Asked once: the answer cannot change while the app runs. */
function hasLiquidGlass(): boolean {
  if (liquid === null) {
    try { liquid = Platform.OS === 'ios' && isLiquidGlassAvailable(); } catch { liquid = false; }
  }
  return liquid;
}

interface GlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** A denser fill, for surfaces that carry text over busy content (tab bar, sheets). */
  strong?: boolean;
  /** Tint the surface, for a selected or accented card. */
  tint?: string;
  padding?: number;
}

export function Glass({ children, style, radius = R.lg, strong, tint, padding }: GlassProps) {
  const { c, dark } = useTheme();
  const shape: ViewStyle = { borderRadius: radius, overflow: 'hidden' };
  const content: ViewStyle = { padding };

  if (hasLiquidGlass()) {
    return (
      <GlassView glassEffectStyle="regular" tintColor={tint} style={[shape, style]}>
        <View style={content}>{children}</View>
      </GlassView>
    );
  }

  const fill = tint ?? (strong ? c.glassStrong : c.glass);
  const edge: ViewStyle = { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.glassBorder };

  if (Platform.OS === 'ios') {
    return (
      <View style={[shape, edge, style]}>
        <BlurView intensity={strong ? 60 : 36} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
        <View style={content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[shape, edge, { backgroundColor: fill }, style]}>
      {/* The lit top edge that makes a flat fill read as glass. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: c.glassHi }} />
      <View style={content}>{children}</View>
    </View>
  );
}
