'use client';

import { useCallback, useEffect, useState } from 'react';
import { FOCO, unir } from './kit';

// La campanita: avisos internos que el sistema le deja a cada persona (pagos,
// consultas del bot, proveedores, pedidos sin tomar, reportes…).
//
// 6/10/2026 (el circuito entre áreas):
// - Los avisos del bot les llegan a los tres dueños (decisión de Leandro); el
//   primero que toca "Listo" lo cierra para todos y QUEDA SU NOMBRE: la pestaña
//   "Atendidos" muestra quién cerró cada uno en las últimas 48 h.
// - Muchos se cierran solos cuando se resuelve el hecho (el cobro aprobado, el
//   pedido tomado, el WhatsApp que finalmente llegó).
// - Si la API no contesta lo dice, en vez de mostrar "Nada pendiente".
// - Íconos de línea por tipo en lugar de emojis (regla del kit).
type Alerta = { id: string; tipo: string; titulo: string; detalle: string | null; referencia: any; creada_en: string; leida_en?: string; leidaPorNombre?: string };

// un trazo por familia de aviso (24×24)
const TRAZOS: Record<string, string> = {
  pedido: 'M5 8h14l-1.2 11.2a1 1 0 01-1 .8H7.2a1 1 0 01-1-.8zM9 8V6.5a3 3 0 016 0V8',
  plata: 'M3 7h18v10H3zM12 15a3 3 0 100-6 3 3 0 000 6zM6.5 10v4M17.5 10v4',
  charla: 'M4 5h16v11H9l-4 3.5V16H4z',
  proveedor: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  atencion: 'M12 4L2.8 19.5h18.4zM12 10v4M12 17h.01',
  arreglo: 'M14.5 6.5a4 4 0 00-5.4 5.1L4 16.7 7.3 20l5.1-5.1a4 4 0 005.1-5.4l-2.4 2.4-2.6-.6-.6-2.6z',
  caja: 'M4 10h16v9H4zM7 10V5h10v5M9 14h6',
  stock: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
};
const FAMILIA: Record<string, string> = {
  pedido_sin_tomar: 'pedido', pedido_sin_aviso: 'pedido', derivacion: 'charla',
  pago: 'plata', cobranza: 'plata', devolucion: 'caja', caja_diferencia: 'caja',
  consulta: 'charla', nota_bot: 'charla',
  proveedor_ofrece: 'proveedor', proveedor_incompleto: 'proveedor', proveedor_completo: 'proveedor', oc_enviada: 'proveedor', oc_no_salio: 'atencion', cambio_factura: 'proveedor',
  bot_caido: 'atencion', whatsapp_caido: 'atencion',
  reporte: 'arreglo', arreglo: 'arreglo',
  abastecimiento: 'stock', transferencia: 'stock',
};
const URGENTES = new Set(['bot_caido', 'whatsapp_caido', 'oc_no_salio', 'pedido_sin_tomar', 'pedido_sin_aviso']);

function IconoAviso({ tipo }: { tipo: string }) {
  const urgente = URGENTES.has(tipo);
  return (
    <span aria-hidden="true" className={unir('flex size-8 shrink-0 items-center justify-center rounded-full', urgente ? 'bg-marca-suave text-marca-hondo' : 'bg-crema-claro text-tinta/70')}>
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={TRAZOS[FAMILIA[tipo] ?? 'charla']} />
      </svg>
    </span>
  );
}

// el texto del enlace según adónde lleva
const destino = (link: string) =>
  link.startsWith('/compras') ? 'Completar el proveedor'
    : link.startsWith('/mesa-compras') ? 'Ver qué comprar'
      : link.startsWith('/aprobaciones') ? 'Ir a Aprobaciones'
        : link.startsWith('/pedidos') ? 'Ver el pedido'
          : link.startsWith('/reportes') ? 'Ver el reporte'
            : link.startsWith('/cierres') ? 'Ver el cierre'
              : link.startsWith('/stock') ? 'Ver en Stock'
                : 'Abrir';
