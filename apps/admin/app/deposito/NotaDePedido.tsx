'use client';

// La nota de pedido del Depósito (17/11/2026). Leandro, mirando la de antes:
// «no se entiende nada la nota de pedido, ni para quién es, ni a qué hora
// entró, ni el detalle, nada». La de antes no mostraba el nombre del cliente
// (venía en los datos), decía «hace 14268 min» y la nota iba en gris itálica.
// Ahora se lee de arriba abajo como una comanda: PARA QUIÉN (grande), CÓMO SE
// ENTREGA y CUÁNDO, CUÁNDO ENTRÓ (día y hora, y hace cuánto en palabras),
// QUÉ LLEVA (la cantidad en el círculo rojo de la placa de pedidos), la NOTA
// en letra normal y el TOTAL en la píldora negra con cómo paga.

import type { ReactNode } from 'react';
import { FOCO, unir } from '../ui/kit';
import { conCodigo } from '../lib/codigo-producto';
import { pesos } from '../lib/formato';
import { cantidadLegible, linkWhatsapp, origenDe, telefonoLegible, type PedidoCola } from '../lib/pedidos';
import { textoVisible } from '../lib/texto';

export type PedidoDeposito = PedidoCola & { sucursal?: { nombre: string } | null };

const ZONA = 'America/Argentina/Buenos_Aires';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** «vie 7/11 a las 14:35» (hoy: «hoy a las 14:35»; ayer: «ayer a las 9:10») */
export function entroEl(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dia = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(x);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
  const hoy = dia(new Date());
  const ayer = dia(new Date(Date.now() - 86_400_000));
  if (dia(d) === hoy) return `hoy a las ${hora}`;
  if (dia(d) === ayer) return `ayer a las ${hora}`;
  const [, m, dd] = dia(d).split('-').map(Number);
  const semana = DIAS[new Date(`${dia(d)}T12:00:00Z`).getUTCDay()].slice(0, 3);
  return `${semana} ${dd}/${m} a las ${hora}`;
}

/** «hace 5 min», «hace 2 h 10 min», «hace 3 días» (nunca «hace 14268 min») */
export function haceTanto(minutos: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `hace ${h} h${r ? ` ${r} min` : ''}`;
  }
  const d = Math.floor(m / (24 * 60));
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

const sinSuc = (n?: string | null) => String(n ?? '').replace(/^suc(ursal)?\.?\s+/i, '').trim();

const FORMA_PAGO: Record<string, string> = {
  efectivo: 'efectivo', transferencia: 'transferencia', tarjeta: 'tarjeta', mercadopago: 'Mercado Pago', mercado_pago: 'Mercado Pago', debito: 'débito', credito: 'crédito',
};

function Dato({ rotulo, children, tono }: { rotulo: string; children: ReactNode; tono?: string }) {
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-tinta/60">{rotulo}</dt>
      <dd className={unir('min-w-0 break-words text-sm leading-snug', tono ?? 'text-tinta')}>{children}</dd>
    </div>
  );
}

