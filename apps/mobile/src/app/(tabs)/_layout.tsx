import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORES, useEstado } from '../../lib/estado';

export default function TabsLayout() {
  const { carrito } = useEstado();
  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: COLORES.negro },
        headerTintColor: COLORES.blanco,
        headerTitleStyle: { letterSpacing: 2, fontWeight: '600' },
        tabBarStyle: { backgroundColor: COLORES.negro, borderTopColor: '#222' },
        tabBarActiveTintColor: COLORES.blanco,
        tabBarInactiveTintColor: '#888',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'O.D.B',
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="catalogo"
        options={{
          title: 'Catálogo',
          tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="comprafacil"
        options={{
          title: 'Comprá Fácil',
          tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="somelier"
        options={{
          title: 'Somelier ODB',
          tabBarIcon: ({ color, size }) => <Ionicons name="wine-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="carrito"
        options={{
          title: 'Carrito',
          tabBarBadge: unidades || undefined,
          tabBarBadgeStyle: { backgroundColor: COLORES.rojo, color: COLORES.blanco },
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
