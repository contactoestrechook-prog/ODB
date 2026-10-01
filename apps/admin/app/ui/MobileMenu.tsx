'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { InstalarApp } from './InstalarApp';
import { CampanaAlertas } from './CampanaAlertas';

type Item = { href: string; label: string; icono: string };
type Grupo = { titulo: string; items: Item[] };

// Sobre el negro: texto white/70, rótulos y los íconos apagados white/55 (el
// mínimo que se lee); nada por debajo de eso.
const ENLACE =
  'group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';
const ENLACE_PIE = `${ENLACE} text-white/70 hover:bg-white/[0.06] hover:text-white`;

function Icono({ d, activo = false }: { d: string; activo?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-[18px] shrink-0 ${activo ? 'text-white' : 'text-white/55'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Navegación del celular: la barra negra de arriba (menú, título de la
 * sección, avisos y logo) y el cajón con todas las secciones. La barra
 * respeta la muesca/isla del iPhone con la app instalada (safe-area) y mide
 * lo que dice --alto-barra-movil en globals.css.
 */
export function MobileMenu({
  grupos,
  iconos,
  activo,
  titulo,
  pendientes = {},
}: {
  grupos: Grupo[];
  iconos: Record<string, string>;
  activo: string;
  titulo: string;
  /** Números de lo que espera firma, por ruta ('/aprobaciones': 3). */
  pendientes?: Record<string, number>;
}) {
  const [abierto, setAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const botonCerrar = useRef<HTMLButtonElement>(null);
  const cajon = useRef<HTMLElement>(null);
  const hayPendientes = Object.values(pendientes).some((n) => n > 0);

  useEffect(() => {
    if (!abierto) return;
    const html = document.documentElement;
    const abridor = botonMenu.current;
    // los flotantes (Esto está mal, instalar, actualización) se esconden y la
    // página de atrás no scrollea mientras el cajón está abierto
    html.dataset.cajonAbierto = '1';
    const overflowAntes = html.style.overflow;
    html.style.overflow = 'hidden';
    botonCerrar.current?.focus();

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        return;
      }
      // el foco no se escapa a la página de atrás (el cajón es modal): Tab
      // después del último vuelve al primero y Mayús+Tab al revés
      if (e.key !== 'Tab' || !cajon.current) return;
      const enfocables = Array.from(cajon.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter(
        (x) => x.offsetParent !== null,
      );
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (!cajon.current.contains(document.activeElement)) {
        e.preventDefault();
        primero.focus();
      }
    };
    // si la ventana pasa a escritorio con el cajón abierto, se cierra solo
    const escritorio = window.matchMedia('(min-width: 1024px)');
    const alCambiar = () => {
      if (escritorio.matches) setAbierto(false);
    };
    document.addEventListener('keydown', alTeclear);
    escritorio.addEventListener('change', alCambiar);
    return () => {
      delete html.dataset.cajonAbierto;
      html.style.overflow = overflowAntes;
      document.removeEventListener('keydown', alTeclear);
      escritorio.removeEventListener('change', alCambiar);
      abridor?.focus({ preventScroll: true });
    };
  }, [abierto]);

  return (
    <>
      {/* barra superior móvil */}
      <header className="sticky top-0 z-barra bg-tinta pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))] text-white lg:hidden">
        <div className="flex h-14 items-center gap-1">
          <button
            ref={botonMenu}
            type="button"
            onClick={() => setAbierto(true)}
            aria-label={hayPendientes ? 'Abrir el menú (hay cosas esperando tu firma)' : 'Abrir el menú'}
            aria-expanded={abierto}
            aria-controls="menu-movil"
            className="relative grid size-11 shrink-0 place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {hayPendientes && <span className="absolute right-2 top-2 size-2.5 rounded-full bg-marca ring-2 ring-tinta" aria-hidden="true" />}
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{titulo}</h1>
          {/* avisos internos: en el celular el panel se abre a lo ancho de la pantalla */}
          <CampanaAlertas donde="movil" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="ml-1 h-7 w-auto shrink-0" />
        </div>
      </header>

      {/* cajón lateral */}
      {abierto && (
        <div className="fixed inset-0 z-cajon flex lg:hidden">
          <div className="absolute inset-0 bg-tinta/60 animate-aparece motion-reduce:animate-none" onClick={() => setAbierto(false)} aria-hidden="true" />
          <aside
            ref={cajon}
            id="menu-movil"
            role="dialog"
            aria-modal="true"
            aria-label="Menú del sistema"
            className="relative flex h-full w-72 max-w-[85%] flex-col bg-tinta pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-white shadow-flotante animate-cajon-entra motion-reduce:animate-none"
          >
            <div className="flex items-center justify-between py-3 pr-3 pl-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="h-9 w-auto" />
              <button
                ref={botonCerrar}
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar el menú"
                className="grid size-11 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav aria-label="Secciones del sistema" className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-4">
              {grupos.map((g) => (
                <div key={g.titulo}>
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">{g.titulo}</p>
                  {g.items.map((i) => {
                    const esActivo = i.href === activo;
                    const n = pendientes[i.href] ?? 0;
                    return (
                      <Link
                        key={i.href}
                        href={i.href}
                        onClick={() => setAbierto(false)}
                        aria-current={esActivo ? 'page' : undefined}
                        className={`${ENLACE} mb-0.5 ${esActivo ? 'bg-marca font-semibold text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'}`}
                      >
                        <Icono d={iconos[i.icono]} activo={esActivo} />
                        <span className="min-w-0 flex-1 truncate">{i.label}</span>
                        {n > 0 && (
                          <span className={`importe rounded-full px-2 text-xs font-semibold leading-5 ${esActivo ? 'bg-white text-marca' : 'bg-marca text-white'}`}>
                            {n}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="space-y-0.5 border-t border-white/10 px-3 py-2">
              <Link href="/manual" onClick={() => setAbierto(false)} className={ENLACE_PIE}>
                <Icono d={iconos.manual} />
                Manual del sistema
              </Link>
              <Link href="/cambiar-clave" onClick={() => setAbierto(false)} className={ENLACE_PIE}>
                <Icono d={iconos.clave} />
                Cambiar mi contraseña
              </Link>
              <InstalarApp />
              <a href="/api/salir" className={ENLACE_PIE}>
                <Icono d={iconos.salir} />
                Cerrar sesión
              </a>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
