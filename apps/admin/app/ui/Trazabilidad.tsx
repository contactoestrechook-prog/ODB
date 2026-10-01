'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Etiqueta, Modal, Pestanas, Tarjeta, TarjetaCabecera, clasesBoton } from './kit';
import { fechaHora, pesos } from '../lib/formato';

// Lo que en una ISO 9001 sería el "control de registros": cada compra tiene que
// poder reconstruirse de punta a punta, y lo que quedó a medias tiene que
// saltar a la vista. Los huecos van primero porque son los que hay que
// trabajar; el libro de documentos es la consulta.
const cuando = (s?: string | null) => fechaHora(s, { conAnio: true });
// enlace a un PDF dentro de la cadena: 44 px de alto en el celular
const LINK_PDF = 'inline-flex min-h-11 items-center text-sm font-medium text-marca-hondo underline underline-offset-2 sm:min-h-0 sm:text-xs';

const TIPOS: Record<string, string> = {
  orden_compra: 'Orden de compra',
  orden_pago: 'Orden de pago',
  recibo_cobranza: 'Recibo',
  recepcion: 'Acta de recepción',
};
const RUTA_PDF: Record<string, string> = {
  orden_compra: 'oc', orden_pago: 'op', recibo_cobranza: 'recibo', recepcion: 'remito',
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
      linea: (x) => `#${x.numero} · ${x.proveedor ?? '—'} · ${pesos(x.total ?? 0)} · hace ${x.dias} días`,
    },
    {
      clave: 'sinFactura', titulo: 'Mercadería recibida sin factura',
      porque: 'Entró stock y la deuda con el proveedor todavía no está cargada.',
      linea: (x) => `Remito ${x.numero || 's/n'} · ${x.proveedor ?? '—'} · hace ${x.dias} días`,
    },
    {
      clave: 'sinConciliar', titulo: 'Facturas sin cruzar contra el remito',
      porque: 'Llegó la mercadería y llegó la factura, pero nadie verificó que digan lo mismo. Se resuelve en Conciliación.',
      linea: (x) => `Remito ${x.numero || 's/n'} · ${x.proveedor ?? '—'} · hace ${x.dias} días`,
    },
    {
      clave: 'sinRespaldo', titulo: 'Facturas sin orden ni remito',
      porque: 'Se va a pagar algo que nadie contó contra un pedido.',
      linea: (x) => `${x.numero} · ${x.proveedor ?? '—'} · ${pesos(x.monto ?? 0)} · hace ${x.dias} días`,
    },
    {
      clave: 'vencidas', titulo: 'Facturas vencidas impagas',
      porque: 'Vencieron y siguen con saldo.',
      linea: (x) => `${x.numero} · ${x.proveedor ?? '—'} · debe ${pesos(x.saldo ?? 0)} · vencida hace ${x.dias} días`,
    },
  ];

  const total = huecos ? bloques.reduce((s, b) => s + (huecos[b.clave]?.length ?? 0), 0) : 0;

  const tituloCadena =
    cadena && !cadena.cargando && !cadena.error ? `Orden #${cadena.orden?.numero}` : 'Cadena de la orden';

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta/60">
        Cada compra, de la orden al pago: quién la hizo, quién la aprobó, quién la recibió y con qué papel.
      </p>

      <Pestanas
        etiquetaAccesible="Vistas de trazabilidad"
        valor={vista}
        onCambiar={setVista}
        opciones={(['huecos', 'libro'] as const).map((v) => ({
          valor: v,
          etiqueta: v === 'huecos' ? 'Qué falta cerrar' : 'Documentos emitidos',
        }))}
      />

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && <Cargando />}

      {vista === 'huecos' && huecos && !cargando && (
        <>
          {total === 0 ? (
            <Aviso tono="ok">Cadena completa: no hay pasos abiertos en los últimos 90 días.</Aviso>
          ) : (
            <Tarjeta>
              <p className="text-sm text-tinta">
                <b className="importe">{total}</b> {total === 1 ? 'caso abierto' : 'casos abiertos'} en los últimos 90 días.
              </p>
            </Tarjeta>
          )}

          {bloques.map((b) => {
            const filas = huecos[b.clave] ?? [];
            if (!filas.length) return null;
            return (
              <Tarjeta key={b.clave} relleno={false}>
                <TarjetaCabecera
                  titulo={<>{b.titulo} <span className="importe font-medium text-tinta/60">({filas.length})</span></>}
                  sub={b.porque}
                />
                <ul className="divide-y divide-black/[0.06]">
                  {filas.slice(0, 30).map((x: any) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                      <p className="min-w-0 flex-1 break-words text-sm text-tinta">{b.linea(x)}</p>
                      {b.accion && (
                        <Boton variante="secundario" tamano="chico" onClick={() => b.accion!(x)}>
                          Ver cadena
                        </Boton>
                      )}
                    </li>
                  ))}
                </ul>
                {filas.length > 30 && (
                  <p className="border-t border-black/[0.06] px-4 py-3 text-xs text-tinta/60 sm:px-5">y {filas.length - 30} más.</p>
                )}
              </Tarjeta>
            );
          })}
        </>
      )}

      {vista === 'libro' && !cargando && (
        <Tarjeta relleno={false}>
          <TarjetaCabecera
            titulo="Documentos emitidos"
            sub="Numeración propia de la casa. Un documento nunca se renumera: si se vuelve a imprimir, sale con el mismo folio."
          />
          {libro.length === 0 ? (
            <p className="px-4 py-4 text-sm text-tinta/60 sm:px-5">Todavía no se emitió ningún documento.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {libro.map((d: any) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-tinta"><b>{d.folio}</b> · {TIPOS[d.tipo] ?? d.tipo}</p>
                    <p className="text-xs text-tinta/60">{cuando(d.emitido_en)} · {d.emitidoPor ?? '—'}</p>
                  </div>
                  <a
                    href={`/api/documento?tipo=${RUTA_PDF[d.tipo] ?? 'oc'}&id=${d.entidad_id}`}
                    target="_blank" rel="noreferrer"
                    className={clasesBoton({ variante: 'secundario', tamano: 'chico' })}>
                    Ver PDF
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}

      <Modal
        abierto={Boolean(cadena)}
        onCerrar={() => setCadena(null)}
        titulo={tituloCadena}
        descripcion={cadena && !cadena.cargando && !cadena.error ? `${cadena.orden?.proveedor ?? '—'} · ${pesos(cadena.orden?.total ?? 0)}` : undefined}
        ancho="ancho"
      >
        {cadena && (cadena.cargando ? <Cargando /> : cadena.error ? (
          <Aviso tono="error">{cadena.error}</Aviso>
        ) : (
          <>
            {cadena.completa
              ? <Aviso tono="ok">Cadena completa.</Aviso>
              : <Aviso tono="error">{`${cadena.faltan} paso${cadena.faltan === 1 ? '' : 's'} sin cerrar.`}</Aviso>}
            <ol className="mt-4 space-y-0">
              {cadena.pasos.map((p: any, i: number) => (
                <li key={i} className="relative flex gap-3 pb-5 pl-1">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${p.estado === 'hecho' ? 'bg-ok' : p.estado === 'rechazado' ? 'bg-marca' : 'bg-tinta/20'}`} />
                  {i < cadena.pasos.length - 1 && <span className="absolute left-[9px] top-4 h-full w-px bg-black/10" />}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tinta">
                      <b>{p.paso}</b>
                      {p.folio && <Etiqueta tono="neutro">{p.folio}</Etiqueta>}
                    </p>
                    <p className="break-words text-xs text-tinta/60">
                      {p.detalle}
                      {p.quien && ` · ${p.quien}`}
                      {p.cuando && ` · ${cuando(p.cuando)}`}
                    </p>
                    <div className="flex flex-wrap gap-x-4">
                      {p.paso === 'Orden de compra' && (
                        <a href={`/api/documento?tipo=oc&id=${cadena.orden.id}`} target="_blank" rel="noreferrer" className={LINK_PDF}>ver orden en PDF</a>
                      )}
                      {p.remitoId && (
                        <a href={`/api/documento?tipo=remito&id=${p.remitoId}`} target="_blank" rel="noreferrer" className={LINK_PDF}>ver acta de recepción</a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ))}
      </Modal>
    </div>
  );
}