const hace = (v: string) => {
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

// `donde`: 'lateral' (barra lateral de escritorio: el panel se abre hacia la derecha,
// sobre el contenido) o 'movil' (barra superior del celular: ocupa el ancho de la
// pantalla). ANTES se abría con right-0 pegado a la campanita de la barra lateral y
// quedaba 150 px fuera de la pantalla por la izquierda (2026-09-09).
export function CampanaAlertas({ donde = 'lateral', esDuenio = true }: { donde?: 'lateral' | 'movil'; esDuenio?: boolean } = {}) {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [atendidas, setAtendidas] = useState<Alerta[] | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [pestana, setPestana] = useState<'pendientes' | 'atendidos'>('pendientes');
  const [sinRespuesta, setSinRespuesta] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/novedades?que=alertas', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (r.ok && Array.isArray(d)) { setAlertas(d); setSinRespuesta(false); } else setSinRespuesta(true);
    } catch { setSinRespuesta(true); }
  }, []);
  const cargarAtendidas = useCallback(async () => {
    try {
      const r = await fetch('/api/novedades?que=atendidas', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      setAtendidas(r.ok && Array.isArray(d) ? d : []);
    } catch { setAtendidas([]); }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [cargar]);
  // al abrirla se actualiza (antes mostraba lo de hasta 30 s atrás)
  useEffect(() => { if (abierta) { cargar(); if (pestana === 'atendidos') cargarAtendidas(); } }, [abierta, pestana, cargar, cargarAtendidas]);

  async function leida(a: Alerta) {
    setAlertas((xs) => xs.filter((x) => x.id !== a.id));
    await fetch('/api/novedades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, que: 'alerta' }) }).catch(() => null);
    setAtendidas(null);
  }

  const cuenta = alertas.length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-label={cuenta ? `Avisos: ${cuenta} sin atender` : 'Avisos'}
        aria-expanded={abierta}
        className={unir('relative flex size-10 items-center justify-center rounded-full text-white/75 hover:bg-white/10 hover:text-white', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50')}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20.5a2 2 0 004 0" />
        </svg>
        {cuenta > 0 && (
          <span className="importe absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-marca px-1 text-xs font-bold leading-none text-white">
            {cuenta > 9 ? '9+' : cuenta}
          </span>
        )}
        {sinRespuesta && !cuenta && <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-atencion" />}
      </button>

      {abierta && (
        <div
          className={unir(
            'z-modal overflow-hidden rounded-2xl bg-white text-tinta shadow-flotante ring-1 ring-black/10',
            donde === 'movil' ? 'fixed inset-x-2 top-[calc(var(--alto-barra-movil)+0.25rem)]' : 'absolute left-0 top-full mt-2 w-[min(calc(100vw-17rem),21rem)]',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5">
            <p className="text-sm font-semibold">Avisos</p>
            <button type="button" onClick={() => setAbierta(false)} className={unir('rounded-full px-2 py-1 text-xs font-medium text-tinta/60 hover:text-tinta', FOCO)}>Cerrar</button>
          </div>
          <div role="tablist" aria-label="Avisos" className="flex gap-1 border-b border-black/[0.06] px-2">
            {(['pendientes', 'atendidos'] as const).map((p) => (
              <button
                key={p}
                role="tab"
                type="button"
                aria-selected={pestana === p}
                onClick={() => setPestana(p)}
                className={unir('-mb-px border-b-2 px-3 py-2 text-xs font-semibold', pestana === p ? 'border-marca text-tinta' : 'border-transparent text-tinta/60 hover:text-tinta', FOCO)}
              >
                {p === 'pendientes' ? `Por atender${cuenta ? ` (${cuenta})` : ''}` : 'Atendidos (48 h)'}
              </button>
            ))}
          </div>

          <div className="max-h-[60dvh] overflow-y-auto">
            {pestana === 'pendientes' ? (
              <>
                {sinRespuesta && (
                  <div role="alert" className="m-3 rounded-xl bg-atencion-suave px-3 py-2.5 text-sm text-atencion">
                    No pude traer los avisos.{' '}
                    <button type="button" onClick={cargar} className={unir('font-semibold underline', FOCO)}>Reintentar</button>
                  </div>
                )}
                {!sinRespuesta && cuenta === 0 && <p className="px-4 py-8 text-center text-sm text-tinta/60">Nada por atender.</p>}
                {alertas.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3 last:border-0">
                    <IconoAviso tipo={a.tipo} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-snug">{a.titulo}</p>
                      {/* con más de un número de WhatsApp, a cuál escribió el cliente (6/10/2026) */}
                      {a.referencia?.lineaNombre && (
                        <span className="mt-0.5 inline-block rounded-full bg-info-suave px-2 py-0.5 text-[11px] font-semibold text-info">{String(a.referencia.lineaNombre)}</span>
                      )}
                      {a.detalle && <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-xs text-tinta/70">{a.detalle}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                        <span className="text-tinta/60">{hace(a.creada_en)}</span>
                        {/* la charla la abre solo el dueño (RESPONDE): a los demás los mandaba a Inicio */}
                        {a.referencia?.telefono && esDuenio && (
                          <a href="/whatsapp" className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>Abrir la charla</a>
                        )}
                        {a.referencia?.link && (
                          <a href={String(a.referencia.link)} className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>{destino(String(a.referencia.link))}</a>
                        )}
                        <button type="button" onClick={() => leida(a)} className={unir('ml-auto rounded-full border border-black/15 px-3 py-1 font-semibold text-tinta hover:bg-crema-claro', FOCO)}>Listo</button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : atendidas === null ? (
              <p className="px-4 py-8 text-center text-sm text-tinta/60">Buscando…</p>
            ) : atendidas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-tinta/60">Nadie cerró avisos en las últimas 48 horas.</p>
            ) : (
              atendidas.map((a) => (
                <div key={a.id} className="flex items-start gap-3 border-b border-black/[0.06] px-4 py-3 last:border-0">
                  <IconoAviso tipo={a.tipo} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm leading-snug text-tinta/70">{a.titulo}</p>
                    <p className="mt-1 text-xs text-tinta/60">
                      Lo atendió <b className="font-semibold text-tinta">{a.leidaPorNombre}</b>{a.leida_en ? ` · ${hace(a.leida_en)}` : ''}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
