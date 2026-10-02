'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Boton, Etiqueta, FOCO, FOCO_ADENTRO, PlacaRoja, unir, type RenglonPlaca, type TonoEtiqueta } from './kit';
import { pesos } from '../lib/formato';

// La propuesta de compra de un proveedor, dibujada como la nota de pedido que
// después le llega. Cada renglón se tilda; la cantidad se corrige ahí mismo;
// abajo, lo que suma lo tildado y el botón que lo convierte en orden de compra.
//
// 2/10/2026: pasó a la Placa roja (el paquete gráfico de los pedidos y las
// listas de precios: franja roja con el logo, la cantidad en el círculo rojo,
// el total en la píldora negra). Antes tenía un diseño propio, franja negra con
// línea dorada; Leandro pidió que todo detalle de productos se vea igual. Cambió
// cómo se ve, no lo que hace: la casilla, el − y +, la barrita y el armado
// siguen siendo los mismos.
//
// La barrita de cada producto es la cuenta que importa: cuántos días le alcanza
// el stock contra cuántos tarda el proveedor (la marca negra). Si la barra no
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

const dec = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
// un ritmo de 0,04 por día con un decimal se leería 'vende 0 por día'
const ritmo = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: n < 0.1 ? 2 : 1 });
const VISIBLES = 12;

const ETIQUETA: Record<string, { texto: string; tono: TonoEtiqueta }> = {
  sin_stock: { texto: 'Sin stock', tono: 'error' },
  no_llega: { texto: 'No llega', tono: 'atencion' },
  menos_de_12: { texto: 'Menos de 12', tono: 'neutro' },
};

const TILDE = (
  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
);

