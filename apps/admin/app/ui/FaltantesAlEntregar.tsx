'use client';

import { useEffect, useState } from 'react';
import { pesos } from '../lib/formato';
import { Aviso, Boton, Entrada, Modal, Tarjeta } from './kit';

// Al entregar, si falta algo, se pregunta qué hacemos: sacarlo o reemplazarlo,
// nada más (Leandro, 21/10/2026). Antes: "Stock insuficiente: la operación
// dejaría -6.000 unidades", sin decir de qué producto, y la gente apretaba
// "Entregar" otra vez. La usan Pedidos, Depósito, Envíos y el repartidor.

export type Faltante = { productoId: string; sku: string | null; nombre: string; pide: number; hay: number };
/** Un cambio que espera lo que dice el cliente (un parecido o «¿cuál querés?»). */
export type CambioAbierto = {
  id: string; tipo: 'parecido' | 'variedad'; falta: string; reemplazo: string | null;
  cantidad: number | null; pide: number | null; hay: number | null; pedida: string | null; variedades: string[]; estado: string;
};
export type FaltaDeStock = { pedidoId: string; faltantes: Faltante[]; cambios?: CambioAbierto[]; sucursalId: string | null; mensaje: string };

/**
 * La respuesta de "entregar" (o de listo / salir) dice que falta stock, o que
 * hay un cambio sin contestar (23/11/2026, DOM-F0CF53FF6465: se entregó con el
 * cambio del Feta sin contestar y el Crottin nunca entró): devuelve qué falta.
 */
export function faltaDeStock(pedidoId: string, status: number, datos: any): FaltaDeStock | null {
  if (status !== 409) return null;
  if (datos?.codigo === 'CAMBIO_SIN_RESPUESTA' && Array.isArray(datos.cambios) && datos.cambios.length) {
    return { pedidoId, faltantes: [], cambios: datos.cambios, sucursalId: null, mensaje: String(datos.message ?? '') };
  }
  if (datos?.codigo !== 'FALTA_STOCK' || !Array.isArray(datos.faltantes) || !datos.faltantes.length) return null;
  return { pedidoId, faltantes: datos.faltantes, sucursalId: datos.sucursalId ?? null, mensaje: String(datos.message ?? '') };
}

/** «200 g de Crottin», «2 × Coca»: como se lo dijo el WhatsApp. Lo que no es entero es por peso. */
function queVa(c: CambioAbierto) {
  const n = Number(c.cantidad);
  const nombre = c.reemplazo ?? 'el parecido';
  if (!Number.isFinite(n) || n <= 0 || n === 1) return nombre;
  if (!Number.isInteger(n)) return n < 1 ? `${Math.round(n * 1000)} g de ${nombre}` : `${cant(n)} kg de ${nombre}`;
  return `${cant(n)} × ${nombre}`;
}

const cant = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 3 }));

type Hecho = { texto: string };
type Cambio = { total: number; totalAntes: number; pagado: boolean };

