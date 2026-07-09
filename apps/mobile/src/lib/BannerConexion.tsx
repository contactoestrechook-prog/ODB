import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onEstadoRed } from './api';

// Banner global "Sin conexión". Se alimenta de la señal del cliente HTTP
// (un fallo de red lo muestra; la primera respuesta del servidor lo oculta),
// así no hace falta ninguna dependencia de NetInfo.
export default function BannerConexion() {
  const [visible, setVisible] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => onEstadoRed((e) => setVisible(e === 'offline')), []);
  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [visible, anim]);

  if (!visible) return null;
  return (
    <Animated.View style={[est.banner, { paddingTop: insets.top + 6, opacity: anim }]}>
      <Text style={est.texto}>Sin conexión — mostrando lo último disponible</Text>
    </Animated.View>
  );
}

const est = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: '#932A1F',
    paddingBottom: 6,
    alignItems: 'center',
  },
  texto: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
});
