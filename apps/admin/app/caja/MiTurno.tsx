'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boton, Entrada, IconoCerrar, PlacaRoja, Selector, unir, FOCO, FOCO_ADENTRO, ROTULO } from '../ui/kit';
import { hora, numero, pesos } from '../lib/formato';

// ============================================================
// "MI TURNO" — la caja deja de ser ciega (2026-09-12)
//
// La cajera cobraba y no volvía a ver nada: ni cuánto llevaba vendido, ni qué
// facturas emitió, ni cómo cobró cada ticket. Cuando el cliente volvía al
// mostrador ("¿me cobraste bien?", "quiero pagar con otra cosa"), la única
// salida era llamar a un gerente o anular la venta.
//
// Esta pantalla le da su turno completo, en vivo: el total por medio de pago,
// cada ticket con su comprobante, y el cambio de medio de pago con PIN.
// Todo lo pesado lo agrega Postgres: acá solo se pinta.
// ============================================================

const ETIQUETA_TIPO: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C', REM: 'Remito',
  NCA: 'N. crédito A', NCB: 'N. crédito B', NCC: 'N. crédito C',
};

// Los medios con los que la caja puede rearmar un pago. Coinciden con los
// botones de cobro: lo que la cajera ya conoce.
const MEDIOS: { valor: string; etiqueta: string; terminal?: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta Getnet', terminal: 'getnet' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta Clover', terminal: 'clover' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'cta_cte', etiqueta: 'Cuenta corriente' },
];

type Resumen = {
  tickets: number;
  anuladas: number;
  total: number;
  ticketPromedio: number;
  medios: { medio: string; terminal: string | null; etiqueta: string; monto: number; pagos: number }[];
  efectivoVentas: number;
  ingresos: number;
  egresos: number;
  comprobantes: { tipo: string; cantidad: number; sinCae: number }[];
};

type VentaFila = {
  id: string;
  ticket: string;
  total: number;
  estado: string;
  vendidaEn: string;
  cliente: { nombre: string | null; dni: string | null } | null;
  pagos: { medio: string; terminal: string | null; monto: number; etiqueta: string }[];
  comprobante: { tipo: string; puntoVenta: number; numero: number; cae: string | null } | null;
  cambiosPago: number;
};

type Detalle = {
  id: string;
  ticket: string;
  estado: string;
  vendidaEn: string;
  total: number;
  descuento: number;
  cliente: { dni?: string; nombre?: string } | null;
  items: { sku: string | null; nombre: string; cantidad: number; precioUnitario: number; total: number }[];
  pagos: { id: string; medio: string; terminal: string | null; monto: number; etiqueta: string; mpPaymentId: string | null }[];
  comprobantes: { tipo: string; numero: string; cae: string | null; estado: string; total: number }[];
  cambiosPago: { antes: any; despues: any; motivo: string | null; creadoEn: string; usuario: string | null; autorizante: string | null }[];
};

