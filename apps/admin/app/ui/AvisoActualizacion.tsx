'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fecha } from '../lib/formato';
import { esCampoParaEscribir, MIRAR_CADA_MS, sePuedeActualizar } from '../lib/actualizar-sola';

// Aviso de actualización. Aparece por dos motivos:
//
// 1. Se publicó una novedad (qué cambió, escrito para la gente del local).
// 2. Hay una VERSIÓN NUEVA publicada, se haya escrito novedad o no. Esto es lo
//    que faltaba: la pestaña que quedó abierta desde ayer sigue con el panel
//    viejo, y la persona jura que "no le anda" algo que ya está arreglado. El
//    panel se da cuenta solo comparando la versión que tenía al abrir contra la
//    que está publicada.
//
// Y SE ACTUALIZA SOLO (27/11/2026, lib/actualizar-sola.ts): con una versión
// nueva, la pestaña se recarga sola apenas es un momento en que no se pierde
// nada (sin ventanas abiertas, sin avisos en la pila, sin nadie escribiendo y con
// la pantalla quieta 3 minutos). Antes nunca recargaba sin permiso y Juan Pablo
// siguió dos días con el panel viejo. «Ahora no» solo esconde el aviso.
type Novedad = { id: string; version: string; titulo: string; detalle: string[]; requiere_recarga: boolean; publicada_en: string };

const OMITIDA = 'odb_version_omitida';

export function AvisoActualizacion() {
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [versionNueva, setVersionNueva] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const versionInicial = useRef<string | null>(null);
  // hay una versión publicada más nueva que la de esta pestaña (aunque hayan dicho «Ahora no»)
  const [hayVersion, setHayVersion] = useState(false);
  const ultimaActividad = useRef(0);

  const mirar = useCallback(async () => {
    try {
      const r = await fetch('/api/novedades', { cache: 'no-store' });
      if (r.ok) {
        const xs: Novedad[] = await r.json();
        if (Array.isArray(xs) && xs.length) setNovedades(xs);
      }
    } catch { /* sin red: no molesta */ }

    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (!r.ok) return;
      const { version } = await r.json();
      if (!version) return;
      if (versionInicial.current === null) { versionInicial.current = version; return; }
      if (version === versionInicial.current) return;
      setHayVersion(true);
      // si ya dijo "ahora no" para ESTA versión, el aviso no insiste (se actualiza sola igual)
      if (localStorage.getItem(OMITIDA) === version) return;
      setVersionNueva(version);
    } catch { /* idem */ }
  }, []);

  useEffect(() => {
    mirar();
    // el panel queda abierto horas: se chequea cada 3 minutos, y también al
    // volver a la pestaña, que es cuando la persona retoma el trabajo
    const t = setInterval(mirar, 3 * 60_000);
    const alVolver = () => { if (document.visibilityState === 'visible') mirar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [mirar]);

  // lo último que hizo alguien en la pantalla
  useEffect(() => {
    const anotar = () => { ultimaActividad.current = Date.now(); };
    anotar(); // abrir la pestaña cuenta como estar usándola
    const eventos = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of eventos) window.addEventListener(e, anotar, { capture: true, passive: true });
    return () => { for (const e of eventos) window.removeEventListener(e, anotar, { capture: true }); };
  }, []);

  // con versión nueva: se recarga sola en cuanto no se pierde nada (lib/actualizar-sola.ts)
  useEffect(() => {
    if (!hayVersion) return;
    const probar = () => {
      const listo = sePuedeActualizar({
        ahora: Date.now(),
        ultimaActividad: ultimaActividad.current,
        ventanaAbierta: document.documentElement.dataset.modalAbierto === '1' || !!document.querySelector('[aria-modal="true"], [role="alertdialog"]'),
        escribiendo: esCampoParaEscribir(document.activeElement as HTMLInputElement | null),
        avisosEnPantalla: document.querySelectorAll('.pila-avisos section[aria-label]').length,
      });
      if (listo) window.location.reload();
    };
    const t = setInterval(probar, MIRAR_CADA_MS);
    return () => clearInterval(t);
  }, [hayVersion]);

  if (!novedades.length && !versionNueva) return null;
  const ultima = novedades[0];

  async function marcarVistas() {
    await Promise.all(
      novedades.map((n) =>
        fetch('/api/novedades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id }) }).catch(() => null),
      ),
    );
  }

  async function actualizar() {
    if (trabajando) return;
    setTrabajando(true);
    await marcarVistas();
    if (versionNueva) localStorage.removeItem(OMITIDA);
    // recarga dura: se saltea el caché para que baje la versión nueva del panel
    window.location.reload();
  }

  async function despues() {
    // "ahora no": se guarda como vista para no insistir; la app la toma igual
    // en la próxima recarga que haga la persona por su cuenta
    await marcarVistas();
    if (versionNueva) localStorage.setItem(OMITIDA, versionNueva);
    setNovedades([]);
    setVersionNueva(null);
  }

  // Capa de aviso (A7): arriba, debajo de la muesca/isla del iPhone
  // (safe-area). Se esconde mientras el menú del celular o un modal están
  // abiertos y vuelve a aparecer al cerrarlos.
  return (
    <div className="flotante-ocultable fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-aviso w-[min(calc(100vw-1.5rem),35rem)] -translate-x-1/2 print:hidden">
      <div className="overflow-hidden rounded-2xl bg-tinta text-crema shadow-flotante ring-1 ring-white/10">
        <div className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-marca text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
          </span>
          <div className="min-w-0 flex-1" role="status">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-dorado">Actualización del sistema</p>
            <p className="mt-0.5 text-sm font-semibold">{ultima?.titulo ?? 'Hay una versión nueva del sistema'}</p>
            {ultima && novedades.length > 1 && (
              <p className="mt-0.5 text-xs text-white/70">y {novedades.length - 1} más desde tu última visita</p>
            )}
            {!ultima && (
              <p className="mt-0.5 text-xs text-white/70">Se actualiza sola cuando dejes de usar la pantalla, sin perder lo que estés cargando.</p>
            )}
            {ultima && (
              <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="mt-1 text-xs text-white/70 underline underline-offset-2 hover:text-white">
                {abierto ? 'Ocultar el detalle' : '¿Qué incluye?'}
              </button>
            )}
          </div>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto sm:flex-col sm:gap-1.5">
            <button
              type="button"
              onClick={actualizar}
              disabled={trabajando}
              className="min-h-11 flex-1 rounded-full bg-marca px-4 text-sm font-semibold text-white transition-colors hover:bg-marca-hondo active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 sm:min-h-10 sm:flex-none"
            >
              {trabajando ? 'Actualizando…' : 'Actualizar ahora'}
            </button>
            <button type="button" onClick={despues} className="min-h-11 rounded-full px-4 text-xs text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:min-h-8">
              Ahora no
            </button>
          </div>
        </div>

        {abierto && ultima && (
          <div className="max-h-[40dvh] overflow-y-auto border-t border-white/10 bg-white/5 px-4 py-3">
            {novedades.map((n) => (
              <div key={n.id} className="mb-3 last:mb-0">
                <p className="text-xs font-semibold text-white/85">
                  {n.titulo}
                  <span className="ml-2 font-normal text-white/60">{fecha(n.publicada_en, 'corta')}</span>
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-white/70">
                  {(n.detalle ?? []).map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
