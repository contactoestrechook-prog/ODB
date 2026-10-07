'use client';

import { camposDeLecturaIncompletos } from '../lib/lectura-compras';
import { Dictado } from './Dictado';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { prepararComprobante } from './comprimirImagen';
import { ALICUOTAS_IVA, repartirIva } from '../lib/iva-compras';
import { conversionSugerida } from '../lib/presentacion';
import {
  alCambiarVinculo, conversionBajaDeMas, dejarEnCajas, estadoDelBulto, opcionesDelBulto, pasarAUnidades, precioYaEsDeLaUnidad,
  variacionDeCosto, volverABulto as volverABultoRenglon, volverAPendiente, yaEnUnidades,
} from '../lib/bultos-compras';
import { PanelImpuestos } from './PanelImpuestos';
import {
  Aviso, Boton, CLASES_ENTRADA, Cargando, Etiqueta, FOCO, FOCO_ADENTRO, Girador, IconoAtencion, IconoCerrar, IconoError, IconoInfo, IconoOk, Kpi, Modal as Ventana,
  Pestanas, PlacaRoja, TablaResponsiva, Tarjeta, TarjetaCabecera, Vacio, clasesBoton, unir, useConfirmar, type TonoEtiqueta,
} from './kit';
// `numero` se renombra: OrdenDetalle ya tiene una prop `numero` (el de la OC)
import { fecha, numero as cifra, pesos } from '../lib/formato';

// Mismo redondeo de góndola que aplica el servidor al guardar el precio
// (apps/api/src/compras/precio.ts): a la centena, de 50 para arriba sube. Se
// repite acá para que lo que se ve al cargar sea exactamente lo que queda.
function redondearPrecio(p: number): number {
  const n = Number(p) || 0;
  if (n <= 0) return 0;
  if (n < 100) return Math.round(n);
  return Math.round(n / 100) * 100;
}

// el mismo estado lleva el mismo color en todo el panel (chips <Etiqueta>)
const ESTADO_TONO: Record<string, TonoEtiqueta> = {
  borrador: 'neutro', pendiente_aprobacion: 'atencion',
  aprobada: 'info', enviada: 'info',
  recibida_parcial: 'atencion', recibida: 'ok',
  cancelada: 'neutro',
};
const ESTADO_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', recibida_parcial: 'parcial' };
const OP_TONO: Record<string, TonoEtiqueta> = {
  pendiente_aprobacion: 'atencion', aprobada: 'info',
  pagada: 'ok', rechazada: 'neutro',
};
const OP_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', aprobada: 'aprobada · a pagar', pagada: 'pagada', rechazada: 'rechazada' };

const TABS = [['ordenes', 'Órdenes'], ['aprobar', 'Por aprobar'], ['recepcion', 'Recepción'], ['proveedores', 'Proveedores'], ['pagos', 'Órdenes de pago'], ['sugerencias', 'Sugerencias']] as const;

// los campos sueltos de los formularios de compras: los del kit (44 px y 16 px en el celular)
const input = CLASES_ENTRADA;
// rótulo chico arriba de un campo
const ROTULO_CAMPO = 'mb-1 block text-xs font-medium text-tinta/70';
// campo chico de las filas (cantidad, costo, %): 44 px en el celular, 36 en escritorio.
// La forma va separada del color para poder marcar la remarcación aprendida.
const CAMPO_FILA_BASE = 'block min-h-11 rounded-xl border px-2.5 text-right text-tinta placeholder:text-tinta/40 focus:border-marca focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15 sm:min-h-9 sm:text-sm';
const CAMPO_FILA = 'w-full ' + CAMPO_FILA_BASE;
const CAMPO_FILA_COLOR = 'border-black/15 bg-crema-claro';
// el rótulo de cada dato de una fila: en el celular va arriba del campo; en escritorio lo dice el encabezado
const ROTULO_FILA = 'mb-1 block text-xs text-tinta/60 md:hidden';
// campo blanco (va sobre una caja crema, donde el campo crema del kit no se distingue)
const CAMPO_BLANCO = 'block w-full min-h-11 rounded-xl border border-black/15 bg-white px-3.5 py-2 text-base text-tinta placeholder:text-tinta/40 focus:border-marca focus:outline-none focus:ring-4 focus:ring-marca/15 sm:min-h-10 sm:text-sm';
// botones del visor del documento original (zoom, rotar, ocultar)
const BOTON_VISOR = unir('grid size-11 place-items-center rounded-full text-tinta/70 transition-colors hover:bg-tinta/5 sm:size-8', FOCO);
// acción de texto dentro de una nota (cambiar, deshacer, cancelar): la zona táctil
// se estira con el ::before sin agrandar el renglón
const ENLACE = unir('relative rounded-sm underline underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3', FOCO);
// acción secundaria chica con borde (Buscar otro, No aplicar): 32 px, 44 de zona táctil
const CHIP_ACCION = unir('relative inline-flex min-h-8 items-center rounded-full border border-black/15 bg-white px-3 text-xs text-tinta/70 transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 hover:border-marca hover:text-marca-hondo', FOCO);
// botón ✕ de quitar un renglón (44 px de zona táctil)
const BOTON_QUITAR = unir('grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-marca-suave hover:text-marca-hondo md:size-9', FOCO);

