import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { datosDesdeToken } from '../lib/permisos';
import { tokenDelPanelResponde } from '../lib/responde';

export const dynamic = 'force-dynamic';

// RESPONDE de O.D.B: es LA app de RESPONDE (la de MetoGroup, con su estética y
// sus funciones), embebida a pantalla completa. Lee y opera contra el backend
// de RESPONDE — los mismos datos que se ven en resonant-kitten — y lo ÚNICO
// distinto es el envío: sale por el WhatsApp propio de ODB (WAHA), que es el
// canal que funciona. Solo la ven los dueños.
export const metadata: Metadata = { title: 'RESPONDE · O.D.B', manifest: '/whatsapp.webmanifest' };
export const viewport: Viewport = { themeColor: '#0A0A0B', viewportFit: 'cover' };

export default async function RespondeApp() {
  const yo = datosDesdeToken((await cookies()).get('odb_token')?.value);
  if (!yo.sub) redirect('/login');
  if (yo.rol !== 'dueno') redirect('/inicio'); // RESPONDE es de los dueños
  const token = await tokenDelPanelResponde();
  if (!token) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0A0A0B', color: '#F0EBE2', fontFamily: 'system-ui', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.6 }}>
          <p style={{ fontSize: 15, fontWeight: 600 }}>RESPONDE no está configurado en este servidor</p>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
            Faltan las credenciales del panel (RESPONDE_PANEL_EMAIL y RESPONDE_PANEL_CLAVE en las variables del servicio) o RESPONDE no respondió al login.
          </p>
        </div>
      </main>
    );
  }
  return (
    <iframe
      src={`/responde-app.html?embed=1&token=${encodeURIComponent(token)}`}
      title="RESPONDE · O.D.B"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, background: '#0A0A0B' }}
      allow="microphone; camera"
    />
  );
}
