'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

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

  // en login / cambio de clave no molestamos
  if (pathname === '/login' || pathname === '/cambiar-clave') return null;
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

  return (
    <div className="fixed inset-x-3 bottom-3 z-[90] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[390px]">
      <div className="rounded-2xl bg-black text-[#F0EBE2] shadow-[0_18px_50px_-15px_rgba(0,0,0,0.6)] border border-white/10 p-4">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl shrink-0 border border-white/15" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Instalá la app del sistema</p>
            <p className="mt-0.5 text-xs text-white/60 leading-snug">
              {esIos
                ? 'Acceso directo en tu pantalla de inicio, a pantalla completa.'
                : 'Se abre en su propia ventana, con ícono propio, como cualquier app.'}
            </p>
          </div>
          <button onClick={cerrar} aria-label="Cerrar" className="shrink-0 -mt-1 -mr-1 h-8 w-8 grid place-items-center rounded-full text-white/50 hover:text-white hover:bg-white/10">
            ✕
          </button>
        </div>

        {esIos && pasosIos && (
          <ol className="mt-3 space-y-1.5 text-xs text-white/80 list-decimal pl-4">
            <li>
              Tocá el botón <b>Compartir</b>
              <svg viewBox="0 0 24 24" className="inline-block w-3.5 h-3.5 mx-1 -mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>
              (abajo en Safari, arriba en iPad)
            </li>
            <li>Elegí <b>“Agregar a pantalla de inicio”</b></li>
          </ol>
        )}

        <div className="mt-3 flex gap-2">
          {esIos ? (
            <button onClick={() => setPasosIos((v) => !v)} className="flex-1 rounded-full bg-[#B82D25] py-2 text-xs font-semibold text-white hover:bg-[#932A1F]">
              {pasosIos ? 'Entendido' : 'Ver cómo instalarla'}
            </button>
          ) : (
            <button onClick={instalar} className="flex-1 rounded-full bg-[#B82D25] py-2 text-xs font-semibold text-white hover:bg-[#932A1F]">
              Instalar ahora
            </button>
          )}
          <button onClick={cerrar} className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:text-white">
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
