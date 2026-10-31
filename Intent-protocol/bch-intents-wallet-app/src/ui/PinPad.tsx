/**
 * The six-digit PIN entry: dots that fill, and a keypad of large keys.
 *
 * The app draws its own keypad, so the digits never pass through a keyboard app, and the layout does not jump
 * when a system keyboard would open. A wrong PIN shakes the dots and clears them.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Delete, Fingerprint, ScanFace } from 'lucide-react-native';
import { PIN_LENGTH } from '@/wdk/pin';
import { buzz, tap } from './primitives';
import { space, useTheme } from './theme';

interface PinPadProps {
  value: string;
  onChange: (pin: string) => void;
  /** Called once, when the last digit is entered. */
  onComplete?: (pin: string) => void;
  /** Changes to a new number each time the PIN was wrong: shakes the dots. */
  errorTick?: number;
  disabled?: boolean;
  /** Shows a biometric key in the free corner of the keypad. */
  biometric?: { kind: 'face' | 'fingerprint' | 'iris'; label: string; onPress: () => void };
  deleteLabel: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Key({ label, onPress, children, a11y, disabled }: { label?: string; onPress: () => void; children?: React.ReactNode; a11y: string; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y}
      style={({ pressed }) => ({
        width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? c.primaryDim : label ? c.surface : 'transparent',
        borderWidth: label ? 1 : 0, borderColor: pressed ? c.primaryBorder : c.border, opacity: disabled ? 0.4 : 1,
      })}
    >
      {label ? <Text style={{ color: c.fg, fontSize: 28, fontWeight: '500' }}>{label}</Text> : children}
    </Pressable>
  );
}

export function PinPad({ value, onChange, onComplete, errorTick = 0, disabled, biometric, deleteLabel }: PinPadProps) {
  const { c } = useTheme();
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!errorTick) return;
    buzz();
    Animated.sequence([-1, 1, -0.7, 0.7, -0.3, 0].map(v => Animated.timing(shake, { toValue: v, duration: 60, useNativeDriver: true }))).start();
  }, [errorTick, shake]);

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    tap();
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };
  const back = () => { if (!disabled && value.length) { tap(); onChange(value.slice(0, -1)); } };

  const BioIcon = biometric?.kind === 'face' ? ScanFace : Fingerprint;

  return (
    <View style={{ alignItems: 'center', gap: space.xxl }}>
      <Animated.View
        accessible accessibilityLabel={`${value.length} / ${PIN_LENGTH}`} accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', gap: 16, transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] }) }] }}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < value.length ? c.primary : 'transparent', borderWidth: 1.5, borderColor: i < value.length ? c.primary : c.borderStrong }} />
        ))}
      </Animated.View>

      <View style={{ gap: 14 }}>
        {[0, 1, 2].map(row => (
          <View key={row} style={{ flexDirection: 'row', gap: 26 }}>
            {KEYS.slice(row * 3, row * 3 + 3).map(d => <Key key={d} label={d} a11y={d} onPress={() => press(d)} disabled={disabled} />)}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 26 }}>
          {biometric
            ? <Key a11y={biometric.label} onPress={() => { tap(); biometric.onPress(); }} disabled={disabled}><BioIcon size={30} color={c.primary} /></Key>
            : <View style={{ width: 76, height: 76 }} />}
          <Key label="0" a11y="0" onPress={() => press('0')} disabled={disabled} />
          <Key a11y={deleteLabel} onPress={back} disabled={disabled}><Delete size={26} color={c.fgMute} /></Key>
        </View>
      </View>
    </View>
  );
}
