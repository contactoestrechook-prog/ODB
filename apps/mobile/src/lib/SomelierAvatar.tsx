import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { C, Ionicons } from './ui';

// Marco animado del somelier: halo dorado pulsante, destellos y flotación.
// Si recibe `source` muestra ese personaje (PNG IA); si no, renderiza children
// (el avatar actual). Cuando llegue el render IA: <SomelierAvatar source={require('../assets/somelier.png')} />
export default function SomelierAvatar({
  source, size = 200, children,
}: { source?: any; size?: number; children?: ReactNode }) {
  const entrada = useSharedValue(0);
  const flota = useSharedValue(0);
  const halo = useSharedValue(0);
  const ch1 = useSharedValue(0);
  const ch2 = useSharedValue(0);

  useEffect(() => {
    entrada.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.4)) });
    const vai = (d: number) => withRepeat(withSequence(
      withTiming(1, { duration: d, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: d, easing: Easing.inOut(Easing.quad) }),
    ), -1);
    flota.value = vai(1900);
    halo.value = vai(1600);
    ch1.value = withRepeat(withDelay(200, withSequence(withTiming(1, { duration: 650 }), withTiming(0, { duration: 950 }))), -1);
    ch2.value = withRepeat(withDelay(1100, withSequence(withTiming(1, { duration: 650 }), withTiming(0, { duration: 950 }))), -1);
  }, []);

  const sContenido = useAnimatedStyle(() => ({
    opacity: entrada.value,
    transform: [{ scale: 0.85 + entrada.value * 0.15 }, { translateY: -5 * flota.value }],
  }));
  const sHalo = useAnimatedStyle(() => ({ opacity: 0.1 + halo.value * 0.16, transform: [{ scale: 0.9 + halo.value * 0.18 }] }));
  const sCh1 = useAnimatedStyle(() => ({ opacity: ch1.value, transform: [{ scale: 0.5 + ch1.value * 0.6 }] }));
  const sCh2 = useAnimatedStyle(() => ({ opacity: ch2.value, transform: [{ scale: 0.5 + ch2.value * 0.6 }] }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[est.halo, { width: size * 0.86, height: size * 0.86, borderRadius: size }, sHalo]} />
      <Animated.View style={[est.chispa, { top: size * 0.06, right: size * 0.1 }, sCh1]}>
        <Ionicons name="sparkles" size={20} color={C.dorado} />
      </Animated.View>
      <Animated.View style={[est.chispa, { bottom: size * 0.12, left: size * 0.08 }, sCh2]}>
        <Ionicons name="sparkles" size={14} color={C.dorado} />
      </Animated.View>
      <Animated.View style={sContenido}>
        {source ? <Image source={source} style={{ width: size, height: size }} contentFit="contain" /> : children}
      </Animated.View>
    </View>
  );
}

const est = StyleSheet.create({
  halo: { position: 'absolute', backgroundColor: C.dorado },
  chispa: { position: 'absolute', zIndex: 3 },
});
