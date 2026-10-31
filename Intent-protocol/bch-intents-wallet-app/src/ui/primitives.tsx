/**
 * The app's building blocks. Every screen is made of these, so spacing, type, touch targets and the two themes
 * are decided once.
 *
 * Rules they keep: a touch target is at least 44 points; text that states a balance uses tabular figures; a
 * control says what it is to a screen reader; nothing relies on colour alone.
 */
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, X } from 'lucide-react-native';
import { Glass } from './Glass';
import { radius, space, TOUCH, useTheme } from './theme';

export const tap = () => { Haptics.selectionAsync().catch(() => {}); };
export const thud = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };
export const buzz = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); };

// ── text ─────────────────────────────────────────────────────────────────────

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'small' | 'micro';
type Tone = 'fg' | 'mute' | 'faint' | 'primary' | 'red' | 'amber' | 'onPrimary';

const TYPE: Record<Variant, TextStyle> = {
  display: { fontSize: 38, lineHeight: 44, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11.5, lineHeight: 15, fontWeight: '600', letterSpacing: 0.2 },
};

interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
  /** Equal-width digits, for amounts that change or line up. */
  tabular?: boolean;
  weight?: TextStyle['fontWeight'];
}

export function Txt({ variant = 'body', tone = 'fg', center, tabular, weight, style, ...rest }: TxtProps) {
  const { c } = useTheme();
  const color = { fg: c.fg, mute: c.fgMute, faint: c.fgFaint, primary: c.primary, red: c.red, amber: c.amber, onPrimary: c.onPrimary }[tone];
  return (
    <RNText
      {...rest}
      style={[TYPE[variant], { color }, center && { textAlign: 'center' }, tabular && { fontVariant: ['tabular-nums'] }, weight ? { fontWeight: weight } : null, style]}
    />
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

/** The backdrop every screen stands on: the base colour with two soft lights, which is what the glass shows through. */
export function Backdrop() {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg0 }]}>
      <LinearGradient colors={[c.meshA, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 0.6 }} style={[StyleSheet.absoluteFill, { height: '55%' }]} />
      <LinearGradient colors={['transparent', c.meshB]} start={{ x: 0.2, y: 0.3 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Pinned under the content, above the home indicator: the primary action of the screen. */
  footer?: React.ReactNode;
  /** Leave room for the floating tab bar. */
  tabs?: boolean;
  padded?: boolean;
  refreshControl?: React.ReactElement;
  testID?: string;
}

export const TAB_BAR_SPACE = 92;

export function Screen({ children, scroll, footer, tabs, padded = true, refreshControl, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = { paddingHorizontal: padded ? space.lg : 0 };
  const bottom = (tabs ? TAB_BAR_SPACE : 0) + (footer ? 0 : insets.bottom + space.lg);
  return (
    <View style={{ flex: 1 }} testID={testID}>
      <Backdrop />
      {/* The app draws edge to edge, where Android does not resize the window for the keyboard: the padding is ours to add. */}
      <KeyboardAvoidingView style={{ flex: 1, paddingTop: insets.top }} behavior="padding">
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }} contentContainerStyle={[pad, { paddingBottom: bottom, flexGrow: 1 }]}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} refreshControl={refreshControl as never}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, paddingBottom: bottom }, pad]}>{children}</View>
        )}
        {footer ? <View style={[pad, { paddingTop: space.md, paddingBottom: insets.bottom + space.md }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Header({ title, sub, onBack, right, backLabel = 'Back' }: { title?: string; sub?: string; onBack?: () => void; right?: React.ReactNode; backLabel?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: space.sm, marginBottom: space.sm }}>
      {onBack ? (
        <Pressable
          onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface2 : c.surface, marginLeft: -4 })}
        >
          <ChevronLeft size={22} color={c.fg} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {title ? <Txt variant="heading" numberOfLines={1} accessibilityRole="header">{title}</Txt> : null}
        {sub ? <Txt variant="small" tone="mute" numberOfLines={1}>{sub}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

// ── controls ─────────────────────────────────────────────────────────────────

interface ButtonProps {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  small?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, kind = 'primary', disabled, loading, icon, small, testID, style }: ButtonProps) {
  const { c } = useTheme();
  const off = disabled || loading;
  const bg = { primary: c.primary, secondary: c.surface2, ghost: 'transparent', danger: c.redDim }[kind];
  const fg = { primary: c.onPrimary, secondary: c.fg, ghost: c.primary, danger: c.red }[kind];
  const border = { primary: 'transparent', secondary: c.borderStrong, ghost: 'transparent', danger: c.redBorder }[kind];
  return (
    <Pressable
      onPress={() => { if (!off) { tap(); onPress?.(); } }}
      disabled={off} testID={testID}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [{
        minHeight: small ? TOUCH : 54, paddingHorizontal: small ? space.lg : space.xl, borderRadius: small ? radius.md : radius.lg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
        backgroundColor: bg, borderWidth: 1, borderColor: border,
        opacity: off ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed && !off ? 0.985 : 1 }],
      }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
      <RNText style={{ color: fg, fontSize: small ? 14 : 16, fontWeight: '700' }} numberOfLines={1}>{label}</RNText>
    </Pressable>
  );
}

export function IconButton({ children, label, onPress, active, size = TOUCH, testID }: { children: React.ReactNode; label: string; onPress?: () => void; active?: boolean; size?: number; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { tap(); onPress?.(); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID={testID}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? c.primaryDim : pressed ? c.surface2 : c.surface, borderWidth: 1, borderColor: active ? c.primaryBorder : c.border,
      })}
    >
      {children}
    </Pressable>
  );
}

