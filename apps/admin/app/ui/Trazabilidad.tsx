'use client';

import { useCallback, useEffect, useState } from 'react';

// Lo que en una ISO 9001 sería el "control de registros": cada compra tiene que
// poder reconstruirse de punta a punta, y lo que quedó a medias tiene que
// saltar a la vista. Los huecos van primero porque son los que hay que
// trabajar; el libro de documentos es la consulta.
const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const cuando = (s?: string | null) =>
  s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const TIPOS: Record<string, string> = {
  orden_compra: 'Orden de compra',
  recibo_cobranza: 'Recibo',
  recepcion: 'Acta de recepción',
};

type Huecos = {
  sinRecepcion: any[]; sinFactura: any[]; sinConciliar: any[]; sinRespaldo: any[]; vencidas: any[];
};

export function Trazabilidad() {
  const [vista, setVista] = useState<'huecos' | 'libro'>('huecos');
  const [huecos, setHuecos] = useState<Huecos | null>(null);
  const [libro, setLibro] = useState<any[]>([]);
  const [cadena, setCadena] = useState<any | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await fetch(`/api/trazabilidad?vista=${vista}`);
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude consultar la API'); return; }
      if (vista === 'huecos') setHuecos(d); else setLibro(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setCargando(false);
    }
  }, [vista]);

  useEffect(() => { cargar(); }, [cargar]);

  const verCadena = async (ocId: string) => {
    setCadena({ cargando: true });
    const r = await fetch(`/api/trazabilidad?vista=cadena&ocId=${encodeURIComponent(ocId)}`);
    const d = await r.json();
    setCadena(r.ok ? d : { error: d?.message ?? 'No pude armar la cadena' });
  };

  const bloques: { clave: keyof Huecos; titulo: string; porque: string; accion?: (x: any) => void; linea: (x: any) => string }[] = [
    {
      clave: 'sinRecepcion', titulo: 'Órdenes sin recepción',
      porque: 'Se pidió la mercadería y nadie registró que haya llegado.',
      accion: (x) => verCadena(x.id),
      linea: (x) => `#${x.numero} · ${x.proveedor ?? '—'} · ${pesos(x.total)} · hace ${x.dias} días`,
    },
    {
      clave: 'sinFactura', titulo: 'Mercadería recibida sin factura',
      porque: 'Entró stock y la deuda con el proveedor todavía no está cargada.',
      linea: (x) => `Remito ${x.numero || 's/n'} · ${x.proveedor ?? '—'} · hace ${x.dias} días`,
    },
    {
      clave: 'sinConciliar', titulo: 'Facturas sin cruzar contra el remito',
      porque: 'Llegó la mercadería y llegó la factura, pero nadie verificó que digan lo mismo.',
      linea: (x) => `Remito ${x.numero || 's/n'} · ${x.proveedor ?? '—'} · hace ${x.dias} días`,
    },
    {
      clave: 'sinRespaldo', titulo: 'Facturas sin orden ni remito',
      porque: 'Se va a pagar algo que nadie contó contra un pedido.',
      linea: (x) => `${x.numero} · ${x.proveedor ?? '—'} · ${pesos(x.monto)} · hace ${x.dias} días`,
    },
    {
      clave: 'vencidas', titulo: 'Facturas vencidas impagas',
      porque: 'Vencieron y siguen con saldo.',
      linea: (x) => `${x.numero} · ${x.proveedor ?? '—'} · debe ${pesos(x.saldo)} · vencida hace ${x.dias} días`,
    },
  ];

  const total = huecos ? bloques.reduce((s, b) => s + (huecos[b.clave]?.length ?? 0), 0) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-black">Trazabilidad</h1>
          <p className="text-xs text-black/50">
            Cada compra, de la orden al pago: quién la hizo, quién la aprobó, quién la recibió y con qué papel.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['huecos', 'libro'] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${vista === v ? 'bg-black text-white' : 'bg-white text-black/60 hover:bg-black/5'}`}>
              {v === 'huecos' ? 'Qué falta cerrar' : 'Documentos emitidos'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl bg-white p-4 text-sm text-[#B82D25]">{error}</p>}
      {cargando && <p className="text-sm text-black/40">Cargando…</p>}

      {vista === 'huecos' && huecos && !cargando && (
        <>
          <div className={`rounded-2xl p-4 ${total === 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-white shadow-sm'}`}>
            <p className={`text-sm ${total === 0 ? 'text-emerald-800' : 'text-black'}`}>
              {total === 0
                ? 'Cadena completa: no hay pasos abiertos en los últimos 90 días.'
                : <><b>{total}</b> {total === 1 ? 'caso abierto' : 'casos abiertos'} en los últimos 90 días.</>}
            </p>
          </div>

          {bloques.map((b) => {
            const filas = huecos[b.clave] ?? [];
            if (!filas.length) return null;
            return (
              <section key={b.clave} className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-black">{b.titulo} <span className="text-black/40">({filas.length})</span></h2>
                <p className="mt-0.5 text-[11px] text-black/45">{b.porque}</p>
                <div className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10">
                  {filas.slice(0, 30).map((x: any) => (
                    <div key={x.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <p className="min-w-0 truncate text-sm text-black">{b.linea(x)}</p>
                      {b.accion && (
                        <button onClick={() => b.accion!(x)} className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs text-black/70 hover:bg-black/5">
                          Ver cadena
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {filas.length > 30 && <p className="mt-2 text-[11px] text-black/40">y {filas.length - 30} más.</p>}
              </section>
            );
          })}
        </>
      )}

      {vista === 'libro' && !cargando && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-black">Documentos emitidos</h2>
          <p className="mt-0.5 text-[11px] text-black/45">
            Numeración propia de la casa. Un documento nunca se renumera: si se vuelve a imprimir, sale con el mismo folio.
          </p>
          {libro.length === 0 ? (
            <p className="mt-3 text-sm text-black/40">Todavía no se emitió ningún documento.</p>
          ) : (
            <div className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10">
              {libro.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-black"><b>{d.folio}</b> · {TIPOS[d.tipo] ?? d.tipo}</p>
                    <p className="text-[11px] text-black/45">{cuando(d.emitido_en)} · {d.emitidoPor ?? '—'}</p>
                  </div>
                  <a
                    href={`/api/documento?tipo=${d.tipo === 'orden_compra' ? 'oc' : d.tipo === 'recibo_cobranza' ? 'recibo' : 'remito'}&id=${d.entidad_id}`}
                    target="_blank" rel="noreferrer"
                    className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs text-black/70 hover:bg-black/5">
                    Ver PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {cadena && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => setCadena(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            {cadena.cargando ? <p className="text-sm text-black/40">Cargando…</p> : cadena.error ? (
              <p className="text-sm text-[#B82D25]">{cadena.error}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-black">Orden #{cadena.orden?.numero}</h3>
                    <p className="text-xs text-black/50">{cadena.orden?.proveedor ?? '—'} · {pesos(cadena.orden?.total)}</p>
                  </div>
                  <button onClick={() => setCadena(null)} className="rounded-full px-2 text-black/40 hover:text-black">✕</button>
                </div>
                <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${cadena.completa ? 'bg-emerald-50 text-emerald-800' : 'bg-[#FDF3F2] text-[#B82D25]'}`}>
                  {cadena.completa ? 'Cadena completa.' : `${cadena.faltan} paso${cadena.faltan === 1 ? '' : 's'} sin cerrar.`}
                </p>
                <ol className="mt-4 space-y-0">
                  {cadena.pasos.map((p: any, i: number) => (
                    <li key={i} className="relative flex gap-3 pb-5 pl-1">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${p.estado === 'hecho' ? 'bg-emerald-500' : p.estado === 'rechazado' ? 'bg-[#B82D25]' : 'bg-black/20'}`} />
                      {i < cadena.pasos.length - 1 && <span className="absolute left-[9px] top-4 h-full w-px bg-black/10" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-black">
                          <b>{p.paso}</b>
                          {p.folio && <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-[10px] tracking-wide text-black/60">{p.folio}</span>}
                        </p>
                        <p className="text-[11px] text-black/50">
                          {p.detalle}
                          {p.quien && ` · ${p.quien}`}
                          {p.cuando && ` · ${cuando(p.cuando)}`}
                        </p>
                        {p.paso === 'Orden de compra' && (
                          <a href={`/api/documento?tipo=oc&id=${cadena.orden.id}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#B82D25] underline">ver orden en PDF</a>
                        )}
                        {p.remitoId && (
                          <a href={`/api/documento?tipo=remito&id=${p.remitoId}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#B82D25] underline">ver acta de recepción</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