// La IA a veces devuelve la fecha como DD/MM/AAAA: la base solo acepta ISO.
// Si no se puede normalizar con certeza, mejor no mandar nada.
function normFechaIso(f?: string | null): string | undefined {
  if (!f) return undefined;
  const s = String(f).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function ComprasWorkspace({ resumen, ordenes, proveedores, sugerencias, sucursales, categorias = [], abrirProveedor }: {
  resumen: any; ordenes: any[]; proveedores: any[]; sugerencias: any[]; sucursales: any[]; categorias?: { id: string; nombre: string }[];
  // /compras?proveedor=<id>: el aviso a administración abre directo la ficha a completar
  abrirProveedor?: string;
}) {
  const router = useRouter();
  const provAbrir = abrirProveedor ? proveedores.find((p) => p.id === abrirProveedor) : null;
  const [tab, setTab] = useState(provAbrir ? 'proveedores' : 'ordenes');
  const [modal, setModal] = useState<any>(provAbrir ? { tipo: 'proveedor', prov: provAbrir } : null); // {tipo, ...}
  const [deuda, setDeuda] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (tab === 'pagos' && deuda === null) {
      fetch('/api/compras?recurso=deuda').then((r) => r.json()).then((d) => setDeuda(Array.isArray(d) ? d : []));
      fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()).then((d) => setPagos(Array.isArray(d) ? d : []));
    }
  }, [tab]);

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null);
    router.refresh();
    if (tab === 'pagos') {
      const [dd, pp] = await Promise.all([
        fetch('/api/compras?recurso=deuda').then((r) => r.json()),
        fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()),
      ]);
      setDeuda(Array.isArray(dd) ? dd : []);
      setPagos(Array.isArray(pp) ? pp : []);
    }
    return d;
  };

  const porAprobar = ordenes.filter((o) => o.estado === 'pendiente_aprobacion');
  const porRecibir = ordenes.filter((o) => ['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado));

  // --- Bandeja de lectura: hasta 5 facturas a la vez, cada una en su carril ---
  const [bandeja, setBandeja] = useState<any[]>([]);
  const [avisoBandeja, setAvisoBandeja] = useState<string | null>(null);
  const cargarBandeja = async () => {
    try { const r = await fetch('/api/entrada-foto?bandeja=1', { cache: 'no-store' }); if (r.ok) setBandeja(await r.json()); } catch { /* sin red: se reintenta */ }
  };
  useEffect(() => { cargarBandeja(); }, []);
  // se refresca sola mientras haya alguna leyéndose, y cada vez que se cierra un modal
  useEffect(() => {
    if (!bandeja.some((l) => l.estado === 'procesando')) return;
    const t = setInterval(cargarBandeja, 4000);
    return () => clearInterval(t);
  }, [bandeja]);
  useEffect(() => { if (!modal) cargarBandeja(); }, [modal]);
  const abrirLectura = (id: string) => setModal({ tipo: 'entradaFoto', lecturaId: id });
  const descartarLectura = async (id: string) => {
    await fetch('/api/entrada-foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'descartar', id }) }).catch(() => {});
    cargarBandeja();
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs + nueva OC */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi etiqueta="Comprado (mes)" valor={pesos(resumen?.compradoMes ?? 0)} />
        <Kpi etiqueta="A aprobar" valor={resumen?.pendientesAprobacion ?? 0} tono={(resumen?.pendientesAprobacion ?? 0) > 0 ? 'atencion' : 'neutro'} />
        <Kpi etiqueta="Por recibir" valor={resumen?.porRecibir ?? 0} />
        <Kpi etiqueta="Deuda proveedores" valor={pesos(resumen?.deudaProveedores ?? 0)} tono={resumen?.deudaProveedores > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Sugerencias" valor={resumen?.sugerencias ?? 0} className="col-span-2 sm:col-span-1" />
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Boton variante="secundario" onClick={() => setModal({ tipo: 'entradaFoto' })}>Entrada por foto</Boton>
        <Boton variante="secundario" onClick={() => setModal({ tipo: 'entradaDirecta' })}>Entrada directa (sin OC)</Boton>
        <Boton onClick={() => setModal({ tipo: 'nuevaOC', items: [] })}>+ Nueva orden de compra</Boton>
      </div>

      {(bandeja.length > 0 || avisoBandeja) && (
        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Bandeja de lectura" sub="Las facturas se leen en segundo plano. Abrí cada una cuando esté lista." />
          {avisoBandeja && <Aviso tono="neutro" className="mx-4 mt-3 sm:mx-5">{avisoBandeja}</Aviso>}
          <ul className="divide-y divide-black/[0.06]">
            {bandeja.map((l: any) => {
              const seg = Math.max(0, Math.round((Date.now() - new Date(l.creadoEn).getTime()) / 1000));
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-5">
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block min-w-0 break-words text-tinta">{l.nombreArchivo || 'Factura'}{l.releida ? ' · releída con aclaraciones' : ''}</span>
                    {l.estado === 'procesando' && <span className="mt-0.5 flex items-center gap-1.5 text-xs text-tinta/60"><Girador className="size-3.5 shrink-0 text-marca" />leyendo… {seg}s — podés seguir con otra cosa</span>}
                    {l.estado === 'listo' && <span className="mt-0.5 flex items-start gap-1.5 text-xs text-ok"><IconoOk className="mt-px size-3.5 shrink-0" /><span className="min-w-0">lista{l.resumen?.proveedor ? ` · ${l.resumen.proveedor}` : ''}{l.resumen?.numero ? ` · ${l.resumen.numero}` : ''} · {l.resumen?.renglones ?? 0} renglones{l.resumen?.dudas ? ` · ${l.resumen.dudas} duda(s)` : ''}{l.resumen?.total != null ? ` · ${pesos(l.resumen.total)}` : ''}{l.abiertaEn ? ' · ya abierta' : ''}</span></span>}
                    {l.estado === 'error' && <span className="mt-0.5 flex items-start gap-1.5 text-xs text-marca-hondo"><IconoError className="mt-px size-3.5 shrink-0" /><span className="min-w-0">{l.error || 'No se pudo leer'}</span></span>}
                  </span>
                  <span className="flex items-center gap-1">
                    {l.estado === 'listo' && <Boton tamano="chico" onClick={() => abrirLectura(l.id)}>Abrir</Boton>}
                    {l.estado !== 'procesando' && (
                      <button onClick={() => descartarLectura(l.id)} title="Sacar de la bandeja" aria-label="Sacar de la bandeja"
                        className={unir('grid size-11 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-marca-suave hover:text-marca-hondo sm:size-9', FOCO)}>
                        <IconoCerrar className="size-4" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}

      <Pestanas
        aLoAncho
        etiquetaAccesible="Secciones de compras"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => {
          const badge = k === 'aprobar' ? porAprobar.length : k === 'recepcion' ? porRecibir.length : k === 'sugerencias' ? sugerencias.length : 0;
          return { valor: k, etiqueta: label, cuenta: badge ? badge : undefined };
        })}
      />

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      {/* ÓRDENES (todas) */}
      {(tab === 'ordenes' || tab === 'aprobar' || tab === 'recepcion') && (
        <div className="space-y-3">
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).map((o) => (
            <Tarjeta
              key={o.numero}
              onClick={() => setModal({ tipo: 'ocDetalle', ocId: o.id, numero: o.numero })}
              className="cursor-pointer transition-colors hover:bg-crema-claro"
              title="Ver el detalle, los remitos y las facturas de esta compra"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-tinta">OC #{o.numero} · {o.proveedor?.razon_social ?? '—'}
                    <Etiqueta tono={ESTADO_TONO[o.estado] ?? 'neutro'} className="ml-2 align-middle">{ESTADO_LABEL[o.estado] ?? o.estado}</Etiqueta>
                  </p>
                  <p className="mt-0.5 text-xs text-tinta/60">
                    {o.sucursal?.nombre} · {fecha(o.creado_en)} · {(o.items ?? []).length} ítems
                    {o.condicion_pago && ` · ${o.condicion_pago}`}
                    {o.vencimiento_pago && ` · vence ${fecha(o.vencimiento_pago)}`}
                    {o.fecha_entrega && ` · entrega ${fecha(o.fecha_entrega)}`}
                    {o.firmadaPor && ` · aprobó ${o.firmadaPor}`}
                  </p>
                  {o.observaciones && <p className="mt-0.5 break-words text-xs italic text-tinta/60">“{o.observaciones}”</p>}
                  {o.estado === 'cancelada' && o.rechazo_motivo && (
                    <p className="mt-0.5 text-xs text-marca-hondo">
                      Rechazada{o.rechazador?.nombre ? ` por ${o.rechazador.nombre}` : ''}{o.rechazada_en ? ` el ${fecha(o.rechazada_en)}` : ''}: {o.rechazo_motivo}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <p className="importe font-semibold text-tinta">{pesos(o.total ?? 0)}</p>
                  <div className="flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    {o.estado === 'pendiente_aprobacion' && <>
                      <Boton tamano="chico" variante="ok" onClick={() => post({ accion: 'aprobar', id: o.id })}>Aprobar</Boton>
                      <Boton tamano="chico" variante="peligro" onClick={() => setModal({ tipo: 'rechazar', oc: o })}>Rechazar</Boton>
                    </>}
                    {['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado) && <Boton tamano="chico" variante="secundario" onClick={() => setModal({ tipo: 'recibir', oc: o, recibido: {} })}>Recibir</Boton>}
                  </div>
                </div>
              </div>
            </Tarjeta>
          ))}
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).length === 0 && (
            tab === 'aprobar' ? <Vacio titulo="No hay órdenes esperando aprobación." />
              : tab === 'recepcion' ? <Vacio titulo="No hay órdenes pendientes de recepción." />
              : <Vacio titulo="Sin órdenes de compra." texto="Creá una o miralas en Sugerencias." />
          )}
        </div>
      )}

      {/* PROVEEDORES */}
      {tab === 'proveedores' && (
        <div className="space-y-3">
          <div className="flex justify-end"><Boton onClick={() => setModal({ tipo: 'proveedor', prov: {} })}>+ Nuevo proveedor</Boton></div>
          <TablaResponsiva
            etiqueta="Proveedores"
            filas={proveedores}
            claveFila="id"
            vacio={<Vacio titulo="Sin proveedores." texto="Agregá el primero." />}
            columnas={[
              {
                clave: 'proveedor',
                titulo: 'Proveedor',
                principal: true,
                celda: (p: any) => (
                  <div className="min-w-0">
                    <p className="break-words font-medium text-tinta">{p.razon_social}</p>
                    <p className="break-words text-xs font-normal text-tinta/60">{[p.telefono, p.email].filter(Boolean).join(' · ')}</p>
                    {p.faltan?.length > 0 && <p className="text-xs font-normal text-marca-hondo">Para comprarle falta: {p.faltan.join(', ')}</p>}
                  </div>
                ),
              },
              { clave: 'cuit', titulo: 'CUIT', celda: (p: any) => <span className="text-tinta/70">{p.cuit ?? '—'}</span> },
              { clave: 'condicion', titulo: 'Condición', celda: (p: any) => <span className="text-tinta/70">{p.condicion_pago ?? '—'}</span> },
              { clave: 'entrega', titulo: 'Entrega', alinear: 'derecha', celda: (p: any) => <span className="text-tinta/70">{p.lead_time_dias} días{p.lead_time_confirmado ? '' : ' ?'}</span> },
              { clave: 'acciones', titulo: '', acciones: true, celda: (p: any) => <Boton tamano="chico" variante="fantasma" onClick={() => setModal({ tipo: 'proveedor', prov: p })}>Editar</Boton> },
            ]}
          />
        </div>
      )}

      {/* ÓRDENES DE PAGO */}
      {tab === 'pagos' && (
        <div className="space-y-3">
          <div className="flex justify-end"><Boton variante="secundario" onClick={() => setModal({ tipo: 'factura' })}>+ Registrar factura de proveedor</Boton></div>
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Cuentas a pagar (por proveedor)" />
            {deuda === null ? <Cargando bloque />
              : deuda.length === 0 ? <p className="px-4 py-6 text-center text-sm text-tinta/60">Sin facturas pendientes de pago.</p>
              : deuda.map((d) => (
                <div key={d.proveedor?.id} className="border-b border-black/[0.06] px-4 py-3 last:border-0 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0"><p className="break-words font-medium text-tinta">{d.proveedor?.razon_social}</p><p className="text-xs text-tinta/60">{d.facturas.length} factura(s) · próx. vence {fecha(d.facturas[0]?.vencimiento)}</p></div>
                    <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end"><p className="importe font-semibold text-marca-hondo">{pesos(d.total ?? 0)}</p>
                      <Boton tamano="chico" variante="secundario" onClick={() => setModal({ tipo: 'pagar', prov: d })}>Crear orden de pago</Boton></div>
                  </div>
                  {/* cada factura es clickeable para ver su detalle */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.facturas.map((fc: any) => (
                      <button key={fc.id} onClick={() => setModal({ tipo: 'facturaDetalle', facturaId: fc.id })}
                        className={unir('relative inline-flex min-h-9 max-w-full items-center rounded-full border border-black/15 bg-white px-3 text-xs text-tinta/70 transition-colors before:absolute before:inset-x-0 before:-inset-y-1 hover:border-marca hover:text-marca-hondo sm:min-h-8 sm:before:hidden', FOCO)}>
                        <span className="truncate">#{fc.numero} · <span className="importe">{pesos(fc.monto ?? 0)}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </Tarjeta>
          {pagos && pagos.length > 0 && (
            <Tarjeta relleno={false}>
              <TarjetaCabecera titulo="Órdenes de pago" />
              {pagos.map((p) => (
                <div key={p.numero} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-black/[0.06] px-4 py-3 text-sm last:border-0 sm:px-5">
                  <div className="min-w-0">
                    <span className="break-words text-tinta">OP #{p.numero} · {p.proveedor?.razon_social}</span>
                    <Etiqueta tono={OP_TONO[p.estado] ?? 'neutro'} className="ml-2 align-middle">{OP_LABEL[p.estado] ?? p.estado}</Etiqueta>
                    <p className="text-xs text-tinta/60">{p.medio_pago}{p.vencimiento ? ` · vence ${fecha(p.vencimiento)}` : ''}{p.pagada_en ? ` · pagada ${fecha(p.pagada_en)}` : ''}</p>
                    {p.estado === 'rechazada' && (
                      <p className="text-xs text-marca-hondo">
                        Rechazada{p.rechazador?.nombre ? ` por ${p.rechazador.nombre}` : ''}{p.rechazada_en ? ` el ${fecha(p.rechazada_en)}` : ''}{p.rechazo_motivo ? `: ${p.rechazo_motivo}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                    <p className="importe font-medium text-tinta">{pesos(p.total ?? 0)}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      {p.estado === 'pendiente_aprobacion' && <>
                        <Boton tamano="chico" variante="ok" onClick={() => post({ accion: 'aprobarOP', id: p.id })}>Aprobar</Boton>
                        <Boton tamano="chico" variante="peligro" onClick={() => setModal({ tipo: 'rechazarOP', op: p })}>Rechazar</Boton>
                      </>}
                      {p.estado === 'aprobada' && <Boton tamano="chico" variante="secundario" onClick={() => post({ accion: 'pagarOP', id: p.id })}>Marcar pagada</Boton>}
                    </div>
                  </div>
                </div>
              ))}
            </Tarjeta>
          )}
        </div>
      )}

      {/* SUGERENCIAS */}
      {tab === 'sugerencias' && (
        <Tarjeta relleno={false}>
          <TarjetaCabecera
            titulo="Sugerencias de reposición"
            accion={<a href="/analista" className={unir('rounded-sm text-sm font-medium text-marca-hondo hover:underline', FOCO)}>Pedir plan al Analista ODB →</a>}
          />
          {sugerencias.length === 0 ? <p className="px-4 py-6 text-sm text-tinta/60 sm:px-5">Nada para reponer por ahora.</p> : (
            <TablaResponsiva
              sinMarco
              etiqueta="Sugerencias de reposición"
              filas={sugerencias.slice(0, 100)}
              claveFila={(s: any) => `${s.sku}-${s.sucursal}`}
              columnas={[
                { clave: 'producto', titulo: 'Producto', principal: true, celda: (s: any) => <div className="min-w-0"><p className="break-words font-medium text-tinta">{s.producto}</p><p className="text-xs font-normal text-tinta/60">{s.sku}</p></div> },
                { clave: 'sucursal', titulo: 'Sucursal', celda: (s: any) => <span className="text-tinta/70">{s.sucursal}</span> },
                { clave: 'stock', titulo: 'Stock', importe: true, celda: (s: any) => Math.round(Number(s.cantidad)) },
                { clave: 'sugerido', titulo: 'Sugerido', importe: true, celda: (s: any) => <span className="font-medium">{Math.round(Number(s.cantidad_sugerida))} u.</span> },
                { clave: 'proveedor', titulo: 'Proveedor', celda: (s: any) => <span className="text-xs text-tinta/70">{s.proveedor ?? 'sin asignar'}</span> },
              ]}
            />
          )}
        </Tarjeta>
      )}

      {modal && <Modal modal={modal} setModal={setModal} post={post} proveedores={proveedores} sucursales={sucursales} aviso={aviso} categorias={categorias} onLecturasEncoladas={(t: string) => { setAvisoBandeja(t); cargarBandeja(); }} />}
    </div>
  );
}

// Sello: la marca corta que resume el estado de un renglón (CAJA ×12, BONIF. 12%,
// SIN CARGO, REVISAR). Lee de un vistazo lo que antes era un párrafo.
// la etiqueta de precio de los renglones de rebaja (antes, el emoji 🏷️)
function IconoRebaja({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  );
}

function Sello({ tono = 'neutro', children }: { tono?: 'neutro' | 'ok' | 'ojo' | 'info' | 'oro'; children: any }) {
  const t: TonoEtiqueta = tono === 'ok' ? 'ok' : tono === 'ojo' ? 'error' : tono === 'info' ? 'info' : tono === 'oro' ? 'atencion' : 'neutro';
  return <Etiqueta tono={t} className="whitespace-nowrap">{children}</Etiqueta>;
}

function Modal({ modal, setModal, post, proveedores, sucursales, aviso, categorias = [], onLecturasEncoladas }: any) {
  const [f, setF] = useState<any>(modal.prov ?? modal);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const [items, setItems] = useState<any[]>([]);
  const [busca, setBusca] = useState(''); const [sug, setSug] = useState<any[]>([]);
  const [recibido, setRecibido] = useState<Record<string, string>>({});
  const [vencs, setVencs] = useState<Record<string, string>>({}); // vencimiento por sku al recibir → crea el lote
  // Remarcación por producto: la que quedó aprendida de la última entrada de ese
  // proveedor (y la del rubro como respaldo). Se propone en cada renglón para no
  // volver a pedirla cada vez que entra la misma mercadería; se puede editar, y
  // lo que se edite queda aprendido para la próxima.
  const [remarca, setRemarca] = useState<Record<string, { margenPct: number | null; margenRubro: number | null; ultimoCosto: number | null }>>({});
  const [margenPorSku, setMargenPorSku] = useState<Record<string, string>>({});
  // renglones donde el % editado pasa a ser el HABITUAL. Por defecto no: un %
  // distinto al de siempre es una promoción y vale solo para esta entrada.
  const [fijarSku, setFijarSku] = useState<Record<string, boolean>>({});
  // para preguntar antes de una conversión que deja el costo por el piso (6/10/2026)
  const { confirmar, dialogo } = useConfirmar();

  const traerRemarcacion = useCallback(async (proveedorId: string, skus: string[]) => {
    const faltan = skus.filter((sku) => sku && !(sku in remarca));
    if (!faltan.length) return;
    try {
      const r = await fetch(`/api/compras?recurso=remarcacion&proveedorId=${encodeURIComponent(proveedorId ?? '')}&skus=${encodeURIComponent(faltan.join(','))}`);
      if (!r.ok) return;
      const d = await r.json();
      setRemarca((x) => ({ ...x, ...d }));
      // se propone la aprendida; si no hay, el casillero queda vacío y manda el rubro
      setMargenPorSku((m) => {
        const nuevo = { ...m };
        for (const [sku, v] of Object.entries(d as Record<string, any>)) {
          if (nuevo[sku] === undefined && v?.margenPct != null) nuevo[sku] = String(v.margenPct);
        }
        return nuevo;
      });
    } catch { /* si no se puede consultar, se usa el del rubro como siempre */ }
  }, [remarca]);

  // Al abrir "recibir" o "entrada directa", se consulta qué remarcación quedó
  // aprendida para esos productos con ese proveedor y se propone en cada
  // renglón. Es lo que evita tener que acordarse del porcentaje de memoria cada
  // vez que entra la misma mercadería.
  useEffect(() => {
    if (modal?.tipo === 'recibir') {
      const skus = (modal.oc?.items ?? []).map((it: any) => it.producto?.sku).filter(Boolean);
      traerRemarcacion(modal.oc?.proveedor_id ?? '', skus);
    }
  }, [modal, traerRemarcacion]);

  useEffect(() => {
    if (modal?.tipo !== 'entradaDirecta' || !items.length) return;
    traerRemarcacion(f.proveedorId ?? '', items.map((i: any) => i.sku).filter(Boolean));
  }, [modal, items, f.proveedorId, traerRemarcacion]);

  // lo aprendido es POR proveedor: si cambian de proveedor, se olvida lo propuesto
  useEffect(() => {
    if (modal?.tipo !== 'entradaDirecta') return;
    setRemarca({});
    setMargenPorSku({});
  }, [modal?.tipo, f.proveedorId]);

  // Debajo del casillero de %: dice cuál es el habitual, deja volver a él de un
  // toque, y ofrece fijar el nuevo si el cambio vino para quedarse.
  const AvisoMargen = ({ sku, habitualExterno, valor, poner }: { sku: string; habitualExterno?: number | null; valor?: any; poner?: (v: string) => void }) => {
    const info = remarca[sku];
    const habitual = habitualExterno !== undefined ? habitualExterno : info?.margenPct;
    if (habitual == null) return null;
    const puesto = valor !== undefined ? (valor === '' || valor == null ? '' : String(valor)) : (margenPorSku[sku] ?? '');
    const setear = poner ?? ((v: string) => setMargenPorSku((m) => ({ ...m, [sku]: v })));
    if (puesto === '' || Number(puesto) === Number(habitual)) {
      return <p className="mt-0.5 text-right text-xs text-tinta/60">habitual {habitual}%</p>;
    }
    return (
      <p className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs">
        <button onClick={() => setear(String(habitual))} className={unir(ENLACE, 'text-tinta/70')}>
          volver al {habitual}%
        </button>
        <label className="inline-flex min-h-8 items-center gap-1 text-marca-hondo" title="Si no lo tildás, este % vale solo para esta entrada">
          <input type="checkbox" checked={!!fijarSku[sku]} onChange={(e) => setFijarSku((x) => ({ ...x, [sku]: e.target.checked }))} className="size-4 shrink-0 accent-marca" />
          dejarlo fijo
        </label>
      </p>
    );
  };

  const [facturasSel, setFacturasSel] = useState<string[]>(modal.prov?.facturas?.map((x: any) => x.id) ?? []);
  const [importando, setImportando] = useState(false);
  const [importInfo, setImportInfo] = useState<{ conMatch: number; sinMatch: string[] } | null>(null);

  // --- entrada por foto: la IA lee la factura/remito y acá se revisa y confirma ---
  const [foto, setFoto] = useState<any>(null); // resultado de /api/entrada-foto
  const [fotoArchivo, setFotoArchivo] = useState<File | null>(null); // imagen ya comprimida (para re-leer)
  const [verOriginal, setVerOriginal] = useState(true); // mostrar el documento original al lado de lo leído
  const [fotoUrl, setFotoUrl] = useState<string | null>(null); // URL local del archivo, para el visor
  const [fotoEsPdf, setFotoEsPdf] = useState(false); // el visor usa iframe para PDF e <img> para fotos
  const [fotoRot, setFotoRot] = useState(0); // rotación del visor: 0/90/180/270
  const [fotoZoom, setFotoZoom] = useState(1); // zoom del visor
  const [aclaraciones, setAclaraciones] = useState(''); // respuestas del operador a las dudas de la IA
  const [fotoItems, setFotoItems] = useState<any[]>([]); // renglones editables
  const [fotoImp, setFotoImp] = useState<any>({});
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const [segundosLeyendo, setSegundosLeyendo] = useState(0);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null); // foto chica (comprimida por WhatsApp)
  const [sumarIva, setSumarIva] = useState(true); // factura A: costo = neto + IVA
  // Percepciones adentro del costo: es la política de la casa. Se puede sacar
  // para una factura puntual (por ejemplo si esa percepción se va a usar).
  const [percepcionesAlCosto, setPercepcionesAlCosto] = useState(true);
  // Prorrateo de regalos entre el grupo de la promo: decisión del DUEÑO, con
  // su PIN, por factura. Sin autorizar, el regalo solo abarata a su producto.
  const [prorrateoAut, setProrrateoAut] = useState<{ nombre: string } | null>(null);
  const [pinProrrateo, setPinProrrateo] = useState('');
  const [errorProrrateo, setErrorProrrateo] = useState('');
  const [pagada, setPagada] = useState(false);
  // true = la mercadería ya ingresó por Recepción (pistola): solo se registra la
  // factura con sus renglones y va a la bandeja de conciliación, SIN mover stock
  const [soloFactura, setSoloFactura] = useState(false);
  // buscador por renglón para vincular un producto (índice de fila + texto + resultados)
  const [vinculaIdx, setVinculaIdx] = useState<number | null>(null);
  // Renglón al que administración le está cargando los kilos a mano (ver pasarAPesoManual)
  const [pesoEdit, setPesoEdit] = useState<{ idx: number; kg: string; marcarCatalogo: boolean; enCatalogo: boolean | null } | null>(null);
  // Renglón al que administración le indica cuántas unidades trae cada bulto
  const [bultoEdit, setBultoEdit] = useState<{ idx: number; unidades: string } | null>(null);
  const [avisoCatalogo, setAvisoCatalogo] = useState<{ idx: number; texto: string; error?: boolean } | null>(null);
  const [vinculaBusca, setVinculaBusca] = useState('');
  const [vinculaSug, setVinculaSug] = useState<any[]>([]);

  // Primera lectura: comprime la foto en el navegador (las de celular pesan
  // 10-20 MB) y la guarda por si hay que volver a leerla con aclaraciones. El PDF
  // va tal cual.
  async function leerFoto(archivo: File) {
    setAclaraciones('');
    setAvisoFoto(await avisoSiEsChica(archivo));
    const listo = await prepararComprobante(archivo);
    setFotoArchivo(listo);
    await enviarComprobante(listo, '');
  }

  // Segunda pasada: la misma imagen + lo que el operador aclaró sobre las dudas.
  async function reLeerConAclaraciones() {
    if (!aclaraciones.trim()) return;
    if (fotoArchivo) { await enviarComprobante(fotoArchivo, aclaraciones); return; }
    // abierta desde la bandeja: el original está en el servidor, no se vuelve a subir
    if (!foto?.lecturaId) return;
    setLeyendoFoto(true); setSegundosLeyendo(0);
    try {
      const r = await fetch('/api/entrada-foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'releer', id: foto.lecturaId, aclaraciones: aclaraciones.trim() }) });
      const enc = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(enc.message ?? 'No se pudo volver a leer');
      const d = await esperarLectura(enc.lecturaId);
      cargarLecturaEnPantalla({ ...d, lecturaId: enc.lecturaId });
    } catch (e) { setFoto({ error: e instanceof Error ? e.message : 'Error al leer' }); }
    setLeyendoFoto(false);
  }

  // Espera una lectura en segundo plano preguntando cada 3 s (con el contador).
  async function esperarLectura(lecturaId: string): Promise<any> {
    const desde = Date.now();
    for (;;) {
      await new Promise((res) => setTimeout(res, 3000));
      const p = await fetch(`/api/entrada-foto?id=${encodeURIComponent(lecturaId)}`, { cache: 'no-store' });
      const e = await p.json().catch(() => ({ estado: 'procesando' }));
      if (e.estado === 'listo') return e;
      if (e.estado === 'error') throw new Error(e.message ?? 'No se pudo leer el comprobante');
      setSegundosLeyendo(Math.round((Date.now() - desde) / 1000));
      if (Date.now() - desde > 12 * 60_000) throw new Error('La lectura tardó demasiado. Probá de nuevo con la misma foto.');
    }
  }

  // Lo leído (de una foto recién subida o de la bandeja) pasa a la pantalla.
  function cargarLecturaEnPantalla(d: any) {
      setFoto(d);
      setF((x: any) => ({
        ...x,
        proveedorId: d.proveedor?.match?.id ?? '',
        numeroRemito: d.comprobante?.numero ?? '',
      }));
      setFotoImp({ ...(d.impuestos ?? {}) });
      // "Sumar IVA" (solo relevante como fallback cuando no hay pie): arranca en ON
      // únicamente si los renglones parecen NETOS (su suma ≈ el neto gravado), el IVA
      // no es sospechoso y no es régimen especial. En cigarrillos → OFF.
      const sumaLineas = (d.items ?? []).reduce((s: number, i: any) => s + (Number(i.cantidad) || 1) * (Number(i.precio) || 0), 0);
      const netoLeido = d.impuestos?.neto != null ? Number(d.impuestos.neto) : null;
      const ivaLeido = d.impuestos?.iva != null ? Number(d.impuestos.iva) : null;
      const alicEf = netoLeido && netoLeido > 0 && ivaLeido != null ? ivaLeido / netoLeido : null;
      const escala = netoLeido && netoLeido > 0 ? netoLeido : (sumaLineas || 1);
      const dNeto = netoLeido != null ? Math.abs(sumaLineas - netoLeido) / escala : Infinity;
      const ivaSospechoso = alicEf != null && (alicEf < 0.18 || alicEf > 0.23) && !(alicEf >= 0.095 && alicEf <= 0.115);
      setSumarIva(d.comprobante?.tipo === 'factura_a' && dNeto <= 0.01 && !ivaSospechoso && !d.regimenEspecial);
      setPagada(/contado/i.test(d.comprobante?.condicionVenta ?? ''));
      setFotoItems((d.items ?? []).map((i: any) => {
        const sugerido = i.match?.sugerido === true;
        // La interpretación del renglón —bulto, bonificación, peso, corrección
        // de cantidad, descuento— la decide el servidor en UNA función con la
        // precedencia explícita y probada (interpretarRenglon). Acá solo se
        // dibuja. Recalcular en el panel fue la fuente de los últimos bugs:
        // cinco reglas sueltas que se pisaban entre sí.
        const r = i.interpretado ?? {};
        const cantidad = r.cantidad ?? i.cantidad ?? '';
        const porPeso = !!r.porPeso;
        // Factura por unidad suelta y la casa stockea el envase (Ferrero T12): el
        // servidor ya dividió la cantidad; el precio pasa a ser el del envase
        const envase = r.decision === 'unidades_a_envase' && Number(r.cantidadOriginal) > 0 && cantidad > 0
          ? Math.round(Number(r.cantidadOriginal) / cantidad) : null;
        const cantidadCorregida = envase ? null : (r.cantidadOriginal ?? null);
        const bultoConsumido = r.bultoConsumido ?? null;
        return {
          descripcion: i.descripcion,
          cantidad,
          cantidadCorregida,
          bultoConsumido,
          porPeso,
          kg: i.kg ?? null,
          precio: envase && Number(r.precioPropuesto) > 0 ? Number(r.precioPropuesto) : i.precio ?? '',
          envaseAplicado: envase,
          sku: i.match?.sku ?? '',
          nombre: i.match?.nombre ?? null,
          variacionPct: i.match?.variacionPct ?? null,
          sugerido, // la IA lo propuso: hay que confirmar antes de incluir
          motivoIa: i.match?.motivo ?? null,
          // por qué NO se vinculó: medida distinta a la del producto parecido
          avisoMedida: i.avisoMedida ?? null,
          // remarcación: la guardada de la última compra; vacío ('') = hereda del rubro
          margenPct: i.match?.margenPct != null ? i.match.margenPct : '',
          codigo: i.codigo ?? null,
          // Lo que resuelve el lector en código: unidades por bulto, bonificación
          // y si el renglón es una rebaja en vez de mercadería. Este mapeo arma un
          // objeto nuevo, así que un campo que no se copie acá no existe para la
          // pantalla por más que la API lo mande.
          unidadesPorBulto: r.unidadesPorBulto ?? null,
          // El «×N» que el lector NO aplicó porque la evidencia probó que la
          // cantidad ya está en la unidad de stock (o que el producto es la
          // caja), con su porqué; y, si quedó pendiente, qué sugiere la
          // evidencia (6/10/2026: los Doritos de Mapaca).
          bultoDescartado: Number(r.bultoDescartado) > 1 ? Number(r.bultoDescartado) : null,
          bultoDescartadoComo: Number(r.bultoDescartado) > 1 ? (r.razonBulto?.sugerencia === 'caja' ? 'caja' : 'unidades') : null,
          bultoAuto: Number(r.bultoDescartado) > 1,
          razonBulto: r.razonBulto ?? null,
          // de dónde salió el «×N»: la tarjeta dice "la descripción dice ×14"
          // solo si la descripción lo dice (6/10/2026)
          bultoOrigen: i.bultoOrigen ?? null,
          // la del papel, o la que el servidor dedujo del importe (columna "Dto" no leída)
          bonificacionPct: r.bonificacionPct ?? i.bonificacionPct ?? null,
          // si la lectura tomó el importe CON IVA, se usa el neto que dedujo el servidor
          importe: r.importeNeto ?? i.importe ?? null,
          importeConIvaLeido: r.importeNeto != null ? i.importe : null,
          esDescuento: !!i.esDescuento,
          descuentoPct: i.descuentoPct ?? null,
          puedePorPeso: !!i.puedePorPeso,
          // la alícuota impresa, o la que prueba un importe leído con IVA adentro
          alicuotaIva: i.alicuotaIva ?? r.alicuotaDeducida ?? null,
          alicuotaCatalogo: i.match?.alicuotaCatalogo ?? null,
          costoCatalogo: i.match?.costoActual ?? null,
          alicuotaElegida: null,
          bultoAplicado: null,
          // las sugerencias de IA NO se incluyen hasta que el operador confirme "¿es este?"
          // y una rebaja no se incluye NUNCA: no es mercadería
          incluir: !i.esDescuento && !!i.match && !sugerido,
        };
      }));
  }

  // Foto chica (≤1300 px): casi siempre vino comprimida por WhatsApp. Al modelo
  // le cuesta el doble leerla —y es donde cruza filas—: mejor avisar.
  async function avisoSiEsChica(archivo: File): Promise<string | null> {
    if (!/^image\//.test(archivo.type)) return null;
    try {
      const bmp = await createImageBitmap(archivo);
      const lado = Math.max(bmp.width, bmp.height);
      bmp.close?.();
      if (lado <= 1300) return `Esta foto es chica (${lado} px): seguramente vino comprimida por WhatsApp. Sacala con la cámara desde el panel, o mandala por WhatsApp como documento: se lee más rápido y con menos errores.`;
    } catch { /* HEIC u otros que el navegador no decodifica: sin aviso */ }
    return null;
  }

  // Varias fotos a la vez: cada una entra a su carril y la pantalla queda libre.
  async function leerVarias(archivos: File[]) {
    setLeyendoFoto(true);
    let ok = 0; const errores: string[] = [];
    for (const a of archivos.slice(0, 5)) {
      try {
        const listo = await prepararComprobante(a);
        const fd = new FormData(); fd.append('archivo', listo, a.name);
        const r = await fetch('/api/entrada-foto', { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message ?? 'No se pudo cargar');
        ok++;
      } catch (e) { errores.push(`${a.name}: ${e instanceof Error ? e.message : 'error'}`); }
    }
    setLeyendoFoto(false);
    onLecturasEncoladas?.(`${ok} factura(s) en lectura. Podés seguir trabajando: cuando estén listas aparecen en la bandeja de lectura.${errores.length ? ' No se pudo cargar → ' + errores.join(' · ') : ''}`);
    setModal(null);
  }

  // Abrir desde la bandeja: el workspace manda el id; acá se carga la lectura.
  async function abrirDesdeBandeja(id: string) {
    const r = await fetch(`/api/entrada-foto?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.estado !== 'listo') { setFoto({ error: d.message ?? 'Esa lectura todavía no está lista' }); return; }
    setFotoArchivo(null); setFotoUrl(null); setAclaraciones(''); setAvisoFoto(null);
    cargarLecturaEnPantalla({ ...d, lecturaId: id });
    fetch('/api/entrada-foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'abrir', id }) }).catch(() => {});
    // el original está en el servidor: se muestra al lado, como cuando la foto se acaba de subir
    fetch(`/api/entrada-foto?original=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (o?.url) { setFotoUrl(o.url); setFotoEsPdf(!!o.esPdf); setVerOriginal(true); setFotoRot(0); setFotoZoom(1); } })
      .catch(() => {});
  }
  useEffect(() => { if (modal?.tipo === 'entradaFoto' && modal?.lecturaId) abrirDesdeBandeja(modal.lecturaId); }, [modal?.lecturaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviarComprobante(listo: File, aclara: string) {
    setLeyendoFoto(true);
    setSegundosLeyendo(0);
    // la autorización del dueño es POR FACTURA: no puede arrastrarse a la próxima
    setProrrateoAut(null);
    setPinProrrateo('');
    setErrorProrrateo('');
    try {
      const fd = new FormData();
      fd.append('archivo', listo);
      if (aclara.trim()) fd.append('aclaraciones', aclara.trim());
      // La lectura corre en segundo plano: el POST devuelve un id al instante y
      // acá se pregunta por el resultado hasta que está. Antes se esperaba la
      // respuesta del tirón y una factura grande (4-5 min) moría con "upstream
      // error" del gateway, con la lectura ya terminada del lado del servidor.
      const r = await fetch('/api/entrada-foto', { method: 'POST', body: fd });
      const encolado = await r.json();
      if (!r.ok) throw new Error(encolado.message ?? 'No se pudo leer el comprobante');
      const lecturaId = encolado.lecturaId;
      const d: any = lecturaId ? await esperarLectura(lecturaId) : encolado;
      cargarLecturaEnPantalla({ ...d, lecturaId });
    } catch (e) {
      setFoto({ error: e instanceof Error ? e.message : 'Error al leer' });
    }
    setLeyendoFoto(false);
  }

  // --- Costeo por PRORRATEO re-anclado a la mercadería (spec contable) ---
  // El costo unitario reparte el valor de la mercadería (neto + IVA + internos, SIN
  // percepciones) entre los renglones en proporción a su PRE.UNIT. Así se limpia la
  // percepción IIBB embebida (cigarrillos) y desaparece el ×1,21 a ciegas. En una
  // factura A normal con precios netos el factor da 1,21 (suma IVA), y sin pie
  // (remito) cae al fallback del checkbox "Sumar IVA".
  const numImp = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Muchos renglones vienen POR BULTO: "CORONA 355 X 24B", cantidad 84, precio
  // $55.000. Si eso entra tal cual contra el producto suelto, quedan 84
  // unidades a $55.000 en vez de 2.016 a $2.292 — y ese costo pasa derecho al
  // precio de venta. La conversión NO se hace sola: el renglón podría estar
  // vinculado al bulto y ahí multiplicar sería el error al revés.
  //
  // Y el «×N» tampoco quiere decir que la cantidad sean cajas (6/10/2026): los
  // 28 Doritos de Mapaca ya eran unidades. Por eso hay tres salidas —ya vienen
  // en unidades, multiplicar ×N, dejar en cajas— y la cuenta de cada una está
  // en app/lib/bultos-compras.ts, con tests.
  type RenglonFoto = Record<string, unknown>;
  const cambiarRenglon = (idx: number, f: (x: RenglonFoto) => RenglonFoto) =>
    setFotoItems((xs) => xs.map((x, j) => (j === idx ? f(x) : x)));
  const pasarAUnidad = async (idx: number) => {
    // Nada frenaba convertir un renglón que ya estaba en unidades: el total, el
    // IVA y el techo de mercadería dan igual, y el producto quedaba con el
    // costo dividido por N. Si la cuenta deja el costo por el piso contra el
    // catálogo, se pregunta (no se bloquea).
    const x = itemsCalc[idx];
    const n = Math.round(numImp(x?.unidadesPorBulto));
    if (x && conversionBajaDeMas(costoFinal(x, idx), n, x.costoCatalogo)) {
      const cantidadPapel = numImp(x.cantidad);
      const seguro = await confirmar({
        titulo: cantidadPapel === 1 ? `¿El 1 del papel es una caja de ${n}?` : `¿Los ${cantidadPapel.toLocaleString('es-AR')} del papel son cajas de ${n}?`,
        texto: `Al multiplicar por ${n}, el costo baja de ${pesos(costoFinal(x, idx))} a ${pesos(costoFinal(x, idx) / n)} por unidad, y el producto en el catálogo cuesta ${pesos(numImp(x.costoCatalogo))}. Si ya vienen en unidades, cancelá y tocá «Ya vienen en unidades».`,
        textoConfirmar: `Sí, multiplicar ×${n}`,
        textoCancelar: 'Cancelar',
      });
      if (!seguro) return;
    }
    cambiarRenglon(idx, pasarAUnidades);
  };
  const volverABulto = (idx: number) => cambiarRenglon(idx, volverABultoRenglon);
  const marcarYaEnUnidades = (idx: number) => cambiarRenglon(idx, yaEnUnidades);
  const marcarEnCajas = (idx: number) => cambiarRenglon(idx, dejarEnCajas);
  const deshacerBultoDescartado = (idx: number) => cambiarRenglon(idx, volverAPendiente);
  const discriminaIva = foto?.comprobante?.tipo === 'factura_a';
  // Lo que de verdad se paga por el renglón. Una bonificación del 100% deja el
  // renglón en cero: la mercadería llega igual, pero no se paga. Sin esto, los
  // renglones bonificados inflaban la suma de renglones y, como el costo sale
  // de prorratear el pie sobre esa suma, ABARATABAN también a los productos que
  // sí se pagaron.
  // Lo que REALMENTE cuesta una unidad de este renglón.
  //
  // El orden importa. Manda el importe impreso del renglón, porque ya trae
  // aplicado todo lo de esa fila: es común que el proveedor mande mercadería
  // sin cargo con el precio unitario lleno (el de lista) y el importe en cero.
  // Si no hay columna de importe, se cae al precio unitario menos la
  // bonificación. Y en cualquier caso se le suma el descuento que venga en un
  // renglón aparte.
  // Lo que factura el renglón, por unidad, ANTES de los descuentos de otros
  // renglones. Manda el importe impreso; si no hay columna, el unitario menos
  // la bonificación de la fila.
  const baseUnitaria = (i: any) => {
    const cant = numImp(i.cantidad) || 1;
    return i.importe != null && i.importe !== ''
      ? numImp(i.importe) / cant
      : numImp(i.precio) * (1 - Math.min(100, Math.abs(numImp(i.bonificacionPct))) / 100);
  };

  // Un descuento NO puede ser más grande que el renglón al que se aplica. Si lo
  // es, la rebaja no era de ese renglón solo —suele ser una promoción que cubre
  // varios, o toda la factura— y adjudicársela entera deja el costo por el
  // piso o en negativo. En ese caso no se aplica y se avisa: es preferible que
  // alguien decida a que el sistema invente un costo.
  const descuentoDesmedido = (i: any) => {
    const d = Math.abs(numImp(i._descuento));
    const linea = Math.abs(baseUnitaria(i) * (numImp(i.cantidad) || 1));
    // Igual a la línea (±redondeo) NO es desmedido: es el renglón sin cargo,
    // y sigue el circuito de regalos (prorrateo con PIN del dueño).
    return d > 0 && linea > 0 && d > linea + Math.max(0.05, linea * 0.001);
  };

  const precioEfectivo = (i: any) => {
    const cant = numImp(i.cantidad) || 1;
    const base = baseUnitaria(i);
    if (descuentoDesmedido(i)) return base; // sin aplicar: hay que revisarlo a mano
    return Math.max(0, base + numImp(i._descuento) / cant);
  };
  // Producto por PESO (fiambres, quesos fraccionados): la factura trae CANT=1
  // (una horma), pero el precio es POR KILO y el importe del renglón = peso ×
  // precio. Si se deja cantidad=1, ese precio/kilo se reconcilia contra el pie
  // hasta el TOTAL de la horma y el costo entra inflado. El peso real sale de
  // dividir el importe del renglón por el precio unitario.
  const pesoDelImporte = (i: any) => {
    const imp = Math.abs(numImp(i.importe));
    const p = Math.abs(numImp(i.precio));
    return imp > 0 && p > 0 ? imp / p : 0;
  };
  const medidaVariable = (i: any) => {
    // Que la cuenta no cierre tiene varias explicaciones; el peso es solo una,
    // y para una bebida es imposible. Sin esto, una lata de 1000ml se ofrecía
    // cargar como 24 kg.
    if (!i.puedePorPeso) return false;
    if (i._esDescuento || numImp(i._descuento) !== 0) return false;
    // Una bonificación en el propio renglón ya explica por qué el importe no da
    // cantidad × precio, y lo explica MEJOR que el peso. Un vino bonificado al
    // 50% deja importe ÷ precio = 0,5, que leído como peso es "medio kilo".
    if (numImp(i.bonificacionPct) > 0) return false;
    if (numImp(i.unidadesPorBulto) > 1 || numImp(i.bultoAplicado) > 1 || numImp(i.bultoDescartado) > 1) return false; // eso es bulto, no peso
    const imp = Math.abs(numImp(i.importe));
    const cant = numImp(i.cantidad);
    const p = Math.abs(numImp(i.precio));
    if (!(imp > 0 && p > 0 && cant > 0)) return false;
    const esperado = cant * p;
    if (esperado <= 0) return false;
    // el importe representa bastante más (o menos) que cantidad × precio, y el
    // peso que implica no coincide con la cantidad leída → el precio es por kilo
    return Math.abs(imp - esperado) / esperado > 0.02 && Math.abs(pesoDelImporte(i) - cant) > 0.01;
  };
  const pasarAPeso = (idx: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx) return x;
    const p = Math.abs(numImp(x.precio));
    const imp = Math.abs(numImp(x.importe));
    const kilos = p > 0 ? Math.round((imp / p) * 1000) / 1000 : numImp(x.cantidad);
    return { ...x, cantidad: kilos, porPeso: true };
  }));

  // ⚖️ POR PESO A MANO (2026-09-15)
  // Hay facturas que traen la horma como "1 × $39.600": la cuenta cierra y no
  // hay columna de kilos, así que nada permite deducir que es por peso. Solo
  // quien recibe sabe cuántos kilos vinieron. Con esos kilos, la cantidad pasa
  // a kg y el costo pasa a ser por kilo (el importe del renglón no cambia).
  // Se guarda lo que había para poder deshacerlo tal cual.
  const pasarAPesoManual = (idx: number, kg: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx || !(kg > 0)) return x;
    const importe = Math.abs(numImp(x.importe)) || numImp(x.cantidad) * Math.abs(numImp(x.precio));
    return {
      ...x,
      antesDePeso: x.antesDePeso ?? { cantidad: x.cantidad, precio: x.precio, importe: x.importe },
      cantidad: Math.round(kg * 1000) / 1000,
      precio: Math.round((importe / kg) * 100) / 100,
      importe,
      porPeso: true,
      cantidadCorregida: null,
      bultoConsumido: null,
    };
  }));
  // Abre el editor de kilos y averigua cómo está el producto en el catálogo:
  // si ya se vende por peso no hay nada que marcar.
  const abrirPesoEdit = async (idx: number, sku: string) => {
    if (pesoEdit?.idx === idx) { setPesoEdit(null); return; }
    setBultoEdit(null);
    setPesoEdit({ idx, kg: '', marcarCatalogo: true, enCatalogo: null });
    if (!sku) return;
    try {
      const r = await fetch('/api/producto/por-peso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku }) });
      const d = await r.json();
      if (r.ok) setPesoEdit((e) => (e && e.idx === idx ? { ...e, enCatalogo: !!d.vendidoPorPeso, marcarCatalogo: !d.vendidoPorPeso } : e));
    } catch {}
  };
  // Aplica los kilos y, si se pidió, deja el producto "vendido por peso" en el
  // catálogo para que caja y stock queden en la misma unidad que la compra.
  const confirmarPeso = async (idx: number, sku: string, nombre: string) => {
    if (!pesoEdit || !(Number(pesoEdit.kg) > 0)) return;
    const marcar = pesoEdit.marcarCatalogo && pesoEdit.enCatalogo !== true && !!sku;
    pasarAPesoManual(idx, Number(pesoEdit.kg));
    setPesoEdit(null);
    if (!marcar) return;
    try {
      const r = await fetch('/api/producto/por-peso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, porPeso: true }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'no se pudo marcar');
      setAvisoCatalogo({ idx, texto: `«${nombre}» quedó vendido por peso en el catálogo: la caja lo cobra por kilo.` });
    } catch (e) {
      setAvisoCatalogo({ idx, texto: `Los kilos se aplicaron, pero no se pudo marcar el producto en el catálogo (${e instanceof Error ? e.message : 'error'}).`, error: true });
    }
  };

  // 📦 BULTO A MANO (2026-09-15): "HWN DISPLAY MOGUL COLMILLO 12 x" = 3 displays
  // de 12. Cuando el detector no lo lee, administración dice cuántas unidades
  // trae cada bulto y el renglón pasa a unidades sueltas con su costo unitario.
  // Reusa bultoAplicado, así "deshacer" funciona igual que en la conversión automática.
  // 📦 ARMAR ENVASES (2026-09-15): lo inverso de "pasar a unidades". Ferrero
  // factura el bocadito ($827) y la casa vende la caja x3/x8/x12/x24: 60
  // bocaditos = 5 cajas de 12 a $9.930. El importe del renglón no cambia.
  const armarEnvases = (idx: number, n: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx || !(n > 1)) return x;
    const cant = numImp(x.cantidad);
    if (!(cant > 0) || !Number.isInteger(cant / n)) return x;
    return { ...x, cantidad: cant / n, precio: Math.round(numImp(x.precio) * n * 100) / 100, envaseAplicado: n, cantidadCorregida: null };
  }));
  const deshacerEnvases = (idx: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx) return x;
    const n = Math.round(numImp(x.envaseAplicado));
    if (!(n > 1)) return x;
    return { ...x, cantidad: numImp(x.cantidad) * n, precio: Math.round((numImp(x.precio) / n) * 100) / 100, envaseAplicado: null };
  }));
  // ¿La factura viene en otra unidad que la del stock? (cajas de Ferrero,
  // congelados por kilo empaquetados de 250 g). La cuenta está en
  // app/lib/presentacion.ts, con tests; acá solo se ofrece.
  // Un renglón "ya en unidades" (el «×N» era lo que trae la caja) también
  // entra: es justo cuando la cantidad son unidades sueltas, y si el producto
  // vinculado es la caja de N hay que armar cajas. Antes se apagaba y los 28
  // Doritos vinculados a la caja de 14 entraban como 28 cajas sin ningún botón
  // para arreglarlo (6/10/2026). "Dejar en cajas" sí queda afuera.
  const sugerirConversion = (i: any) => {
    if (!i.sku || i._esDescuento || i.porPeso || numImp(i.envaseAplicado) > 1 || numImp(i.paqueteAplicado) > 0
      || numImp(i.bultoAplicado) > 1 || numImp(i.unidadesPorBulto) > 1 || estadoDelBulto(i) === 'caja') return null;
    return conversionSugerida({
      descripcion: i.descripcion,
      nombreCatalogo: i.nombre,
      cantidad: numImp(i.cantidad),
      precio: numImp(i.precio),
      costoCatalogo: i.costoCatalogo,
      cantidadEnUnidades: estadoDelBulto(i) === 'ya_en_unidades',
    });
  };
  // kilos facturados → paquetes de N gramos (y su vuelta atrás)
  const pasarAPaquetes = (idx: number, gramos: number, cantidadNueva: number, precioNuevo: number) =>
    setFotoItems((xs) => xs.map((x, j) => (j === idx
      ? { ...x, cantidad: cantidadNueva, precio: precioNuevo, paqueteAplicado: gramos, porPeso: false, cantidadCorregida: null }
      : x)));
  const deshacerPaquetes = (idx: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx) return x;
    const g = numImp(x.paqueteAplicado);
    if (!(g > 0)) return x;
    return { ...x, cantidad: numImp(x.cantidad) / (1000 / g), precio: Math.round(numImp(x.precio) * (1000 / g) * 100) / 100, paqueteAplicado: null };
  }));

  const pasarABultoManual = (idx: number, n: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx || !(n > 1)) return x;
    return {
      ...x,
      cantidad: numImp(x.cantidad) * n,
      precio: Math.round((numImp(x.precio) / n) * 100) / 100,
      bultoAplicado: n,
      bultoManual: true,
      unidadesPorBulto: null,
    };
  }));

  const deshacerPeso = (idx: number) => setFotoItems((xs) => xs.map((x, j) => {
    if (j !== idx) return x;
    if (x.antesDePeso) return { ...x, ...x.antesDePeso, porPeso: false, antesDePeso: null };
    return { ...x, cantidad: 1, porPeso: false };
  }));

  // ¿Este renglón vino sin cargo? Es lo que después se prorratea.
  // La factura trae su propia prueba: cantidad × precio unitario tiene que dar
  // el importe del renglón. Cuando el lector toma un número de la fila de al
  // lado —pasa con las columnas apretadas y con las anotaciones a mano que
  // corren el renglón— esa cuenta deja de cerrar. Es lo único que agarra ese
  // error a tiempo, porque el número leído es plausible: es el precio de otro
  // producto de la misma factura.
  // Un renglón de factura SIEMPRE cierra: cantidad × precio da el importe. Si
  // en nuestra lectura no cierra, el que leyó mal es el sistema, no el papel.
  // El importe es el número más confiable —es el que suma al neto del pie—, así
  // que con él se deduce cuál de los otros dos está mal.
  const correccionRenglon = (i: any): { campo: 'cantidad' | 'precio'; valor: number; seguro: boolean } | null => {
    const cantidad = numImp(i.cantidad);
    const precio = numImp(i.precio);
    const importe = i.importe == null || i.importe === '' ? null : Math.abs(numImp(i.importe));
    if (!cantidad || !precio || !importe) return null;
    // estos renglones no cierran por motivos legítimos, no por mala lectura
    if (i._esDescuento || numImp(i._descuento) !== 0) return null;
    if (numImp(i.bonificacionPct) > 0) return null;
    if (i.porPeso || numImp(i.kg) > 0) return null;

    const esperado = cantidad * precio;
    if (Math.abs(importe - esperado) / esperado <= 0.02) return null;

    // Si importe ÷ precio da un entero exacto, ese entero ES la cantidad: nadie
    // compra 24,000 unidades por casualidad. Pasa cuando el lector tomó la
    // cantidad de la fila de al lado. Evidencia dura → se corrige solo.
    const cantidadQueDaria = importe / precio;
    const entero = Math.round(cantidadQueDaria);
    if (entero >= 1 && Math.abs(cantidadQueDaria - entero) <= 0.005 && entero !== cantidad) {
      return { campo: 'cantidad', valor: entero, seguro: true };
    }
    return { campo: 'precio', valor: Math.round((importe / cantidad) * 100) / 100, seguro: false };
  };

  const esSinCargo = (i: any) => !i._esDescuento && numImp(i.cantidad) > 0 && Math.abs(precioEfectivo(i)) < 0.01;

  // Un renglón "Desc. 42,86% - MANOS NEGRAS Malbec" NO es mercadería: es una
  // rebaja sobre el renglón de arriba. Antes se ofrecía vincularlo a un
  // producto, y aceptar esa sugerencia habría cargado 7 unidades a -$22.630.
  // Peor: como la rebaja no se aplicaba, el Malbec entraba a precio de lista,
  // un 43% más caro de lo que se pagó, y ese costo va al precio de venta.
  const esRenglonDescuento = (i: any) => !!i.esDescuento || numImp(i.precio) < 0;
  const soloTexto = (t: any) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Reparte cada renglón de descuento sobre la mercadería que le corresponde.
  // Tres formas, en orden: (1) el descuento NOMBRA un renglón y la cuenta cierra
  // con él; (2) es un descuento de GRUPO (típico de Coca/distribuidores: "Px
  // mágico = 17,2%", "AQ 1.5L = 24,3%") que aplica a TODOS los renglones desde
  // el descuento anterior hasta este, y se reparte proporcional al importe de
  // cada uno; (3) no se puede atribuir → no se aplica y se avisa. El reparto por
  // grupo nunca deja un costo en negativo (cada renglón recibe una fracción de
  // lo suyo) y cierra con el pie por construcción.
  const sinAtribuir: { descripcion: string; importe: number }[] = [];
  const grupoDeDescuento = new Map<number, { n: number; pct: number | null; importe: number }>();
  const base = (x: any) => {
    const cant = numImp(x.cantidad) || 1;
    return x.importe != null && x.importe !== '' ? Math.abs(numImp(x.importe)) : Math.abs(numImp(x.precio) * cant);
  };
  const descuentoPorIdx = (() => {
    const m = new Map<number, number>();
    let ventanaInicio = 0; // primer índice de mercadería de la ventana en curso
    fotoItems.forEach((d: any, j: number) => {
      if (!esRenglonDescuento(d)) return;
      const cerrarVentana = () => { ventanaInicio = j + 1; };
      // El operador decidió no aplicar esta rebaja: la mercadería queda a precio
      // de lista y lo pagado de menos se reparte solo en la reconciliación.
      if (d.noAplicar) return cerrarVentana();
      const importe = d.importe != null && d.importe !== '' && numImp(d.importe) !== 0
        ? numImp(d.importe) : numImp(d.cantidad) * numImp(d.precio);
      if (!importe) return cerrarVentana();
      const abs = Math.abs(importe);
      const textoDesc = soloTexto(d.descripcion);
      const pct = d.descuentoPct != null ? numImp(d.descuentoPct) : null;

      // 1) NOMBRA un renglón puntual (dentro de la ventana) y cierra con él
      let destino = -1;
      for (let k = j - 1; k >= ventanaInicio; k--) {
        if (esRenglonDescuento(fotoItems[k])) continue;
        const nombre = soloTexto(fotoItems[k].descripcion);
        const linea = base(fotoItems[k]);
        // Tolerancia de redondeo: el maní se factura a $760,585, el papel
        // imprime 760,58 y el importe 1.521,17 — una rebaja del 100% "superaba"
        // a la línea por un centavo y quedaba sin atribuir (2026-09-08).
        const cierraUno = linea > 0 && (pct != null ? Math.abs((abs / linea) * 100 - pct) <= 1.5 : abs <= linea + Math.max(0.05, linea * 0.001));
        if (nombre && textoDesc.includes(nombre) && cierraUno) { destino = k; break; }
      }
      if (destino >= 0) { m.set(destino, (m.get(destino) ?? 0) + importe); return cerrarVentana(); }

      // 2) descuento de GRUPO: los renglones de mercadería de la ventana
      const grupo: number[] = [];
      let sumaG = 0;
      for (let k = ventanaInicio; k < j; k++) {
        if (esRenglonDescuento(fotoItems[k])) continue;
        const b = base(fotoItems[k]);
        if (b > 0) { grupo.push(k); sumaG += b; }
      }
      // Se acepta si el descuento es una fracción del grupo y —cuando el papel
      // trae el %— ese % cierra con la suma del grupo (tolerancia amplia para no
      // depender de si la IA leyó la columna con o sin IVA).
      const pctCierra = pct == null || Math.abs(sumaG * (pct / 100) - abs) / abs < 0.06;
      if (grupo.length > 0 && sumaG > 0 && abs < sumaG * 0.999 && pctCierra) {
        for (const k of grupo) m.set(k, (m.get(k) ?? 0) + importe * (base(fotoItems[k]) / sumaG));
        grupoDeDescuento.set(j, { n: grupo.length, pct, importe: abs });
        return cerrarVentana();
      }

      // 3) no se pudo atribuir con certeza
      sinAtribuir.push({ descripcion: d.descripcion, importe: abs });
      cerrarVentana();
    });
    return m;
  })();
  // La lista con la que se calcula y se dibuja: cada renglón ya sabe qué
  // descuento le corresponde.
  const itemsCalc = fotoItems.map((i: any, idx: number) => ({
    ...i,
    _descuento: descuentoPorIdx.get(idx) ?? 0,
    _esDescuento: esRenglonDescuento(i),
  }));
  // OJO: el descuento ya está adentro de precioEfectivo del renglón que rebaja.
  // Sumar además el renglón de descuento lo restaría DOS veces.
  const sumaRenglones = itemsCalc.reduce(
    (s: number, i: any) => (i._esDescuento ? s : s + numImp(i.cantidad) * precioEfectivo(i)),
    0,
  );
  const netoDoc = fotoImp?.neto != null && fotoImp.neto !== '' ? numImp(fotoImp.neto) : null;
  const ivaDoc = fotoImp?.iva != null && fotoImp.iva !== '' ? numImp(fotoImp.iva) : null;
  const percIvaDoc = numImp(fotoImp?.percepcionIva);
  const percIibbDoc = numImp(fotoImp?.percepcionIibb);
  const impIntDoc = numImp(fotoImp?.impuestosInternos);
  const otrosDoc = numImp(fotoImp?.otros);
  // Descuento del pie sobre TODA la factura ("Desc. 50%"). Es lo que explica
  // que los renglones sumen más que el neto. Sin tenerlo en cuenta, el control
  // de "los renglones no cierran con el pie" gritaba en falso en cualquier
  // factura con descuento general — y un aviso que grita en falso se ignora.
  const descuentoGlobalDoc = Math.abs(numImp(fotoImp?.descuentoGlobal));
  const totalDoc = fotoImp?.total != null && fotoImp.total !== '' ? numImp(fotoImp.total) : null;
  const alicEfectiva = netoDoc && netoDoc > 0 && ivaDoc != null ? ivaDoc / netoDoc : null;
  // mercadería con IVA, sin percepciones
  const valorConIva = (netoDoc != null && ivaDoc != null) ? netoDoc + ivaDoc + impIntDoc
    : (totalDoc != null) ? totalDoc - percIvaDoc - percIibbDoc - otrosDoc : null;
  // Las percepciones (IIBB, IVA) son pago a cuenta de impuestos propios: en los
  // libros no son costo. Pero solo dejan de serlo si después se USAN contra el
  // impuesto que corresponde; si se acumulan sin consumir, es plata que salió y
  // no vuelve. La casa decidió costear con las percepciones adentro, que es la
  // política prudente: mejor un costo apenas alto que un precio de venta que no
  // cubre lo que de verdad se pagó.
  const percepciones = percIvaDoc + percIibbDoc;
  const baseCosto = valorConIva != null ? valorConIva + (percepcionesAlCosto ? percepciones : 0) : null;
  const factorRecon = (baseCosto != null && sumaRenglones > 0) ? baseCosto / sumaRenglones
    : (discriminaIva && sumarIva && alicEfectiva != null ? 1 + alicEfectiva : discriminaIva && sumarIva ? 1.21 : 1);
  // ============================================================
  // IVA POR RENGLÓN, VERIFICADO CONTRA EL PIE (2026-09-15)
  // Regla: en una factura A cada renglón paga SU alícuota (la que eligió una
  // persona › la impresa en la fila › la del catálogo › 21%) y la suma tiene que
  // dar el IVA del pie. Si no da, la factura NO se registra: se marca cuánto
  // falta y se pide la alícuota. Nunca más un promedio en silencio (Tufaro:
  // brócoli al 10,5; Distri Sur: lentejón al 10,5). La cuenta está en
  // app/lib/iva-compras.ts, con tests.
  // ============================================================
  const alicLinea = (i: any): number | null => {
    const a = numImp(i.alicuotaIva);
    return a > 0 && a <= 27 ? a : null;
  };
  // percepciones e internos no son IVA: se reparten proporcional al neto,
  // que es como los calcula la propia factura
  const cargaComunPct = netoDoc != null && netoDoc > 0
    ? (impIntDoc + (percepcionesAlCosto ? percepciones : 0)) / netoDoc
    : 0;
  const renglonesIva = itemsCalc
    .map((i: any, idx: number) => ({ i, idx }))
    .filter(({ i }) => !i._esDescuento && numImp(i.cantidad) > 0);
  const ivaFactura = discriminaIva
    ? repartirIva(
        renglonesIva.map(({ i }) => ({
          neto: numImp(i.cantidad) * precioEfectivo(i),
          alicuotaImpresa: alicLinea(i),
          alicuotaElegida: i.alicuotaElegida != null && i.alicuotaElegida !== '' ? Number(i.alicuotaElegida) : null,
          alicuotaCatalogo: i.alicuotaCatalogo != null ? Number(i.alicuotaCatalogo) : null,
        })),
        { neto: netoDoc, iva: ivaDoc, percepcionesAlCosto: percepcionesAlCosto ? percepciones : 0, impuestosInternos: impIntDoc },
      )
    : null;
  // posición de cada renglón de fotoItems dentro del cálculo del IVA
  const posIva = new Map<number, number>(renglonesIva.map(({ idx }, k) => [idx, k]));
  const ivaConAlicuotas = ivaFactura && (ivaFactura.estado === 'cierra' || ivaFactura.estado === 'no_cierra') ? ivaFactura : null;
  const alicDe = (idx: number): number | null => {
    const k = posIva.get(idx);
    return ivaConAlicuotas && k != null ? ivaConAlicuotas.alicuotas[k] : null;
  };
  const origenAlic = (idx: number) => {
    const k = posIva.get(idx);
    return ivaConAlicuotas && k != null ? ivaConAlicuotas.origenes[k] : null;
  };
  // Factura A: el IVA es el de cada renglón (aunque todavía no cierre: así el
  // costo que se ve ya responde a la alícuota que se va eligiendo). B, C y
  // remitos: el precio ya trae el IVA adentro y sigue el factor de siempre.
  const factorDe = (i: any, idx: number) => {
    const a = alicDe(idx);
    return ivaConAlicuotas && a != null
      ? ivaConAlicuotas.factorNeto * (1 + a / 100 + ivaConAlicuotas.cargaComunPct)
      : factorRecon;
  };
  const ivaBloquea = !!ivaFactura && ivaFactura.estado !== 'cierra' && renglonesIva.some(({ i }) => i.incluir);
  // cambia la alícuota de uno o varios renglones (a mano o aceptando la sugerencia)
  const elegirAlicuota = (indices: number[], a: number | null) =>
    setFotoItems((xs) => xs.map((x, j) => (indices.includes(j) ? { ...x, alicuotaElegida: a } : x)));
  // La cuenta del costo de un renglón, escrita: lo que se muestra al pasar el
  // mouse por el "c/IVA" para no tener que sacarla a mano.
  const desgloseCosto = (i: any, idx: number) => {
    const partes = [`${pesos(precioEfectivo(i))} por unidad${numImp(i.bonificacionPct) > 0 ? ` (ya con el ${numImp(i.bonificacionPct)}% de descuento)` : ''}`];
    const a = alicDe(idx);
    if (ivaConAlicuotas && a != null) {
      const neto = precioEfectivo(i) * ivaConAlicuotas.factorNeto;
      if (Math.abs(ivaConAlicuotas.factorNeto - 1) > 0.0001) partes.push(`× ${ivaConAlicuotas.factorNeto.toFixed(4).replace('.', ',')} (descuento del pie)`);
      const origen = { elegida: 'elegida a mano', impresa: 'impresa en la factura', catalogo: 'del catálogo', general: 'general' }[origenAlic(idx) ?? 'general'];
      partes.push(`+ IVA ${String(a).replace('.', ',')}% (${origen}) ${pesos(neto * a / 100)}`);
      if (ivaConAlicuotas.cargaComunPct > 0) partes.push(`+ percepciones${impIntDoc > 0 ? ' e internos' : ''} ${(ivaConAlicuotas.cargaComunPct * 100).toFixed(2).replace('.', ',')}% ${pesos(neto * ivaConAlicuotas.cargaComunPct)}`);
    } else if (hayDatosFiscales) {
      partes.push(`× ${factorRecon.toFixed(4).replace('.', ',')} (impuestos de la factura repartidos en proporción)`);
    }
    return `${partes.join('  ')}  = ${pesos(costoFinal(i, idx))} c/IVA`;
  };
  const costoFinal = (i: any, idx?: number) =>
    Math.round(precioEfectivo(i) * factorDe(i, idx ?? itemsCalc.indexOf(i)) * 100) / 100;
  const hayDatosFiscales = baseCosto != null;
  // La variación contra el costo del catálogo, con lo que el renglón dice AHORA
  // (la salida elegida para el «×N», la alícuota, el pie): costo final contra
  // costo final. Antes era un número fijo de la API —precio neto ÷ el «×N» del
  // lector contra un costo con IVA— y los Doritos salían "−93,9%" cuando en
  // realidad subían un 10,6% (6/10/2026).
  const variacionCosto = (i: Parameters<typeof costoFinal>[0], idx: number): number | null => {
    if (i.porPeso || !(numImp(i.cantidad) > 0) || !(numImp(i.costoCatalogo) > 0)) return i.variacionPct ?? null;
    return variacionDeCosto(costoFinal(i, idx), i.costoCatalogo);
  };
  // Reconciliación: el costo a stock nunca puede superar el valor de la mercadería
  // con IVA (ni el total). Si lo hace, hay un error y se bloquea Registrar.
  const inclItems = itemsCalc.filter((i: any) => i.incluir && !i._esDescuento);
  const sumaCostos = inclItems.reduce((s, i) => s + numImp(i.cantidad) * costoFinal(i), 0);
  const baseIncluidos = inclItems.reduce((s, i) => s + numImp(i.cantidad) * precioEfectivo(i), 0) * factorRecon;
  const techoMerc = baseCosto != null ? baseCosto : (totalDoc != null ? totalDoc : Infinity);
  const excedeMerc = sumaCostos > techoMerc * 1.005;
  const excedeTotal = totalDoc != null && sumaCostos > totalDoc * 1.005;
  const subCosteo = baseIncluidos > 0 && sumaCostos < baseIncluidos * 0.98;
  // Si los renglones leídos no suman el neto del pie, la IA leyó otra columna
  // (la de con IVA, o el total del renglón en vez del unitario). El factor sale
  // de dividir el pie por esa suma, así que un renglón mal leído ensucia el
  // costo de TODOS sin que se note: el total cierra igual. Es la causa más
  // común de "el costo no me da".
  // Lo que los renglones TENDRÍAN que sumar: el neto más lo que se descontó en
  // el pie (el descuento se aplica después de sumar los renglones).
  // Rebajas que el operador eligió no aplicar: para el control del pie cuentan
  // igual que el descuento global (los renglones van a sumar de más por eso).
  const descuentosNoAplicados = fotoItems.reduce(
    (s: number, d: any) => (esRenglonDescuento(d) && d.noAplicar ? s + Math.abs(numImp(d.cantidad) * numImp(d.precio)) : s),
    0,
  );
  const netoEsperado = netoDoc != null ? netoDoc + descuentoGlobalDoc + descuentosNoAplicados : null;
  const desvioRenglones = netoEsperado != null && netoEsperado > 0 && sumaRenglones > 0
    ? sumaRenglones / netoEsperado - 1
    : null;
  const columnaSospechosa = desvioRenglones != null && Math.abs(desvioRenglones) > 0.02;
  // Renglones que la IA leyó como bulto y siguen sin convertir. No bloquea
  // —puede que el producto vinculado sea el bulto— pero tiene que estar a la
  // vista antes de apretar Registrar. Los resueltos (ya en unidades, pasados a
  // unidades o dejados en cajas) no cuentan (6/10/2026).
  const bultosSinResolver = inclItems.filter((i) => estadoDelBulto(i) === 'pendiente').length;
  // el aviso nombra las presentaciones (×14, ×24) en vez de decir "×N"
  const presentacionesSinResolver = [...new Set(inclItems.filter((i) => estadoDelBulto(i) === 'pendiente').map((i) => Math.round(numImp(i.unidadesPorBulto))))];
  const descuentosDesmedidos = inclItems.filter((i: any) => descuentoDesmedido(i)).length;

  // El mismo producto puede venir en DOS renglones: el que se paga y el
  // bonificado. Si se mandan sueltos, la entrada fija el costo dos veces para
  // el mismo SKU y gana el último — que suele ser el de cero. Se fusionan: la
  // cantidad se suma y el costo es el promedio ponderado, que es exactamente
  // "prorratear las cajas sin cargo para bajar el costo".
  // El 10+1 abarata a TODO el grupo que lo ganó, no solo a su varietal.
  //
  // El arreglo real del proveedor es "comprá 10 cajas de la línea, llevate 1
  // gratis". Esa caja la ganaron todos los varietales, y el costo se reparte
  // entre las 11. ¿Cuál es el grupo? Está impreso: los renglones con el MISMO
  // precio de lista. En Wiwo, la Monteagrelo gratis comparte precio con
  // Malbec, Cabernet y Franc — ese es su grupo; la Cupra Rose gratis solo con
  // la Rose paga, y el Pinot (otro precio) queda afuera. Espejo probado de
  // costearConGruposPromo en el servidor (bultos.spec.ts).
  const fusionarPorSku = (xs: any[]) => {
    const claveP = (i: any) => String(Math.round(numImp(i.precio) * 100));
    const grupos = new Map<string, { pagado: number; unidades: number; tieneGratis: boolean }>();
    for (const i of xs) {
      const k = claveP(i);
      const g = grupos.get(k) ?? { pagado: 0, unidades: 0, tieneGratis: false };
      const cant = numImp(i.cantidad);
      g.pagado += cant * costoFinal(i);
      g.unidades += cant;
      if (esSinCargo(i)) g.tieneGratis = true;
      grupos.set(k, g);
    }
    const costoDeLinea = (i: any) => {
      const g = grupos.get(claveP(i))!;
      return g.tieneGratis && g.unidades > 0 && prorrateoAut ? g.pagado / g.unidades : costoFinal(i);
    };
    const porSku = new Map<string, any>();
    for (const i of xs) {
      const cant = numImp(i.cantidad);
      const costo = costoDeLinea(i);
      const enPromo = grupos.get(claveP(i))!.tieneGratis && !!prorrateoAut;
      const prev = porSku.get(i.sku);
      const gratis = esSinCargo(i) ? cant : 0;
      if (!prev) {
        porSku.set(i.sku, { ...i, cantidad: cant, _costoTotal: cant * costo, _renglones: 1, _gratis: gratis, _enPromo: enPromo });
      } else {
        prev.cantidad += cant;
        prev._costoTotal += cant * costo;
        prev._renglones += 1;
        prev._gratis += gratis;
        prev._enPromo = prev._enPromo || enPromo;
      }
    }
    return [...porSku.values()].map((i) => ({
      ...i,
      costoUnitario: i.cantidad > 0 ? Math.round((i._costoTotal / i.cantidad) * 100) / 100 : 0,
    }));
  };
  const hayRegalos = inclItems.some((i: any) => esSinCargo(i));
  const itemsFusionados = fusionarPorSku(inclItems.filter((i) => i.sku));
  const skusFusionados = itemsFusionados.filter((i) => i._renglones > 1 || i._enPromo);
  // el IVA que no cierra con el pie también bloquea: nunca más un promedio
  const lecturaIncompleta = fotoItems.some((i) => (soloFactura || i.incluir) && camposDeLecturaIncompletos(i));
  const costoBloquea = excedeMerc || excedeTotal || ivaBloquea || lecturaIncompleta;

  // Excel/CSV del portal del proveedor → precarga los renglones de la OC
  async function importarPedido(archivo: File) {
    if (!f.proveedorId) { setImportInfo({ conMatch: 0, sinMatch: ['Elegí primero el proveedor'] }); return; }
    setImportando(true);
    setImportInfo(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('proveedorId', f.proveedorId);
      const r = await fetch('/api/importar-oc', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo leer el archivo');
      const matcheados = (d.items ?? []).filter((i: any) => i.match);
      setItems((xs) => {
        const mapa = new Map(xs.map((x: any) => [x.sku, { ...x }]));
        for (const i of matcheados) {
          const ex = mapa.get(i.match.sku);
          if (ex) ex.cantidad += Number(i.cantidad) || 1;
          else mapa.set(i.match.sku, {
            sku: i.match.sku,
            nombre: i.match.nombre,
            cantidad: Number(i.cantidad) || 1,
            costoUnitario: Number(i.precio) || i.match.costoActual || 0,
          });
        }
        return [...mapa.values()];
      });
      setImportInfo({
        conMatch: matcheados.length,
        sinMatch: (d.items ?? []).filter((i: any) => !i.match).map((i: any) => `${i.descripcion} × ${i.cantidad}`),
      });
    } catch (e) {
      setImportInfo({ conMatch: 0, sinMatch: [e instanceof Error ? e.message : 'Error al importar'] });
    }
    setImportando(false);
  }

  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`); if (r.ok) setSug((await r.json()).items ?? []); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  // URL local del documento subido, para el visor lado a lado. Se revoca al
  // cambiar de archivo o desmontar, para no dejar memoria colgada.
  useEffect(() => {
    // sin archivo local no se pisa una URL firmada del servidor (lectura abierta desde la bandeja)
    if (!fotoArchivo) { setFotoUrl((u) => (u && u.startsWith('blob:') ? null : u)); return; }
    const url = URL.createObjectURL(fotoArchivo);
    setFotoUrl(url);
    setFotoEsPdf(fotoArchivo.type === 'application/pdf');
    setFotoRot(0);
    setFotoZoom(1);
    return () => URL.revokeObjectURL(url);
  }, [fotoArchivo]);

  // buscador por renglón de la entrada por foto (vincular producto a mano):
  // por nombre, código o PLU. El backend resuelve código de barras exacto y
  // nombre/SKU por texto.
  useEffect(() => {
    if (vinculaIdx == null) return;
    if (vinculaBusca.trim().length < 2) return setVinculaSug([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(vinculaBusca)}`);
      if (r.ok) setVinculaSug((await r.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [vinculaBusca, vinculaIdx]);

  // vincula un producto a un renglón leído (y lo tilda para incluirlo)
  const vincularProducto = (idx: number, p: any) => {
    setFotoItems((xs) => xs.map((x, j) => {
      if (j !== idx) return x;
      const nuevo = { ...x, sku: p.sku, nombre: p.nombre, variacionPct: null, sugerido: false, motivoIa: null, incluir: true, alicuotaCatalogo: p.alicuotaIva != null ? Number(p.alicuotaIva) : null, costoCatalogo: p.costo ?? null };
      // otro producto: lo que el lector decidió del «×N» con el costo del anterior ya no vale
      return x.sku === p.sku ? nuevo : alCambiarVinculo(nuevo);
    }));
    setVinculaIdx(null); setVinculaBusca(''); setVinculaSug([]);
  };

  // Alta desde la factura. El renglón que el sistema no reconoce no tiene por
  // qué frenar la carga: se da de alta ahí mismo, con la descripción y el costo
  // que ya se leyeron del papel, y el renglón queda vinculado al producto nuevo.
  // Mandarlos a otra pantalla significaba perder la factura a medio cargar.
  const [altaIdx, setAltaIdx] = useState<number | null>(null);
  const [altaForm, setAltaForm] = useState<any>({ nombre: '', rubro: '', marca: '', codigoBarras: '' });
  const [altaError, setAltaError] = useState('');
  const [creandoProd, setCreandoProd] = useState(false);

  const abrirAlta = (idx: number, i: any) => {
    setAltaIdx(altaIdx === idx ? null : idx);
    setAltaError('');
    setAltaForm({
      nombre: (i.descripcion ?? '').trim(),
      rubro: '',
      marca: '',
      codigoBarras: (i.codigo ?? '').toString().trim(),
    });
    setVinculaIdx(null);
  };

  const crearDesdeFactura = async (idx: number, i: any) => {
    if (creandoProd || !altaForm.nombre.trim()) return;
    setCreandoProd(true);
    setAltaError('');
    try {
      const costo = costoFinal(i);
      const r = await fetch('/api/producto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: altaForm.nombre.trim(),
          rubro: altaForm.rubro.trim() || undefined,
          marca: altaForm.marca.trim() || undefined,
          codigoBarras: altaForm.codigoBarras.trim() || undefined,
          costo: costo > 0 ? costo : undefined,
          // queda atado al proveedor de ESTA factura, con el texto que trae el
          // papel: la próxima factura suya lo reconoce sola
          proveedores: f.proveedorId ? [{ proveedorId: f.proveedorId, codigoProveedor: (i.codigo ?? '') || undefined, costo: costo > 0 ? costo : undefined }] : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setAltaError(d?.message ?? 'No se pudo crear el producto'); return; }
      // el producto nuevo no tiene costo anterior con qué comparar: sin
      // costoCatalogo, si no quedaba el del producto vinculado antes
      setFotoItems((xs) => xs.map((x, j) => j === idx ? alCambiarVinculo({ ...x, sku: d.sku, nombre: altaForm.nombre.trim(), variacionPct: null, sugerido: false, motivoIa: null, incluir: true, costoCatalogo: null }) : x));
      setAltaIdx(null);
    } catch {
      setAltaError('No se pudo crear el producto. Probá de nuevo.');
    } finally {
      setCreandoProd(false);
    }
  };

  // el operador confirma la sugerencia de la IA ("sí, es este") → queda vinculado
  // e incluido; al registrar la entrada se aprende y la próxima vez matchea solo.
  const confirmarSugerencia = (idx: number) =>
    setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, sugerido: false, incluir: true } : x));

  // "no, no es ese" → descarta la sugerencia y abre la búsqueda manual
  const rechazarSugerencia = (idx: number) => {
    setFotoItems((xs) => xs.map((x, j) => j === idx ? alCambiarVinculo({ ...x, sku: '', nombre: null, variacionPct: null, sugerido: false, motivoIa: null, incluir: false, costoCatalogo: null }) : x));
    setVinculaIdx(idx); setVinculaBusca('');
  };

  // alta de proveedor en el momento: si la IA detectó un proveedor que no está en
  // el sistema, lo damos de alta acá mismo (sin salir de la entrada por foto) con
  // la razón social y el CUIT leídos, y lo dejamos seleccionado.
  const [extraProv, setExtraProv] = useState<any[]>([]);
  const [creandoProv, setCreandoProv] = useState(false);
  const [provAviso, setProvAviso] = useState('');
  const provList = [...proveedores, ...extraProv];
  async function crearProveedorDetectado() {
    const det = foto?.proveedor?.detectado;
    if (!det?.nombre || creandoProv) return;
    setCreandoProv(true);
    setProvAviso('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crearProveedor', razonSocial: det.nombre, cuit: (det.cuit ?? '').toString().replace(/\D/g, '') || undefined }),
      });
      const d = await r.json();
      if (r.ok && d?.id) {
        setExtraProv((xs) => [...xs, { id: d.id, razon_social: d.razon_social ?? det.nombre, cuit: d.cuit ?? det.cuit }]);
        setF((x: any) => ({ ...x, proveedorId: d.id }));
      } else {
        setProvAviso(d?.message ?? 'No se pudo dar de alta el proveedor');
      }
    } catch {
      setProvAviso('No se pudo dar de alta el proveedor');
    } finally {
      setCreandoProv(false);
    }
  }

  // precio de venta calculado = costo final × (1 + remarcación%)
  const precioVenta = (i: any) => redondearPrecio(costoFinal(i) * (1 + (Number(i.margenPct) || 0) / 100));

  // % de remarcación GENERAL de la factura: al ponerlo, cascada a TODOS los
  // renglones (pisa el 50% por defecto). Vacío = cada renglón queda como esté.
  const aplicarRemarcacionGeneral = (v: string) => {
    set('margenPct', v);
    if (v !== '') setFotoItems((xs) => xs.map((x) => ({ ...x, margenPct: Number(v) })));
  };

  const cerrar = () => setModal(null);
  const t = modal.tipo;

  // con el documento a la vista, la ventana se ensancha para el layout de dos columnas
  // la revisión de una factura necesita ancho SIEMPRE (haya o no documento al lado).
  // Ojo: el Modal del kit llega como mucho a max-w-3xl ('ancho'); antes esta
  // revisión usaba max-w-6xl. Si el kit suma un ancho mayor, va acá.
  // Recibir y entrada directa también van anchas: su fila (cantidad, costo, %,
  // vencimiento) no entra en 512 px sin dejar el nombre del producto en cero.
  const modalAncho = (t === 'entradaFoto' && foto && !foto.error) || t === 'recibir' || t === 'entradaDirecta' ? 'ancho' : 'normal';

  // el título de cada ventana (antes, el <h2> de cada rama)
  const titulo =
    t === 'nuevaOC' ? 'Nueva orden de compra'
    : t === 'rechazar' ? <>Rechazar OC #{modal.oc.numero}</>
    : t === 'rechazarOP' ? <>Rechazar OP #{modal.op.numero}</>
    : t === 'recibir' ? <>Recibir OC #{modal.oc.numero}</>
    : t === 'entradaDirecta' ? 'Entrada directa de mercadería'
    : t === 'entradaFoto' ? 'Entrada por foto'
    : t === 'proveedor' ? (modal.prov?.id ? 'Editar proveedor' : 'Nuevo proveedor')
    : t === 'factura' ? 'Registrar factura de proveedor'
    : t === 'pagar' ? <>Nueva orden de pago — {modal.prov.proveedor?.razon_social}</>
    : '';

  // los botones de cada ventana (Cancelar + la acción), fijos abajo aunque el contenido scrollee
  const pie =
    t === 'nuevaOC' ? (
      <Acciones cerrar={cerrar} onOk={() => post({ accion: 'crearOC', proveedorId: f.proveedorId, sucursalId: f.sucursalId, items, fechaEntrega: f.fechaEntrega, condicionPago: f.condicionPago, vencimientoPago: f.vencimientoPago, observaciones: f.observaciones })} okLabel="Crear OC" disabled={!f.proveedorId || !f.sucursalId || !items.length} />
    ) : t === 'rechazar' ? (
      <Acciones variante="peligro" cerrar={cerrar} onOk={() => post({ accion: 'rechazar', id: modal.oc.id, motivo: f.motivo })} okLabel="Rechazar orden" />
    ) : t === 'rechazarOP' ? (
      <Acciones variante="peligro" cerrar={cerrar} onOk={() => post({ accion: 'rechazarOP', id: modal.op.id, motivo: f.motivo })} okLabel="Rechazar OP" />
    ) : t === 'recibir' ? (
      <Acciones cerrar={cerrar} okLabel="Registrar recepción" onOk={() => post({ accion: 'recibir', id: modal.oc.id, margenPct: f.margenPct ? Number(f.margenPct) : undefined, items: (modal.oc.items ?? []).map((it: any) => ({ sku: it.producto?.sku, cantidad: Number(recibido[it.producto?.sku] ?? (Number(it.cantidad) - Number(it.cantidad_recibida ?? 0))), vencimiento: vencs[it.producto?.sku] || undefined, margenPct: margenPorSku[it.producto?.sku] ? Number(margenPorSku[it.producto?.sku]) : undefined, fijarMargen: !!fijarSku[it.producto?.sku] })).filter((x: any) => x.cantidad > 0) })} />
    ) : t === 'entradaDirecta' ? (
      <Acciones cerrar={cerrar} okLabel="Registrar entrada" disabled={!f.proveedorId || !f.sucursalId || !items.length} onOk={() => post({ accion: 'entradaDirecta', proveedorId: f.proveedorId, sucursalId: f.sucursalId, numeroRemito: f.numeroRemito, margenPct: f.margenPct ? Number(f.margenPct) : undefined, items: items.map((i: any) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: Number(i.costo) || 0, vencimiento: i.vencimiento || undefined, margenPct: margenPorSku[i.sku] ? Number(margenPorSku[i.sku]) : undefined, fijarMargen: !!fijarSku[i.sku] })) })} />
    ) : t === 'entradaFoto' ? (
      !foto ? (
        <Acciones cerrar={cerrar} okLabel="—" disabled onOk={() => {}} />
      ) : foto.error ? (
        <Acciones cerrar={cerrar} okLabel="Reintentar" onOk={() => setFoto(null)} />
      ) : (
        soloFactura ? (
          <Acciones
            cerrar={cerrar}
            okLabel="Registrar factura para conciliar"
            disabled={!f.proveedorId || !(fotoImp?.total > 0) || lecturaIncompleta}
            onOk={() => post({
              accion: 'factura',
              proveedorId: f.proveedorId,
              sucursalId: f.sucursalId || undefined,
              tipo: 'factura',
              letra: foto.comprobante?.tipo?.split('_')[1]?.toUpperCase() || undefined,
              numero: foto.comprobante?.numero ?? 's/n',
              monto: Number(fotoImp.total),
              neto: fotoImp.neto, iva: fotoImp.iva,
              percepcionIva: Number(fotoImp.percepcionIva ?? 0),
              percepcionIibb: Number(fotoImp.percepcionIibb ?? 0),
              impuestosInternos: Number(fotoImp.impuestosInternos ?? 0),
              otros: Number(fotoImp.otros ?? 0),
              fechaEmision: normFechaIso(foto.comprobante?.fecha),
              condicionVenta: foto.comprobante?.condicionVenta || undefined,
              archivoUrl: foto.archivoUrl || undefined,
              pagada,
              // TODOS los renglones leídos (con o sin producto): son la base del cruce
              items: fotoItems.map((i) => ({ sku: i.sku || undefined, descripcion: i.descripcion, cantidad: Number(i.cantidad), precio: numImp(i.precio) })),
            })}
          />
        ) : (
        <Acciones
          cerrar={cerrar}
          okLabel={`Registrar entrada${foto.comprobante?.tipo?.startsWith('factura') ? ' + factura' : ''}`}
          disabled={!f.proveedorId || !f.sucursalId || !fotoItems.some((i) => i.incluir && i.sku) || fotoItems.some((i) => i.incluir && !i.sku) || costoBloquea}
          onOk={() => post({
            accion: 'entradaDirecta',
            proveedorId: f.proveedorId,
            sucursalId: f.sucursalId,
            numeroRemito: foto.comprobante?.numero || f.numeroRemito,
            margenPct: f.margenPct ? Number(f.margenPct) : undefined,
            items: itemsFusionados.map((i) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: i.costoUnitario, precioLeido: numImp(i.precio), margenPct: i.margenPct === '' ? undefined : Number(i.margenPct), fijarMargen: !!fijarSku[i.sku], descripcionLeida: i.descripcion })),
            // el catálogo aprende el IVA que esta factura PROBÓ (cerró al centavo con el pie)
            ...(ivaFactura?.estado === 'cierra' ? {
              alicuotasVerificadas: renglonesIva
                .map(({ i }, k) => ({ sku: i.sku, alicuota: ivaFactura.alicuotas[k], origen: ivaFactura.origenes[k], incluir: i.incluir }))
                .filter((x) => x.incluir && x.sku && (x.origen === 'impresa' || x.origen === 'elegida'))
                .map(({ sku, alicuota, origen }) => ({ sku, alicuota, origen })),
            } : {}),
            ...(foto.comprobante?.tipo?.startsWith('factura') && fotoImp?.total > 0 ? {
              factura: {
                numero: foto.comprobante?.numero ?? 's/n',
                total: Number(fotoImp.total),
                neto: fotoImp.neto != null ? Number(fotoImp.neto) : undefined,
                iva: fotoImp.iva != null ? Number(fotoImp.iva) : undefined,
                percepcionIva: Number(fotoImp.percepcionIva ?? 0),
                percepcionIibb: Number(fotoImp.percepcionIibb ?? 0),
                impuestosInternos: Number(fotoImp.impuestosInternos ?? 0),
                otros: Number(fotoImp.otros ?? 0),
                letra: foto.comprobante?.tipo?.split('_')[1]?.toUpperCase() || undefined,
                fechaEmision: normFechaIso(foto.comprobante?.fecha),
                condicionVenta: foto.comprobante?.condicionVenta || undefined,
                archivoUrl: foto.archivoUrl || undefined,
                pagada,
              },
            } : {}),
          })}
        />
        )
      )
    ) : t === 'proveedor' ? (
      <Acciones cerrar={cerrar} okLabel="Guardar" onOk={() => post(modal.prov?.id ? { accion: 'editarProveedor', id: modal.prov.id, razonSocial: f.razonSocial ?? f.razon_social, cuit: f.cuit, condicionPago: f.condicionPago ?? f.condicion_pago, email: f.email, telefono: f.telefono, leadTimeDias: f.leadTimeDias ?? f.lead_time_dias, leadTimeConfirmado: !!(f.leadTimeConfirmado ?? f.lead_time_confirmado) } : { accion: 'crearProveedor', razonSocial: f.razonSocial, cuit: f.cuit, condicionPago: f.condicionPago, email: f.email, telefono: f.telefono, leadTimeDias: f.leadTimeDias, leadTimeConfirmado: !!f.leadTimeConfirmado })} />
    ) : t === 'factura' ? (
      <Acciones cerrar={cerrar} okLabel="Registrar" onOk={() => post({ accion: 'factura', proveedorId: f.proveedorId, numero: f.numero, monto: Number(f.monto), vencimiento: f.vencimiento })} />
    ) : t === 'pagar' ? (
      <Acciones cerrar={cerrar} okLabel="Crear orden de pago" disabled={!facturasSel.length} onOk={() => post({ accion: 'crearOP', facturaIds: facturasSel, medioPago: f.medioPago ?? 'transferencia', fechaProgramada: f.fechaProgramada, observaciones: f.observaciones })} />
    ) : null;

  // Escape dentro de un campo no cierra la ventana: varios campos lo usan para
  // cancelar su propia edición (los kilos, las unidades por caja, el monto de un
  // impuesto) y una factura a medio revisar no se puede perder por un Escape.
  const escapeEnCampo = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (e.target as HTMLElement).closest('input, textarea, select')) e.nativeEvent.stopImmediatePropagation();
  };

  if (t === 'ocDetalle') {
    return (
      <OrdenDetalle
        id={modal.ocId}
        numero={modal.numero}
        cerrar={cerrar}
        verFactura={(facturaId: string) => setModal({ tipo: 'facturaDetalle', facturaId, volverA: { tipo: 'ocDetalle', ocId: modal.ocId, numero: modal.numero } })}
      />
    );
  }
  if (t === 'facturaDetalle') {
    return <FacturaDetalle id={modal.facturaId} cerrar={modal.volverA ? () => setModal(modal.volverA) : cerrar} volviendo={!!modal.volverA} />;
  }

  return (
    <Ventana abierto onCerrar={cerrar} titulo={titulo} ancho={modalAncho} pie={pie} cerrarAlTocarAfuera={false}>
      <div className="space-y-3" onKeyDown={escapeEnCampo}>
        {t === 'nuevaOC' && (<>
          <select aria-label="Proveedor" className={input} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select aria-label="Sucursal destino" className={input} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
            <option value="">Sucursal destino…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0"><span className={ROTULO_CAMPO}>Entrega esperada</span><input type="date" value={f.fechaEntrega ?? ''} onChange={(e) => set('fechaEntrega', e.target.value)} className={input} /></label>
            <label className="min-w-0"><span className={ROTULO_CAMPO}>Vence el pago</span><input type="date" value={f.vencimientoPago ?? ''} onChange={(e) => set('vencimientoPago', e.target.value)} className={input} /></label>
          </div>
          <input value={f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición de pago (contado / 30 días / cta cte…)" className={input} />

          {/* pedido armado en el portal del proveedor → Excel/CSV precarga los renglones */}
          <label className={'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-center text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marca ' + (f.proveedorId ? 'border-black/25 text-tinta/70 hover:border-marca hover:text-marca-hondo' : 'cursor-not-allowed border-black/15 text-tinta/60')}>
            {importando ? 'Leyendo el archivo…' : 'Importar Excel del pedido (portal del proveedor)'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              className="sr-only"
              disabled={!f.proveedorId || importando}
              onChange={(e) => { const a = e.target.files?.[0]; if (a) importarPedido(a); e.target.value = ''; }}
            />
          </label>
          {importInfo && (
            <div className="space-y-1 rounded-xl bg-crema-claro px-3 py-2 text-xs text-tinta/70">
              {importInfo.conMatch > 0 && <p className="flex items-start gap-1.5 font-medium text-ok"><IconoOk className="size-4 shrink-0" />{importInfo.conMatch} renglón(es) importados al pedido</p>}
              {importInfo.sinMatch.length > 0 && (
                <>
                  <p className="flex items-start gap-1.5 font-medium text-marca-hondo"><IconoAtencion className="size-4 shrink-0" /><span className="min-w-0">Sin match en el catálogo ({importInfo.sinMatch.length}) — agregalos a mano:</span></p>
                  {importInfo.sinMatch.slice(0, 6).map((s, i) => <p key={i} className="min-w-0 break-words">· {s}</p>)}
                  {importInfo.sinMatch.length > 6 && <p>… y {importInfo.sinMatch.length - 6} más</p>}
                </>
              )}
            </div>
          )}

          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar producto…" aria-label="Agregar producto" className={input} />
            {sug.length > 0 && <div className="absolute z-contenido mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
              {sug.map((p: any) => <button key={p.sku} onClick={() => { setItems((xs) => [...xs, { sku: p.sku, nombre: p.nombre, cantidad: 1, costoUnitario: p.costo ?? 0 }]); setBusca(''); setSug([]); }} className="min-h-11 w-full border-b border-black/[0.06] px-3 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none">{p.nombre} <span className="text-xs text-tinta/60">{p.sku}</span></button>)}
            </div>}
          </div>
          {items.length > 0 && (
            <div className="hidden items-center gap-2 pr-11 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60 md:flex">
              <span className="flex-1">Producto</span><span className="w-16 text-right">Cant.</span><span className="w-24 text-right">Costo $</span>
            </div>
          )}
          {items.map((i, idx) => (
            <div key={idx} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1 border-b border-black/[0.06] pb-3 text-sm last:border-0 md:flex md:items-center md:gap-2 md:border-0 md:pb-0">
              <span className="col-span-2 min-w-0 self-center break-words text-tinta md:flex-1">{i.nombre}</span>
              <div className="col-start-1 md:w-16"><span className={ROTULO_FILA}>Cant.</span><input type="number" aria-label={`Cantidad de ${i.nombre}`} value={i.cantidad} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} /></div>
              <div className="col-start-2 md:w-24"><span className={ROTULO_FILA}>Costo $</span><input type="number" aria-label={`Costo de ${i.nombre}`} value={i.costoUnitario} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, costoUnitario: Number(e.target.value) } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} placeholder="costo" /></div>
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} aria-label={`Quitar ${i.nombre}`} title="Quitar" className={unir(BOTON_QUITAR, 'col-start-3 row-start-1 justify-self-end')}><IconoCerrar className="size-4" /></button>
            </div>
          ))}
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
          <textarea value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" aria-label="Observaciones" rows={2} className={input} />
          {items.length > 0 && <p className="importe text-right text-sm font-semibold text-tinta">Total OC: {pesos(items.reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.costoUnitario || 0), 0))}</p>}
          <p className="text-xs text-tinta/60">La OC queda <b>pendiente de aprobación del dueño</b>.</p>
        </>)}

        {t === 'rechazar' && (<>
          <p className="text-sm text-tinta/70">{modal.oc.proveedor?.razon_social} · {pesos(modal.oc.total ?? 0)}. Se cancela la orden y queda registrado el motivo.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" aria-label="Motivo del rechazo" className={input} autoFocus />
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'rechazarOP' && (<>
          <p className="text-sm text-tinta/70">{modal.op.proveedor?.razon_social} · {pesos(modal.op.total ?? 0)}. Las facturas vuelven a quedar pendientes.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" aria-label="Motivo del rechazo" className={input} autoFocus />
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'recibir' && (<>
          <p className="text-xs text-tinta/60">Ingresá lo que llegó de cada ítem. Al recibir se fija el costo de la compra y se calcula el precio de venta con el % de remarcación. Si cargás vencimiento, nace el lote para la vigilancia de vencimientos.</p>
          <div className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60 md:flex">
            <span className="flex-1">Producto</span><span className="w-20 text-right">Llegó</span><span className="w-24 text-right">Remarc. %</span><span className="w-36">Vencimiento</span>
          </div>
          {(modal.oc.items ?? []).map((it: any, idx: number) => {
            const pend = Number(it.cantidad) - Number(it.cantidad_recibida ?? 0);
            const sku = it.producto?.sku;
            const info = remarca[sku];
            return (
              <div key={idx} className="grid grid-cols-2 items-start gap-x-3 gap-y-1 border-b border-black/[0.06] pb-3 text-sm last:border-0 md:flex md:items-start md:gap-2 md:border-0 md:pb-0">
                <span className="col-span-2 min-w-0 break-words text-tinta md:flex-1 md:pt-2">{it.producto?.nombre} <span className="text-xs text-tinta/60">(pend. {pend})</span></span>
                <div className="md:w-20"><span className={ROTULO_FILA}>Llegó</span><input type="number" aria-label={`Llegó de ${it.producto?.nombre ?? sku}`} value={recibido[sku] ?? ''} onChange={(e) => setRecibido((r) => ({ ...r, [sku]: e.target.value }))} placeholder={String(pend)} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} /></div>
                <div className="min-w-0 md:w-24">
                  <span className={ROTULO_FILA}>Remarc. %</span>
                  <input
                    aria-label={`Remarcación de ${it.producto?.nombre ?? sku}`}
                    type="number"
                    value={margenPorSku[sku] ?? ''}
                    onChange={(e) => setMargenPorSku((m) => ({ ...m, [sku]: e.target.value }))}
                    placeholder={info?.margenRubro != null ? String(info.margenRubro) : 'rubro'}
                    title={info?.margenPct != null ? `La última vez se remarcó ${info.margenPct}%` : 'Sin remarcación previa: se usa la del rubro'}
                    className={unir(CAMPO_FILA, info?.margenPct != null ? 'border-marca/40 bg-marca-suave' : CAMPO_FILA_COLOR)}
                  />
                  <AvisoMargen sku={sku} />
                </div>
                <div className="md:w-36"><span className={ROTULO_FILA}>Vencimiento</span><input type="date" title="Vencimiento (opcional)" aria-label={`Vencimiento de ${it.producto?.nombre ?? sku} (opcional)`} value={vencs[sku] ?? ''} onChange={(e) => setVencs((v) => ({ ...v, [sku]: e.target.value }))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR, 'text-left')} /></div>
              </div>
            );
          })}
          <label className="mt-1 flex items-center gap-2 border-t border-black/[0.06] pt-3 text-sm">
            <span className="min-w-0 flex-1 text-tinta/70">% de remarcación <span className="text-xs text-tinta/60">(vacío = usa el del rubro)</span></span>
            <input type="number" value={f.margenPct ?? ''} onChange={(e) => set('margenPct', e.target.value)} placeholder="rubro" className={unir(CAMPO_FILA_BASE, CAMPO_FILA_COLOR, 'w-20 shrink-0')} />
            <span className="text-xs text-tinta/60">%</span>
          </label>
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'entradaDirecta' && (<>
          <p className="text-xs text-tinta/60">Llegó mercadería <b>sin orden de compra previa</b> (reparto, compra de oportunidad). Genera la OC retroactiva con su remito, suma stock, fija costo y recalcula el precio de venta — todo trazable.</p>
          <select aria-label="Proveedor" className={input} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <select aria-label="Sucursal" className={input} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
              <option value="">Sucursal…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <input value={f.numeroRemito ?? ''} onChange={(e) => set('numeroRemito', e.target.value)} placeholder="N° de remito del proveedor" aria-label="N° de remito del proveedor" className={input} />
          </div>
          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar producto…" aria-label="Agregar producto" className={input} />
            {sug.length > 0 && <div className="absolute z-contenido mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
              {sug.map((p: any) => <button key={p.sku} onClick={() => { setItems((xs) => [...xs, { sku: p.sku, nombre: p.nombre, cantidad: 1, costo: p.costo ?? 0, vencimiento: '' }]); setBusca(''); setSug([]); }} className="min-h-11 w-full border-b border-black/[0.06] px-3 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none">{p.nombre} <span className="text-xs text-tinta/60">{p.sku}</span></button>)}
            </div>}
          </div>
          {items.length > 0 && (
            <div className="hidden items-center gap-2 pr-11 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60 md:flex">
              <span className="flex-1">Producto</span><span className="w-16 text-right">Cant.</span><span className="w-24 text-right">Costo $</span><span className="w-24 text-right">Remarc. %</span><span className="w-36">Vencimiento</span>
            </div>
          )}
          {items.map((i, idx) => {
            const info = remarca[i.sku];
            const margen = margenPorSku[i.sku] !== undefined ? margenPorSku[i.sku] : '';
            const venta = Number(i.costo) > 0 && margen !== '' ? redondearPrecio(Number(i.costo) * (1 + Number(margen) / 100)) : null;
            return (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-black/[0.06] pb-3 text-sm last:border-0 md:flex md:items-start md:gap-2 md:border-0 md:pb-0">
                <span className="col-span-2 min-w-0 self-center break-words text-tinta md:flex-1 md:self-start md:pt-2">
                  {i.nombre}
                  {venta != null && <span className="ml-2 text-xs text-tinta/60">vende {pesos(venta)}</span>}
                </span>
                <div className="col-start-1 md:w-16"><span className={ROTULO_FILA}>Cant.</span><input type="number" aria-label={`Cantidad de ${i.nombre}`} value={i.cantidad} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} /></div>
                <div className="col-start-2 md:w-24"><span className={ROTULO_FILA}>Costo $</span><input type="number" aria-label={`Costo de ${i.nombre}`} value={i.costo} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, costo: Number(e.target.value) } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} placeholder="costo" /></div>
                <div className="col-start-1 min-w-0 md:w-24">
                  <span className={ROTULO_FILA}>Remarc. %</span>
                  <input
                    aria-label={`Remarcación de ${i.nombre}`}
                    type="number"
                    value={margen}
                    onChange={(e) => setMargenPorSku((m) => ({ ...m, [i.sku]: e.target.value }))}
                    placeholder={info?.margenRubro != null ? String(info.margenRubro) : 'rubro'}
                    title={info?.margenPct != null ? `La última vez se remarcó ${info.margenPct}%` : 'Sin remarcación previa: se usa la del rubro'}
                    className={unir(CAMPO_FILA, info?.margenPct != null ? 'border-marca/40 bg-marca-suave' : CAMPO_FILA_COLOR)}
                  />
                  <AvisoMargen sku={i.sku} />
                </div>
                <div className="col-start-2 md:w-36"><span className={ROTULO_FILA}>Vencimiento</span><input type="date" aria-label={`Vencimiento de ${i.nombre}`} value={i.vencimiento ?? ''} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, vencimiento: e.target.value } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR, 'text-left')} /></div>
                <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} aria-label={`Quitar ${i.nombre}`} title="Quitar" className={unir(BOTON_QUITAR, 'col-start-3 row-start-1 justify-self-end')}><IconoCerrar className="size-4" /></button>
              </div>
            );
          })}
          <label className="mt-1 flex items-center gap-2 border-t border-black/[0.06] pt-3 text-sm">
            <span className="min-w-0 flex-1 text-tinta/70">% de remarcación <span className="text-xs text-tinta/60">(vacío = usa el del rubro)</span></span>
            <input type="number" value={f.margenPct ?? ''} onChange={(e) => set('margenPct', e.target.value)} placeholder="rubro" className={unir(CAMPO_FILA_BASE, CAMPO_FILA_COLOR, 'w-20 shrink-0')} />
            <span className="text-xs text-tinta/60">%</span>
          </label>
          {items.length > 0 && <p className="importe text-right text-sm font-semibold text-tinta">Total entrada: {pesos(items.reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.costo || 0), 0))}</p>}
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'entradaFoto' && (<>
          {!foto ? (
            <>
              <p className="text-xs text-tinta/60">Sacale una foto a la factura o remito que llegó con la mercadería (o subí el PDF, hasta 32MB). La IA (Sonnet 5) lee proveedor, renglones e impuestos y, si algo no se entiende, te lo pregunta para que se lo aclares. Vos revisás y confirmás: la entrada suma stock, fija costo/precio y registra la factura con su desglose fiscal.</p>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/15 bg-crema-claro px-4 py-10 text-center text-sm text-tinta/70 transition-colors hover:border-marca hover:text-marca-hondo has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marca">
                {leyendoFoto ? <Girador className="size-8 text-marca" /> : (
                  <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" />
                  </svg>
                )}
                {leyendoFoto
                  ? `Leyendo el comprobante… ${segundosLeyendo > 4 ? `(${segundosLeyendo}s — podés esperar, no se corta)` : ''}`
                  : 'Tocar para sacar foto o elegir archivo'}
                <input type="file" accept="image/*,.pdf" multiple className="sr-only" disabled={leyendoFoto}
                  onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length === 1) leerFoto(fs[0]); else if (fs.length > 1) leerVarias(fs); e.target.value = ''; }} />
              </label>
              <p className="text-xs text-tinta/60">Podés elegir hasta <b>5</b> fotos a la vez: se leen todas juntas y aparecen en la <b>bandeja de lectura</b> cuando están listas. Consejo: sacá la foto desde acá (cámara) o mandala por WhatsApp como <i>documento</i> — comprimida por WhatsApp se lee más lento y peor.</p>
              {avisoFoto && <Aviso tono="atencion">{avisoFoto}</Aviso>}
            </>
          ) : foto.error ? (
            <>
              <Aviso tono="error">{foto.error}</Aviso>
            </>
          ) : (
            <div className={verOriginal && fotoUrl ? 'grid items-start gap-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]' : ''}>
              {/* documento original, para comparar contra lo que leyó la IA */}
              {verOriginal && fotoUrl && (
                <div className="min-w-0 overflow-hidden rounded-xl border border-black/[0.06] bg-crema-claro md:sticky md:top-0">
                  <div className="flex items-center justify-between gap-1 border-b border-black/[0.06] bg-white/70 px-2 py-1">
                    <span className="min-w-0 truncate pl-1 text-xs font-medium text-tinta/70">Documento original</span>
                    <div className="flex shrink-0 items-center">
                      {!fotoEsPdf && (<>
                        <button type="button" onClick={() => setFotoZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))} title="Alejar" aria-label="Alejar" className={unir(BOTON_VISOR, 'text-base')}>−</button>
                        <button type="button" onClick={() => setFotoZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} title="Acercar" aria-label="Acercar" className={unir(BOTON_VISOR, 'text-base')}>+</button>
                        <button type="button" onClick={() => setFotoRot((r) => (r + 90) % 360)} title="Rotar" aria-label="Rotar" className={unir(BOTON_VISOR, 'text-base')}>⟳</button>
                        {(fotoZoom !== 1 || fotoRot !== 0) && (
                          <button type="button" onClick={() => { setFotoZoom(1); setFotoRot(0); }} title="Restablecer" className={unir(BOTON_VISOR, 'w-auto px-2 text-xs')}>reset</button>
                        )}
                      </>)}
                      <button type="button" onClick={() => setVerOriginal(false)} title="Ocultar" aria-label="Ocultar el documento" className={BOTON_VISOR}><IconoCerrar className="size-4" /></button>
                    </div>
                  </div>
                  {fotoEsPdf ? (
                    <iframe src={fotoUrl} title="Documento original" className="h-[45dvh] w-full bg-white md:h-[70dvh]" />
                  ) : (
                    <div className="flex h-[45dvh] items-center justify-center overflow-auto bg-tinta md:h-[70dvh]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fotoUrl}
                        alt="Documento original"
                        className="max-w-none transition-transform"
                        style={{ transform: `rotate(${fotoRot}deg) scale(${fotoZoom})` }}
                      />
                    </div>
                  )}
                </div>
              )}
              {!verOriginal && fotoUrl && (
                <button type="button" onClick={() => setVerOriginal(true)} className={unir('inline-flex min-h-9 items-center rounded-full text-xs text-tinta/70 underline hover:text-marca-hondo', FOCO)}>
                  Mostrar el documento original para comparar
                </button>
              )}
              <div className="min-w-0 space-y-3">
              {/* encabezado detectado */}
              <div className="break-words rounded-xl bg-crema-claro px-3 py-2 text-xs text-tinta/70">
                <p><b>{foto.comprobante?.tipo?.replace('_', ' ').toUpperCase() ?? 'COMPROBANTE'}</b> {foto.comprobante?.numero ?? ''} · {foto.comprobante?.fecha ?? 's/f'} {foto.comprobante?.condicionVenta ? `· ${foto.comprobante.condicionVenta}` : ''}</p>
                <p>{foto.proveedor?.detectado?.nombre ?? 'Proveedor no detectado'} {foto.proveedor?.detectado?.cuit ? `· CUIT ${foto.proveedor.detectado.cuit}` : ''} {foto.proveedor?.match ? '· en el sistema' : '· no está en el sistema'}</p>
              </div>

              {/* IMPUESTOS DE LA FACTURA (17/9/2026). Leandro: "necesito que lea
                  bien los impuestos y que si los lee mal todo se pueda sacar o
                  agregar con un click". Arriba y a la vista: cada impuesto leído
                  es una pastilla con ✕; los que faltan se agregan con un click en
                  su % (o con "lo que falta"); si el pie no cierra con el total, el
                  sistema dice cuál es el impuesto y ofrece el arreglo exacto
                  (app/lib/pie-factura.ts, con tests). Todo se deshace con ↺. */}
              <PanelImpuestos
                key={foto.archivoUrl ?? foto.comprobante?.numero ?? 'factura'}
                fotoImp={fotoImp} setFotoImp={setFotoImp}
                habituales={foto.impuestosHabituales ?? null}
                sumaRenglones={sumaRenglones}
              />

              {foto.items?.some((i: any) => i.interpretado?.faltantes?.includes('importe')) && <p className="rounded-xl bg-atencion-suave p-3 text-sm text-atencion">No se pudieron leer todos los importes de los renglones. Verificá cantidades, precios y totales contra el original; esos importes no se dieron por comprobados.</p>}
              {/* La IA pregunta lo que no entendió; aclarás y vuelve a leer teniéndolo en cuenta */}
              {lecturaIncompleta && <p role="alert" className="rounded-xl bg-atencion-suave p-3 text-sm text-atencion">Hay renglones con cantidad o precio incompletos o inválidos. Revisá el comprobante y completalos antes de registrar.</p>}
              <div className={'rounded-xl px-3 py-2.5 space-y-2 border ' + (foto.dudas?.length ? 'border-atencion/30 bg-atencion-suave' : 'border-black/[0.06] bg-crema-claro')}>
                {foto.dudas?.length ? (
                  <>
                    <p className="text-xs font-semibold text-atencion">La IA tiene {foto.dudas.length === 1 ? 'una duda' : `${foto.dudas.length} dudas`} — mirá el papel y aclarale:</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-atencion">
                      {foto.dudas.map((d: any, i: number) => (
                        <li key={i}>{d.referencia ? <b>{d.referencia}: </b> : null}{d.pregunta}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-tinta/70"><IconoOk className="size-4 shrink-0 text-ok" />La IA no tuvo dudas. Si ves algo mal, aclarale y volvé a leer.</p>
                )}
                <textarea value={aclaraciones} onChange={(e) => setAclaraciones(e.target.value)} rows={2}
                  placeholder="Aclaraciones para la IA (ej: el renglón 3 dice 72, no 12; la percepción de IIBB es 4.850)…"
                  aria-label="Aclaraciones para la IA"
                  className={CAMPO_BLANCO} />
                <div className="flex flex-wrap items-center gap-2">
                  <Dictado onTexto={(t) => setAclaraciones((v) => (v ? v + ' ' : '') + t)} />
                  <Boton tamano="chico" variante="secundario" onClick={reLeerConAclaraciones} disabled={leyendoFoto || !aclaraciones.trim()}>
                    {leyendoFoto ? 'Releyendo…' : 'Volver a leer con mis aclaraciones'}
                  </Boton>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <select aria-label="Proveedor" className={input} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
                  <option value="">Proveedor…</option>{provList.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                </select>
                <select aria-label="Sucursal" className={input} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
                  <option value="">Sucursal…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>

              {/* proveedor detectado pero no está en el sistema: alta en el momento */}
              {!f.proveedorId && foto.proveedor?.detectado?.nombre && !foto.proveedor?.match && (
                <Boton
                  tamano="chico"
                  variante="secundario"
                  onClick={crearProveedorDetectado}
                  disabled={creandoProv}
                  className="self-start"
                >
                  {creandoProv ? 'Dando de alta…' : `+ Dar de alta "${foto.proveedor.detectado.nombre}"${foto.proveedor.detectado.cuit ? ` · CUIT ${foto.proveedor.detectado.cuit}` : ''}`}
                </Boton>
              )}
              {provAviso && <p className="text-xs text-marca-hondo">{provAviso}</p>}

              {/* renglones: cada uno editable — vincular producto, cantidad, remarcación y precio */}
              <div className="@container">
              <div className="hidden @min-[49rem]:grid grid-cols-[26px_minmax(11rem,1fr)_72px_290px_64px_92px] items-end gap-2 px-3 pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">
                <span /><span>Renglón del papel → producto en el sistema</span>
                <span className="text-right">Cant.</span><span className="text-right">Costo papel → c/IVA → total</span>
                <span className="text-right">Remar. %</span><span className="text-right">P. venta</span>
              </div>
              </div>
              {itemsCalc.map((i: any, idx: number) => (
                <div key={idx} className={'rounded-xl border px-3 py-2.5 ' + (i.sugerido ? 'border-dorado bg-crema-claro' : i.incluir ? 'border-black/[0.06] bg-white' : 'border-transparent bg-crema-claro')}>
                  {i._esDescuento ? (
                    <div className={'flex items-start gap-2.5' + (i.noAplicar ? ' opacity-60' : '')}>
                      <IconoRebaja className="mt-0.5 size-4 shrink-0 text-tinta/60" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="min-w-0 font-mono text-sm leading-snug text-tinta [overflow-wrap:anywhere]">{i.descripcion}</span>
                          <span className="font-mono text-xs tabular-nums text-tinta/60">rebaja de <b className="text-tinta/70">{pesos(Math.abs(numImp(i.cantidad) * numImp(i.precio)) || Math.abs(numImp(i.importe)))}</b></span>
                          {i.noAplicar ? <Sello>sin aplicar</Sello>
                            : sinAtribuir.some((x) => x.descripcion === i.descripcion) ? <Sello tono="ojo">sin destino</Sello>
                            : grupoDeDescuento.has(idx) ? <Sello tono="ok">repartida en {grupoDeDescuento.get(idx)!.n}</Sello>
                            : <Sello tono="ok">aplicada</Sello>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta/70">
                          {i.noAplicar ? (
                            <>La mercadería queda a precio de lista; lo pagado de menos se reparte en el costo general.
                              <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: false } : x))} className={unir(ENLACE, 'text-tinta/70 hover:text-marca-hondo')}>Aplicar de nuevo</button></>
                          ) : sinAtribuir.some((x) => x.descripcion === i.descripcion) ? (
                            <span className="text-marca-hondo">No se sabe a qué renglón corresponde{numImp(i.descuentoPct) > 0 ? ` (dice ${numImp(i.descuentoPct)}% y no cierra con ninguno)` : ''}: no se descontó de ningún costo. Si es de toda la factura, cargala en “Desc. del pie”.</span>
                          ) : grupoDeDescuento.has(idx) ? (
                            <>Se reparte entre los {grupoDeDescuento.get(idx)!.n} renglones de arriba{grupoDeDescuento.get(idx)!.pct ? ` (${grupoDeDescuento.get(idx)!.pct}%)` : ''}, proporcional a cada uno.
                              <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: true } : x))} className={CHIP_ACCION}>No aplicar</button></>
                          ) : (
                            <>Se descuenta del renglón que nombra.
                              <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, noAplicar: true } : x))} className={CHIP_ACCION}>No aplicar</button></>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="flex items-start gap-2.5">
                    <input type="checkbox" checked={i.incluir} disabled={i.sugerido} onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, incluir: e.target.checked } : x))} aria-label={`Incluir ${i.nombre ?? i.descripcion}`} className="mt-0.5 size-5 shrink-0 accent-marca" />
                    <div className="@container min-w-0 flex-1 space-y-1.5">
                      {/* 1 · lo que dice el papel, tal cual, con sus sellos */}
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="min-w-0 font-mono text-sm leading-snug text-tinta [overflow-wrap:anywhere]">{i.descripcion}</span>
                        <span className="font-mono text-xs tabular-nums text-tinta/60">
                          {numImp(i.cantidad).toLocaleString('es-AR')} × {pesos(numImp(i.precio))}
                          {i.importe != null && i.importe !== '' ? <> = <b className="text-tinta/70">{pesos(Math.abs(numImp(i.importe)))}</b></> : null}
                        </span>
                        {numImp(i.unidadesPorBulto) > 1 && <Sello tono="oro">×{Math.round(numImp(i.unidadesPorBulto))}: ¿cajas o unidades?</Sello>}
                        {numImp(i.bultoAplicado) > 1 && <Sello tono="info">×{Math.round(numImp(i.bultoAplicado))} → unidades</Sello>}
                        {estadoDelBulto(i) === 'ya_en_unidades' && <Sello tono="ok">×{Math.round(numImp(i.bultoDescartado))} · ya en unidades</Sello>}
                        {estadoDelBulto(i) === 'caja' && <Sello tono="info">caja ×{Math.round(numImp(i.bultoDescartado))}</Sello>}
                        {numImp(i.envaseAplicado) > 1 && <Sello tono="info">u. → cajas ×{Math.round(numImp(i.envaseAplicado))}</Sello>}
                        {numImp(i.paqueteAplicado) > 0 && <Sello tono="info">kg → paq. {Math.round(numImp(i.paqueteAplicado))} g</Sello>}
                        {esSinCargo(i) ? <Sello tono="ok">sin cargo</Sello> : numImp(i.bonificacionPct) > 0 ? <Sello tono="ok">bonif. {numImp(i.bonificacionPct)}%</Sello> : null}
                        {numImp(i._descuento) < 0 && (descuentoDesmedido(i) ? <Sello tono="ojo">desc. sin aplicar</Sello> : <Sello tono="ok">desc. aplicado</Sello>)}
                        {numImp(i.cantidadCorregida) > 0 && <Sello tono="ok">cant. corregida</Sello>}
                        {correccionRenglon(i)?.seguro === false && <Sello tono="ojo">revisar lectura</Sello>}
                        {(medidaVariable(i) || i.porPeso) && <Sello tono="info">por peso</Sello>}
                        {i.sugerido && <Sello tono="oro">¿es este?</Sello>}
                        {/* IVA del renglón: siempre a la vista y siempre corregible. Lo que se
                            elige acá manda sobre lo impreso (la lectura pudo tomar mal el %). */}
                        {discriminaIva && numImp(i.cantidad) > 0 && alicDe(idx) != null && (
                          <label
                            className={'ml-auto inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-marca ' +
                              (origenAlic(idx) === 'elegida' ? 'border-tinta bg-tinta text-crema'
                                : ivaFactura?.estado === 'no_cierra' ? 'border-marca/60 bg-marca-suave text-marca-hondo'
                                : 'border-black/15 bg-white text-tinta/70')}
                            title={{ elegida: 'Alícuota elegida a mano', impresa: 'Alícuota impresa en la factura', catalogo: 'Alícuota del producto en el catálogo', general: 'La fila no imprime alícuota: se toma 21%' }[origenAlic(idx) ?? 'general'] + '. Cambiala si no es la correcta: se recalcula todo.'}
                          >
                            IVA
                            <select
                              value={String(alicDe(idx))}
                              onChange={(e) => elegirAlicuota([idx], Number(e.target.value))}
                              className="bg-transparent font-semibold tabular-nums outline-none"
                            >
                              {ALICUOTAS_IVA.map((a) => <option key={a} value={String(a)} className="text-tinta">{String(a).replace('.', ',')}%</option>)}
                            </select>
                            <span className="opacity-60">{{ elegida: 'a mano', impresa: 'factura', catalogo: 'catálogo', general: 'general' }[origenAlic(idx) ?? 'general']}</span>
                            {origenAlic(idx) === 'elegida' && (
                              <button type="button" onClick={(e) => { e.preventDefault(); elegirAlicuota([idx], null); }} className="relative opacity-70 before:absolute before:-inset-2 hover:opacity-100" title="Volver a la alícuota de la factura / catálogo" aria-label="Volver a la alícuota de la factura / catálogo">↺</button>
                            )}
                          </label>
                        )}
                      </div>

                      {/* 2 · lo que entra al sistema: producto y números, en columnas fijas */}
                      {/* Se adapta al ancho de la TARJETA (container query), no al de la ventana:
                          con el documento original abierto al lado, la columna del nombre quedaba
                          en cero y el nombre se partía letra por letra. Si no entra, el nombre va
                          en su propia línea de ancho completo y los números abajo. */}
                      <div className="grid grid-cols-[72px_minmax(0,1fr)] @min-[46rem]:grid-cols-[minmax(11rem,1fr)_72px_290px_64px_92px] items-center gap-2">
                        <div className="col-span-full @min-[46rem]:col-span-1 min-w-0 text-xs leading-snug">
                          {i.sugerido && i.nombre ? (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-dorado-hondo">¿Es <b className="text-tinta">{i.nombre}</b>?</span>
                              <Boton tamano="chico" variante="secundario" onClick={() => confirmarSugerencia(idx)}>Sí, es este</Boton>
                              <button onClick={() => rechazarSugerencia(idx)} className={CHIP_ACCION}>Buscar otro</button>
                              {i.motivoIa && <span className="basis-full text-xs text-tinta/60">{String(i.motivoIa).replace(/\s*:\s*puede ser otro producto.*$/i, '').slice(0, 110)}</span>}
                            </span>
                          ) : i.nombre ? (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {/* el nombre entero (baja de renglón si hace falta): es lo que se mira
                                  para confirmar que el vínculo es el correcto sin entrar a "cambiar" */}
                              <span className="min-w-0 break-words text-ok" title={i.nombre}>→ <b>{i.nombre}</b></span>
                              {(() => {
                                // con lo que el renglón dice AHORA: cambia con cada botón (6/10/2026)
                                const v = variacionCosto(i, idx);
                                if (v == null) return null;
                                return numImp(i.unidadesPorBulto) > 1 && Math.abs(v) > 300
                                  ? <span className="text-tinta/60">precio de caja vs. unidad</span>
                                  : <span className={Math.abs(v) > 25 ? 'text-marca-hondo' : 'text-tinta/60'} title="Costo final de este renglón contra el costo del producto en el catálogo">costo {v > 0 ? '+' : ''}{String(v).replace('.', ',')}%</span>;
                              })()}
                              <button onClick={() => setVinculaIdx(idx)} className={unir(ENLACE, 'text-tinta/70 hover:text-marca-hondo')}>cambiar</button>
                              {!i.porPeso && !medidaVariable(i) && !(numImp(i.bultoAplicado) > 1) && !(numImp(i.unidadesPorBulto) > 1) && !(numImp(i.bultoDescartado) > 1) && !(numImp(i.envaseAplicado) > 1) && !(numImp(i.paqueteAplicado) > 0) && (
                                <>
                                  <button
                                    onClick={() => void abrirPesoEdit(idx, i.sku)}
                                    className={unir(ENLACE, 'text-info hover:text-tinta')}
                                    title="La factura lo trae por unidad pero en stock va por kilo: cargá cuántos kilos vinieron"
                                  >
                                    es por peso
                                  </button>
                                  <button
                                    onClick={() => { setPesoEdit(null); setBultoEdit(bultoEdit?.idx === idx ? null : { idx, unidades: '' }); }}
                                    className={unir(ENLACE, 'text-info hover:text-tinta')}
                                    title="Cada unidad de la factura es una caja o display: cargá cuántas unidades trae"
                                  >
                                    es por bulto
                                  </button>
                                </>
                              )}
                              {pesoEdit?.idx === idx && (
                                <span className="flex basis-full flex-wrap items-center gap-2 rounded-xl bg-info-suave px-3 py-2 text-info">
                                  ¿Cuántos kilos vinieron?
                                  <input
                                    autoFocus type="number" step="0.001" min="0" inputMode="decimal"
                                    value={pesoEdit.kg}
                                    onChange={(e) => setPesoEdit({ ...pesoEdit, kg: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void confirmarPeso(idx, i.sku, i.nombre);
                                      if (e.key === 'Escape') setPesoEdit(null);
                                    }}
                                    placeholder="kg"
                                    aria-label="Kilos que vinieron"
                                    className={unir(CAMPO_FILA_BASE, 'w-24 border-info/30 bg-white')}
                                  />
                                  {Number(pesoEdit.kg) > 0 && (
                                    <span className="text-info/80">
                                      → {pesos((Math.abs(numImp(i.importe)) || numImp(i.cantidad) * Math.abs(numImp(i.precio))) / Number(pesoEdit.kg))} el kilo
                                    </span>
                                  )}
                                  <Boton
                                    tamano="chico"
                                    disabled={!(Number(pesoEdit.kg) > 0)}
                                    onClick={() => void confirmarPeso(idx, i.sku, i.nombre)}
                                  >
                                    Pasar a kilos
                                  </Boton>
                                  <button onClick={() => setPesoEdit(null)} className={unir(ENLACE, 'text-info')}>cancelar</button>
                                  <span className="basis-full">
                                    {pesoEdit.enCatalogo === true ? (
                                      <span className="inline-flex items-center gap-1"><IconoOk className="size-4 shrink-0" />En el catálogo ya se vende por peso.</span>
                                    ) : (
                                      <label className="inline-flex min-h-9 items-center gap-2">
                                        <input
                                          className="size-5 shrink-0 accent-marca"
                                          type="checkbox"
                                          checked={pesoEdit.marcarCatalogo}
                                          disabled={pesoEdit.enCatalogo === null}
                                          onChange={(e) => setPesoEdit({ ...pesoEdit, marcarCatalogo: e.target.checked })}
                                        />
                                        {pesoEdit.enCatalogo === null
                                          ? 'Revisando el catálogo…'
                                          : <>Marcar el producto como <b>vendido por peso</b> en el catálogo (la caja lo va a cobrar por kilo)</>}
                                      </label>
                                    )}
                                  </span>
                                </span>
                              )}
                              {bultoEdit?.idx === idx && (
                                <span className="flex basis-full flex-wrap items-center gap-2 rounded-xl bg-info-suave px-3 py-2 text-info">
                                  ¿Cuántas unidades trae cada caja?
                                  <input
                                    autoFocus type="number" step="1" min="2" inputMode="numeric"
                                    value={bultoEdit.unidades}
                                    onChange={(e) => setBultoEdit({ idx, unidades: e.target.value.replace(/[^\d]/g, '') })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && Number(bultoEdit.unidades) > 1) { pasarABultoManual(idx, Number(bultoEdit.unidades)); setBultoEdit(null); }
                                      if (e.key === 'Escape') setBultoEdit(null);
                                    }}
                                    placeholder="u."
                                    aria-label="Unidades por caja"
                                    className={unir(CAMPO_FILA_BASE, 'w-20 border-info/30 bg-white')}
                                  />
                                  {Number(bultoEdit.unidades) > 1 && (
                                    <span className="text-info/80">
                                      → {numImp(i.cantidad) * Number(bultoEdit.unidades)} unidades a {pesos(numImp(i.precio) / Number(bultoEdit.unidades))} c/u
                                    </span>
                                  )}
                                  <Boton
                                    tamano="chico"
                                    disabled={!(Number(bultoEdit.unidades) > 1)}
                                    onClick={() => { pasarABultoManual(idx, Number(bultoEdit.unidades)); setBultoEdit(null); }}
                                  >
                                    Multiplicar{Number(bultoEdit.unidades) > 1 ? ` ×${bultoEdit.unidades}` : ''}
                                  </Boton>
                                  {Number(bultoEdit.unidades) > 1 && Number.isInteger(numImp(i.cantidad) / Number(bultoEdit.unidades)) && (
                                    <span className="flex basis-full flex-wrap items-center gap-2">
                                      <span className="text-info">…o al revés, la factura trae unidades sueltas y en stock va la caja:
                                        {' '}{numImp(i.cantidad)} u. = <b>{numImp(i.cantidad) / Number(bultoEdit.unidades)} cajas</b> a {pesos(numImp(i.precio) * Number(bultoEdit.unidades))}</span>
                                      <Boton
                                        tamano="chico"
                                        variante="secundario"
                                        onClick={() => { armarEnvases(idx, Number(bultoEdit.unidades)); setBultoEdit(null); }}
                                      >
                                        Armar cajas
                                      </Boton>
                                    </span>
                                  )}
                                  <button onClick={() => setBultoEdit(null)} className={unir(ENLACE, 'text-info')}>cancelar</button>
                                </span>
                              )}
                              {avisoCatalogo?.idx === idx && (
                                <span className={'basis-full ' + (avisoCatalogo.error ? 'text-marca-hondo' : 'text-ok')}>
                                  {avisoCatalogo.texto}
                                  <button onClick={() => setAvisoCatalogo(null)} className={unir(ENLACE, 'ml-2 text-tinta/70')}>ok</button>
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {i.avisoMedida && <span className="basis-full text-marca-hondo">Medida distinta ({i.avisoMedida}): es otro producto.</span>}
                              <Boton tamano="chico" variante="secundario" onClick={() => setVinculaIdx(vinculaIdx === idx ? null : idx)}>Vincular producto</Boton>
                              <button onClick={() => abrirAlta(idx, i)} className={CHIP_ACCION}>Dar de alta</button>
                            </span>
                          )}
                        </div>
                        <input type="number" step="any" min="0" value={i.cantidad} onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} aria-label="Cantidad" className={unir(CAMPO_FILA, CAMPO_FILA_COLOR, 'importe')} />
                        {/* costo: el precio del papel (corregible) → el costo final que queda en stock, en la misma línea */}
                        <div className="col-span-1 flex flex-wrap items-center justify-end gap-1.5 tabular-nums">
                          <input
                            type="number" step="any" min="0" value={i.precio}
                            onChange={(e) => setFotoItems((xs) => xs.map((x, j) => {
                              if (j !== idx) return x;
                              const p = Number(e.target.value) || 0;
                              return { ...x, precio: p, importe: numImp(x.cantidad) * p, cantidadCorregida: null, bultoConsumido: null };
                            }))}
                            title="Precio unitario tal como está en el papel (sin IVA): corregilo si la lectura falló"
                            aria-label="Precio del papel"
                            className={unir(CAMPO_FILA_BASE, CAMPO_FILA_COLOR, 'importe w-[78px] px-1.5')}
                          />
                          {Math.abs(costoFinal(i, idx) - precioEfectivo(i)) > 0.5 ? (
                            <span
                              className="whitespace-nowrap text-right leading-none"
                              title={desgloseCosto(i, idx)}
                            >
                              <span className="text-tinta/60">→</span> <b className="text-sm font-semibold text-tinta">{pesos(costoFinal(i, idx))}</b>
                              <span className="ml-1 text-xs uppercase tracking-wide text-tinta/60">c/IVA</span>
                            </span>
                          ) : null}
                          {numImp(i.cantidad) > 0 && (
                            <span
                              className="whitespace-nowrap text-right leading-none"
                              title={`Total del renglón: ${numImp(i.cantidad).toLocaleString('es-AR')} × ${pesos(costoFinal(i))} (costo final por unidad)`}
                            >
                              <span className="text-tinta/60">×{numImp(i.cantidad).toLocaleString('es-AR')} =</span>{' '}
                              <b className="text-sm font-semibold text-tinta">{pesos(numImp(i.cantidad) * costoFinal(i))}</b>
                            </span>
                          )}
                        </div>
                        <div>
                          <input type="number" value={i.margenPct} placeholder="rubro" aria-label="Remarcación %" onChange={(e) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, margenPct: e.target.value === '' ? '' : Number(e.target.value) } : x))} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR, 'importe')} />
                          <AvisoMargen
                            sku={i.sku}
                            habitualExterno={i.match?.margenPct ?? null}
                            valor={i.margenPct}
                            poner={(v) => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, margenPct: v === '' ? '' : Number(v) } : x))}
                          />
                        </div>
                        <div className="importe text-right text-sm font-semibold text-tinta">
                          {i.margenPct === '' || i.margenPct == null ? <span className="text-xs font-normal text-tinta/60">s/ rubro</span> : pesos(precioVenta(i))}
                        </div>
                      </div>

                      {/* 3 · una nota por situación, una línea y un solo botón */}
                      {(numImp(i._descuento) < 0 || numImp(i.cantidadCorregida) > 0 || correccionRenglon(i)?.seguro === false || esSinCargo(i) || numImp(i.bonificacionPct) > 0 || numImp(i.unidadesPorBulto) > 1 || numImp(i.bultoAplicado) > 1 || numImp(i.bultoDescartado) > 1 || numImp(i.envaseAplicado) > 1 || numImp(i.paqueteAplicado) > 0 || !!sugerirConversion(i) || i.importeConIvaLeido != null || medidaVariable(i) || (i.porPeso && numImp(i.cantidad) > 0 && !medidaVariable(i))) && (
                      <div className="flex flex-col gap-1 text-xs leading-snug">
                        {numImp(i._descuento) < 0 && (descuentoDesmedido(i) ? (
                          <span className="rounded-xl bg-marca-suave px-2.5 py-1.5 text-marca-hondo"><IconoAtencion className="mr-1 inline size-4 align-[-3px]" />El descuento ({pesos(Math.abs(numImp(i._descuento)))}) supera al renglón ({pesos(Math.abs(baseUnitaria(i) * (numImp(i.cantidad) || 1)))}): no se aplicó. Suele ser de varios renglones o de toda la factura; revisalo antes de registrar.</span>
                        ) : (
                          <span className="rounded-xl bg-ok-suave px-2.5 py-1.5 text-ok">Con el descuento: {pesos(baseUnitaria(i))} − {pesos(Math.abs(numImp(i._descuento)) / (numImp(i.cantidad) || 1))} = <b>{pesos(precioEfectivo(i))}</b> por unidad.</span>
                        ))}
                        {numImp(i.cantidadCorregida) > 0 && (
                          <span className="rounded-xl bg-ok-suave px-2.5 py-1.5 text-ok">Cantidad corregida: {numImp(i.bultoConsumido) > 1
                            ? <>el papel decía <b>{numImp(i.cantidadCorregida)} bulto(s) de {numImp(i.bultoConsumido)}</b> al precio por unidad; el importe ({pesos(Math.abs(numImp(i.importe)))}) da <b>{numImp(i.cantidad)}</b> unidades.</>
                            : <>se leyó {numImp(i.cantidadCorregida)}, pero el importe ({pesos(Math.abs(numImp(i.importe)))}) ÷ el precio da exactamente <b>{numImp(i.cantidad)}</b>.</>}
                            <button onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: numImp(x.cantidadCorregida), cantidadCorregida: null, unidadesPorBulto: numImp(x.bultoConsumido) > 1 ? numImp(x.bultoConsumido) : x.unidadesPorBulto, bultoConsumido: null } : x))} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                          </span>
                        )}
                        {correccionRenglon(i)?.seguro === false && (
                          <span className="rounded-xl bg-atencion-suave px-2.5 py-1.5 text-atencion">{numImp(i.cantidad)} × {pesos(numImp(i.precio))} no da el importe del papel ({pesos(Math.abs(numImp(i.importe)))}). ¿El precio es <b>{pesos(correccionRenglon(i)!.valor)}</b>?
                            <Boton tamano="chico" variante="secundario" onClick={() => setFotoItems((xs) => xs.map((x, j) => j === idx ? { ...x, precio: correccionRenglon(i)!.valor } : x))} className="ml-2 align-middle">Usar {pesos(correccionRenglon(i)!.valor)}</Boton>
                          </span>
                        )}
                        {esSinCargo(i) ? (
                          <span className="rounded-xl bg-ok-suave px-2.5 py-1.5 text-ok">Sin cargo: entran {numImp(i.cantidad)} que no se pagan. Con el PIN del dueño (abajo) se reparten en el grupo del mismo precio; sin él, solo abaratan este producto.</span>
                        ) : numImp(i.bonificacionPct) > 0 ? (
                          <span className="rounded-xl bg-ok-suave px-2.5 py-1.5 text-ok">Bonificado {numImp(i.bonificacionPct)}%: {
                            // Con el bulto sin decidir y el precio del papel por unidad (Oxxon, 7/10/2026:
                            // 3 cajas × 10 × $3.950,89), lo pagado se compara por UNIDAD; antes decía
                            // "se paga $35.558 (la caja) de los $3.951 (la unidad) de lista".
                            numImp(i.unidadesPorBulto) > 1 && precioYaEsDeLaUnidad(i, Math.round(numImp(i.unidadesPorBulto)))
                              ? <>se paga {pesos(precioEfectivo(i) / Math.round(numImp(i.unidadesPorBulto)))} por unidad de los {pesos(numImp(i.precio))} de lista.</>
                              : <>se paga {pesos(precioEfectivo(i))} de los {pesos(numImp(i.precio))} de lista.</>
                          }</span>
                        ) : null}
                        {(() => {
                          // «×N» sin resolver: la pregunta, la evidencia y las TRES salidas
                          // (6/10/2026). Antes afirmaba "28 caja(s) = 392 unidades" y el
                          // único botón multiplicaba, aunque los 28 ya fueran unidades.
                          const o = opcionesDelBulto(i);
                          if (!o) return null;
                          const cant = (n: number) => n.toLocaleString('es-AR');
                          const marca = (s: 'unidades' | 'convertir' | 'caja') => (o.sugerida === s ? <span className="ml-1 font-semibold">· sugerido</span> : null);
                          const salidas = [
                            { clave: 'unidades' as const, boton: <Boton key="u" tamano="chico" variante="secundario" onClick={() => marcarYaEnUnidades(idx)}>Ya vienen en unidades{marca('unidades')}</Boton>, cuenta: <>{cant(o.talCual.cantidad)} a {pesos(o.talCual.precio)}</> },
                            // "Multiplicar", no "Pasar a unidades": al lado de "Ya vienen en
                            // unidades" eran dos botones con "unidades" que hacían lo opuesto
                            // (Ana: "si yo pongo pasar a unidades me toma 28 cajas")
                            { clave: 'convertir' as const, boton: <Boton key="c" tamano="chico" variante="secundario" onClick={() => void pasarAUnidad(idx)}>Multiplicar ×{o.n}{marca('convertir')}</Boton>, cuenta: <>{cant(o.convertido.cantidad)} a {pesos(o.convertido.precio)}</> },
                            { clave: 'caja' as const, boton: <Boton key="k" tamano="chico" variante="secundario" onClick={() => marcarEnCajas(idx)}>Dejar en cajas{marca('caja')}</Boton>, cuenta: <>el producto es la caja</> },
                          ];
                          // la sugerida primero; sin sugerencia, en el orden de siempre
                          if (o.sugerida) salidas.sort((a, b) => Number(b.clave === o.sugerida) - Number(a.clave === o.sugerida));
                          return (
                            <span className="flex flex-col gap-1.5 rounded-xl bg-info-suave px-2.5 py-2 text-info">
                              <span>
                                {o.dice} <b>×{o.n}</b> (lo que trae cada caja). {o.pregunta}
                                {o.motivo && <span className="block text-info/80">{o.rechazada ? 'El lector lo había resuelto así' : o.sugerida === 'convertir' ? 'Parecen cajas' : o.sugerida === 'unidades' ? 'Parecen unidades' : o.sugerida === 'caja' ? 'Parece que el producto es la caja' : 'Ojo'}: {o.motivo}.</span>}
                              </span>
                              <span className="flex flex-wrap gap-x-3 gap-y-1.5">
                                {salidas.map((s) => (
                                  <span key={s.clave} className="inline-flex flex-wrap items-center gap-1.5">
                                    {s.boton}
                                    <span className="text-info/80">{s.cuenta}</span>
                                  </span>
                                ))}
                              </span>
                            </span>
                          );
                        })()}
                        {estadoDelBulto(i) === 'ya_en_unidades' && (
                          // a lo que factura el renglón (el importe), igual que las cuentas de los botones
                          <span className="text-ok">Entran <b>{numImp(i.cantidad).toLocaleString('es-AR')}</b> a {pesos(baseUnitaria(i))}, como dice el papel: el ×{Math.round(numImp(i.bultoDescartado))} es lo que trae cada caja, no la cantidad.
                            {i.bultoAuto && i.razonBulto?.motivo && <span className="text-tinta/70"> Lo decidió el lector: {i.razonBulto.motivo}.</span>}
                            {/* "cambiar", no "no, son cajas": vuelve a la pregunta, no deja nada en cajas */}
                            <button onClick={() => deshacerBultoDescartado(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>{i.bultoAuto ? 'cambiar' : 'deshacer'}</button>
                          </span>
                        )}
                        {estadoDelBulto(i) === 'caja' && (
                          <span className="text-info">Entran <b>{numImp(i.cantidad).toLocaleString('es-AR')} caja(s) de {Math.round(numImp(i.bultoDescartado))}</b> a {pesos(baseUnitaria(i))}: el producto es la caja.
                            {i.bultoAuto && i.razonBulto?.motivo && <span className="text-tinta/70"> Lo decidió el lector: {i.razonBulto.motivo}.</span>}
                            <button onClick={() => deshacerBultoDescartado(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>{i.bultoAuto ? 'cambiar' : 'deshacer'}</button>
                          </span>
                        )}
                        {i.importeConIvaLeido != null && (
                          <span className="text-info">El importe leído ({pesos(Math.abs(numImp(i.importeConIvaLeido)))}) traía el IVA adentro: se toma el neto <b>{pesos(Math.abs(numImp(i.importe)))}</b>.</span>
                        )}
                        {numImp(i.envaseAplicado) > 1 && (
                          <span className="text-info">La factura trae unidades sueltas: {numImp(i.cantidad) * Math.round(numImp(i.envaseAplicado))} u. = <b>{numImp(i.cantidad)} caja(s) de {Math.round(numImp(i.envaseAplicado))}</b> a {pesos(numImp(i.precio))} cada una.
                            <button onClick={() => deshacerEnvases(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                          </span>
                        )}
                        {numImp(i.paqueteAplicado) > 0 && (
                          <span className="text-info">Facturado por kilo: entran <b>{numImp(i.cantidad)} paquete(s) de {Math.round(numImp(i.paqueteAplicado))} g</b> a {pesos(numImp(i.precio))} cada uno.
                            <button onClick={() => deshacerPaquetes(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                          </span>
                        )}
                        {(() => {
                          const c = sugerirConversion(i);
                          if (!c) return null;
                          return (
                            <span className="rounded-xl bg-info-suave px-2.5 py-1.5 text-info">
                              {c.tipo === 'kilo_a_paquete'
                                ? <>La factura cobra por kilo y el producto viene en paquetes de <b>{c.factor} g</b>: ¿son <b>{c.cantidadNueva} paquetes</b> a {pesos(c.precioNuevo)} cada uno?</>
                                : <>El producto es la caja de <b>{c.factor}</b> y vienen {numImp(i.cantidad)} u.: ¿son <b>{c.cantidadNueva} cajas</b> a {pesos(c.precioNuevo)}?</>}
                              <Boton
                                tamano="chico"
                                variante="secundario"
                                onClick={() => (c.tipo === 'kilo_a_paquete'
                                  ? pasarAPaquetes(idx, c.factor, c.cantidadNueva, c.precioNuevo)
                                  : armarEnvases(idx, c.factor))}
                                className="ml-2 align-middle"
                              >
                                {c.tipo === 'kilo_a_paquete' ? 'Pasar a paquetes' : 'Armar cajas'}
                              </Boton>
                              <span className="ml-1 text-info/80">(dejalo así si ya viene en la unidad de stock)</span>
                            </span>
                          );
                        })()}
                        {numImp(i.bultoAplicado) > 1 && (
                          <span className="text-info">Convertido a unidades (caja de {Math.round(numImp(i.bultoAplicado))}).
                            <button onClick={() => volverABulto(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                          </span>
                        )}
                        {medidaVariable(i) && (
                          <span className="rounded-xl bg-info-suave px-2.5 py-1.5 text-info">Se factura por peso: el importe ({pesos(Math.abs(numImp(i.importe)))}) a {pesos(numImp(i.precio))} el kilo da <b>{pesoDelImporte(i).toFixed(3).replace('.', ',')} kg</b>, pero entra como {numImp(i.cantidad)} unidad(es).
                            <Boton tamano="chico" variante="secundario" onClick={() => pasarAPeso(idx)} className="ml-2 align-middle">Pasar a kilos</Boton>
                            <span className="ml-1 text-info/80">(dejalo así solo si en stock va la horma entera)</span>
                          </span>
                        )}
                        {i.porPeso && numImp(i.cantidad) > 0 && !medidaVariable(i) && (
                          <span className="text-info">Por peso: {numImp(i.cantidad).toLocaleString('es-AR')} kg a {pesos(numImp(i.precio))} el kilo.
                            <button onClick={() => deshacerPeso(idx)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                          </span>
                        )}
                      </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* buscador para vincular el producto a este renglón */}
                  {!i._esDescuento && vinculaIdx === idx && (
                    <div className="relative mt-2 sm:ml-6">
                      <input autoFocus value={vinculaBusca} onChange={(e) => setVinculaBusca(e.target.value)} placeholder="Buscar por nombre, código o PLU…" aria-label="Buscar el producto por nombre, código o PLU" className={input} />
                      {/* El vínculo puede estar mal y el producto correcto no existir todavía
                          (té Marolio vinculado al paté Marolio, 15/9/2026): el alta tiene que
                          estar acá también, no solo en los renglones sin vincular. */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-tinta/60">¿No está en el catálogo?</span>
                        <button onClick={() => abrirAlta(idx, i)} className={CHIP_ACCION}>Dar de alta un producto nuevo</button>
                        {i.sku && (
                          <button
                            onClick={() => { setFotoItems((xs) => xs.map((x, j) => j === idx ? alCambiarVinculo({ ...x, sku: '', nombre: null, variacionPct: null, sugerido: false, motivoIa: null, incluir: false, alicuotaCatalogo: null, costoCatalogo: null }) : x)); setVinculaIdx(null); }}
                            className={unir(ENLACE, 'text-tinta/70 hover:text-marca-hondo')}
                          >
                            Quitar el vínculo
                          </button>
                        )}
                        <button onClick={() => setVinculaIdx(null)} className={unir(ENLACE, 'ml-auto text-tinta/70')}>cerrar</button>
                      </div>
                      {vinculaSug.length > 0 && (
                        <div className="absolute z-contenido mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
                          {vinculaSug.map((p: any) => (
                            <button key={p.sku} onClick={() => vincularProducto(idx, p)} className="min-h-11 w-full border-b border-black/[0.06] px-3 py-2 text-left last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-tinta min-w-0 break-words">{p.nombre}{p.marca ? <span className="text-tinta/60"> · {p.marca}</span> : null}</span>
                                {p.precio != null && <span className="importe shrink-0 text-xs font-medium text-ok">{pesos(p.precio)}</span>}
                              </div>
                              <div className="text-xs text-tinta/60">{p.sku}{p.categoria ? ` · ${p.categoria}` : ''}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* alta ahí mismo: el producto no existe todavía en el catálogo */}
                  {altaIdx === idx && (
                    <div className="mt-2 space-y-2 rounded-xl border border-marca/30 bg-marca-suave p-3 sm:ml-6">
                      <p className="text-xs font-semibold text-tinta">Dar de alta este producto</p>
                      <p className="text-xs text-tinta/60 -mt-1">
                        Queda creado y vinculado a este renglón. El costo sale de la factura ({pesos(costoFinal(i))}) y se guarda contra este proveedor, así la próxima factura lo reconoce sola.
                      </p>
                      <input autoFocus value={altaForm.nombre} onChange={(e) => setAltaForm((x: any) => ({ ...x, nombre: e.target.value }))} placeholder="Nombre del producto" aria-label="Nombre del producto" className={CAMPO_BLANCO} />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input value={altaForm.rubro} onChange={(e) => setAltaForm((x: any) => ({ ...x, rubro: e.target.value }))} placeholder="Rubro" aria-label="Rubro" list="rubros-alta" className={CAMPO_BLANCO} />
                        <datalist id="rubros-alta">{categorias.map((c: any) => <option key={c.id} value={c.nombre} />)}</datalist>
                        <input value={altaForm.marca} onChange={(e) => setAltaForm((x: any) => ({ ...x, marca: e.target.value }))} placeholder="Marca" aria-label="Marca" className={CAMPO_BLANCO} />
                        <input value={altaForm.codigoBarras} onChange={(e) => setAltaForm((x: any) => ({ ...x, codigoBarras: e.target.value }))} placeholder="Código de barras" aria-label="Código de barras" className={unir(CAMPO_BLANCO, 'font-mono')} />
                      </div>
                      {altaError && <p className="text-xs text-marca-hondo">{altaError}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <a href="/productos/nuevo" target="_blank" rel="noreferrer" className={unir(ENLACE, 'text-xs text-tinta/70')}>
                          Cargar la ficha completa (se abre aparte)
                        </a>
                        <span className="flex flex-wrap gap-2">
                          <Boton tamano="chico" variante="secundario" onClick={() => setAltaIdx(null)}>Cancelar</Boton>
                          <Boton
                            tamano="chico"
                            onClick={() => crearDesdeFactura(idx, i)}
                            disabled={creandoProd || !altaForm.nombre.trim()}
                          >
                            {creandoProd ? 'Creando…' : 'Crear y vincular'}
                          </Boton>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {fotoItems.some((i) => i.incluir && !i.sku) && (
                <p className="text-xs text-marca-hondo">Hay renglones tildados sin producto asignado: vinculalos o destildalos.</p>
              )}
              {fotoItems.some((i) => i.sugerido) && (
                <p className="text-xs text-atencion"><IconoInfo className="mr-1 inline size-4 align-[-3px]" />La IA sugirió {fotoItems.filter((i) => i.sugerido).length} vínculo(s): confirmá “¿es este?” en los renglones amarillos para incluirlos.</p>
              )}
              <p className="text-xs text-tinta/60">Al confirmar, cada vínculo y su remarcación quedan guardados: la próxima compra de este proveedor los toma solos.</p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta">
                {/* Con datos fiscales el costo se reconcilia solo (prorrateo); el checkbox
                    "Sumar IVA" queda solo para remitos sin pie. */}
                {!hayDatosFiscales && foto.comprobante?.tipo === 'factura_a' && (
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={sumarIva} onChange={(e) => setSumarIva(e.target.checked)} className="size-4 shrink-0 accent-marca" /> Sumar IVA al costo (precios netos)</label>
                )}
                {hayDatosFiscales && (
                  <label className="flex min-h-9 items-center gap-2" title="Percepciones de IVA e IIBB adentro del costo">
                    <input type="checkbox" checked={percepcionesAlCosto} onChange={(e) => setPercepcionesAlCosto(e.target.checked)} className="size-4 shrink-0 accent-marca" />
                    Percepciones al costo{percepciones > 0 ? ` (${pesos(percepciones)})` : ''}
                  </label>
                )}
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={pagada} onChange={(e) => setPagada(e.target.checked)} className="size-4 shrink-0 accent-marca" /> Pagada (contado)</label>
                <label className="flex items-center gap-2" title="Se aplica a todos los renglones de la factura">% remarcación general <input type="number" value={f.margenPct ?? ''} onChange={(e) => aplicarRemarcacionGeneral(e.target.value)} placeholder="a todos" className={unir(CAMPO_FILA_BASE, CAMPO_FILA_COLOR, 'w-20')} /></label>
              </div>

              {/* Reconciliación del costo vs la mercadería de la factura */}
              <div className={'rounded-xl px-3 py-2.5 text-xs ' + (excedeMerc || excedeTotal ? 'bg-marca-suave border border-marca text-marca-hondo' : subCosteo ? 'bg-atencion-suave border border-atencion/30 text-atencion' : 'bg-crema-claro text-tinta/70')}>
                <p className="importe whitespace-normal">Costo a stock (renglones tildados): <b>{pesos(sumaCostos)}</b>{valorConIva != null && <> · Mercadería c/IVA: <b>{pesos(valorConIva)}</b></>}{totalDoc != null && <> · Total factura: <b>{pesos(totalDoc)}</b></>}</p>
                {/* De dónde sale el costo de cada renglón, escrito. Sin esto, la
                    única forma de saber si falta un impuesto es sacar la cuenta
                    a mano y desconfiar del sistema. */}
                {hayDatosFiscales && netoDoc != null && netoDoc > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    <span className="importe rounded-full bg-white px-2.5 py-0.5 text-tinta/70">Neto <b className="text-tinta">{pesos(netoDoc)}</b></span>
                    {ivaDoc != null && <span className="importe rounded-full bg-white px-2.5 py-0.5 text-tinta/70">+ IVA <b className="text-tinta">{pesos(ivaDoc)}</b> ({(ivaDoc / netoDoc * 100).toFixed(2).replace('.', ',')}%)</span>}
                    {percIvaDoc > 0 && <span className={'importe rounded-full px-2.5 py-0.5 ' + (percepcionesAlCosto ? 'bg-white text-tinta/70' : 'bg-white/40 text-tinta/60 line-through')}>+ Percepción IVA <b>{pesos(percIvaDoc)}</b> ({(percIvaDoc / netoDoc * 100).toFixed(2).replace('.', ',')}%)</span>}
                    {percIibbDoc > 0 && <span className={'importe rounded-full px-2.5 py-0.5 ' + (percepcionesAlCosto ? 'bg-white text-tinta/70' : 'bg-white/40 text-tinta/60 line-through')}>+ Percepción IIBB <b>{pesos(percIibbDoc)}</b> ({(percIibbDoc / netoDoc * 100).toFixed(2).replace('.', ',')}%)</span>}
                    {impIntDoc > 0 && <span className="importe rounded-full bg-white px-2.5 py-0.5 text-tinta/70">+ Internos <b className="text-tinta">{pesos(impIntDoc)}</b></span>}
                    {descuentoGlobalDoc > 0 && <span className="importe rounded-full bg-white px-2.5 py-0.5 text-tinta/70">Descuento del pie <b className="text-tinta">{pesos(descuentoGlobalDoc)}</b></span>}
                    {totalDoc != null && <span className="importe rounded-full bg-tinta px-2.5 py-0.5 text-crema">= Total <b>{pesos(totalDoc)}</b></span>}
                  </div>
                )}
                {ivaFactura?.estado === 'cierra' && (
                  <p className="mt-1 text-ok">
                    <IconoOk className="mr-1 inline size-4 align-[-3px]" /><b>IVA verificado:</b> cada renglón con su alícuota suma {pesos(ivaFactura.ivaCalculado)}, igual al IVA del pie.
                    {ivaFactura.cargaComunPct > 0 && <> Percepciones{impIntDoc > 0 ? ' e internos' : ''}: +{(ivaFactura.cargaComunPct * 100).toFixed(2).replace('.', ',')}% sobre el neto de cada renglón.</>}
                    {' '}<span className="text-tinta/60">Pasá el mouse por el precio c/IVA de un renglón para ver su cuenta.</span>
                  </p>
                )}
                {ivaFactura?.estado === 'no_cierra' && (
                  <div className="mt-1.5 rounded-xl border border-marca bg-marca-suave px-2.5 py-2 text-marca-hondo">
                    <p className="font-semibold"><IconoAtencion className="mr-1 inline size-4 align-[-3px]" />El IVA no cierra: los renglones suman {pesos(ivaFactura.ivaCalculado)} de IVA y el pie dice {pesos(ivaFactura.ivaPie)}
                      {' '}({ivaFactura.diferencia < 0 ? 'sobran' : 'faltan'} {pesos(Math.abs(ivaFactura.diferencia))}). No se puede registrar hasta que cierre.</p>
                    <p className="mt-0.5">
                      {ivaFactura.diferencia < 0
                        ? 'Hay renglones cargados con más IVA del que tienen: suele ser un producto al 10,5% (legumbres, carnes, frutas, verduras, harinas) tomado como 21%.'
                        : 'Hay renglones cargados con menos IVA del que tienen, o el IVA del pie se leyó mal.'}
                      {' '}Corregí la alícuota en el renglón (el recuadro <b>IVA</b>) o el IVA del pie si se leyó mal.
                    </p>
                    {ivaFactura.sugerencias.map((sug, n) => {
                      const nombres = sug.indices.map((k) => renglonesIva[k]?.i).map((it: any) => it?.nombre ?? it?.descripcion ?? '—');
                      return (
                        <p key={n} className="mt-1.5 flex flex-wrap items-center gap-2 text-tinta">
                          <span>Cierra al centavo si <b>{nombres.join(' y ')}</b> {sug.indices.length > 1 ? 'van' : 'va'} al <b>{String(sug.alicuota).replace('.', ',')}%</b>.</span>
                          <Boton
                            tamano="chico"
                            variante="secundario"
                            onClick={() => elegirAlicuota(sug.indices.map((k) => renglonesIva[k].idx), sug.alicuota)}
                          >
                            Sí, aplicar {String(sug.alicuota).replace('.', ',')}%
                          </Boton>
                        </p>
                      );
                    })}
                  </div>
                )}
                {ivaFactura?.estado === 'falta_pie' && (
                  <p className="mt-1.5 rounded-xl border border-marca bg-marca-suave px-2.5 py-2 font-semibold text-marca-hondo">
                    <IconoAtencion className="mr-1 inline size-4 align-[-3px]" />{ivaFactura.motivo}: sin eso no hay contra qué verificar el IVA. Cargalo en el pie (arriba) para poder registrar.
                  </p>
                )}
                {ivaFactura?.estado === 'alicuota_invalida' && (
                  <p className="mt-1.5 rounded-xl border border-marca bg-marca-suave px-2.5 py-2 font-semibold text-marca-hondo">
                    <IconoAtencion className="mr-1 inline size-4 align-[-3px]" />La lectura trajo una alícuota que no existe en {ivaFactura.indices.length === 1 ? 'un renglón' : `${ivaFactura.indices.length} renglones`}
                    {' '}({ivaFactura.indices.map((k) => renglonesIva[k]?.i?.descripcion).join(', ')}). Elegí la correcta en el recuadro IVA del renglón.
                  </p>
                )}
                {!ivaFactura && hayDatosFiscales && sumaRenglones > 0 && (
                  <p className="mt-1 text-tinta/70">
                    Comprobante sin IVA discriminado: el precio ya lo trae adentro. Cada renglón leído <b>× {factorRecon.toFixed(4).replace('.', ',')}</b>
                    {percepcionesAlCosto && percepciones > 0 ? ` (incluye percepciones ${pesos(percepciones)})` : ''}.
                  </p>
                )}
                {(excedeMerc || excedeTotal) && (
                  <p className="mt-1 font-semibold"><IconoAtencion className="mr-1 inline size-4 align-[-3px]" />El costo a stock supera el valor de la mercadería con IVA de la factura. Los precios ya incluyen impuestos: revisá el neto/IVA del pie. (No se puede registrar hasta corregirlo.)</p>
                )}
                {hayRegalos && !prorrateoAut && (
                  <div className="mt-1.5 rounded-xl bg-atencion-suave px-2.5 py-2 text-atencion">
                    <p><b>Esta factura trae mercadería regalada.</b> Por ahora el regalo solo abarata a su propio producto.
                    Para repartirlo entre <b>todo el grupo del mismo precio de lista</b> (el 10+1 baja el costo de todos los varietales),
                    lo autoriza el dueño con su PIN:</p>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input
                        type="password" inputMode="numeric" value={pinProrrateo} placeholder="PIN del dueño"
                        aria-label="PIN del dueño"
                        onChange={(e) => setPinProrrateo(e.target.value)}
                        className={unir(CAMPO_FILA_BASE, 'w-36 border-black/15 bg-white text-left')}
                      />
                      <Boton
                        tamano="chico"
                        onClick={async () => {
                          // fetch directo: el helper post() cierra el modal al
                          // terminar, y esto ocurre A MITAD de la carga
                          setErrorProrrateo('');
                          try {
                            const res = await fetch('/api/compras', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ accion: 'autorizarProrrateo', pin: pinProrrateo }),
                            });
                            const r = await res.json();
                            if (res.ok && r?.ok) { setProrrateoAut({ nombre: r.nombre }); setPinProrrateo(''); }
                            else setErrorProrrateo(r?.message ?? 'PIN incorrecto');
                          } catch { setErrorProrrateo('No se pudo verificar el PIN'); }
                        }}
                        disabled={!pinProrrateo.trim()}
                      >
                        Autorizar prorrateo
                      </Boton>
                      {errorProrrateo && <span className="text-xs font-medium text-marca-hondo">{errorProrrateo}</span>}
                    </span>
                  </div>
                )}
                {hayRegalos && prorrateoAut && (
                  <p className="mt-1.5 rounded-xl bg-ok-suave px-2.5 py-2 text-ok">
                    Prorrateo autorizado por <b>{prorrateoAut.nombre}</b>: el regalo se reparte entre todo el grupo del mismo precio.
                    <button onClick={() => setProrrateoAut(null)} className={unir(ENLACE, 'ml-2 text-tinta/70 hover:text-marca-hondo')}>deshacer</button>
                  </p>
                )}
                {skusFusionados.length > 0 && (
                  <div className="mt-1.5 rounded-xl bg-ok-suave px-2.5 py-2 text-ok">
                    <p><b>{skusFusionados.length}</b> producto(s) con mercadería sin cargo o repetidos. {prorrateoAut ? 'El regalo se reparte entre todo el grupo del mismo precio:' : 'El regalo abarata solo a su propio producto (sin autorización de prorrateo):'}</p>
                    {skusFusionados.map((i) => (
                      <p key={i.sku} className="mt-0.5">
                        · {i.nombre ?? i.descripcion}:{' '}
                        {i._gratis > 0
                          ? <><b>{i.cantidad - i._gratis}</b> pagadas + <b>{i._gratis}</b> sin cargo = <b>{i.cantidad}</b> a <b>{pesos(i.costoUnitario)}</b> c/u</>
                          : <><b>{i.cantidad}</b> en total a <b>{pesos(i.costoUnitario)}</b> c/u</>}
                        <span className="text-ok/80"> ({i._renglones} renglones)</span>
                      </p>
                    ))}
                  </div>
                )}
                {sinAtribuir.length > 0 && (
                  <p className="mt-1.5 rounded-xl bg-marca-suave px-2.5 py-2 font-medium text-marca-hondo">
                    <IconoAtencion className="mr-1 inline size-4 align-[-3px]" />Hay <b>{sinAtribuir.length}</b> rebaja(s) por <b>{pesos(sinAtribuir.reduce((a, x) => a + x.importe, 0))}</b> que no se pudo saber
                    a qué renglón corresponden, así que no se aplicaron a ningún costo. Si son promociones de toda la factura, cargalas en
                    “Desc. del pie” y se reparten entre todos los renglones.
                  </p>
                )}
                {descuentosDesmedidos > 0 && (
                  <p className="mt-1.5 rounded-xl bg-marca-suave px-2.5 py-2 font-medium text-marca-hondo">
                    <IconoAtencion className="mr-1 inline size-4 align-[-3px]" /><b>{descuentosDesmedidos}</b> renglón/es tienen un descuento más grande que el renglón mismo, así que no se aplicó.
                    Suele pasar cuando la rebaja cubre varios renglones o toda la factura y no uno solo. Revisá a qué corresponde antes de registrar:
                    si se aplicara entero a un renglón, ese producto entraría con el costo por el piso.
                  </p>
                )}
                {bultosSinResolver > 0 && (
                  <p className="mt-1.5 rounded-xl bg-info-suave px-2.5 py-2 text-info">
                    {/* No afirma que "queda mal": dejar la cantidad del papel es lo correcto
                        cuando ya viene en unidades (6/10/2026). */}
                    {bultosSinResolver === 1 ? <><b>1</b> renglón trae</> : <><b>{bultosSinResolver}</b> renglones traen</>} cuántas unidades tiene la caja ({presentacionesSinResolver.map((n) => `×${n}`).join(', ')})
                    y falta elegir si la cantidad del papel son cajas o unidades. En cada uno tocá «Ya vienen en unidades», «Multiplicar» o «Dejar en cajas».
                    Si registrás así, entran con la cantidad y el precio del papel.
                  </p>
                )}
                {columnaSospechosa && (
                  <p className="mt-1.5 rounded-xl bg-atencion-suave px-2.5 py-2 text-atencion">
                    <IconoAtencion className="mr-1 inline size-4 align-[-3px]" />Los renglones leídos suman <b>{pesos(sumaRenglones)}</b> y el pie espera <b>{pesos(netoEsperado ?? 0)}</b>
                    {descuentoGlobalDoc > 0 ? ` (neto ${pesos(netoDoc ?? 0)} + descuento del pie ${pesos(descuentoGlobalDoc)})` : ''}
                    {' '}({desvioRenglones! > 0 ? '+' : ''}{(desvioRenglones! * 100).toFixed(1).replace('.', ',')}%).
                    Si tendrían que coincidir, la IA leyó la columna equivocada (la de con IVA, o el total del renglón en vez del precio unitario).
                    Corregilo antes de registrar: el costo de todos los renglones sale de esa proporción.
                  </p>
                )}
                {subCosteo && !excedeMerc && !excedeTotal && (
                  <p className="mt-1">El costo quedó por debajo de lo esperado para los renglones tildados; revisá que no falte ninguno.</p>
                )}
                {!hayDatosFiscales && (
                  <p className="mt-1 text-tinta/60">Sin datos fiscales para verificar el costo: se toma el precio leído {sumarIva ? '+ IVA' : 'tal cual'}.</p>
                )}
              </div>

              {foto.notasManuscritas && <p className="break-words text-xs italic text-tinta/60">Nota manuscrita: {foto.notasManuscritas}</p>}

              {/* la mercadería ya entró por Recepción → solo factura + conciliación */}
              {foto.comprobante?.tipo?.startsWith('factura') && (
                <label className="flex min-h-9 items-start gap-2 text-xs text-tinta">
                  <input type="checkbox" checked={soloFactura} onChange={(e) => setSoloFactura(e.target.checked)} className="mt-px size-4 shrink-0 accent-marca" />
                  La mercadería ya fue recibida con la pistola — solo cargar la factura (va a Conciliación, no mueve stock)
                </label>
              )}

              {aviso && <Aviso tono="error">{aviso}</Aviso>}
              </div>
            </div>
          )}
        </>)}

        {t === 'proveedor' && (<>
          {/* lo que le falta para poder comprarle (regla de la base: proveedor_faltantes, 1/10/2026) */}
          {modal.prov?.faltan?.length > 0 && (
            <p className="rounded-xl border border-marca/20 bg-marca-suave px-3 py-2 text-sm text-marca-hondo">Para poder comprarle falta: {modal.prov.faltan.join(', ')}.</p>
          )}
          <input value={f.razon_social ?? f.razonSocial ?? ''} onChange={(e) => set('razonSocial', e.target.value)} placeholder="Razón social" aria-label="Razón social" className={input} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={f.cuit ?? ''} onChange={(e) => set('cuit', e.target.value)} placeholder="CUIT (11 números)" aria-label="CUIT" className={input} />
            <input value={f.condicion_pago ?? f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición (30 días…)" aria-label="Condición de pago" className={input} />
            <input value={f.telefono ?? ''} onChange={(e) => set('telefono', e.target.value)} placeholder="Teléfono / WhatsApp" aria-label="Teléfono / WhatsApp" className={input} />
            <input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="Email" aria-label="Email" className={input} />
            <input type="number" value={f.lead_time_dias ?? f.leadTimeDias ?? ''} onChange={(e) => set('leadTimeDias', e.target.value)} placeholder="Días de entrega" aria-label="Días de entrega" className={input} />
            <label className="flex min-h-11 items-center gap-2 text-sm text-tinta/70">
              <input type="checkbox" className="size-5 shrink-0 accent-marca" checked={!!(f.leadTimeConfirmado ?? f.lead_time_confirmado)} onChange={(e) => set('leadTimeConfirmado', e.target.checked)} />
              Plazo confirmado con el proveedor
            </label>
          </div>
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'factura' && (<>
          <select aria-label="Proveedor" className={input} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} placeholder="N° de factura" aria-label="N° de factura" className={input} />
            <input type="number" value={f.monto ?? ''} onChange={(e) => set('monto', e.target.value)} placeholder="Monto $" aria-label="Monto" className={input} />
          </div>
          <input type="date" value={f.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} aria-label="Vencimiento" className={input} />
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}

        {t === 'pagar' && (<>
          <p className="text-xs text-tinta/60">Elegí las facturas. La OP queda <b>pendiente de aprobación del dueño</b> antes de pagarse.</p>
          {modal.prov.facturas.map((fa: any) => (
            <label key={fa.id} className="flex min-h-11 items-center gap-3 border-b border-black/[0.06] py-1.5 text-sm text-tinta">
              <input type="checkbox" checked={facturasSel.includes(fa.id)} onChange={(e) => setFacturasSel((s) => e.target.checked ? [...s, fa.id] : s.filter((x) => x !== fa.id))} className="size-5 shrink-0 accent-marca" />
              <span className="min-w-0 flex-1 break-words">Factura {fa.numero} {fa.vencimiento ? `· vence ${fecha(fa.vencimiento)}` : ''}</span>
              <span className="importe shrink-0 font-medium">{pesos(fa.monto ?? 0)}</span>
            </label>
          ))}
          <div className="grid grid-cols-2 items-end gap-3">
            <select aria-label="Medio de pago" className={input} value={f.medioPago ?? 'transferencia'} onChange={(e) => set('medioPago', e.target.value)}>
              <option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="efectivo">Efectivo</option>
            </select>
            <label className="min-w-0"><span className={ROTULO_CAMPO}>Pago programado</span><input type="date" value={f.fechaProgramada ?? ''} onChange={(e) => set('fechaProgramada', e.target.value)} className={input} /></label>
          </div>
          <input value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" aria-label="Observaciones" className={input} />
          {facturasSel.length > 0 && <p className="importe text-right text-sm font-semibold text-tinta">Total OP: {pesos(modal.prov.facturas.filter((x: any) => facturasSel.includes(x.id)).reduce((s: number, x: any) => s + Number(x.monto), 0))}</p>}
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </>)}
      </div>
      {dialogo}
    </Ventana>
  );
}

// Detalle de una factura de proveedor ya registrada: desglose fiscal + renglones.
// Detalle de una orden de compra: qué se pidió, qué llegó y con qué papeles.
// La factura se abre desde acá — que es donde uno tiene la duda — en lugar de
// mandar a nadie a buscarla a otra pantalla.
function OrdenDetalle({ id, numero, cerrar, verFactura }: { id: string; numero: number; cerrar: () => void; verFactura: (facturaId: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  // CORREGIR INGRESO (7/10/2026, OC #58: el Merlot entró como 2 cajas a
  // $114.000 en vez de 12 botellas a $19.000). Cantidad y costo por renglón,
  // con motivo; la base ajusta stock, costo, precio y deja el registro.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [cambios, setCambios] = useState<Record<string, { cantidad: string; costo: string }>>({});
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msgCorr, setMsgCorr] = useState('');
  const cargar = useCallback(() => {
    fetch(`/api/compras?recurso=orden&id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setD)
      .catch(() => setErr('No se pudo cargar el detalle de la compra'));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const corregible = !!d && ['recibida', 'recibida_parcial'].includes(String(d.estado));
  const empezarCorreccion = () => {
    const ini: Record<string, { cantidad: string; costo: string }> = {};
    for (const it of d?.items ?? []) ini[it.producto_id] = { cantidad: String(Number(it.cantidad_recibida ?? 0)), costo: String(Number(it.costo_unitario ?? 0)) };
    setCambios(ini); setMotivo(''); setMsgCorr(''); setCorrigiendo(true);
  };
  const renglonesCambiados = (d?.items ?? []).filter((it: any) => {
    const c = cambios[it.producto_id];
    return c && (Number(c.cantidad) !== Number(it.cantidad_recibida ?? 0) || Number(c.costo) !== Number(it.costo_unitario ?? 0));
  });
  const totalNuevo = (d?.items ?? []).reduce((s: number, it: any) => {
    const c = cambios[it.producto_id];
    const cant = c ? Number(c.cantidad) : Number(it.cantidad_recibida ?? 0);
    const costo = c ? Number(c.costo) : Number(it.costo_unitario ?? 0);
    return s + (Number.isFinite(cant) ? cant : 0) * (Number.isFinite(costo) ? costo : 0);
  }, 0);
  const cambiaTotal = corrigiendo && Math.abs(totalNuevo - Number(d?.total ?? 0)) >= 1;
  const conFactura = (d?.facturas ?? []).some((f: any) => f.estado !== 'anulada');
  const guardarCorreccion = async () => {
    setGuardando(true); setMsgCorr('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'corregirIngreso', id, motivo, renglones: renglonesCambiados.map((it: any) => ({ productoId: it.producto_id, cantidad: Number(cambios[it.producto_id].cantidad), costo: Number(cambios[it.producto_id].costo) })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsgCorr(String(j?.message ?? 'No se pudo guardar la corrección')); return; }
      setCorrigiendo(false); cargar();
    } finally { setGuardando(false); }
  };
  // ¿el costo de un renglón es N veces el de otro de la misma compra? → caja contada como unidad
  const sugerenciaCaja = (it: any) => {
    const c = cambios[it.producto_id]; if (!c) return null;
    const costo = Number(c.costo), cant = Number(c.cantidad);
    if (!(costo > 0 && cant > 0)) return null;
    for (const otro of d?.items ?? []) {
      if (otro.producto_id === it.producto_id) continue;
      const ref = Number(cambios[otro.producto_id]?.costo ?? otro.costo_unitario ?? 0);
      if (!(ref > 0)) continue;
      const n = Math.round(costo / ref);
      if (n >= 2 && n <= 48 && Math.abs(costo / ref - n) < 0.02) return { n, cantidad: cant * n, costo: Math.round((costo / n) * 100) / 100 };
    }
    return null;
  };

  const ESTADO_FACT: Record<string, string> = { pendiente: 'pendiente de pago', pagada: 'pagada', en_pago: 'en pago', anulada: 'anulada' };

  return (
    <Ventana
      abierto
      onCerrar={cerrar}
      titulo={<>OC #{numero}{d?.proveedor?.razon_social ? ` · ${d.proveedor.razon_social}` : ''}</>}
      pie={<>
        {/* El papel con folio: es el que se le manda al proveedor y el que
            después respalda el reclamo si lo que llega no coincide. */}
        <a
          href={`/api/documento?tipo=oc&id=${id}`}
          target="_blank"
          rel="noreferrer"
          className={clasesBoton({ variante: 'secundario' })}
        >
          Orden en PDF
        </a>
        {corregible && !corrigiendo && <Boton variante="secundario" onClick={empezarCorreccion}>Corregir ingreso</Boton>}
        {corrigiendo && <Boton variante="secundario" onClick={() => setCorrigiendo(false)} disabled={guardando}>Cancelar corrección</Boton>}
        {corrigiendo && (
          <Boton onClick={guardarCorreccion} cargando={guardando} disabled={guardando || !motivo.trim() || renglonesCambiados.length === 0 || (cambiaTotal && conFactura)}>
            Guardar corrección
          </Boton>
        )}
        {!corrigiendo && <Boton variante="secundario" onClick={cerrar}>Cerrar</Boton>}
      </>}
    >
      {!d && !err && <Cargando />}
      {err && <Aviso tono="error">{err}</Aviso>}
      {d && (
        <div className="space-y-4">
          <div className="rounded-xl bg-crema-claro px-3 py-2 text-sm text-tinta/80">
            <p className="text-xs text-tinta/70">
              {d.sucursal?.nombre} · {fecha(d.creado_en)}
              {d.creador?.nombre ? ` · cargó ${d.creador.nombre}` : ''}
              {d.condicion_pago ? ` · ${d.condicion_pago}` : ''}
              {d.origen === 'directa' ? ' · entrada directa (sin OC previa)' : ''}
            </p>
            {d.observaciones && <p className="mt-0.5 break-words text-xs italic text-tinta/60">“{d.observaciones}”</p>}
          </div>

          {/* Los productos de la orden, como Placa roja (el paquete gráfico de
              pedidos y listas de precios). Pedido de Leandro (2/10/2026):
              "siempre que se detallen productos vamos a usar el paquete gráfico
              de pedidos". Lo pedido va en el círculo; lo que falta recibir, en
              rojo (antes era el número de "Recibido" en rojo: misma regla).
              Ya no tiene alto máximo propio: con una lista larga se desplaza la
              ventana entera, no una caja adentro de otra. */}
          <PlacaRoja
            titulo="ORDEN DE COMPRA"
            sub={<>OC #{numero}{d.proveedor?.razon_social ? ` · ${d.proveedor.razon_social}` : ''}</>}
            renglones={(d.items ?? []).map((it: any, i: number) => {
              const pedida = Number(it.cantidad ?? 0);
              const recibida = Number(it.cantidad_recibida ?? 0);
              const costo = Number(it.costo_unitario ?? 0);
              const faltan = pedida - recibida;
              return {
                clave: String(i),
                cantidad: pedida,
                nombre: it.producto?.nombre ?? '—',
                detalle: [it.producto?.sku, `${cifra(pedida, 2)} × ${pesos(costo)}`, `recibido ${cifra(recibida, 2)} de ${cifra(pedida, 2)}`].filter(Boolean).join(' · '),
                destacado: recibida < pedida ? `Falta${faltan === 1 ? '' : 'n'} ${cifra(faltan, 2)} por recibir` : undefined,
                importe: pesos(pedida * costo),
              };
            })}
            total={{ etiqueta: 'TOTAL', valor: pesos(d.total ?? 0) }}
          />

          {corrigiendo && (
            <div className="space-y-3 rounded-xl border border-marca/30 bg-white p-3">
              <p className="text-sm font-semibold text-tinta">Corregir lo que entró</p>
              <p className="text-xs text-tinta/70">Cambiá lo que llegó de verdad y a qué costo por unidad. El stock se ajusta por la diferencia; si este ingreso era el último costo del producto, también se corrigen el costo y el precio de venta. La factura no se toca.</p>
              {(d.items ?? []).map((it: any) => {
                const c = cambios[it.producto_id] ?? { cantidad: '', costo: '' };
                const antesCant = Number(it.cantidad_recibida ?? 0), antesCosto = Number(it.costo_unitario ?? 0);
                const dif = Number(c.cantidad) - antesCant;
                const sug = sugerenciaCaja(it);
                const poner = (campo: 'cantidad' | 'costo', v: string) => setCambios((x) => ({ ...x, [it.producto_id]: { ...c, [campo]: v } }));
                return (
                  <div key={it.producto_id} className="rounded-xl bg-crema-claro p-2.5">
                    <p className="break-words text-sm font-medium text-tinta">{it.producto?.nombre ?? '—'}</p>
                    <p className="text-xs text-tinta/60">entró {cifra(antesCant, 2)} × {pesos(antesCosto)} = {pesos(antesCant * antesCosto)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block"><span className={ROTULO_CAMPO}>Llegaron</span>
                        <input inputMode="decimal" value={c.cantidad} onChange={(e) => poner('cantidad', e.target.value)} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} />
                      </label>
                      <label className="block"><span className={ROTULO_CAMPO}>Costo por unidad $</span>
                        <input inputMode="decimal" value={c.costo} onChange={(e) => poner('costo', e.target.value)} className={unir(CAMPO_FILA, CAMPO_FILA_COLOR)} />
                      </label>
                    </div>
                    {Number.isFinite(dif) && dif !== 0 && (
                      <p className="mt-1.5 text-xs text-tinta/70">Stock {dif > 0 ? '+' : ''}{cifra(dif, 2)} · ahora {cifra(Number(c.cantidad), 2)} × {pesos(Number(c.costo))} = {pesos(Number(c.cantidad) * Number(c.costo))}</p>
                    )}
                    {sug && (
                      <p className="mt-1.5 rounded-xl bg-info-suave px-2.5 py-1.5 text-xs text-info">
                        ¿Eran cajas de {sug.n}? → {cifra(sug.cantidad, 2)} unidades a {pesos(sug.costo)} (mismo subtotal).
                        <Boton tamano="chico" variante="secundario" className="ml-2 align-middle" onClick={() => setCambios((x) => ({ ...x, [it.producto_id]: { cantidad: String(sug.cantidad), costo: String(sug.costo) } }))}>Pasar a {cifra(sug.cantidad, 2)} unidades</Boton>
                      </p>
                    )}
                  </div>
                );
              })}
              <label className="block"><span className={ROTULO_CAMPO}>Motivo (obligatorio)</span>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej.: eran 2 cajas de 6, se cargó la caja como botella" className={CAMPO_BLANCO} />
              </label>
              <p className="text-xs text-tinta/70">Total de la orden: {pesos(Number(d.total ?? 0))}{cambiaTotal ? ` → ${pesos(totalNuevo)}` : ' (no cambia)'}</p>
              {cambiaTotal && conFactura && <Aviso tono="error">El total cambia y esta compra ya tiene factura cargada: corregí primero la factura (Facturas de compra → Pedir cambio).</Aviso>}
              {msgCorr && <Aviso tono="error">{msgCorr}</Aviso>}
            </div>
          )}

          {d.correcciones?.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">Correcciones del ingreso</p>
              <div className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06]">
                {d.correcciones.map((c: any, i: number) => (
                  <div key={i} className="px-3 py-2 text-sm text-tinta/80">
                    <p className="text-xs text-tinta/60">{c.por ? `Corrigió ${c.por}` : 'Corregido'} · {fecha(c.en)}{c.motivo ? ` · “${c.motivo}”` : ''}</p>
                    {(c.despues ?? []).map((r: any, j: number) => {
                      const a = (c.antes ?? []).find((x: any) => x.producto_id === r.producto_id) ?? {};
                      const nombre = (d.items ?? []).find((x: any) => x.producto_id === r.producto_id)?.producto?.nombre ?? 'Producto';
                      return <p key={j} className="break-words text-xs">{nombre}: {cifra(Number(a.cantidad ?? 0), 2)} × {pesos(Number(a.costo ?? 0))} → {cifra(Number(r.cantidad), 2)} × {pesos(Number(r.costo))}{Number(r.stock) ? ` · stock ${Number(r.stock) > 0 ? '+' : ''}${cifra(Number(r.stock), 2)}` : ''}</p>;
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FACTURAS de esta compra: el motivo por el que esto es clickeable */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">Facturas de esta compra</p>
            {d.facturas?.length > 0 ? (
              <div className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06]">
                {d.facturas.map((f: any) => (
                  <button
                    key={f.id}
                    onClick={() => verFactura(f.id)}
                    className={unir('flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-crema-claro', FOCO_ADENTRO)}
                  >
                    <span className="min-w-0">
                      <span className="block min-w-0 break-words text-sm text-tinta">
                        {f.letra ? `${String(f.tipo ?? 'factura').replace('_', ' ')} ${f.letra}` : 'Factura'} {f.numero}
                        {f.tieneComprobante && <Etiqueta className="ml-2 align-middle">con comprobante</Etiqueta>}
                      </span>
                      <span className="text-xs text-tinta/60">
                        {f.fecha_emision ? fecha(f.fecha_emision) : fecha(f.creado_en)} · {ESTADO_FACT[f.estado] ?? f.estado}
                        {f.cargador?.nombre ? ` · cargó ${f.cargador.nombre}` : ''}
                      </span>
                    </span>
                    <span className="importe shrink-0 text-sm font-medium text-tinta">{pesos(f.monto ?? 0)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-tinta/60">Todavía no hay factura cargada para esta compra.</p>
            )}
          </div>

          {d.remitos?.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">Remitos</p>
              <div className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06]">
                {d.remitos.map((r: any) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2 text-sm text-tinta/80">
                    <span className="min-w-0 break-words">
                      {r.numero || 'sin número'} <span className="text-xs text-tinta/60">· {fecha(r.creado_en)} · {String(r.estado ?? '').replace(/_/g, ' ')}</span>
                    </span>
                    <a href={`/api/documento?tipo=remito&id=${r.id}`} target="_blank" rel="noreferrer" className={unir('shrink-0 rounded-sm text-xs font-medium text-marca-hondo underline', FOCO)}>acta de recepción</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Ventana>
  );
}

function FacturaDetalle({ id, cerrar, volviendo }: { id: string; cerrar: () => void; volviendo?: boolean }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/compras?recurso=factura&id=${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setD)
      .catch(() => setErr('No se pudo cargar el detalle de la factura'));
  }, [id]);
  const ESTADO: Record<string, string> = { pendiente: 'Pendiente de pago', pagada: 'Pagada', en_pago: 'En pago' };
  return (
    <Ventana
      abierto
      onCerrar={cerrar}
      titulo={<>Factura {d?.numero ?? ''}</>}
      pie={<Boton variante="secundario" onClick={cerrar}>{volviendo ? 'Volver a la compra' : 'Cerrar'}</Boton>}
    >
      {!d && !err && <Cargando />}
      {err && <Aviso tono="error">{err}</Aviso>}
      {d && (
        <div className="space-y-4">
          <div className="rounded-xl bg-crema-claro px-3 py-2 text-sm text-tinta/80">
            <p className="break-words"><b>{d.proveedor?.razon_social}</b>{d.proveedor?.cuit ? ` · CUIT ${d.proveedor.cuit}` : ''}</p>
            <p className="text-xs text-tinta/70">{fecha(d.creado_en)} · {ESTADO[d.estado] ?? d.estado}{d.vencimiento ? ` · vence ${fecha(d.vencimiento)}` : ''}</p>
          </div>
          {/* Los renglones de la factura, como Placa roja (pedido de Leandro,
              2/10/2026: todo detalle de productos con el paquete gráfico de
              pedidos). El total va en la píldora y el desglose fiscal (neto,
              IVA, percepciones) en el recuadro de abajo. El costo de cada
              renglón es el costo del producto en el sistema, no el renglón
              facturado: por eso va en gris y no se multiplica como subtotal
              (no sumaría el neto de la factura y confundiría). */}
          <PlacaRoja
            titulo={d.tipo === 'nota_credito' ? 'NOTA DE CRÉDITO' : d.tipo === 'nota_debito' ? 'NOTA DE DÉBITO' : 'FACTURA'}
            sub={[[d.letra, d.numero].filter(Boolean).join(' '), d.proveedor?.razon_social].filter(Boolean).join(' · ') || undefined}
            renglones={(d.items ?? []).map((it: any, i: number) => ({
              clave: String(i),
              cantidad: it.cantidad,
              nombre: it.nombre,
              detalle: [it.sku, it.costo != null ? `costo ${pesos(it.costo)}` : ''].filter(Boolean).join(' · ') || undefined,
            }))}
            total={{ etiqueta: 'TOTAL', valor: pesos(d.monto ?? 0) }}
            recuadro={(() => {
              const desglose = ([['Neto gravado', d.neto], ['IVA', d.iva], ['Percepción IVA', d.percepcion_iva], ['Percepción IIBB', d.percepcion_iibb], ['Impuestos internos', d.impuestos_internos], ['Otros impuestos', d.otros_impuestos]] as [string, any][])
                .filter(([, v]) => v != null && Number(v) !== 0);
              if (!desglose.length) return undefined;
              return (
                <dl className="space-y-1">
                  {desglose.map(([l, v]) => (
                    <div key={l} className="flex flex-wrap justify-between gap-x-2">
                      <dt className="min-w-0 text-tinta/70">{l}</dt>
                      <dd className="importe text-tinta">{pesos(v)}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}
            pie={d.items?.length > 0 ? undefined : 'Sin renglones asociados (factura cargada a mano).'}
          />

          {/* El papel original. Es lo que se mira cuando hay una duda: el enlace
              es temporal (lo firma el API, el archivo no es público). */}
          {d.comprobanteUrl ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">Comprobante</p>
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className={unir('rounded-sm text-xs font-medium text-marca-hondo hover:underline', FOCO)}>Abrir en grande</a>
              </div>
              {/pdf(\?|$)/i.test(d.archivo_url ?? d.comprobanteUrl) ? (
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className={unir('block rounded-xl border border-black/[0.06] bg-crema-claro px-3 py-4 text-center text-sm text-tinta/70 hover:border-black/15', FOCO)}>
                  Abrir el comprobante (PDF)
                </a>
              ) : (
                <a href={d.comprobanteUrl} target="_blank" rel="noreferrer" className={unir('block rounded-xl', FOCO)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.comprobanteUrl} alt="Comprobante" className="max-h-96 w-full rounded-xl border border-black/[0.06] bg-white object-contain" />
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-tinta/60">Esta factura se cargó a mano: no hay foto ni PDF del comprobante.</p>
          )}
        </div>
      )}
    </Ventana>
  );
}

// Cancelar + la acción de la ventana. Van sueltos: el pie de la ventana los
// acomoda (en el celular se reparten el ancho). `variante` = 'peligro' en los rechazos.
function Acciones({ cerrar, onOk, okLabel, disabled, variante = 'primario' }: any) {
  const [cargando, setCargando] = useState(false);
  return (
    <>
      <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
      <Boton variante={variante} onClick={async () => { setCargando(true); try { await onOk(); } finally { setCargando(false); } }} disabled={disabled} cargando={cargando}>{okLabel}</Boton>
    </>
  );
}