export function FaltantesAlEntregar({
  falta,
  soloSacar = false,
  onCerrar,
  onEntregar,
}: {
  falta: FaltaDeStock;
  /** el repartidor está en la puerta: puede sacar, no cambiar por otro */
  soloSacar?: boolean;
  onCerrar: () => void;
  /** se resolvió todo: seguir con la entrega */
  onEntregar: () => void | Promise<void>;
}) {
  const [faltantes, setFaltantes] = useState<Faltante[]>(falta.faltantes);
  const [cambios, setCambios] = useState<CambioAbierto[]>(falta.cambios ?? []);
  // vino por un cambio sin contestar: el botón sigue con lo que se estaba haciendo (listo, salir o entregar)
  const porCambios = (falta.cambios ?? []).length > 0;
  const [hechos, setHechos] = useState<Hecho[]>([]);
  const [cambio, setCambio] = useState<Cambio | null>(null);
  const [reemplazando, setReemplazando] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  // el total de antes del primer cambio, para mostrar cuánto cambió en total
  const [totalOriginal, setTotalOriginal] = useState<number | null>(null);

  async function resolver(f: Faltante, reemplazo?: { sku: string; nombre: string; cantidad: number }) {
    setTrabajando(true);
    setError('');
    const r = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'faltante', pedidoId: falta.pedidoId, productoId: f.productoId, reemplazoSku: reemplazo?.sku, cantidad: reemplazo?.cantidad }),
    }).catch(() => null);
    setTrabajando(false);
    if (!r) { setError('Sin conexión. Probá de nuevo.'); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.message ?? 'No se pudo cambiar el pedido.'); return; }
    const saca = Number(d.saco?.cantidad ?? f.pide - f.hay);
    setHechos((h) => [...h, {
      texto: reemplazo
        ? `Cambiaste ${cant(saca)} × ${f.nombre} por ${cant(Number(d.puso?.cantidad ?? reemplazo.cantidad))} × ${d.puso?.nombre ?? reemplazo.nombre}.`
        : f.hay > 0
          ? `Sacaste ${cant(saca)} × ${f.nombre}: ${f.hay === 1 ? 'se entrega la que hay' : `se entregan las ${cant(f.hay)} que hay`}.`
          : `Sacaste ${f.nombre} del pedido.`,
    }]);
    if (totalOriginal == null) setTotalOriginal(Number(d.totalAntes));
    setCambio({ total: Number(d.total), totalAntes: Number(d.totalAntes), pagado: !!d.pagado });
    setFaltantes(Array.isArray(d.faltantes) ? d.faltantes : faltantes.filter((x) => x.productoId !== f.productoId));
    setReemplazando(null);
  }

  /** Lo que dijo el cliente del cambio (por teléfono, en el local): entra al pedido ahora. */
  async function anotar(c: CambioAbierto, acepta: boolean, elegida?: string) {
    setTrabajando(true);
    setError('');
    const r = await fetch('/api/salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'decidir-cambio', pedidoId: falta.pedidoId, cambioId: c.id, acepta, ...(elegida ? { elegida } : {}) }),
    }).catch(() => null);
    setTrabajando(false);
    if (!r) { setError('Sin conexión. Probá de nuevo.'); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.message ?? 'No se pudo anotar.'); return; }
    if (d?.error) { setError(`Quedó anotado, pero no se pudo cambiar el pedido: ${d.error}. Avisale a la caja.`); return; }
    const sigue = c.hay != null && c.hay > 0 ? `queda en ${cant(c.hay)}` : 'sale del pedido';
    setHechos((h) => [...h, {
      texto: c.tipo === 'variedad'
        ? acepta ? `Va ${c.falta} (${elegida}).` : `${c.falta} ${sigue}.`
        : acepta ? `Va ${queVa(c)} en lugar de ${c.falta}.` : `No va ${c.reemplazo ?? 'el parecido'}: ${c.falta} ${sigue}.`,
    }]);
    setCambios((xs) => xs.filter((x) => x.id !== c.id));
  }

  async function entregar() {
    setTrabajando(true);
    await onEntregar();
    setTrabajando(false);
  }

  const listo = faltantes.length === 0 && cambios.length === 0;
  const diferencia = cambio && totalOriginal != null ? cambio.total - totalOriginal : 0;

  return (
    <Modal
      abierto
      ancho="normal"
      onCerrar={onCerrar}
      bloquearCierre={trabajando}
      cerrarAlTocarAfuera={false}
      titulo={cambios.length ? 'Falta lo que dijo el cliente' : listo ? (porCambios ? 'Ya está anotado' : 'Listo para entregar') : 'Falta stock para entregar'}
      descripcion={cambios.length ? 'Se le ofreció un cambio y no figura la respuesta. ¿Qué dijo?' : listo ? (porCambios ? 'El pedido ya tiene lo que dijo el cliente.' : 'Ya está todo lo que se lleva.') : '¿Qué hacemos con esto?'}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>Volver</Boton>
        <Boton onClick={entregar} disabled={!listo || trabajando}>
          {porCambios ? 'Seguir' : cambio ? `Entregar (${pesos(cambio.total)})` : 'Entregar'}
        </Boton>
      </>}
    >
      <div className="space-y-3">
        {cambios.map((c) => (
          <Tarjeta key={c.id} className="p-4">
            <p className="font-semibold text-tinta">{c.falta}{c.tipo === 'variedad' && c.pedida ? ` (pidió ${c.pedida})` : ''}</p>
            <p className="mt-0.5 text-sm text-tinta/70">
              {c.tipo === 'variedad'
                ? `No hay la que pidió. Se le preguntó cuál quiere${c.variedades.length ? `: ${c.variedades.join(', ')}` : ''}.`
                : `No hay. Se le ofreció ${queVa(c)}.`}
              {c.estado === 'propuesto' ? ' Todavía no se le consultó.' : ' No figura la respuesta.'}
            </p>
            {soloSacar ? (
              <p className="mt-2 text-sm font-semibold text-marca">Avisale a la caja: tiene que anotar lo que dijo el cliente antes de entregarlo.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {c.tipo === 'variedad'
                  ? c.variedades.map((v) => (
                    <Boton key={v} variante="secundario" tamano="chico" disabled={trabajando} onClick={() => anotar(c, true, v)}>Eligió {v}</Boton>
                  ))
                  : <Boton variante="secundario" tamano="chico" disabled={trabajando} onClick={() => anotar(c, true)}>Dijo que sí: va {c.reemplazo ?? 'el parecido'}</Boton>}
                <Boton variante="secundario" tamano="chico" disabled={trabajando} onClick={() => anotar(c, false)}>
                  {c.tipo === 'variedad' ? 'Ninguna' : 'Dijo que no'}
                </Boton>
              </div>
            )}
          </Tarjeta>
        ))}

        {faltantes.map((f) => (
          <Tarjeta key={f.productoId} className="p-4">
            <p className="font-semibold text-tinta">{f.nombre}</p>
            <p className="mt-0.5 text-sm text-tinta/70">
              El pedido lleva {cant(f.pide)} y {f.hay > 0 ? `hay ${cant(f.hay)}` : 'no hay ninguno'}.
            </p>
            {reemplazando === f.productoId ? (
              <BuscarReemplazo
                falta={f}
                sucursalId={falta.sucursalId}
                trabajando={trabajando}
                onElegir={(r) => resolver(f, r)}
                onCancelar={() => setReemplazando(null)}
              />
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Boton variante="secundario" tamano="chico" disabled={trabajando} onClick={() => resolver(f)}>
                  {f.hay > 0 ? (f.pide - f.hay === 1 ? 'Sacar el que falta' : `Sacar los ${cant(f.pide - f.hay)} que faltan`) : 'Sacarlo'}
                </Boton>
                {!soloSacar && (
                  <Boton variante="secundario" tamano="chico" disabled={trabajando} onClick={() => { setError(''); setReemplazando(f.productoId); }}>
                    Reemplazarlo
                  </Boton>
                )}
              </div>
            )}
          </Tarjeta>
        ))}

        {hechos.length > 0 && (
          <ul className="space-y-1 text-sm text-tinta/70">
            {hechos.map((h, i) => <li key={i}>{h.texto}</li>)}
          </ul>
        )}

        {cambio && totalOriginal != null && diferencia !== 0 && (
          cambio.pagado ? (
            <Aviso tono="atencion" titulo={`El pedido ya estaba pagado (${pesos(totalOriginal)})`}>
              Ahora queda en {pesos(cambio.total)}. {diferencia < 0
                ? `Hay que devolverle ${pesos(-diferencia)} al cliente.`
                : `Faltan ${pesos(diferencia)}: cobráselos al cliente o avisale.`}
            </Aviso>
          ) : (
            <p className="text-sm text-tinta/70">El total pasó de {pesos(totalOriginal)} a <span className="font-semibold text-tinta">{pesos(cambio.total)}</span>.</p>
          )
        )}

        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

