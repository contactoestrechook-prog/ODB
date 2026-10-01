'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { llevaFlotantes } from '../lib/rutas';

// Cartel "Instalá la app del sistema". Tres caminos:
// - Chrome/Edge (escritorio y Android): el navegador avisa que se puede instalar
//   (beforeinstallprompt); guardamos ese evento y el botón instala de un toque.
// - iPhone/iPad (Safari): Apple no permite instalar por botón, así que el cartel
//   muestra los dos pasos (Compartir → Agregar a pantalla de inicio).
// - Ya instalada (modo standalone): no se muestra nunca.
// "Ahora no" lo silencia por 14 días (localStorage).
const SNOOZE_DIAS = 14;
const CLAVE_SNOOZE = 'odb_instalar_snooze';

// Versión del service worker que tiene que estar corriendo. Si el navegador
// quedó con uno viejo (el que hacía respondWith(fetch()) y rompía páginas
// enteras con "network error"), no alcanza con publicar el nuevo: el viejo
// puede seguir controlando la pestaña. Acá se lo detecta y se lo echa.
const VERSION_SW = 'odb-3';

async function asegurarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // updateViaCache 'none': el archivo del service worker nunca sale del caché
    // del navegador, siempre se pregunta al servidor si hay uno nuevo
    const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    reg.update().catch(() => null);

    const control = navigator.serviceWorker.controller;
    if (!control) return; // primera visita: todavía no controla nada, nada que reparar

    const version = await new Promise<string | null>((resolve) => {
      const canal = new MessageChannel();
      const reloj = setTimeout(() => resolve(null), 2000); // el viejo no contesta
      canal.port1.onmessage = (e) => { clearTimeout(reloj); resolve(e.data?.odbVersion ?? null); };
      control.postMessage('odb-version', [canal.port2]);
    });
    if (version === VERSION_SW) return;

    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    // una sola recarga por pestaña, para no entrar en un ciclo si algo falla
    if (!sessionStorage.getItem('odb_sw_reparado')) {
      sessionStorage.setItem('odb_sw_reparado', '1');
      location.reload();
    }
  } catch {
    // sin service worker se trabaja igual: solo se pierde "Instalar la app"
  }
}

export function BannerInstalarApp() {
  const pathname = usePathname();
  const [instalable, setInstalable] = useState<any>(null); // evento beforeinstallprompt
  const [esIos, setEsIos] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pasosIos, setPasosIos] = useState(false);

  useEffect(() => {
    // el navegador solo considera instalable un sitio con service worker: se
    // registra siempre, aunque el cartel no se muestre (así el ítem "Instalar
    // la app" del menú también funciona)
    asegurarServiceWorker();
    // ya corre como app instalada → nada que ofrecer
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // silenciado hace poco → respetar
    const snooze = Number(localStorage.getItem(CLAVE_SNOOZE) || 0);
    if (snooze && Date.now() - snooze < SNOOZE_DIAS * 24 * 60 * 60 * 1000) return;

    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
    if (ios) {
      setEsIos(true);
      setVisible(true);
      return;
    }

    const alPoderInstalar = (e: Event) => {
      e.preventDefault(); // suprimimos el mini-aviso del navegador: mostramos el nuestro
      (window as any).__odbInstalar = e; // lo usa el ítem "Instalar la app" del menú
      window.dispatchEvent(new Event('odb-instalable'));
      setInstalable(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', alPoderInstalar);
    const alInstalar = () => { (window as any).__odbInstalar = null; setVisible(false); };
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', alPoderInstalar);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  // en las pantallas de acceso (login, recuperar o cambiar la clave) y en las
  // que no son del panel no molestamos: la lista es una sola (app/lib/rutas.ts)
  if (!llevaFlotantes(pathname)) return null;
  if (!visible) return null;

  const cerrar = () => {
    localStorage.setItem(CLAVE_SNOOZE, String(Date.now()));
    setVisible(false);
  };

  const instalar = async () => {
    if (!instalable) return;
    instalable.prompt();
    const { outcome } = await instalable.userChoice;
    if (outcome !== 'accepted') localStorage.setItem(CLAVE_SNOOZE, String(Date.now()));
    setVisible(false);
  };

  // Capa de aviso (A7). Abajo respeta el gesto de inicio del iPhone y, si la
  // pantalla tiene una BarraInferior, se para encima (--alto-barra-inferior).
  // Se esconde mientras el menú del celular o un modal están abiertos.
  return (
    <div className="flotante-ocultable fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom)+var(--alto-barra-inferior,0px))] z-aviso sm:inset-x-auto sm:right-5 sm:bottom-[calc(1.25rem+env(safe-area-inset-bottom)+var(--alto-barra-inferior,0px))] sm:w-96 print:hidden">
      <div className="rounded-2xl border border-white/10 bg-tinta p-4 text-crema shadow-flotante">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl border border-white/15" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Instalá la app del sistema</p>
            <p className="mt-0.5 text-xs leading-snug text-white/70">
              {esIos
                ? 'Acceso directo en tu pantalla de inicio, a pantalla completa.'
                : 'Se abre en su propia ventana, con ícono propio, como cualquier app.'}
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {esIos && pasosIos && (
          <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-xs text-white/80">
            <li>
              Tocá el botón <b>Compartir</b>
              <svg viewBox="0 0 24 24" className="mx-1 -mt-0.5 inline-block size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>
              (abajo en Safari, arriba en iPad)
            </li>
            <li>Elegí <b>“Agregar a pantalla de inicio”</b></li>
          </ol>
        )}

        <div className="mt-3 flex gap-2">
          {esIos ? (
            <button type="button" onClick={() => setPasosIos((v) => !v)} className="min-h-11 flex-1 rounded-full bg-marca px-4 text-sm font-semibold text-white transition-colors hover:bg-marca-hondo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:min-h-10">
              {pasosIos ? 'Entendido' : 'Ver cómo instalarla'}
            </button>
          ) : (
            <button type="button" onClick={instalar} className="min-h-11 flex-1 rounded-full bg-marca px-4 text-sm font-semibold text-white transition-colors hover:bg-marca-hondo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:min-h-10">
              Instalar ahora
            </button>
          )}
          <button type="button" onClick={cerrar} className="min-h-11 rounded-full border border-white/20 px-4 text-sm text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:min-h-10">
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
