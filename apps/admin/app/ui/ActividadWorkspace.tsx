'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, FOCO, ROTULO, Selector, Tarjeta, unir, Vacio } from './kit';

// QUIÉN HIZO QUÉ (Leandro, 6/10/2026: "en dónde nos quedan los datos de quién
// hizo cada cosa"). Todo lo que tiene autor en el sistema, en una sola lista:
// pedidos (quién lo tomó, preparó, entregó o canceló), compras (quién creó,
// aprobó, rechazó o envió una orden; quién cargó una factura), caja (quién
// abrió, cerró y con qué diferencia), stock, cobros, firmas y avisos atendidos.
// Lo arma actividad_equipo() en la base (db/migracion-actividad-equipo.sql).

type Fila = { cuando: string; usuarioId: string; quien: string; area: string; accion: string; detalle: string | null; link: string | null };
type Respuesta = { desde: string; hasta: string; filas: Fila[]; recortado: boolean; personas: { id: string; nombre: string }[]; areas: string[] };

const PERIODOS = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: '7', etiqueta: '7 días' },
  { valor: '30', etiqueta: '30 días' },
  { valor: '90', etiqueta: '90 días' },
];
const ZONA = 'America/Argentina/Buenos_Aires';

function desdeDe(periodo: string): string {
  if (periodo === 'hoy') {
    // las 0 h de hoy en Buenos Aires
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
    return new Date(`${hoy}T00:00:00-03:00`).toISOString();
  }
  return new Date(Date.now() - Number(periodo) * 86400_000).toISOString();
}
const diaDe = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(iso));
const tituloDia = (dia: string) => {
  const hoy = diaDe(new Date().toISOString());
  const ayer = diaDe(new Date(Date.now() - 86400_000).toISOString());
  if (dia === hoy) return 'Hoy';
  if (dia === ayer) return 'Ayer';
  const t = new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });

export function ActividadWorkspace() {
  const [periodo, setPeriodo] = useState('7');
  const [persona, setPersona] = useState('');
  const [area, setArea] = useState('');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const q = new URLSearchParams({ desde: desdeDe(periodo) });
      if (persona) q.set('usuario', persona);
      if (area) q.set('area', area);
      const r = await fetch(`/api/actividad?${q}`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !Array.isArray(d.filas)) throw new Error(d?.message ?? 'La API no respondió bien');
      setDatos(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sin conexión');
    } finally {
      setCargando(false);
    }
  }, [periodo, persona, area]);
  useEffect(() => { cargar(); }, [cargar]);

  const porDia = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const f of datos?.filas ?? []) {
      const d = diaDe(f.cuando);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(f);
    }
    return [...m.entries()];
  }, [datos]);

  // cuánto hizo cada uno en el período (con el filtro de área aplicado)
  const resumen = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of datos?.filas ?? []) m.set(f.quien, (m.get(f.quien) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [datos]);

  return (
    <div className="space-y-4">
      <Tarjeta>
        <div className="grid gap-3 sm:grid-cols-[1fr_minmax(0,14rem)]">
          <div className="min-w-0 space-y-2">
            <p className={ROTULO}>Período</p>
            <Chips etiquetaAccesible="Período" valor={periodo} onCambiar={setPeriodo} opciones={PERIODOS} />
          </div>
          <div className="min-w-0 space-y-2">
            <p className={ROTULO}>Persona</p>
            <Selector
              aria-label="Persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              vacio="Todo el equipo"
              opciones={(datos?.personas ?? []).map((p) => ({ valor: p.id, etiqueta: p.nombre }))}
            />
          </div>
        </div>
        {(datos?.areas?.length ?? 0) > 1 && (
          <div className="mt-3 min-w-0 space-y-2">
            <p className={ROTULO}>Área</p>
            <Chips
              etiquetaAccesible="Área"
              valor={area || 'todas'}
              onCambiar={(v) => setArea(v === 'todas' ? '' : v)}
              desplazable
              opciones={[{ valor: 'todas', etiqueta: 'Todas' }, ...(datos?.areas ?? []).map((a) => ({ valor: a, etiqueta: a }))]}
            />
          </div>
        )}
      </Tarjeta>

      {error && <Aviso tono="error" titulo="No pude traer la actividad" accion={<Boton tamano="chico" variante="secundario" onClick={cargar}>Reintentar</Boton>}>{error}</Aviso>}

      {resumen.length > 1 && !persona && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-1">
          {resumen.map(([quien, n]) => (
            <div key={quien} className="min-w-0">
              <p className="importe text-xl font-bold leading-none text-tinta">{n}</p>
              <p className="mt-1 max-w-[10rem] truncate text-xs text-tinta/60">{quien}</p>
            </div>
          ))}
        </div>
      )}

      {cargando && !datos ? (
        <Cargando bloque texto="Juntando quién hizo qué…" />
      ) : !error && porDia.length === 0 ? (
        <Vacio titulo="No hay actividad en este período" texto="Probá con un período más largo o con otra persona. Lo que hace el sistema solo (sin una persona detrás) no aparece acá." />
      ) : (
        <div className={unir('space-y-4', cargando && 'opacity-60')}>
          {porDia.map(([dia, filas]) => (
            <Tarjeta key={dia} relleno={false}>
              <h2 className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-3 text-sm font-semibold text-tinta sm:px-5">
                {tituloDia(dia)}
                <span className="importe text-xs font-medium text-tinta/60">{filas.length}</span>
              </h2>
              <ol>
                {filas.map((f, i) => (
                  <li key={i} className="flex min-w-0 gap-3 border-b border-black/[0.06] px-4 py-3 last:border-0 sm:px-5">
                    <span className="importe w-11 shrink-0 pt-0.5 text-xs text-tinta/60">{hora(f.cuando)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm text-tinta">
                        <b className="font-semibold">{f.quien}</b> · {f.accion}
                      </p>
                      <p className="mt-0.5 min-w-0 break-words text-xs text-tinta/60">
                        {f.area}
                        {f.detalle && <> · {f.detalle.replace(/\$-/g, '-$')}</>}
                      </p>
                    </div>
                    {f.link && (
                      <Link href={f.link} className={unir('shrink-0 self-center rounded-full px-2 py-1 text-xs font-semibold text-marca hover:bg-marca-suave', FOCO)}>
                        Ver
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </Tarjeta>
          ))}
          {datos?.recortado && <p className="px-1 text-xs text-tinta/60">Se muestran las últimas 1.000 acciones. Achicá el período o elegí una persona para ver el resto.</p>}
        </div>
      )}
    </div>
  );
}
