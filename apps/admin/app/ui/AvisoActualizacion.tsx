'use client';

import { useEffect, useState } from 'react';

// Aviso de actualización: cuando el sistema cambió, cada persona ve una sola
// vez qué incluye la novedad y un botón para recargar y tomar la versión nueva.
// Sin esto, la gente sigue con la pantalla vieja abierta y "no le anda" algo
// que ya está arreglado.
type Novedad = { id: string; version: string; titulo: string; detalle: string[]; requiere_recarga: boolean; publicada_en: string };

export function AvisoActualizacion() {
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch('/api/novedades', { cache: 'no-store' });
        if (!r.ok) return;
        const xs: Novedad[] = await r.json();
        if (vivo && Array.isArray(xs) && xs.length) setNovedades(xs);
      } catch { /* sin red: no molesta */ }
    };
    cargar();
    // mientras el panel queda abierto horas, chequea cada 5 minutos si hay algo nuevo
    const t = setInterval(cargar, 5 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (!novedades.length) return null;
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
    // recarga dura: se saltea el caché para que baje la versión nueva del panel
    window.location.reload();
  }

  async function despues() {
    // "ahora no": se guarda como vista para no insistir; la app la toma igual
    // en la próxima recarga que haga la persona por su cuenta
    await marcarVistas();
    setNovedades([]);
  }

  return (
    <div className="fixed left-1/2 top-3 z-[60] w-[min(92vw,560px)] -translate-x-1/2">
      <div className="rounded-xl bg-black text-[#F0EBE2] shadow-2xl ring-1 ring-white/10 overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#B82D25] text-sm">↻</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#C9A96E] font-bold">Actualización del sistema</p>
            <p className="text-sm font-semibold mt-0.5">{ultima.titulo}</p>
            {novedades.length > 1 && (
              <p className="text-xs text-white/50 mt-0.5">y {novedades.length - 1} más desde tu última visita</p>
            )}
            <button onClick={() => setAbierto((v) => !v)} className="mt-1 text-xs text-white/60 underline">
              {abierto ? 'Ocultar el detalle' : '¿Qué incluye?'}
            </button>
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

        {abierto && (
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