export function NotaDePedido({
  p, franja, abierto, onAlternar, acciones,
}: {
  p: PedidoDeposito;
  /** El color de la etapa (borde izquierdo), igual que en Pedidos. */
  franja: string;
  /** Abierto: todos los productos con su precio y la nota entera. */
  abierto: boolean;
  onAlternar: () => void;
  acciones: ReactNode;
}) {
  const origen = origenDe(p);
  const esPY = String(p.qr_retiro ?? '').startsWith('PY-') || p.origen === 'pedidosya';
  const esEnvio = p.canal === 'domicilio';
  const suc = sinSuc(p.sucursal?.nombre) || 'Sant Thomas';
  const tel = telefonoLegible(p.clienteTelefono);
  const wa = linkWhatsapp(p.clienteTelefono);
  const items = p.items ?? [];
  const visibles = abierto ? items : items.slice(0, 4);
  const nota = textoVisible(p.notas);
  const sinEmpezar = ['recibido', 'pagado'].includes(p.estado);
  // tarde: un pedido para hoy que lleva más de 20 minutos sin empezarse
  const tarde = sinEmpezar && !p.programado && (p.minutos ?? 0) > 20;
  const paga = p.pagado_en ? 'Pagado por Mercado Pago' : esPY ? 'Lo cobra PedidosYa' : p.forma_pago ? `Paga con ${FORMA_PAGO[p.forma_pago] ?? p.forma_pago}` : null;
  const codigo = p.qr_retiro || p.id.slice(0, 8).toUpperCase();
  // la fecha de entrega ya pasó y sigue sin entregarse: que se vea, no que parezca vigente
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
  const vencido = !!p.entrega_fecha && p.entrega_fecha < hoy && !['entregado', 'cancelado'].includes(p.estado);

  return (
    <article className={unir('min-w-0 overflow-hidden rounded-2xl border border-black/[0.06] border-l-4 bg-white shadow-tarjeta', franja, tarde && 'ring-2 ring-marca/35')}>
      {/* PARA QUIÉN: lo primero que se lee */}
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">Pedido para</p>
          <h3 className="break-words text-lg font-bold leading-tight text-tinta">{p.clienteNombre || 'Cliente sin nombre'}</h3>
          {tel && (
            wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className={unir('mt-0.5 inline-block text-sm font-semibold text-ok underline-offset-2 hover:underline', FOCO)}>
                {tel} · WhatsApp
              </a>
            ) : <p className="mt-0.5 text-sm text-tinta/70">{tel}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-block rounded-full bg-tinta/[0.06] px-2 py-0.5 text-xs font-semibold text-tinta/80">{origen.label}</span>
          <p className="mt-1 font-mono text-xs text-tinta/60">{codigo}</p>
        </div>
      </header>

      {/* CÓMO, CUÁNDO, CUÁNDO ENTRÓ */}
      <dl className="space-y-1.5 border-y border-black/[0.06] bg-crema-claro px-4 py-2.5">
        <Dato rotulo={esPY ? 'Retira' : esEnvio ? 'Envío' : 'Retira'}>
          <b className="font-semibold">
            {esPY ? 'Lo retira PedidosYa' : esEnvio ? (textoVisible(p.destino_direccion, { unaLinea: true }) || 'Dirección sin cargar') : `En ${suc}`}
          </b>
        </Dato>
        <Dato rotulo="Para" tono={p.programado ? 'text-tinta' : 'text-marca-hondo font-semibold'}>
          {p.entregaEtiqueta ? (vencido ? <>Era para el {p.entregaEtiqueta} <span className="rounded-full bg-marca px-1.5 py-0.5 text-xs font-bold text-white">ya pasó</span></> : p.entregaEtiqueta) : 'Lo antes posible'}
        </Dato>
        <Dato rotulo="Entró" tono={tarde ? 'text-marca-hondo font-semibold' : 'text-tinta'}>
          {entroEl(p.creado_en)} <span className={tarde ? '' : 'text-tinta/60'}>· {haceTanto(p.minutos)}</span>
        </Dato>
        {(p.tomadoPorNombre || p.asignadoNombre) && (
          <Dato rotulo="Lo tiene">
            {[p.tomadoPorNombre, p.asignadoNombre && p.asignadoNombre !== p.tomadoPorNombre ? `lo arma ${p.asignadoNombre}` : null].filter(Boolean).join(' · ')}
          </Dato>
        )}
      </dl>

      {/* QUÉ LLEVA */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">
          Lleva {items.length} {items.length === 1 ? 'producto' : 'productos'}
        </p>
        <ul className="space-y-2">
          {visibles.map((it, i) => {
            const cantidad = Number(it.cantidad) || 0;
            const c = cantidadLegible(cantidad);
            const unitario = Number(it.precio_unitario);
            const conPrecio = it.precio_unitario != null && it.precio_unitario !== '' && Number.isFinite(unitario);
            return (
              <li key={i} className="flex min-w-0 items-start gap-2.5">
                <span className={unir('grid size-9 shrink-0 place-items-center rounded-full bg-marca font-bold tabular-nums text-white', c.length > 2 ? 'text-xs' : 'text-sm')}>{c}</span>
                <div className="min-w-0 flex-1 pt-1.5">
                  <p className="break-words text-sm font-semibold leading-snug text-tinta">{conCodigo(it.producto?.nombre ?? 'Producto sin nombre', it.producto ?? undefined)}</p>
                  {abierto && conPrecio && (
                    <p className="text-xs text-tinta/60"><span className="importe">{c} × {pesos(unitario)} = {pesos(cantidad * unitario)}</span></p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!abierto && items.length > visibles.length && (
          <button type="button" onClick={onAlternar} className={unir('mt-2 text-sm font-semibold text-marca-hondo underline-offset-2 hover:underline', FOCO)}>
            + {items.length - visibles.length} {items.length - visibles.length === 1 ? 'producto más' : 'productos más'}
          </button>
        )}
      </div>

      {/* LA NOTA: en letra normal, con su rótulo */}
      {nota && (
        <div className="mx-4 mb-3 rounded-xl border-l-4 border-marca bg-marca-suave/60 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-marca-hondo">Nota del pedido</p>
          <p className={unir('mt-0.5 whitespace-pre-line break-words text-sm leading-snug text-tinta', !abierto && 'line-clamp-4')}>{nota}</p>
          {!abierto && nota.length > 180 && (
            <button type="button" onClick={onAlternar} className={unir('mt-1 text-xs font-semibold text-marca-hondo underline-offset-2 hover:underline', FOCO)}>Leer la nota entera</button>
          )}
        </div>
      )}

      {/* TOTAL Y CÓMO PAGA */}
      <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-full bg-tinta px-4 py-2 text-white">
        <span className="text-xs font-bold uppercase tracking-wide">Total</span>
        <span className="importe text-lg font-bold">{pesos(Number(p.total) || 0)}</span>
      </div>
      {paga && <p className="-mt-1.5 mb-3 px-4 text-right text-xs font-semibold text-tinta/70">{paga}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-4 py-3">
        {acciones}
        <button type="button" onClick={onAlternar} aria-expanded={abierto} className={unir('ml-auto rounded-full px-3 py-2 text-sm font-semibold text-tinta/70 hover:bg-tinta/5 hover:text-tinta', FOCO)}>
          {abierto ? 'Ver menos' : 'Ver todo'}
        </button>
      </div>
    </article>
  );
}