type Opcion = { sku: string; nombre: string; precio: number | null; stock: number | null; activo: boolean };

function BuscarReemplazo({
  falta, sucursalId, trabajando, onElegir, onCancelar,
}: {
  falta: Faltante;
  sucursalId: string | null;
  trabajando: boolean;
  onElegir: (r: { sku: string; nombre: string; cantidad: number }) => void;
  onCancelar: () => void;
}) {
  const sacar = falta.pide - falta.hay;
  // arranca buscando parecidos: las dos primeras palabras del producto que falta
  const [texto, setTexto] = useState(falta.nombre.split(/\s+/).slice(0, 2).join(' '));
  const [cantidad, setCantidad] = useState(cant(sacar));
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  // lo que se buscó para la lista que se ve: "No encontré nada" y la lista
  // solo valen si corresponden a lo que está escrito ahora
  const [buscado, setBuscado] = useState('');
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) { setOpciones([]); setBuscado(''); setBuscando(false); return; }
    // Si se escribe otra cosa antes de que vuelva la respuesta, la limpieza
    // la deja sin efecto: una búsqueda vieja que llega tarde no pisa la lista
    // de la actual (pasaba con la búsqueda inicial y lo que se escribía después).
    let vigente = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await fetch(`/api/pos-buscar?q=${encodeURIComponent(q)}&sucursal=${encodeURIComponent(sucursalId ?? '')}`).catch(() => null);
      const d = r?.ok ? await r.json().catch(() => ({})) : {};
      if (!vigente) return;
      setOpciones(((d.items ?? []) as Opcion[]).filter((o) => o.activo !== false && o.sku !== falta.sku));
      setBuscado(q);
      setBuscando(false);
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [texto, sucursalId, falta.sku]);

  const n = Number(String(cantidad).replace(',', '.'));
  const cantidadValida = Number.isFinite(n) && n > 0;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Entrada
            aria-label="Buscar el producto que va en su lugar"
            placeholder="¿Qué le damos en su lugar?"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
        </div>
        <div className="w-20 shrink-0">
          <Entrada aria-label="Cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
      </div>
      {buscando && <p className="text-sm text-tinta/60">Buscando…</p>}
      {!buscando && texto.trim().length >= 2 && buscado === texto.trim() && !opciones.length && <p className="text-sm text-tinta/60">No encontré nada con ese nombre.</p>}
      <ul className="divide-y divide-crema-hondo">
        {opciones.map((o) => {
          const alcanza = o.stock == null || (cantidadValida && o.stock >= n);
          return (
            <li key={o.sku} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                {/* el nombre entero, aunque baje de renglón: lo que distingue
                    1,5 L de 900 ml suele estar al final */}
                <p className="break-words text-sm font-medium text-tinta">{o.nombre}</p>
                <p className="text-xs text-tinta/60">
                  {o.precio != null ? pesos(o.precio) : 'Sin precio'} · {o.stock == null ? 'stock sin dato' : o.stock > 0 ? `hay ${cant(o.stock)}` : 'sin stock'}
                </p>
              </div>
              <Boton
                variante="secundario"
                tamano="chico"
                className="shrink-0 whitespace-nowrap"
                disabled={trabajando || !cantidadValida || !alcanza || o.precio == null}
                onClick={() => onElegir({ sku: o.sku, nombre: o.nombre, cantidad: n })}
              >
                Poner este
              </Boton>
            </li>
          );
        })}
      </ul>
      {/* "No reemplazar" y no "Volver": el "Volver" del pie cierra toda la ventana */}
      <Boton variante="fantasma" tamano="chico" onClick={onCancelar} disabled={trabajando}>No reemplazar</Boton>
    </div>
  );
}
