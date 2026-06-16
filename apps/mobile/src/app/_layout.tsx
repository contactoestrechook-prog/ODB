import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { EstadoProvider, COLORES } from '../lib/estado';

export default function RootLayout() {
  return (
    <EstadoProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="pedido/[id]"
          options={{
            headerShown: true,
            title: 'Tu pedido',
            headerStyle: { backgroundColor: COLORES.negro },
            headerTintColor: COLORES.blanco,
          }}
        />
        {[
          { name: 'puntos', title: 'Mis puntos' },
          { name: 'compras', title: 'Mis compras' },
          { name: 'favoritos', title: 'Favoritos' },
          { name: 'referidos', title: 'Invitá y ganá' },
        ].map((s) => (
          <Stack.Screen
            key={s.name}
            name={s.name}
            options={{
              headerShown: true,
              title: s.title,
              headerStyle: { backgroundColor: COLORES.negro },
              headerTintColor: COLORES.blanco,
            }}
          />
        ))}
      </Stack>
    </EstadoProvider>
  );
}
