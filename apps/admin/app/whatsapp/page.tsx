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
      <main className="grid min-h-dvh place-items-center bg-tinta p-6 text-crema">
        <div className="max-w-md text-center leading-relaxed">
          <p className="text-base font-semibold">RESPONDE no está configurado en este servidor</p>
          <p className="mt-2 text-sm text-crema/70">
            Faltan las credenciales del panel (RESPONDE_PANEL_EMAIL y RESPONDE_PANEL_CLAVE en las variables del servicio) o RESPONDE no respondió al login.
          </p>
        </div>
      </main>
    );
  }
  return (
    <>
      <iframe
        src={`/responde-app.html?embed=1&conector=odb&token=${encodeURIComponent(token)}`}
        title="RESPONDE · O.D.B"
        className="fixed inset-0 h-full w-full border-0 bg-tinta"
        allow="microphone; camera"
      />
      {/* la app es pantalla completa: sin esto no hay forma de volver al panel */}
      <a
        href="/inicio"
        className="fixed top-[calc(env(safe-area-inset-top,0px)+0.625rem)] left-3 z-contenido inline-flex min-h-9 items-center gap-1.5 rounded-full bg-crema px-3.5 text-sm font-semibold text-tinta no-underline opacity-90 shadow-flotante transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crema"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        Panel
      </a>
    </>
  );
}
