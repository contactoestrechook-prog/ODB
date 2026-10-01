'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// La propuesta de compra de un proveedor, dibujada como la nota de pedido que
// después le llega (misma franja negra y línea dorada que el PDF de la orden).
// Cada renglón se tilda; la cantidad se corrige ahí mismo; abajo, lo que suma lo
// tildado y el botón que lo convierte en orden de compra.
//
// La barrita de cada producto es la cuenta que importa: cuántos días le alcanza
// el stock contra cuántos tarda el proveedor (la marca dorada). Si la barra no
// llega a la marca, se queda sin stock antes de que llegue el pedido.

export type RenglonPropuesta = {
  sku: string;
  productoId: string;
  nombre: string;
  foto: string | null;
  stock: number;
  enCamino: number;
  ritmoDia: number;
  coberturaDias: number | null;
  alerta: 'sin_stock' | 'no_llega' | 'menos_de_12' | null;
  sugerido: number;
  cantidad: number;
  costo: number | null;
  motivo: string | null;
  tildado: boolean;
};

export type Propuesta = {
  clave: string;
  proveedorId: string;
  proveedor: string;
  sucursalId: string;
  sucursal: string;
  faltan: string[];
  plazoDias: number | null;
  plazoFuente: string | null;
  items: RenglonPropuesta[];
  urgentes: number;
  total: number;
};

export type Armada = { numero: number | null; total: number; renglones: number; faltan: string[]; pedidos?: { sku: string; cantidad: number }[] };

// Cómo está la nota ahora (lo que tildó y corrigió el comprador): el agente no
// ve la pantalla y tiene que saberlo para no proponer ni armar dos veces.
export type EstadoNota = {
  proveedor: string;
  sucursal: string;
  items: { sku: string; nombre: string; cantidad: number; tildado: boolean }[];
  armadas: Armada[];
};

const pesos = (n: number) => '$ ' + Math.round(n || 0).toLocaleString('es-AR');
const dec = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
// un ritmo de 0,04 por día con un decimal se leería 'vende 0 por día'
const ritmo = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: n < 0.1 ? 2 : 1 });
const VISIBLES = 12;

const ETIQUETA: Record<string, { texto: string; clase: string }> = {
  sin_stock: { texto: 'Sin stock', clase: 'bg-[#B82D25] text-white' },
  no_llega: { texto: 'No llega', clase: 'border border-[#B82D25] text-[#B82D25]' },
  menos_de_12: { texto: 'Menos de 12', clase: 'bg-black/[0.06] text-black/60' },
};

function Casilla({ tildado, onClick, nombre }: { tildado: boolean; onClick: () => void; nombre: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={tildado}
      aria-label={`${tildado ? 'Destildar' : 'Tildar'} ${nombre}`}
      onClick={onClick}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B82D25] ${
        tildado ? 'border-[#B82D25] bg-[#B82D25]' : 'border-black/25 bg-white hover:border-black/50'
      }`}
    >
      <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 text-white motion-safe:transition-transform ${tildado ? 'scale-100' : 'scale-0'}`} aria-hidden>
        <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// Días que alcanza el stock contra el plazo del proveedor
function Alcance({ cobertura, plazo, stock }: { cobertura: number | null; plazo: number | null; stock: number }) {
  const tarda = plazo ?? 7;
  const rango = Math.max(14, tarda * 2);
  const llega = cobertura != null && cobertura >= tarda;
  const ancho = cobertura == null ? 0 : Math.min(cobertura / rango, 1) * 100;
  const texto =
    cobertura == null ? 'no se vendió en el período'
      : stock <= 0 ? `sin stock · el proveedor tarda ${dec(tarda)} días`
        : `le alcanza ${cobertura < 1 ? 'menos de 1 día' : `${dec(cobertura)} día${cobertura === 1 ? '' : 's'}`} · el proveedor tarda ${dec(tarda)}`;
  return (
    <div className="mt-1.5">
      <div className="relative h-1 w-full max-w-[220px] rounded-full bg-black/[0.07]">
        <div className={`absolute inset-y-0 left-0 rounded-full ${llega ? 'bg-black/45' : 'bg-[#B82D25]'}`} style={{ width: `${ancho}%` }} />
        <div className="absolute -top-[3px] h-2.5 w-[2px] rounded-full bg-[#C9A96E]" style={{ left: `${(tarda / rango) * 100}%` }} aria-hidden />
      </div>
      <p className={`mt-1 text-[11px] leading-tight ${llega || cobertura == null ? 'text-black/45' : 'text-[#932A1F]'}`}>{texto}</p>
    </div>
  );
}