export function Card({ children, style, padding = space.lg, tint }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padding?: number; tint?: string }) {
  return <Glass style={style} padding={padding} tint={tint}>{children}</Glass>;
}

/** A row that can be pressed: settings entries, list items. */
export function Row({ icon, title, sub, value, onPress, right, danger, last, testID }: {
  icon?: React.ReactNode; title: string; sub?: string; value?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean; last?: boolean; testID?: string;
}) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
      {icon ? <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? c.redDim : c.surface2 }}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Txt variant="label" tone={danger ? 'red' : 'fg'} numberOfLines={1}>{title}</Txt>
        {sub ? <Txt variant="small" tone="mute" numberOfLines={2}>{sub}</Txt> : null}
      </View>
      {value ? <Txt variant="small" tone="mute" numberOfLines={1} style={{ maxWidth: '45%' }}>{value}</Txt> : null}
      {right ?? (onPress ? <ChevronRight size={18} color={c.fgFaint} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title} testID={testID} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c } = useTheme();
  return (
    <Switch
      value={value} onValueChange={v => { tap(); onChange(v); }} accessibilityLabel={label}
      trackColor={{ false: c.bg3, true: c.primary }} thumbColor={Platform.OS === 'android' ? '#ffffff' : undefined} ios_backgroundColor={c.bg3}
    />
  );
}

export function Segmented<V extends string | number>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, gap: 3 }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)} onPress={() => { if (!on) { tap(); onChange(o.value); } }}
            accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            style={{ flex: 1, minHeight: 40, borderRadius: radius.md - 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: on ? c.bg1 : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.borderStrong }}
          >
            <RNText numberOfLines={1} style={{ color: on ? c.fg : c.fgMute, fontSize: 13.5, fontWeight: on ? '700' : '600' }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  right?: React.ReactNode;
  mono?: boolean;
}

export function Field({ label, error, hint, right, mono, style, ...rest }: FieldProps) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Txt variant="micro" tone="mute">{label}</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: error ? c.redBorder : c.borderStrong }}>
        <TextInput
          {...rest}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
          placeholderTextColor={c.fgFaint} selectionColor={c.primary}
          autoCapitalize={rest.autoCapitalize ?? 'none'} autoCorrect={rest.autoCorrect ?? false}
          style={[{ flex: 1, color: c.fg, fontSize: 16, paddingVertical: 12, fontFamily: mono ? Platform.select({ ios: 'Menlo', default: 'monospace' }) : undefined }, style]}
        />
        {right}
      </View>
      {error ? <Txt variant="small" tone="red" accessibilityLiveRegion="polite">{error}</Txt> : hint ? <Txt variant="small" tone="mute">{hint}</Txt> : null}
    </View>
  );
}

