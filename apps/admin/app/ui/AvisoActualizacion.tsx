'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Aviso de actualización. Aparece por dos motivos:
//
// 1. Se publicó una novedad (qué cambió, escrito para la gente del local).
// 2. Hay una VERSIÓN NUEVA publicada, se haya escrito novedad o no. Esto es lo
//    que faltaba: la pestaña que quedó abierta desde ayer sigue con el panel
//    viejo, y la persona jura que "no le anda" algo que ya está arreglado. El
//    panel se da cuenta solo comparando la versión que tenía al abrir contra la
//    que está publicada.
//
// Nunca recarga sin permiso: se avisa y decide la persona, porque una recarga
// en medio de una carga de factura le borra lo que estaba escribiendo.
type Novedad = { id: string; version: string; titulo: string; detalle: string[]; requiere_recarga: boolean; publicada_en: string };

const OMITIDA = 'odb_version_omitida';

export function AvisoActualizacion() {
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [versionNueva, setVersionNueva] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const versionInicial = useRef<string | null>(null);

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
      // si ya dijo "ahora no" para ESTA versión, no se insiste
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

  return (
    <div className="fixed left-1/2 top-3 z-[60] w-[min(92vw,560px)] -translate-x-1/2">
      <div className="rounded-xl bg-black text-[#F0EBE2] shadow-2xl ring-1 ring-white/10 overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#B82D25] text-sm">↻</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#C9A96E] font-bold">Actualización del sistema</p>
            <p className="text-sm font-semibold mt-0.5">{ultima?.titulo ?? 'Hay una versión nueva del sistema'}</p>
            {ultima && novedades.length > 1 && (
              <p className="text-xs text-white/50 mt-0.5">y {novedades.length - 1} más desde tu última visita</p>
            )}
            {!ultima && (
              <p className="text-xs text-white/50 mt-0.5">Actualizá para trabajar con la última versión.</p>
            )}
            {ultima && (
              <button onClick={() => setAbierto((v) => !v)} className="mt-1 text-xs text-white/60 underline">
                {abierto ? 'Ocultar el detalle' : '¿Qué incluye?'}
              </button>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              onClick={actualizar}
              disabled={trabajando}
              className="rounded-lg bg-[#B82D25] px-3.5 py-1.5 text-sm font-medium text-white active:scale-95 disabled:opacity-50"
            >
              {trabajando ? 'Actualizando…' : 'Actualizar ahora'}
            </button>
            <button onClick={despues} className="text-xs text-white/45 hover:text-white/70">
              Ahora no
            </button>
          </div>
        </div>

        {abierto && ultima && (
          <div className="border-t border-white/10 bg-white/5 px-4 py-3 max-h-[40vh] overflow-y-auto">
            {novedades.map((n) => (
              <div key={n.id} className="mb-3 last:mb-0">
                <p className="text-xs font-semibold text-white/85">
                  {n.titulo}
                  <span className="ml-2 font-normal text-white/40">{new Date(n.publicada_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
                </p>
                <ul className="mt-1 space-y-0.5 pl-4 text-xs text-white/70 list-disc">
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
