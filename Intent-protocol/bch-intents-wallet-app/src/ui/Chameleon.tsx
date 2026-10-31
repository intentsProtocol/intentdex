/**
 * Cham, the wallet's chameleon: the same character as in the browser extension, drawn for a phone.
 *
 * Its skin takes the colour of the chain in focus, and it reacts to what the user is doing:
 *
 *   idle     breathes, looks around, blinks now and then
 *   shy      shuts its eye while a PIN or recovery phrase is on screen
 *   happy    flicks its tongue (unlocked, sent, confirmed)
 *   error    shakes its head (wrong PIN, failed transaction)
 *   busy     the tail spiral turns while something is in flight
 *
 * The drawing is one SVG split into layers, and each moving part is its own layer moved with a transform, so
 * every animation runs on the native thread. With "reduce motion" on, Cham holds still and only changes pose.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { mix, useTheme } from './theme';

export type ChamMood = 'idle' | 'shy' | 'happy' | 'error' | 'busy';

interface ChameleonProps {
  size?: number;
  /** Any colour of the palette; usually a chain colour. Defaults to the brand emerald. */
  tone?: string;
  mood?: ChamMood;
  label?: string;
}

const W = 200, H = 160;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (on) setReduced(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { on = false; sub.remove(); };
  }, []);
  return reduced;
}

