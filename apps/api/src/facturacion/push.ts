// Envío de notificación push vía el servicio de Expo.
// No requiere credenciales: usa el ExponentPushToken del dispositivo.
// En producción (build con EAS) Expo enruta a FCM (Android) / APNs (iOS).
export async function enviarPush(token: string, titulo: string, cuerpo: string) {
  if (!token?.startsWith('ExponentPushToken')) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: token,
      title: titulo,
      body: cuerpo,
      sound: 'default',
      channelId: 'default',
      priority: 'high',
    }),
  });
}