function Casilla({ tildado, onClick, nombre, disabled }: { tildado: boolean; onClick: () => void; nombre: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={tildado}
      aria-label={`${tildado ? 'Destildar' : 'Tildar'} ${nombre}`}
      onClick={onClick}
      disabled={disabled}
      // la casilla mide 24 px pero se toca en 44 (el ::before estira la zona)
      className={unir(
        'relative grid size-6 shrink-0 place-items-center rounded-sm border-2 transition-colors before:absolute before:-inset-2.5 disabled:opacity-50',
        FOCO,
        tildado ? 'border-marca bg-marca' : 'border-black/25 bg-white hover:border-black/50',
      )}
    >
      <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 text-white motion-safe:transition-transform ${tildado ? 'scale-100' : 'scale-0'}`} aria-hidden>
        {TILDE}
      </svg>
    </button>
  );
}

// Días que alcanza el stock contra el plazo del proveedor. Va dentro del
// "detalle" del renglón de la placa, que es un <p>: por eso es todo <span>
// (un <div> adentro de un <p> rompe la hidratación).
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
    <span className="mt-1.5 block">
      <span className="relative block h-1 w-full max-w-56 rounded-full bg-crema-hondo">
        <span className={unir('absolute inset-y-0 left-0 rounded-full', llega ? 'bg-tinta/45' : 'bg-marca')} style={{ width: `${ancho}%` }} />
        <span className="absolute -top-[3px] h-2.5 w-0.5 rounded-full bg-tinta" style={{ left: `${(tarda / rango) * 100}%` }} aria-hidden />
      </span>
      <span className={unir('mt-1 block text-xs leading-tight', llega || cobertura == null ? 'text-tinta/60' : 'text-marca-hondo')}>{texto}</span>
    </span>
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

  // Mientras se arma la orden no se toca nada: lo que se mandó es lo que se ve.
  // (Antes lo hacía un <fieldset disabled>; la placa no tiene dónde ponerlo
  // sin cortar los renglones, así que cada control lleva su disabled.)
  const renglones: RenglonPlaca[] = visibles.map((it) => {
    const etiqueta = it.alerta ? ETIQUETA[it.alerta] : null;
    // lo destildado queda a la vista pero apagado: no entra en el total
    const apagado = it.tildado ? '' : 'opacity-55';
    const nota = [it.costo == null && 'sin costo', it.sugerido > 0 && it.cantidad !== it.sugerido && `sugerido ${it.sugerido}`].filter(Boolean).join(' · ');
    return {
      clave: it.sku,
      cantidad: it.cantidad,
      nombre: <span className={unir('transition-opacity', apagado)}>{it.nombre}</span>,
      etiqueta: etiqueta ? <Etiqueta tono={etiqueta.tono}>{etiqueta.texto}</Etiqueta> : undefined,
      importe: it.costo != null ? <span className={unir('transition-opacity', apagado)}>{pesos(it.costo * it.cantidad)}</span> : undefined,
      detalle: (
        <span className={unir('block transition-opacity', apagado)}>
          {/* sin puntos separadores: al saltar de línea en el celular quedaban colgando */}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="tabular-nums">stock {dec(it.stock)}</span>
            {it.ritmoDia > 0 && <span className="tabular-nums">vende {ritmo(it.ritmoDia)} por día</span>}
            {it.enCamino > 0 && <span className="tabular-nums">{dec(it.enCamino)} en camino</span>}
          </span>
          {it.motivo && <span className="mt-0.5 block text-xs italic">{it.motivo}</span>}
          {/* sin stock ya lo dice la etiqueta; la barra es para lo que todavía tiene */}
          {it.stock > 0 && <Alcance cobertura={it.coberturaDias} plazo={propuesta.plazoDias} stock={it.stock} />}
        </span>
      ),
      acciones: (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Casilla
            tildado={it.tildado}
            nombre={it.nombre}
            disabled={armando}
            onClick={() => cambiar(it.sku, { tildado: !it.tildado, cantidad: it.cantidad || it.sugerido || 1 })}
          />
          <div className="flex items-center rounded-full bg-white ring-1 ring-black/15">
            <button type="button" onClick={() => poner(it.sku, it.cantidad - 1)} disabled={armando || it.cantidad <= 0} aria-label={`Uno menos de ${it.nombre}`}
              className={unir('size-11 rounded-l-full text-lg leading-none text-tinta/70 hover:bg-tinta/5 disabled:opacity-30 sm:size-8', FOCO_ADENTRO)}>−</button>
            <input
              inputMode="numeric"
              aria-label={`Cantidad de ${it.nombre}`}
              value={it.cantidad || ''}
              placeholder="0"
              disabled={armando}
              onChange={(e) => poner(it.sku, Number(e.target.value.replace(/\D/g, '')) || 0)}
              className="importe h-11 w-12 border-x border-black/15 bg-transparent text-center text-base font-semibold text-tinta outline-none focus:bg-crema sm:h-8 sm:w-11"
            />
            <button type="button" onClick={() => poner(it.sku, it.cantidad + 1)} disabled={armando} aria-label={`Uno más de ${it.nombre}`}
              className={unir('size-11 rounded-r-full text-lg leading-none text-tinta/70 hover:bg-tinta/5 disabled:opacity-30 sm:size-8', FOCO_ADENTRO)}>+</button>
          </div>
          {nota && <p className="importe text-xs text-tinta/60">{nota}</p>}
        </div>
      ),
    };
  });

  // lo que no entra de una: un renglón más que abre el resto
  if (restantes > 0) {
    renglones.push({
      clave: 'ver-mas',
      nombre: (
        <button type="button" onClick={() => setVerTodos(true)}
          className={unir('flex min-h-11 w-full items-center justify-center rounded-xl text-center text-sm font-medium text-tinta/70 transition-colors hover:text-tinta', FOCO)}>
          <span>
            Ver {restantes} producto{restantes === 1 ? '' : 's'} más
            {tildadosOcultos > 0 && <span className="text-marca-hondo"> · {tildadosOcultos} ya tildado{tildadosOcultos === 1 ? '' : 's'}</span>}
          </span>
        </button>
      ),
    });
  }

  // Lo que pasa con la nota: datos que le faltan al proveedor (en rojo) y las
  // órdenes ya armadas. Va en el recuadro de la placa, justo arriba del botón.
  const hayRecuadro = propuesta.faltan.length > 0 || armadas.length > 0;
  const recuadro = hayRecuadro ? (
    <div className="space-y-3">
      {propuesta.faltan.length > 0 && (
        <p className="leading-snug text-marca-hondo">
          <b>Para comprarle falta:</b> {propuesta.faltan.join(', ')}. El pedido se arma igual y queda frenado hasta que administración lo complete.
        </p>
      )}
      {armadas.map((a, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-tinta text-white" aria-hidden>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">{TILDE}</svg>
          </span>
          <div className="min-w-0 leading-snug text-tinta">
            <p className="break-words">
              <b>Orden {a.numero != null ? `#${a.numero}` : ''} armada</b> · {a.renglones} producto{a.renglones === 1 ? '' : 's'} · <span className="importe">{pesos(a.total ?? 0)}</span>
            </p>
            {a.faltan.length ? (
              <p className="mt-0.5 break-words text-marca-hondo">Frenada: para comprarle falta {a.faltan.join(', ')}. Administración ya recibió el pedido de completarlo.</p>
            ) : (
              <p className="mt-0.5 text-tinta/70">
                Espera la firma del dueño en <a href="/aprobaciones" className={unir('rounded-sm font-medium text-marca-hondo underline underline-offset-2', FOCO)}>Aprobaciones</a>.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : undefined;

  // El recuadro aparece recién con la primera orden, y un aria-live que nace
  // ya con texto no siempre se anuncia: el aviso para el lector de pantalla
  // vive aparte, montado desde el principio.
  const ultima = armadas[armadas.length - 1];
  const anuncio = ultima
    ? `Orden ${ultima.numero != null ? `#${ultima.numero} ` : ''}armada: ${ultima.renglones} producto${ultima.renglones === 1 ? '' : 's'}, ${pesos(ultima.total ?? 0)}. ${
      ultima.faltan.length ? `Frenada: para comprarle falta ${ultima.faltan.join(', ')}.` : 'Espera la firma del dueño en Aprobaciones.'
    }`
    : '';

  const plazo = propuesta.plazoDias != null
    ? ` · tarda ${dec(propuesta.plazoDias)} días${/sin confirmar|por defecto/.test(propuesta.plazoFuente ?? '') ? ' (sin confirmar)' : ''}`
    : '';

  return (
    <div className="min-w-0">
      <PlacaRoja
        titulo="Nota de pedido"
        sub={
          <>
            <span className="font-semibold text-white">{propuesta.proveedor}</span> · {propuesta.sucursal}
            <span className="block">
              {vivos.length} sugerido{vivos.length === 1 ? '' : 's'}
              {urgentes > 0 && ` · ${urgentes} urgente${urgentes === 1 ? '' : 's'}`}
              {plazo}
            </span>
          </>
        }
        renglones={renglones}
        total={vivos.length > 0 ? { etiqueta: 'Total tildado', valor: pesos(total) } : undefined}
        recuadro={recuadro}
        pie={
          vivos.length > 0
            ? `${tildados.length} tildado${tildados.length === 1 ? '' : 's'} · ${unidades.toLocaleString('es-AR')} unidad${unidades === 1 ? '' : 'es'}${
              sinCosto ? ' · hay productos sin costo: el total lo confirma la factura' : ' · con el último costo conocido'
            }`
            // sin esto la placa queda con la franja y nada abajo: todo lo
            // suyo lo pidió otra nota de la pantalla (yaPedidos)
            : !hayRecuadro && items.length > 0 ? 'Lo sugerido ya se pidió en otra nota de esta pantalla.' : undefined
        }
        acciones={
          vivos.length > 0 ? (
            <>
              <Boton variante="fantasma" tamano="chico" className="mr-auto" disabled={armando}
                onClick={() => setItems((xs) => xs.map((x) => (todos ? { ...x, tildado: false } : { ...x, tildado: true, cantidad: x.cantidad || x.sugerido || 1 })))}>
                {todos ? 'Destildar todos' : 'Tildar todos'}
              </Boton>
              <Boton onClick={armar} disabled={!tildados.length || armando} cargando={armando} className="grow sm:grow-0">
                {armando ? 'Armando el pedido…' : 'Armar pedido con lo tildado'}
              </Boton>
              {error && <p role="alert" className="basis-full break-words text-sm text-marca-hondo">{error}</p>}
            </>
          ) : undefined
        }
      />
      <p className="sr-only" aria-live="polite">{anuncio}</p>
    </div>
  );
}