export function Chameleon({ size = 140, tone, mood = 'idle', label = 'Cham the chameleon' }: ChameleonProps) {
  const { c } = useTheme();
  const still = useReducedMotion();
  const skin = tone ?? c.primary;
  const dark = mix(skin, '#04120b', 0.38);
  const lightTone = mix(skin, '#ffffff', 0.45);
  const belly = mix(skin, '#fffbe8', 0.7);
  const k = size / W;
  const height = size * (H / W);

  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const tail = useRef(new Animated.Value(0)).current;
  const tongue = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;

  // Breathing and looking around.
  useEffect(() => {
    if (still) { breathe.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, breathe]);

  useEffect(() => {
    if (still || mood === 'shy') { lookX.setValue(0); lookY.setValue(0); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const glance = () => {
      if (!alive) return;
      const angle = Math.random() * Math.PI * 2, reach = 2 + Math.random() * 3.5;
      Animated.parallel([
        Animated.timing(lookX, { toValue: Math.cos(angle) * reach * k, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(lookY, { toValue: Math.sin(angle) * reach * k, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      timer = setTimeout(glance, 1400 + Math.random() * 2600);
    };
    timer = setTimeout(glance, 900);
    return () => { alive = false; clearTimeout(timer); };
  }, [still, mood, k, lookX, lookY]);

  // The eyelid: shut when shy, otherwise a blink every few seconds.
  useEffect(() => {
    if (mood === 'shy') {
      Animated.timing(blink, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(blink, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    if (still) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const once = () => {
      if (!alive) return;
      Animated.sequence([
        Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 0, duration: 110, useNativeDriver: true }),
      ]).start();
      timer = setTimeout(once, 3500 + Math.random() * 3500);
    };
    timer = setTimeout(once, 2500);
    return () => { alive = false; clearTimeout(timer); };
  }, [mood, still, blink]);

  useEffect(() => {
    if (mood !== 'busy' || still) { tail.stopAnimation(); tail.setValue(0); return; }
    const spin = Animated.loop(Animated.timing(tail, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
    spin.start();
    return () => spin.stop();
  }, [mood, still, tail]);

  useEffect(() => {
    if (mood === 'happy' && !still) {
      Animated.sequence([
        Animated.timing(tongue, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(180),
        Animated.timing(tongue, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    if (mood === 'error' && !still) {
      Animated.sequence([-1, 1, -0.7, 0.7, -0.3, 0].map(v => Animated.timing(shake, { toValue: v, duration: 70, useNativeDriver: true }))).start();
    }
  }, [mood, still, tongue, shake]);

  const layer = { position: 'absolute' as const, left: 0, top: 0, width: size, height };
  const box = `0 0 ${W} ${H}`;
  const mouth = mood === 'happy' ? 'M152 78 C 160 84, 170 82, 175 74' : mood === 'error' ? 'M152 80 C 160 76, 170 76, 175 78' : 'M152 78 C 160 80, 170 79, 175 75';

  /** A scale of exactly zero makes a transform some devices refuse; this stops just short of it. */
  const visible = (v: Animated.Value) => v.interpolate({ inputRange: [0, 1], outputRange: [0.001, 1] });

  /** A layer that turns or scales around a point of the drawing, given in the drawing's own units. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const around = (x: number, y: number, transform: any[]): any => ({
    ...layer,
    transform: [{ translateX: x * k - size / 2 }, { translateY: y * k - height / 2 }, ...transform, { translateX: size / 2 - x * k }, { translateY: height / 2 - y * k }],
  });

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height }}>
      <Animated.View style={{ width: size, height, transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-7 * k, 7 * k] }) }] }}>
        {/* branch */}
        <Svg style={layer} viewBox={box}>
          <Path d="M8 128 C 60 120, 140 124, 194 112" stroke={c.fgFaint} strokeWidth={6} strokeLinecap="round" fill="none" opacity={0.55} />
          <Path d="M150 118 C 160 106, 172 104, 180 96" stroke={c.fgFaint} strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.45} />
          <Ellipse cx={183} cy={93} rx={9} ry={5} transform="rotate(-35 183 93)" fill={lightTone} opacity={0.75} />
        </Svg>

        <Animated.View style={{ ...layer, transform: [{ translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -1.8 * k] }) }] }}>
          {/* tail: a spiral that turns while busy */}
          <Animated.View style={around(38, 96, [{ rotate: tail.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }])}>
            <Svg style={layer} viewBox={box}>
              <Path d="M62 100 C 44 122, 14 110, 20 90 C 24 76, 46 76, 46 92 C 46 102, 34 104, 32 96" stroke={skin} strokeWidth={9} strokeLinecap="round" fill="none" />
            </Svg>
          </Animated.View>

          {/* tongue, behind the head */}
          <Animated.View style={[around(174, 74, [{ scaleX: visible(tongue) }]), { opacity: tongue.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 1] }) }]}>
            <Svg style={layer} viewBox={box}>
              <Path d="M174 74 C 184 72, 190 76, 198 70" stroke="#f472b6" strokeWidth={3.5} strokeLinecap="round" fill="none" />
              <Circle cx={198} cy={70} r={3.5} fill="#f472b6" />
            </Svg>
          </Animated.View>

          <Svg style={layer} viewBox={box}>
            {/* body */}
            <Path d="M56 104 C 52 70, 86 46, 122 54 C 140 58, 150 74, 146 92 C 142 110, 112 118, 84 116 C 70 115, 58 112, 56 104 Z" fill={skin} />
            <Path d="M66 106 C 80 114, 118 114, 140 98 C 132 112, 108 118, 84 116 C 74 115, 68 112, 66 106 Z" fill={belly} opacity={0.85} />
            <Path d="M64 78 C 78 56, 104 50, 124 55" stroke={dark} strokeWidth={3} strokeLinecap="round" fill="none" strokeDasharray="1 7" />
            <Path d="M82 66 C 78 82, 80 98, 86 110 M100 60 C 96 78, 98 96, 104 112" stroke={dark} strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.4} />
            {/* legs gripping the branch */}
            <Path d="M82 112 C 80 120, 78 124, 74 127 M88 113 C 88 121, 90 125, 94 127" stroke={dark} strokeWidth={5} strokeLinecap="round" fill="none" />
            <Path d="M122 110 C 122 117, 120 121, 116 124 M128 108 C 130 115, 133 119, 137 121" stroke={dark} strokeWidth={5} strokeLinecap="round" fill="none" />
            {/* head with crest */}
            <Path d="M118 56 C 126 34, 150 30, 160 44 C 172 48, 180 60, 176 72 C 173 82, 160 88, 146 86 C 130 84, 118 74, 118 56 Z" fill={skin} />
            <Path d="M126 46 C 134 34, 150 32, 158 44" stroke={dark} strokeWidth={3} strokeLinecap="round" fill="none" />
            <Path d={mouth} stroke={dark} strokeWidth={2.5} strokeLinecap="round" fill="none" />
            {/* turret eye */}
            <Circle cx={138} cy={62} r={15} fill={lightTone} />
            <Circle cx={138} cy={62} r={15} fill="none" stroke={dark} strokeWidth={2} opacity={0.5} />
            <Circle cx={138} cy={62} r={9.5} fill="#ffffff" />
          </Svg>

          {/* pupil */}
          <Animated.View style={{ ...layer, transform: [{ translateX: lookX }, { translateY: lookY }] }}>
            <Svg style={layer} viewBox={box}>
              <Circle cx={138} cy={62} r={5} fill="#0b1210" />
              <Circle cx={139.8} cy={60.2} r={1.6} fill="#ffffff" />
            </Svg>
          </Animated.View>

          {/* eyelid: closes from the top */}
          <Animated.View style={[around(138, 51.5, [{ scaleY: visible(blink) }]), { opacity: blink.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 1] }) }]}>
            <Svg style={layer} viewBox={box}>
              <Ellipse cx={138} cy={62} rx={10.5} ry={10.5} fill={skin} />
              {mood === 'shy' ? <Path d="M129 63 C 134 67, 142 67, 147 63" stroke={dark} strokeWidth={2.2} strokeLinecap="round" fill="none" /> : null}
            </Svg>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
