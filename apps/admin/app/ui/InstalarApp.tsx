'use client';

import { useEffect, useState } from 'react';

// Ítem fijo del menú para instalar el sistema como app de escritorio. El cartel
// flotante aparece una vez y se puede cerrar; esto queda siempre a mano, para
// cualquier usuario y en cualquier momento.
//
// Tres situaciones:
// - Chrome / Edge (escritorio y Android): instala de un click con el evento
//   beforeinstallprompt que guardó el cartel.
// - Safari (Mac / iPhone) y Firefox: no existe ese botón; se muestran los pasos.
// - Ya instalada: el ítem no se muestra.
export function InstalarApp() {
  const [instalada, setInstalada] = useState(false);
  const [listo, setListo] = useState(false); // el navegador ya ofreció instalar
  const [pasos, setPasos] = useState(false);
  const [nav, setNav] = useState<'chrome' | 'safari' | 'firefox' | 'otro'>('otro');

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) { setInstalada(true); return; }

    const ua = navigator.userAgent;
    setNav(
      /Firefox\//.test(ua) ? 'firefox'
        : /Edg\//.test(ua) || /Chrome\//.test(ua) ? 'chrome'
        : /Safari\//.test(ua) ? 'safari' : 'otro',
    );

    if ((window as unknown as { __odbInstalar?: unknown }).__odbInstalar) setListo(true);
    const alListo = () => setListo(true);
    const alInstalar = () => setInstalada(true);
    window.addEventListener('odb-instalable', alListo);
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('odb-instalable', alListo);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  if (instalada) return null;

  const instalar = async () => {
    const ev = (window as unknown as { __odbInstalar?: { prompt: () => void; userChoice: Promise<{ outcome: string }> } }).__odbInstalar;
    if (!ev) { setPasos((v) => !v); return; }
    ev.prompt();
    await ev.userChoice.catch(() => null);
  };

  return (
    <>
      <button
        onClick={instalar}
        className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-white/50 hover:text-white hover:bg-white/5 text-left"
      >
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        Instalar la app
      </button>

      {pasos && !listo && (
        <div className="mx-3 mb-2 rounded-lg bg-white/5 p-3 text-[11px] leading-relaxed text-white/70">
          {nav === 'safari' ? (
            <>
              En Safari: menú <b className="text-white/90">Archivo</b> →{' '}
              <b className="text-white/90">Agregar al Dock</b>. En iPhone o iPad, botón{' '}
              <b className="text-white/90">Compartir</b> →{' '}
              <b className="text-white/90">Agregar a pantalla de inicio</b>.
            </>
          ) : nav === 'firefox' ? (
            <>
              Firefox no instala aplicaciones web. Para tenerla como app, abrí el sistema en{' '}
              <b className="text-white/90">Chrome</b> o <b className="text-white/90">Edge</b> y volvé a tocar acá.
            </>
          ) : (
            <>
              En la barra de direcciones, el ícono de{' '}
              <b className="text-white/90">instalar</b> (una pantalla con una flecha) a la derecha
              del candado. Si no aparece: menú <b className="text-white/90">⋮</b> →{' '}
              <b className="text-white/90">Guardar y compartir</b> →{' '}
              <b className="text-white/90">Instalar página como aplicación</b>.
            </>
          )}
        </div>
      )}
    </>
  );
}