export function NotaDePedido({
  propuesta,
  yaPedidos,
  onArmada,
  onCambio,
}: {
  propuesta: Propuesta;
  // productos que otra nota ya pidió en esta pantalla ("sucursalId:sku"): salen de esta
  yaPedidos?: Set<string>;
  onArmada?: (orden: Armada & { proveedor: string; sucursal: string; sucursalId: string }) => void;
  onCambio?: (estado: EstadoNota) => void;
}) {
  const [items, setItems] = useState<RenglonPropuesta[]>(propuesta.items);
  const [verTodos, setVerTodos] = useState(false);
  const [armando, setArmando] = useState(false);
  const [error, setError] = useState('');
  const [armadas, setArmadas] = useState<Armada[]>([]);

  const vivos = useMemo(
    () => (yaPedidos?.size ? items.filter((i) => !yaPedidos.has(`${propuesta.sucursalId}:${i.sku}`)) : items),
    [items, yaPedidos, propuesta.sucursalId],
  );
  const tildados = useMemo(() => vivos.filter((i) => i.tildado && i.cantidad > 0), [vivos]);
  const total = tildados.reduce((s, i) => s + (i.costo ?? 0) * i.cantidad, 0);
  const unidades = tildados.reduce((s, i) => s + i.cantidad, 0);
  const sinCosto = tildados.some((i) => i.costo == null);
  const todos = vivos.length > 0 && vivos.every((i) => i.tildado);
  const urgentes = vivos.filter((i) => i.alerta === 'sin_stock' || i.alerta === 'no_llega').length;
  const visibles = verTodos ? vivos : vivos.slice(0, VISIBLES);
  const restantes = vivos.length - visibles.length;
  // lo tildado que queda escondido: se compra igual, así que se dice
  const tildadosOcultos = restantes > 0 ? vivos.slice(VISIBLES).filter((i) => i.tildado && i.cantidad > 0).length : 0;

  const avisar = useRef(onCambio);
  avisar.current = onCambio;
  useEffect(() => {
    avisar.current?.({
      proveedor: propuesta.proveedor,
      sucursal: propuesta.sucursal,
      items: vivos.map((i) => ({ sku: i.sku, nombre: i.nombre, cantidad: i.cantidad, tildado: i.tildado })),
      armadas,
    });
  }, [vivos, armadas, propuesta.proveedor, propuesta.sucursal]);

  const cambiar = (sku: string, cambio: Partial<RenglonPropuesta>) =>
    setItems((xs) => xs.map((x) => (x.sku === sku ? { ...x, ...cambio } : x)));
  const poner = (sku: string, valor: number) => {
    const n = Math.max(0, Math.round(valor) || 0);
    // corregir la cantidad es decidir comprarlo: se tilda solo
    cambiar(sku, { cantidad: n, tildado: n > 0 });
  };

  async function armar() {
    if (!tildados.length || armando) return;
    setArmando(true);
    setError('');
    try {
      const r = await fetch('/api/abastecimiento?que=orden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorId: propuesta.proveedorId,
          sucursalId: propuesta.sucursalId,
          items: tildados.map((i) => ({ sku: i.sku, cantidad: i.cantidad })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No se pudo armar el pedido');
      const armada: Armada = { ...(j as Armada), pedidos: tildados.map((i) => ({ sku: i.sku, cantidad: i.cantidad })) };
      setArmadas((a) => [...a, armada]);
      onArmada?.({ ...armada, proveedor: propuesta.proveedor, sucursal: propuesta.sucursal, sucursalId: propuesta.sucursalId });
      // lo pedido sale de la nota; lo que quedó sin tildar sigue para otra vez
      const pedidos = new Set(tildados.map((i) => i.sku));
      setItems((xs) => xs.filter((x) => !pedidos.has(x.sku)).map((x) => ({ ...x, tildado: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el pedido');
    } finally {
      setArmando(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(20,20,20,0.06)] ring-1 ring-black/[0.06]">
      {/* la franja de la nota de pedido */}
      <header className="bg-[#141414] px-4 pb-3 pt-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="min-w-0 break-words text-[15px] font-bold uppercase tracking-[0.08em] text-white">{propuesta.proveedor}</h3>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#C9A96E]">{propuesta.sucursal}</p>
        </div>
        <p className="mt-1 text-[11.5px] text-white/55">
          {vivos.length} sugerido{vivos.length === 1 ? '' : 's'}
          {urgentes > 0 && <> · <span className="text-white/85">{urgentes} urgente{urgentes === 1 ? '' : 's'}</span></>}
          {propuesta.plazoDias != null && <> · tarda {dec(propuesta.plazoDias)} días{/sin confirmar|por defecto/.test(propuesta.plazoFuente ?? '') ? ' (sin confirmar)' : ''}</>}
        </p>
      </header>
      <div className="h-[3px] bg-[#C9A96E]" />

      {propuesta.faltan.length > 0 && (
        <p className="border-b border-[#B82D25]/15 bg-[#B82D25]/[0.06] px-4 py-2.5 text-[12.5px] leading-snug text-[#932A1F] sm:px-5">
          <b>Para comprarle falta:</b> {propuesta.faltan.join(', ')}. El pedido se arma igual y queda frenado hasta que administración lo complete.
        </p>
      )}

      <div aria-live="polite">
      {armadas.map((a, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-black/[0.06] bg-[#FAF7F1] px-4 py-3 sm:px-5">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#C9A96E] text-white" aria-hidden>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="min-w-0 text-[13px] leading-snug text-black">
            <p>
              <b>Orden {a.numero != null ? `#${a.numero}` : ''} armada</b> · {a.renglones} producto{a.renglones === 1 ? '' : 's'} · {pesos(a.total)}
            </p>
            {a.faltan.length ? (
              <p className="mt-0.5 text-[#932A1F]">Frenada: para comprarle falta {a.faltan.join(', ')}. Administración ya recibió el pedido de completarlo.</p>
            ) : (
              <p className="mt-0.5 text-black/55">
                Espera la firma del dueño en <a href="/aprobaciones" className="font-medium text-[#B82D25] underline underline-offset-2">Aprobaciones</a>.
              </p>
            )}
          </div>
        </div>
      ))}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3 sm:px-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/40">Producto</p>
            <button
              type="button"
              onClick={() => setItems((xs) => xs.map((x) => ({ ...x, tildado: !todos && x.cantidad > 0 })))}
              className="rounded text-[12px] font-medium text-[#B82D25] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#B82D25]"
            >
              {todos ? 'Destildar todos' : 'Tildar todos'}
            </button>
          </div>

          <ul>
            {visibles.map((it) => {
              const etiqueta = it.alerta ? ETIQUETA[it.alerta] : null;
              return (
                <li key={it.sku} className="grid grid-cols-[24px_40px_minmax(0,1fr)] items-start gap-x-3 border-b border-black/[0.05] px-4 py-3 last:border-0 sm:grid-cols-[24px_44px_minmax(0,1fr)_auto] sm:px-5">
                  <div className="pt-2.5"><Casilla tildado={it.tildado} nombre={it.nombre} onClick={() => cambiar(it.sku, { tildado: !it.tildado, cantidad: it.cantidad || it.sugerido || 1 })} /></div>
                  {it.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.foto} alt="" loading="lazy" className="h-10 w-10 rounded-lg bg-[#F0EBE2] object-contain sm:h-11 sm:w-11" />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#F0EBE2] text-sm font-semibold text-black/25 sm:h-11 sm:w-11" aria-hidden>
                      {it.nombre.trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={`min-w-0 transition-opacity ${it.tildado ? '' : 'opacity-55'}`}>
                    <p className="break-words text-[13.5px] font-medium leading-snug text-black">{it.nombre}</p>
                    {/* sin puntos separadores: al saltar de línea en el celular quedaban colgando */}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-black/55">
                      {etiqueta && <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${etiqueta.clase}`}>{etiqueta.texto}</span>}
                      <span className="tabular-nums">stock {dec(it.stock)}</span>
                      {it.ritmoDia > 0 && <span className="tabular-nums">vende {dec(it.ritmoDia)} por día</span>}
                      {it.enCamino > 0 && <span className="tabular-nums">{dec(it.enCamino)} en camino</span>}
                    </p>
                    {it.motivo && <p className="mt-0.5 text-[11.5px] italic text-black/50">{it.motivo}</p>}
                    {/* sin stock ya lo dice la etiqueta; la barra es para lo que todavía tiene */}
                    {it.stock > 0 && <Alcance cobertura={it.coberturaDias} plazo={propuesta.plazoDias} stock={it.stock} />}
                  </div>
                  <div className="col-start-3 mt-2.5 flex items-center justify-between gap-3 sm:col-start-4 sm:row-start-1 sm:mt-0 sm:flex-col sm:items-end sm:justify-start sm:gap-1">
                    <div className="flex items-center rounded-full ring-1 ring-black/15">
                      <button type="button" onClick={() => poner(it.sku, it.cantidad - 1)} disabled={it.cantidad <= 0} aria-label={`Uno menos de ${it.nombre}`}
                        className="h-8 w-8 rounded-l-full text-lg leading-none text-black/60 hover:bg-black/[0.04] disabled:opacity-30">−</button>
                      <input
                        inputMode="numeric"
                        aria-label={`Cantidad de ${it.nombre}`}
                        value={it.cantidad || ''}
                        placeholder="0"
                        onChange={(e) => poner(it.sku, Number(e.target.value.replace(/\D/g, '')) || 0)}
                        className="h-8 w-11 border-x border-black/10 bg-transparent text-center text-[15px] font-semibold tabular-nums text-black outline-none focus:bg-[#F0EBE2]"
                      />
                      <button type="button" onClick={() => poner(it.sku, it.cantidad + 1)} aria-label={`Uno más de ${it.nombre}`}
                        className="h-8 w-8 rounded-r-full text-lg leading-none text-black/60 hover:bg-black/[0.04]">+</button>
                    </div>
                    <p className="text-[11px] tabular-nums text-black/45">
                      {it.costo != null ? pesos(it.costo * it.cantidad) : 'sin costo'}
                      {it.sugerido > 0 && it.cantidad !== it.sugerido && <span className="ml-1.5 text-black/35">(sugerido {it.sugerido})</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {restantes > 0 && (
            <button type="button" onClick={() => setVerTodos(true)}
              className="w-full border-t border-black/[0.06] px-4 py-2.5 text-[12.5px] font-medium text-black/55 hover:bg-black/[0.02] hover:text-black">
              Ver {restantes} producto{restantes === 1 ? '' : 's'} más
            </button>
          )}

          <footer className="flex flex-col gap-3 border-t border-black/10 bg-[#FAF7F1] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="text-[19px] font-bold tabular-nums leading-none text-black">{pesos(total)}</p>
              <p className="mt-1 text-[11.5px] text-black/50">
                {tildados.length} tildado{tildados.length === 1 ? '' : 's'} · {unidades.toLocaleString('es-AR')} unidad{unidades === 1 ? '' : 'es'}
                {sinCosto ? ' · hay productos sin costo: el total lo confirma la factura' : ' · con el último costo conocido'}
              </p>
            </div>
            <button type="button" onClick={armar} disabled={!tildados.length || armando}
              className="shrink-0 rounded-full bg-[#B82D25] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#932A1F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B82D25] disabled:opacity-40">
              {armando ? 'Armando el pedido…' : 'Armar pedido con lo tildado'}
            </button>
          </footer>
          {error && <p className="border-t border-[#B82D25]/20 bg-[#B82D25]/[0.06] px-4 py-2.5 text-[12.5px] text-[#932A1F] sm:px-5">{error}</p>}
        </>
      )}
    </article>
  );
}
