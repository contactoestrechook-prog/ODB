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
      </Stack>
    </EstadoProvider>
  );
}
