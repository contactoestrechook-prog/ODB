'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const pesos = (n: number) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

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
    <div className="fixed inset-0 z-40 bg-[#F0EBE2] flex flex-col">
      {/* ---- cabecera ---- */}
      <header className="bg-[#1A1A1A] text-[#F0EBE2] px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight">Mi turno</h1>
          <p className="text-xs text-[#F0EBE2]/60 min-w-0 break-words">
            {cajaNombre}
            {abiertaEn ? ` · abierta ${hora(abiertaEn)}` : ''}
          </p>
        </div>
        <button
          onClick={() => { void traerResumen(); void traerVentas(0); }}
          className="ml-auto rounded-lg bg-white/10 px-3 py-2 text-sm"
        >
          ↻ Actualizar
        </button>
        <button onClick={onCerrar} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold">
          Volver a cobrar (Esc)
        </button>
      </header>

      {/* ---- lo que lleva vendido ---- */}
      <div className="px-4 pt-4 shrink-0">
        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="rounded-2xl bg-[#1A1A1A] text-white px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-white/50">Vendido en este turno</p>
            <p className="text-4xl font-black tabular-nums leading-tight">{pesos(resumen?.total ?? 0)}</p>
            <p className="text-sm text-white/60">
              {resumen?.tickets ?? 0} {resumen?.tickets === 1 ? 'ticket' : 'tickets'}
              {resumen?.anuladas ? ` · ${resumen.anuladas} anulada(s)` : ''}
            </p>
          </div>
          <div className="rounded-2xl bg-white px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-black/45">Ticket promedio</p>
            <p className="text-2xl font-bold tabular-nums text-black">{pesos(resumen?.ticketPromedio ?? 0)}</p>
          </div>
          <div className="rounded-2xl bg-white px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-black/45">Tiene que haber en el cajón</p>
            <p className="text-2xl font-bold tabular-nums text-black">{pesos(efectivoEsperado)}</p>
            <p className="text-[11px] text-black/45">
              ventas en efectivo{resumen?.ingresos ? ` + ${pesos(resumen.ingresos)} ingresos` : ''}
              {resumen?.egresos ? ` − ${pesos(resumen.egresos)} retiros` : ''} (sin la base)
            </p>
          </div>
        </div>

        {/* ---- cómo cobró: chips que además filtran la lista ---- */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setMedio(null)}
            className={'rounded-xl px-4 py-2.5 text-sm font-semibold border-2 ' + (medio === null ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-black/70 border-black/10')}
          >
            Todo
          </button>
          {(resumen?.medios ?? []).map((m) => (
            <button
              key={m.etiqueta}
              onClick={() => setMedio(medio === m.medio ? null : m.medio)}
              className={'rounded-xl px-4 py-2.5 text-left border-2 ' + (medio === m.medio ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-black border-black/10')}
            >
              <span className="block text-[11px] uppercase tracking-wider opacity-60">{m.etiqueta}</span>
              <span className="block text-lg font-bold tabular-nums leading-tight">{pesos(m.monto)}</span>
              <span className="block text-[11px] opacity-55">{m.pagos} {m.pagos === 1 ? 'cobro' : 'cobros'}</span>
            </button>
          ))}
          {(resumen?.comprobantes ?? []).map((c) => (
            <div key={c.tipo} className="rounded-xl px-4 py-2.5 bg-white border-2 border-black/10">
              <span className="block text-[11px] uppercase tracking-wider text-black/50">{ETIQUETA_TIPO[c.tipo] ?? c.tipo}</span>
              <span className="block text-lg font-bold tabular-nums leading-tight text-black">{c.cantidad}</span>
              {c.sinCae > 0 && <span className="block text-[11px] text-[#B82D25] font-semibold">{c.sinCae} sin CAE</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ---- buscador + lista ---- */}
      <div className="px-4 pt-4 pb-4 flex-1 min-h-0 grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="min-h-0 flex flex-col">
          <input
            ref={buscarRef}
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscá por número de ticket, importe, factura, DNI o nombre…"
            className="w-full rounded-xl border-2 border-[#B82D25] bg-white px-4 py-3 text-base text-black outline-none shrink-0"
          />
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white">
            {error && <p className="px-4 py-3 text-sm text-[#B82D25]">{error}</p>}
            {!cargando && ventas.length === 0 && (
              <p className="px-4 py-10 text-center text-black/40 text-sm">
                {buscar || medio ? 'Ningún ticket coincide.' : 'Todavía no cobraste nada en este turno.'}
              </p>
            )}
            {ventas.map((v) => {
              const elegida = detalle?.id === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => void abrirDetalle(v.id)}
                  className={'w-full text-left px-4 py-3 border-b border-black/5 flex items-center gap-3 ' + (elegida ? 'bg-[#F0EBE2]' : 'hover:bg-[#F0EBE2]/50')}
                >
                  <span className="w-12 shrink-0 text-sm tabular-nums text-black/50">{hora(v.vendidaEn)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-black">
                      #{v.ticket}
                      {v.cliente?.nombre ? ` · ${v.cliente.nombre}` : v.cliente?.dni ? ` · DNI ${v.cliente.dni}` : ''}
                      {v.estado !== 'completada' && <span className="ml-2 text-[#B82D25] text-xs uppercase">{v.estado}</span>}
                    </span>
                    <span className="block text-xs text-black/50 min-w-0 break-words">
                      {v.pagos.map((p) => p.etiqueta).join(' + ') || 'sin pagos'}
                      {v.comprobante ? ` · ${ETIQUETA_TIPO[v.comprobante.tipo] ?? v.comprobante.tipo} ${String(v.comprobante.numero).padStart(8, '0')}` : ''}
                      {v.comprobante && !v.comprobante.cae ? ' · sin CAE' : ''}
                      {v.cambiosPago > 0 ? ' · medio de pago cambiado' : ''}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums text-black">{pesos(v.total)}</span>
                </button>
              );
            })}
            {ventas.length < totalVentas && (
              <button
                onClick={() => void traerVentas(ventas.length)}
                className="w-full py-3 text-sm text-black/60 hover:bg-[#F0EBE2]/50"
              >
                Ver más ({totalVentas - ventas.length} restantes)
              </button>
            )}
          </div>
        </div>

        {/* ---- detalle del ticket elegido ---- */}
        <div className="min-h-0 overflow-y-auto rounded-2xl bg-white p-5">
          {!detalle ? (
            <p className="text-center text-black/35 text-sm py-16">
              Tocá un ticket para ver el detalle, reimprimirlo o cambiarle el medio de pago.
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-black/45">Ticket #{detalle.ticket}</p>
                  <p className="text-2xl font-black tabular-nums text-black leading-tight">{pesos(detalle.total)}</p>
                  <p className="text-xs text-black/50">
                    {hora(detalle.vendidaEn)}
                    {detalle.descuento ? ` · descuento ${pesos(detalle.descuento)}` : ''}
                    {detalle.cliente?.nombre ? ` · ${detalle.cliente.nombre}` : ''}
                  </p>
                </div>
                <button onClick={() => setDetalle(null)} className="text-black/30 text-xl px-1">✕</button>
              </div>

              <div className="mt-4 rounded-xl bg-[#F0EBE2]/60 p-3">
                {detalle.items.map((i, n) => (
                  <div key={`${i.sku}-${n}`} className="flex justify-between gap-2 text-sm py-0.5">
                    <span className="min-w-0 break-words text-black">
                      <span className="tabular-nums text-black/50">{i.cantidad}×</span> {i.nombre}
                    </span>
                    <span className="tabular-nums text-black/70 shrink-0">{pesos(i.total)}</span>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-[11px] uppercase tracking-wider text-black/45">Cobrado con</p>
              <div className="mt-1 grid gap-1">
                {detalle.pagos.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span className="text-black">{p.etiqueta}</span>
                    <span className="tabular-nums font-semibold text-black">{pesos(p.monto)}</span>
                  </div>
                ))}
              </div>

              {detalle.comprobantes.length > 0 && (
                <>
                  <p className="mt-4 text-[11px] uppercase tracking-wider text-black/45">Comprobantes</p>
                  <div className="mt-1 grid gap-1">
                    {detalle.comprobantes.map((c, n) => (
                      <div key={n} className="text-sm">
                        <span className="text-black">{ETIQUETA_TIPO[c.tipo] ?? c.tipo} {c.numero}</span>
                        {c.cae ? (
                          <span className="text-black/50"> · CAE {c.cae}</span>
                        ) : (
                          <span className="text-[#B82D25] font-semibold"> · sin CAE todavía</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {detalle.cambiosPago.length > 0 && (
                <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-amber-800">Cambios de medio de pago</p>
                  {detalle.cambiosPago.map((c, n) => (
                    <p key={n} className="text-xs text-amber-900 mt-1">
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
                    <button
                      onClick={() => onReimprimir(detalle)}
                      className="w-full rounded-xl border-2 border-black/10 py-3 text-black font-semibold"
                    >
                      🖨 Reimprimir el ticket
                    </button>
                  )}
                  {detalle.estado === 'completada' && (
                    <button
                      onClick={empezarCambio}
                      className="w-full rounded-xl bg-[#1A1A1A] py-3 text-white font-semibold"
                    >
                      Cambiar el medio de pago
                    </button>
                  )}
                  {onDevolver && detalle.estado === 'completada' && (
                    <button
                      onClick={() => onDevolver(detalle.id)}
                      className="w-full rounded-xl border-2 border-black/10 py-3 text-black/70"
                    >
                      ↩ Devolver productos de este ticket
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-5 rounded-xl border-2 border-[#B82D25] p-3">
                  <p className="font-semibold text-black">Cambiar el medio de pago</p>
                  <p className="text-xs text-black/55">
                    El ticket y la factura quedan como están. Solo cambia con qué se pagó.
                  </p>

                  <div className="mt-3 grid gap-2">
                    {cambio.pagos.map((p, i) => (
                      <div key={i} className="flex gap-2">
                        <select
                          value={`${p.medio}|${p.terminal ?? ''}`}
                          onChange={(e) => {
                            const [medioSel, term] = e.target.value.split('|');
                            setCambio((c) => c && {
                              ...c,
                              pagos: c.pagos.map((x, n) => (n === i ? { ...x, medio: medioSel, terminal: term || undefined } : x)),
                            });
                          }}
                          className="flex-1 rounded-lg border-2 border-black/10 px-2 py-2.5 text-sm text-black"
                        >
                          {MEDIOS.map((m) => (
                            <option key={m.etiqueta} value={`${m.valor}|${m.terminal ?? ''}`}>{m.etiqueta}</option>
                          ))}
                        </select>
                        <input
                          value={p.monto}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d]/g, '');
                            setCambio((c) => c && { ...c, pagos: c.pagos.map((x, n) => (n === i ? { ...x, monto: v } : x)) });
                          }}
                          inputMode="numeric"
                          className="w-28 rounded-lg border-2 border-black/10 px-2 py-2.5 text-sm text-black tabular-nums"
                        />
                        {cambio.pagos.length > 1 && (
                          <button
                            onClick={() => setCambio((c) => c && { ...c, pagos: c.pagos.filter((_, n) => n !== i) })}
                            className="px-2 text-black/40 text-xl"
                            aria-label="Quitar"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setCambio((c) => c && {
                      ...c,
                      pagos: [...c.pagos, { medio: 'efectivo', monto: String(Math.max(0, Math.round(detalle.total - sumaCambio))) }],
                    })}
                    className="mt-2 text-xs text-[#B82D25] underline"
                  >
                    ÷ Dividir en otro medio
                  </button>

                  <p className={'mt-2 text-sm tabular-nums ' + (Math.abs(sumaCambio - detalle.total) > 0.01 ? 'text-[#B82D25] font-semibold' : 'text-black/60')}>
                    Suma {pesos(sumaCambio)} de {pesos(detalle.total)}
                    {Math.abs(sumaCambio - detalle.total) > 0.01 && ` · faltan ${pesos(detalle.total - sumaCambio)}`}
                  </p>

                  {mpADevolver > 0 && (
                    <p className="mt-2 rounded-lg bg-[#009EE3]/10 px-3 py-2 text-xs text-[#0a5c7a]">
                      Al confirmar, el sistema le devuelve <b>{pesos(mpADevolver)}</b> al cliente por Mercado Pago.
                      La plata vuelve sola a su cuenta; si el reembolso falla, no se cambia nada.
                    </p>
                  )}

                  <input
                    value={cambio.motivo}
                    onChange={(e) => setCambio((c) => c && { ...c, motivo: e.target.value })}
                    placeholder="Motivo (ej: el cliente prefirió pagar en efectivo)"
                    className="mt-2 w-full rounded-lg border-2 border-black/10 px-3 py-2.5 text-sm text-black"
                  />
                  <input
                    value={cambio.pin}
                    onChange={(e) => setCambio((c) => c && { ...c, pin: e.target.value })}
                    type="password"
                    inputMode="numeric"
                    placeholder="PIN del supervisor"
                    className="mt-2 w-full rounded-lg border-2 border-black/10 px-3 py-2.5 text-sm text-black"
                  />
                  {cambio.error && <p className="mt-2 text-sm text-[#B82D25]">{cambio.error}</p>}

                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setCambio(null)} className="flex-1 rounded-xl border border-black/10 py-3 text-black/60">
                      Cancelar
                    </button>
                    <button
                      onClick={() => void confirmarCambio()}
                      disabled={cambio.procesando}
                      className="flex-1 rounded-xl bg-[#B82D25] py-3 text-white font-semibold disabled:opacity-40"
                    >
                      {cambio.procesando ? 'Cambiando…' : 'Confirmar cambio'}
                    </button>
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
