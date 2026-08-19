import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// RESPONDE de O.D.B: es LA app de RESPONDE (la de MetoGroup, con su estética
// y sus funciones), servida a pantalla completa y conectada a los datos de ODB.
// Misma app para todos los clientes de MetoGroup; acá solo cambia el backend.
export const metadata: Metadata = { title: 'RESPONDE · O.D.B', manifest: '/whatsapp.webmanifest' };
export const viewport: Viewport = { themeColor: '#0A0A0B', viewportFit: 'cover' };

export default async function RespondeApp() {
  if (!(await cookies()).get('odb_token')?.value) redirect('/login');
  return (
    <iframe
      src="/responde-app.html"
      title="RESPONDE · O.D.B"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, background: '#0A0A0B' }}
      allow="microphone; camera"
    />
  );
}