export default function MiTurno({
  sesionId,
  cajaNombre,
  abiertaEn,
  onCerrar,
  onReimprimir,
  onDevolver,
}: {
  sesionId: string;
  cajaNombre: string;
  abiertaEn?: string;
  onCerrar: () => void;
  onReimprimir?: (d: Detalle) => void;
  onDevolver?: (ventaId: string) => void;
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [ventas, setVentas] = useState<VentaFila[]>([]);
  const [totalVentas, setTotalVentas] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [medio, setMedio] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cambio, setCambio] = useState<{ pagos: { medio: string; terminal?: string; monto: string }[]; motivo: string; pin: string; error: string; procesando: boolean } | null>(null);
  const buscarRef = useRef<HTMLInputElement>(null);
  // en el celular el detalle queda debajo de la lista: al elegir un ticket se lo trae a la vista
  const detalleRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PASO = 50;

  const traerResumen = useCallback(async () => {
    try {
      const r = await fetch(`/api/caja?recurso=turno-resumen&sesionId=${encodeURIComponent(sesionId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo traer el turno');
      setResumen(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo traer el turno');
    }
  }, [sesionId]);

  const traerVentas = useCallback(
    async (offset = 0) => {
      setCargando(true);
      try {
        const qs = new URLSearchParams({ recurso: 'turno-ventas', sesionId, limite: String(PASO), offset: String(offset) });
        if (buscar.trim()) qs.set('buscar', buscar.trim());
        if (medio) qs.set('medio', medio);
        const r = await fetch(`/api/caja?${qs.toString()}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message ?? 'No se pudieron traer las ventas');
        setTotalVentas(d.total ?? 0);
        setVentas((prev) => (offset === 0 ? d.items ?? [] : [...prev, ...(d.items ?? [])]));
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudieron traer las ventas');
      }
      setCargando(false);
    },
    [sesionId, buscar, medio],
  );

  // primera carga + refresco en vivo mientras la pantalla está abierta
  useEffect(() => { void traerResumen(); }, [traerResumen]);
  useEffect(() => {
    const t = setInterval(() => { void traerResumen(); }, 20_000);
    return () => clearInterval(t);
  }, [traerResumen]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void traerVentas(0); }, buscar ? 250 : 0);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [traerVentas, buscar]);

  useEffect(() => { setTimeout(() => buscarRef.current?.focus(), 60); }, []);

  useEffect(() => {
    if (!detalle?.id || window.matchMedia('(min-width: 1024px)').matches) return;
    detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [detalle?.id]);

  // Esc cierra: la cajera tiene que poder volver al mostrador de un toque
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (cambio) setCambio(null);
        else if (detalle) setDetalle(null);
        else onCerrar();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cambio, detalle, onCerrar]);

  async function abrirDetalle(id: string) {
    setDetalle(null);
    try {
      const r = await fetch(`/api/venta-pagos?ventaId=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo abrir el ticket');
      setDetalle(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el ticket');
    }
  }

  function empezarCambio() {
    if (!detalle) return;
    setCambio({
      pagos: [{ medio: 'efectivo', monto: String(Math.round(detalle.total)) }],
      motivo: '',
      pin: '',
      error: '',
      procesando: false,
    });
  }

  const sumaCambio = useMemo(
    () => (cambio?.pagos ?? []).reduce((a, p) => a + (Number(p.monto) || 0), 0),
    [cambio],
  );

  // Lo que se le devuelve al cliente por Mercado Pago si sale ese medio.
  const mpADevolver = useMemo(() => {
    if (!detalle || !cambio) return 0;
    const antes = detalle.pagos.filter((p) => p.medio === 'mercadopago').reduce((a, p) => a + p.monto, 0);
    const despues = cambio.pagos.filter((p) => p.medio === 'mercadopago').reduce((a, p) => a + (Number(p.monto) || 0), 0);
    return Math.max(0, Math.round((antes - despues) * 100) / 100);
  }, [detalle, cambio]);

  async function confirmarCambio() {
    if (!detalle || !cambio) return;
    if (Math.abs(sumaCambio - detalle.total) > 0.01) {
      setCambio({ ...cambio, error: `Los pagos suman ${pesos(sumaCambio)} y el ticket es de ${pesos(detalle.total)}` });
      return;
    }
    if (!cambio.pin.trim()) {
      setCambio({ ...cambio, error: 'Falta el PIN del supervisor' });
      return;
    }
    setCambio({ ...cambio, procesando: true, error: '' });
    try {
      // el PIN se cambia por un token de un solo uso; nunca viaja a la venta
      const ra = await fetch('/api/caja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'autorizar', pin: cambio.pin.trim() }),
      });
      const da = await ra.json();
      if (!ra.ok) throw new Error(da?.message ?? 'PIN incorrecto');

      const r = await fetch('/api/venta-pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ventaId: detalle.id,
          pagos: cambio.pagos.map((p) => ({ medio: p.medio, terminal: p.terminal, monto: Number(p.monto) })),
          motivo: cambio.motivo.trim() || undefined,
          autorizacionToken: da.token,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo cambiar el medio de pago');
      setCambio(null);
      await abrirDetalle(detalle.id);
      await traerResumen();
      await traerVentas(0);
    } catch (e) {
      setCambio((c) => (c ? { ...c, procesando: false, error: e instanceof Error ? e.message : 'No se pudo cambiar' } : c));
    }
  }

  const efectivoEsperado = resumen
    ? resumen.efectivoVentas + resumen.ingresos - resumen.egresos
    : 0;

  return (
    <div className="fixed inset-0 z-cajon flex flex-col overflow-y-auto overscroll-contain bg-crema lg:overflow-hidden">
      {/* ---- cabecera ---- */}
      <header className="sticky top-0 z-contenido flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-tinta px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-crema">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">Mi turno</h1>
          <p className="min-w-0 break-words text-xs text-crema/70">
            {cajaNombre}
            {abiertaEn ? ` · abierta ${hora(abiertaEn)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => { void traerResumen(); void traerVentas(0); }}
            className="inline-flex min-h-11 items-center rounded-xl bg-white/10 px-3 text-sm hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:min-h-10"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={onCerrar}
            className="inline-flex min-h-11 items-center rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:min-h-10"
          >
            Volver a cobrar<span className="hidden sm:inline">&nbsp;(Esc)</span>
          </button>
        </div>
      </header>

      {/* ---- lo que lleva vendido ---- */}
      <div className="shrink-0 px-4 pt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="col-span-2 min-w-0 rounded-2xl bg-tinta px-5 py-4 text-white md:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Vendido en este turno</p>
            <p className="importe truncate text-4xl font-bold leading-tight">{pesos(resumen?.total ?? 0)}</p>
            <p className="text-sm text-white/70">
              {resumen?.tickets ?? 0} {resumen?.tickets === 1 ? 'ticket' : 'tickets'}
              {resumen?.anuladas ? ` · ${resumen.anuladas} anulada(s)` : ''}
            </p>
          </div>
          <div className="min-w-0 rounded-2xl bg-white px-4 py-4 shadow-tarjeta sm:px-5">
            <p className={ROTULO}>Ticket promedio</p>
            <p className="importe truncate text-xl font-bold text-tinta sm:text-2xl">{pesos(resumen?.ticketPromedio ?? 0)}</p>
          </div>
          <div className="min-w-0 rounded-2xl bg-white px-4 py-4 shadow-tarjeta sm:px-5">
            <p className={ROTULO}>Tiene que haber en el cajón</p>
            <p className="importe truncate text-xl font-bold text-tinta sm:text-2xl">{pesos(efectivoEsperado)}</p>
            <p className="text-xs text-tinta/60">
              ventas en efectivo{resumen?.ingresos ? ` + ${pesos(resumen.ingresos)} ingresos` : ''}
              {resumen?.egresos ? ` − ${pesos(resumen.egresos)} retiros` : ''} (sin la base)
            </p>
          </div>
        </div>

        {/* ---- cómo cobró: chips que además filtran la lista ---- */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={medio === null}
            onClick={() => setMedio(null)}
            className={unir('min-h-11 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold', medio === null ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta/70', FOCO)}
          >
            Todo
          </button>
          {(resumen?.medios ?? []).map((m) => (
            <button
              key={m.etiqueta}
              type="button"
              aria-pressed={medio === m.medio}
              onClick={() => setMedio(medio === m.medio ? null : m.medio)}
              className={unir('min-w-0 rounded-xl border-2 px-4 py-2.5 text-left', medio === m.medio ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta', FOCO)}
            >
              <span className="block text-xs font-semibold uppercase tracking-[0.08em] opacity-70">{m.etiqueta}</span>
              <span className="importe block text-lg font-bold leading-tight">{pesos(m.monto ?? 0)}</span>
              <span className="block text-xs opacity-70">{m.pagos} {m.pagos === 1 ? 'cobro' : 'cobros'}</span>
            </button>
          ))}
          {(resumen?.comprobantes ?? []).map((c) => (
            <div key={c.tipo} className="rounded-xl border-2 border-black/10 bg-white px-4 py-2.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">{ETIQUETA_TIPO[c.tipo] ?? c.tipo}</span>
              <span className="importe block text-lg font-bold leading-tight text-tinta">{c.cantidad}</span>
              {c.sinCae > 0 && <span className="block text-xs font-semibold text-marca-hondo">{c.sinCae} sin CAE</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ---- buscador + lista ---- */}
      <div className="grid gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_420px]">
        <div className="flex min-w-0 flex-col lg:min-h-0">
          <Entrada
            ref={buscarRef}
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscá por número de ticket, importe, factura, DNI o nombre…"
            aria-label="Buscar ticket"
            className="shrink-0"
          />
          <div className="mt-2 rounded-2xl bg-white shadow-tarjeta lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {error && <p role="alert" className="px-4 py-3 text-sm font-medium text-marca-hondo">{error}</p>}
            {!cargando && ventas.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-tinta/60">
                {buscar || medio ? 'Ningún ticket coincide.' : 'Todavía no cobraste nada en este turno.'}
              </p>
            )}
            {ventas.map((v) => {
              const elegida = detalle?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={elegida}
                  onClick={() => void abrirDetalle(v.id)}
                  className={unir('flex w-full items-center gap-3 border-b border-black/[0.06] px-4 py-3 text-left', elegida ? 'bg-crema' : 'hover:bg-crema/50', FOCO_ADENTRO)}
                >
                  <span className="importe w-12 shrink-0 text-sm text-tinta/60">{hora(v.vendidaEn)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-tinta">
                      #{v.ticket}
                      {v.cliente?.nombre ? ` · ${v.cliente.nombre}` : v.cliente?.dni ? ` · DNI ${v.cliente.dni}` : ''}
                      {v.estado !== 'completada' && <span className="ml-2 inline-block whitespace-nowrap text-xs uppercase text-marca-hondo">{v.estado}</span>}
                    </span>
                    <span className="block min-w-0 break-words text-xs text-tinta/60">
                      {v.pagos.map((p) => p.etiqueta).join(' + ') || 'sin pagos'}
                      {v.comprobante ? ` · ${ETIQUETA_TIPO[v.comprobante.tipo] ?? v.comprobante.tipo} ${String(v.comprobante.numero).padStart(8, '0')}` : ''}
                      {v.comprobante && !v.comprobante.cae ? ' · sin CAE' : ''}
                      {v.cambiosPago > 0 ? ' · medio de pago cambiado' : ''}
                    </span>
                  </span>
                  <span className="importe shrink-0 font-bold text-tinta">{pesos(v.total ?? 0)}</span>
                </button>
              );
            })}
            {ventas.length < totalVentas && (
              <button
                type="button"
                onClick={() => void traerVentas(ventas.length)}
                className={unir('min-h-11 w-full py-3 text-sm text-tinta/70 hover:bg-crema/50', FOCO_ADENTRO)}
              >
                Ver más ({totalVentas - ventas.length} restantes)
              </button>
            )}
          </div>
        </div>

        {/* ---- detalle del ticket elegido ---- */}
        <div ref={detalleRef} className="min-w-0 scroll-mt-24 rounded-2xl bg-white p-4 shadow-tarjeta sm:p-5 lg:min-h-0 lg:overflow-y-auto">
          {!detalle ? (
            <p className="py-10 text-center text-sm text-tinta/60 lg:py-16">
              Tocá un ticket para ver el detalle, reimprimirlo o cambiarle el medio de pago.
            </p>
          ) : (
            <>
              <div className="-mt-2 mb-2 flex items-center justify-between gap-2">
                <p className={ROTULO}>Ticket elegido</p>
                <button type="button" onClick={() => setDetalle(null)} aria-label="Cerrar el detalle" className={unir('-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 hover:bg-tinta/5 hover:text-tinta', FOCO)}>
                  <IconoCerrar className="size-5" />
                </button>
              </div>

              {/* El ticket en la Placa roja, el paquete gráfico de pedidos y
                  listas de precios (2/10/2026, pedido de Leandro: "siempre que
                  se detallen productos"). Antes era una lista gris "2× producto";
                  ahora cada renglón lleva la cantidad en el círculo, cantidad ×
                  unitario y su total. El cliente, el descuento y cómo se cobró
                  van en el recuadro. El ticket impreso no cambia. */}
              <PlacaRoja
                titulo="Ticket"
                sub={`#${detalle.ticket} · ${hora(detalle.vendidaEn)}`}
                renglones={detalle.items.map((i, n) => ({
                  clave: `${i.sku}-${n}`,
                  cantidad: i.cantidad,
                  nombre: i.nombre,
                  detalle: `${numero(i.cantidad, 3)} × ${pesos(i.precioUnitario ?? 0)}`,
                  importe: pesos(i.total ?? 0),
                }))}
                total={{ etiqueta: 'Total', valor: pesos(detalle.total ?? 0) }}
                recuadro={
                  <div className="grid gap-1">
                    {detalle.cliente?.nombre && (
                      <div className="flex flex-wrap justify-between gap-x-2">
                        <span className="text-tinta/70">Cliente</span>
                        <span className="min-w-0 break-words font-semibold text-tinta">{detalle.cliente.nombre}</span>
                      </div>
                    )}
                    {detalle.descuento ? (
                      <div className="flex flex-wrap justify-between gap-x-2">
                        <span className="text-tinta/70">Descuento</span>
                        <span className="importe font-semibold text-tinta">{pesos(detalle.descuento)}</span>
                      </div>
                    ) : null}
                    <p className={unir(ROTULO, detalle.cliente?.nombre || detalle.descuento ? 'mt-2' : '')}>Cobrado con</p>
                    {detalle.pagos.map((p) => (
                      <div key={p.id} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words text-tinta">{p.etiqueta}</span>
                        <span className="importe shrink-0 font-semibold text-tinta">{pesos(p.monto ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                }
              />

              {detalle.comprobantes.length > 0 && (
                <>
                  <p className={unir(ROTULO, 'mt-4')}>Comprobantes</p>
                  <div className="mt-1 grid gap-1">
                    {detalle.comprobantes.map((c, n) => (
                      <div key={n} className="break-words text-sm">
                        <span className="text-tinta">{ETIQUETA_TIPO[c.tipo] ?? c.tipo} {c.numero}</span>
                        {c.cae ? (
                          <span className="text-tinta/60"> · CAE {c.cae}</span>
                        ) : (
                          <span className="font-semibold text-marca-hondo"> · sin CAE todavía</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {detalle.cambiosPago.length > 0 && (
                <div className="mt-4 rounded-xl border border-atencion/20 bg-atencion-suave p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-atencion">Cambios de medio de pago</p>
                  {detalle.cambiosPago.map((c, n) => (
                    <p key={n} className="mt-1 break-words text-xs text-atencion">
                      {hora(c.creadoEn)} · {(c.antes ?? []).map((p: any) => p.medio).join('+')} → {(c.despues ?? []).map((p: any) => p.medio).join('+')}
                      {c.autorizante ? ` · autorizó ${c.autorizante}` : ''}
                      {c.motivo ? ` · «${c.motivo}»` : ''}
                    </p>
                  ))}
                </div>
              )}

              {/* ---- acciones ---- */}
              {!cambio ? (
                <div className="mt-5 grid gap-2">
                  {onReimprimir && (
                    <Boton variante="secundario" anchoCompleto onClick={() => onReimprimir(detalle)}>
                      Reimprimir el ticket
                    </Boton>
                  )}
                  {detalle.estado === 'completada' && (
                    <Boton anchoCompleto onClick={empezarCambio}>
                      Cambiar el medio de pago
                    </Boton>
                  )}
                  {onDevolver && detalle.estado === 'completada' && (
                    <Boton variante="secundario" anchoCompleto onClick={() => onDevolver(detalle.id)}>
                      Devolver productos de este ticket
                    </Boton>
                  )}
                </div>
              ) : (
                <div className="mt-5 rounded-xl border-2 border-marca/40 p-3">
                  <p className="font-semibold text-tinta">Cambiar el medio de pago</p>
                  <p className="text-sm text-tinta/70">
                    El ticket y la factura quedan como están. Solo cambia con qué se pagó.
                  </p>

                  <div className="mt-3 grid gap-2">
                    {cambio.pagos.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Selector
                          value={`${p.medio}|${p.terminal ?? ''}`}
                          onChange={(e) => {
                            const [medioSel, term] = e.target.value.split('|');
                            setCambio((c) => c && {
                              ...c,
                              pagos: c.pagos.map((x, n) => (n === i ? { ...x, medio: medioSel, terminal: term || undefined } : x)),
                            });
                          }}
                          aria-label="Medio de pago"
                          className="flex-1"
                        >
                          {MEDIOS.map((m) => (
                            <option key={m.etiqueta} value={`${m.valor}|${m.terminal ?? ''}`}>{m.etiqueta}</option>
                          ))}
                        </Selector>
                        <div className="w-28 shrink-0">
                          <Entrada
                            value={p.monto}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^\d]/g, '');
                              setCambio((c) => c && { ...c, pagos: c.pagos.map((x, n) => (n === i ? { ...x, monto: v } : x)) });
                            }}
                            inputMode="numeric"
                            aria-label="Monto"
                            className="tabular-nums"
                          />
                        </div>
                        {cambio.pagos.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setCambio((c) => c && { ...c, pagos: c.pagos.filter((_, n) => n !== i) })}
                            className={unir('grid size-11 shrink-0 place-items-center rounded-xl text-tinta/60 hover:text-marca-hondo', FOCO)}
                            aria-label="Quitar"
                          >
                            <IconoCerrar className="size-5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCambio((c) => c && {
                      ...c,
                      pagos: [...c.pagos, { medio: 'efectivo', monto: String(Math.max(0, Math.round(detalle.total - sumaCambio))) }],
                    })}
                    className={unir('mt-2 inline-flex min-h-9 items-center rounded-sm text-xs font-semibold text-marca-hondo underline underline-offset-2', FOCO)}
                  >
                    Dividir en otro medio
                  </button>

                  <p className={'mt-2 text-sm tabular-nums ' + (Math.abs(sumaCambio - detalle.total) > 0.01 ? 'font-semibold text-marca-hondo' : 'text-tinta/70')}>
                    Suma {pesos(sumaCambio)} de {pesos(detalle.total)}
                    {Math.abs(sumaCambio - detalle.total) > 0.01 && ` · faltan ${pesos(detalle.total - sumaCambio)}`}
                  </p>

                  {mpADevolver > 0 && (
                    <p className="mt-2 rounded-xl bg-info-suave px-3 py-2 text-xs text-info">
                      Al confirmar, el sistema le devuelve <b>{pesos(mpADevolver)}</b> al cliente por Mercado Pago.
                      La plata vuelve sola a su cuenta; si el reembolso falla, no se cambia nada.
                    </p>
                  )}

                  <Entrada
                    value={cambio.motivo}
                    onChange={(e) => setCambio((c) => c && { ...c, motivo: e.target.value })}
                    placeholder="Motivo (ej: el cliente prefirió pagar en efectivo)"
                    aria-label="Motivo"
                    className="mt-2"
                  />
                  <Entrada
                    value={cambio.pin}
                    onChange={(e) => setCambio((c) => c && { ...c, pin: e.target.value })}
                    type="password"
                    inputMode="numeric"
                    placeholder="PIN del supervisor"
                    aria-label="PIN del supervisor"
                    className="mt-2"
                  />
                  {cambio.error && <p role="alert" className="mt-2 text-sm font-medium text-marca-hondo">{cambio.error}</p>}

                  <div className="mt-3 flex gap-2 *:flex-1">
                    <Boton variante="secundario" onClick={() => setCambio(null)}>
                      Cancelar
                    </Boton>
                    <Boton onClick={() => void confirmarCambio()} cargando={cambio.procesando}>
                      {cambio.procesando ? 'Cambiando…' : 'Confirmar cambio'}
                    </Boton>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