export function Pill({ label, tone = 'mute', icon, onPress, testID }: { label: string; tone?: 'mute' | 'primary' | 'amber' | 'red'; icon?: React.ReactNode; onPress?: () => void; testID?: string }) {
  const { c } = useTheme();
  const bg = { mute: c.surface2, primary: c.primaryDim, amber: c.amberDim, red: c.redDim }[tone];
  const fg = { mute: c.fgMute, primary: c.primary, amber: c.amber, red: c.red }[tone];
  const border = { mute: c.border, primary: c.primaryBorder, amber: c.amberBorder, red: c.redBorder }[tone];
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 28, borderRadius: radius.pill, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      {icon}
      <RNText style={{ color: fg, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{label}</RNText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} testID={testID} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const { c } = useTheme();
  const bg = { info: c.surface2, warn: c.amberDim, error: c.redDim, ok: c.primaryDim }[tone];
  const fg = { info: c.fgMute, warn: c.amber, error: c.red, ok: c.primary }[tone];
  const border = { info: c.border, warn: c.amberBorder, error: c.redBorder, ok: c.primaryBorder }[tone];
  const Icon = tone === 'info' ? Info : tone === 'ok' ? Check : AlertTriangle;
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: bg, borderWidth: 1, borderColor: border }}>
      <Icon size={17} color={fg} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Txt variant="label" style={{ color: fg }}>{title}</Txt> : null}
        {typeof children === 'string' ? <Txt variant="small" style={{ color: tone === 'info' ? c.fgMute : c.fg }}>{children}</Txt> : children}
        {action ? <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>{action}</View> : null}
      </View>
    </View>
  );
}

export function Spinner({ size = 'small', color }: { size?: 'small' | 'large'; color?: string }) {
  const { c } = useTheme();
  return <ActivityIndicator size={size} color={color ?? c.primary} />;
}

/** A grey bar that pulses while content loads, in the place the content will take. */
export function Skeleton({ width, height = 16, style }: { width: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, height, borderRadius: height / 2, backgroundColor: c.surface2, opacity: pulse }, style]} />;
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl * 1.5, paddingHorizontal: space.xl, gap: space.sm }}>
      {icon}
      <Txt variant="heading" center>{title}</Txt>
      {body ? <Txt variant="small" tone="mute" center>{body}</Txt> : null}
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Txt variant="micro" tone="faint" style={{ textTransform: 'uppercase', marginTop: space.xl, marginBottom: space.sm, marginLeft: 4 }} accessibilityRole="header">{children}</Txt>;
}

/** One line of a summary: a label on the left, its value on the right. */
export function Line({ label, value, tone, mono }: { label: string; value: string; tone?: 'warn'; mono?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, paddingVertical: 7 }}>
      <Txt variant="small" tone="mute">{label}</Txt>
      <Txt variant="small" tabular selectable weight="600" style={{ flexShrink: 1, textAlign: 'right', color: tone === 'warn' ? c.amber : c.fg, fontFamily: mono ? Platform.select({ ios: 'Menlo', default: 'monospace' }) : undefined }}>{value}</Txt>
    </View>
  );
}

// ── sheet ────────────────────────────────────────────────────────────────────

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Fill most of the screen: for lists and pickers. */
  tall?: boolean;
  closeLabel?: string;
  testID?: string;
}

/** A sheet that rises from the bottom over a dimmed screen. The back gesture and a tap outside close it. */
export function Sheet({ visible, onClose, title, children, tall, closeLabel = 'Close', testID }: SheetProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior="padding">
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} accessibilityLabel={closeLabel} accessibilityRole="button" />
        <Glass strong radius={radius.xl} style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '92%', ...(tall ? { height: '86%' } : null) }}>
          <View testID={testID} style={{ paddingBottom: insets.bottom + space.md, ...(tall ? { height: '100%' } : null) }}>
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: c.borderStrong }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 52 }}>
              <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">{title ?? ''}</Txt>
              <IconButton label={closeLabel} onPress={onClose} size={36}><X size={18} color={c.fgMute} /></IconButton>
            </View>
            {children}
          </View>
        </Glass>
      </KeyboardAvoidingView>
    </Modal>
  );
}
