import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { API } from './config';

// Mostrar la notificación aunque la app esté abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Registra el dispositivo para recibir push y guarda el token en la API.
// En web/simulador no hay push: las notificaciones in-app siguen andando.
export async function registrarPush(tokenCliente?: string) {
  if (!tokenCliente || Platform.OS === 'web' || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'O.D.B',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#B82D25',
      });
    }
    const previo = await Notifications.getPermissionsAsync();
    let status = previo.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return; // sin proyecto EAS todavía no se puede emitir token

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await fetch(`${API}/mi/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCliente}` },
      body: JSON.stringify({ token }),
    });
  } catch {
    // sin red o sin permisos: se reintenta en el próximo login
  }
}
