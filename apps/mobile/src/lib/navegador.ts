import { Platform, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Abre la verificación de identidad (Didit) sin sacar al cliente de la app:
// browser in-app en el celu; en web no hay in-app, se abre en otra pestaña.
export async function abrirVerificacion(url: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(url, '_blank');
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  } catch {
    // fallback: navegador externo
    Linking.openURL(url).catch(() => {});
  }
}
