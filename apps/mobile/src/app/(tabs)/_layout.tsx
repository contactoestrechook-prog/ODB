import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEstado } from '../../lib/estado';
import { C } from '../../lib/ui';

export default function TabsLayout() {
  const { carrito, notif } = useEstado();
  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);

  type IcoName = keyof typeof Ionicons.glyphMap;
  const icono = (on: IcoName, off: IcoName) =>
    ({ color, focused, size }: any) => <Ionicons name={focused ? on : off} size={size - 1} color={color} />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.negro },
        headerTintColor: '#fff',
        headerTitleStyle: { letterSpacing: 1, fontWeight: '700' },
        tabBarStyle: { backgroundColor: C.negro, borderTopColor: 'transparent', height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: C.rojo, color: '#fff', fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false, tabBarLabel: 'Inicio', tabBarIcon: icono('home', 'home-outline') }} />
      <Tabs.Screen name="catalogo" options={{ headerShown: false, tabBarLabel: 'Catálogo', tabBarIcon: icono('grid', 'grid-outline') }} />
      <Tabs.Screen name="comprafacil" options={{ title: 'Comprá Fácil', tabBarLabel: 'Escanear', tabBarIcon: icono('scan', 'scan-outline') }} />
      <Tabs.Screen name="somelier" options={{ title: 'Somelier ODB', tabBarLabel: 'Somelier', tabBarIcon: icono('wine', 'wine-outline') }} />
      <Tabs.Screen name="cuenta" options={{ title: 'Mi cuenta', tabBarLabel: 'Mi cuenta', tabBarBadge: notif.noLeidas || undefined, tabBarIcon: icono('card', 'card-outline') }} />
      <Tabs.Screen name="carrito" options={{ title: 'Carrito', tabBarLabel: 'Carrito', tabBarBadge: unidades || undefined, tabBarIcon: icono('cart', 'cart-outline') }} />
    </Tabs>
  );
}
