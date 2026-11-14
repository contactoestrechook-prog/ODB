'use client';

import { useCallback, useEffect, useState } from 'react';
import { numero, pesos } from '../lib/formato';
import { haceCuanto, telefonoLegible } from '../lib/pedidos';
import {
  AreaTexto, Aviso, Boton, Campo, Cargando, Chips, Entrada, Etiqueta, FOCO, IconoCerrar, Modal, PlacaRoja, Selector, unir, Vacio,
} from './kit';

// PEDIDOS › CHARLAS DE WHATSAPP (14/11/2026). Leandro: «que empiecen a salir los
// nuevos». Desde el 9/11 no entraba ningún pedido: los cierra una persona desde
// el teléfono y quedaban solo en el chat. Acá están las charlas de las últimas
// 36 horas; «Pasar a pedido» hace que la IA lea la charla entera y arme el
// pedido, la persona lo revisa (al lado de la charla) y lo crea. Entra SIN
// TOMAR: suena en las cajas de la sucursal como cualquier pedido nuevo.

export type Charla = {
  linea: string;
  telefono: string;
  nombre: string | null;
  telefonoReal: string | null;
  actualizadoEn: string;
  ultimo: { texto: string; de: 'cliente' | 'persona' | 'bot' } | null;
  mensajesCliente: number;
  hablaDeProductos: boolean;
  atendidaPorPersona: boolean;
  pedido: { id: string; codigo: string | null; estado: string | null; en: string } | null;
};

/** Para revisar: habló de productos y todavía no tiene pedido. */
export const paraRevisar = (c: Charla) => !c.pedido && c.hablaDeProductos;

const QUIEN = { cliente: 'Cliente', persona: 'Casa', bot: 'Bot' } as const;
const LINEA: Record<string, string> = { pedidos: 'Línea de pedidos', local: 'Línea del local', general: 'Línea general' };
const lineaDe = (l: string) => LINEA[l] ?? `Línea ${l}`;

/** Las charlas, al día cada 30 s (las usa la pestaña para mostrar cuántas hay para revisar). */
export function useCharlas() {
  const [charlas, setCharlas] = useState<Charla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/pedidos/charlas', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.message ?? 'No pude traer las charlas.'); return; }
      if (Array.isArray(d)) { setCharlas(d); setError(null); }
    } catch {
      setError('Sin conexión. Reintento solo.');
    }
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [cargar]);
  return { charlas, error, cargar };
}

type Filtro = 'revisar' | 'sin' | 'todas';

export function CharlasDeWhatsapp({ charlas, error, recargar, onCreado, onVerPedido }: {
  charlas: Charla[] | null;
  error: string | null;
  recargar: () => void;
  onCreado: () => void;
  onVerPedido: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>('revisar');
  const [abierta, setAbierta] = useState<Charla | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  if (!charlas) return error ? <Aviso tono="error">{error}</Aviso> : <Cargando bloque texto="Buscando las charlas…" />;
  const lista = charlas.filter((c) => (filtro === 'revisar' ? paraRevisar(c) : filtro === 'sin' ? !c.pedido : true));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips
          etiquetaAccesible="Qué charlas ver"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={[
            { valor: 'revisar', etiqueta: 'Hablaron de productos, sin pedido', cuenta: charlas.filter(paraRevisar).length },
            { valor: 'sin', etiqueta: 'Sin pedido', cuenta: charlas.filter((c) => !c.pedido).length },
            { valor: 'todas', etiqueta: 'Todas', cuenta: charlas.length },
          ]}
        />
        <p className="text-xs text-tinta/60">Últimas 36 horas · se actualiza sola</p>
      </div>

      {hecho && <Aviso tono="ok" accion={<Boton tamano="chico" variante="secundario" onClick={() => setHecho(null)}>Entendido</Boton>}>{hecho}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {lista.length === 0 ? (
        <Vacio
          titulo={filtro === 'revisar' ? 'No hay charlas con productos sin pedido' : 'No hay charlas'}
          texto={filtro === 'revisar' ? 'Cuando alguien cierre un pedido por WhatsApp y no esté cargado, aparece acá.' : 'Las charlas de las últimas 36 horas aparecen acá.'}
        />
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {lista.map((c) => (
            <TarjetaCharla key={`${c.linea}:${c.telefono}`} c={c} onPasar={() => setAbierta(c)} onVerPedido={onVerPedido} />
          ))}
        </div>
      )}

      {abierta && (
        <PasarAPedido
          charla={abierta}
          onCerrar={() => setAbierta(null)}
          onCreado={(codigo, sinReserva) => {
            setAbierta(null);
            setHecho(`Pedido ${codigo} creado: ya suena en las cajas.${sinReserva ? ' No alcanzaba el stock para reservarlo y quedó anotado en el pedido.' : ''}`);
            recargar();
            onCreado();
          }}
        />
      )}
    </div>
  );
}

function TarjetaCharla({ c, onPasar, onVerPedido }: { c: Charla; onPasar: () => void; onVerPedido: (id: string) => void }) {
  const tel = telefonoLegible(c.telefonoReal);
  return (
    <article className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-white p-4 shadow-tarjeta ring-1 ring-black/[0.04]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-tinta">{c.nombre || tel || 'Cliente sin nombre'}</p>
          <p className="truncate text-xs text-tinta/60">{[c.nombre && tel ? tel : null, lineaDe(c.linea)].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="importe shrink-0 text-xs text-tinta/60">{haceCuanto(c.actualizadoEn)}</span>
      </header>
      {c.ultimo && (
        <p className="line-clamp-2 min-w-0 break-words text-sm text-tinta/80">
          <span className="font-semibold text-tinta">{QUIEN[c.ultimo.de]}:</span> {c.ultimo.texto}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {c.pedido
          ? <Etiqueta tono="ok">Pedido {c.pedido.codigo ?? 'cargado'}</Etiqueta>
          : c.hablaDeProductos ? <Etiqueta tono="atencion">Habló de productos · sin pedido</Etiqueta> : <Etiqueta tono="neutro">Sin pedido</Etiqueta>}
        {c.atendidaPorPersona && <Etiqueta tono="info">La atendió una persona</Etiqueta>}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {c.pedido ? (
          <>
            <Boton tamano="chico" variante="secundario" onClick={() => onVerPedido(c.pedido!.id)}>Ver pedido</Boton>
            <Boton tamano="chico" variante="fantasma" onClick={onPasar}>Pasar otro pedido</Boton>
          </>
        ) : (
          <Boton tamano="chico" onClick={onPasar}>Pasar a pedido</Boton>
        )}
      </div>
    </article>
  );
}

type Renglon = { producto_id: string; cantidad: number; pedido: string; match: string; sku: string; precio: number | null; precioDicho: number | null; precioDistinto: boolean };
type Armado = {
  linea: string; telefono: string; telefonoReal: string | null;
  nombre: string | null; tipo: 'retiro' | 'envio' | null; direccion: string | null; entregaFecha: string | null; franja: string | null;
  formaPago: string | null; recibe: string | null; notas: string | null; dudas: string[];
  items: Renglon[]; sinMatch: string[]; charla: { de: 'cliente' | 'persona' | 'bot'; texto: string }[];
};

const FORMAS = [
  { valor: '', etiqueta: 'No lo dijo' },
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
];

function PasarAPedido({ charla, onCerrar, onCreado }: { charla: Charla; onCerrar: () => void; onCreado: (codigo: string, sinReserva: boolean) => void }) {
  const [armado, setArmado] = useState<Armado | null>(null);
  const [leyendo, setLeyendo] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setLeyendo(true); setError(null);
    fetch('/api/pedidos/charlas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'armar', linea: charla.linea, telefono: charla.telefono }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setError(d?.message ?? 'No pude leer la charla.');
        else setArmado({ ...d, tipo: d.tipo ?? 'retiro' });
      })
      .catch(() => { if (vivo) setError('Sin conexión. Probá de nuevo.'); })
      .finally(() => { if (vivo) setLeyendo(false); });
    return () => { vivo = false; };
  }, [charla.linea, charla.telefono, intento]);

  const cambiar = (c: Partial<Armado>) => setArmado((a) => (a ? { ...a, ...c } : a));
  const items = armado?.items ?? [];
  const total = items.length > 0 && items.every((i) => i.precio != null) ? items.reduce((t, i) => t + (Number(i.cantidad) || 0) * (i.precio ?? 0), 0) : null;
  const faltaDireccion = armado?.tipo === 'envio' && !String(armado.direccion ?? '').trim();
  const puedeCrear = !!armado && items.length > 0 && items.every((i) => Number(i.cantidad) > 0) && !faltaDireccion && !creando;

  async function crear() {
    if (!armado || !puedeCrear) return;
    setCreando(true); setError(null);
    try {
      const r = await fetch('/api/pedidos/charlas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'crear',
          linea: armado.linea, telefono: armado.telefono, telefonoReal: armado.telefonoReal,
          items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precioDicho: i.precioDicho, nombre: i.match, precio: i.precio })),
          nombre: armado.nombre, tipo: armado.tipo, direccion: armado.direccion, entregaFecha: armado.entregaFecha || null, franja: armado.franja,
          formaPago: armado.formaPago || null, recibe: armado.recibe, notas: armado.notas, sinMatch: armado.sinMatch,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.message ?? 'No se pudo crear el pedido.'); return; }
      onCreado(String(d.codigo ?? ''), !!d.sinReserva);
    } catch {
      setError('Sin conexión. Probá de nuevo.');
    } finally {
      setCreando(false);
    }
  }

  const titulo = `Pasar a pedido · ${charla.nombre || telefonoLegible(charla.telefonoReal) || 'Cliente sin nombre'}`;
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={titulo}
      descripcion="La IA leyó la charla y armó el pedido. Revisalo contra la charla: al crearlo entra sin tomar y suena en las cajas."
      ancho="completo"
      bloquearCierre={creando}
      cerrarAlTocarAfuera={false}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={creando}>Cancelar</Boton>
          {armado && <Boton onClick={crear} cargando={creando} disabled={!puedeCrear}>{creando ? 'Creando…' : 'Crear pedido'}</Boton>}
        </>
      }
    >
      {leyendo ? (
        <Cargando bloque texto="Leyendo la charla con la IA… tarda unos segundos." />
      ) : !armado ? (
        <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={() => setIntento((n) => n + 1)}>Probar de nuevo</Boton>}>{error ?? 'No pude leer la charla.'}</Aviso>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {armado.dudas.length > 0 && (
              <Aviso tono="atencion" titulo="Mirá esto antes de crear">
                <ul className="list-disc space-y-0.5 pl-4">{armado.dudas.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </Aviso>
            )}
            {items.length > 0 ? (
              <PlacaRoja
                titulo="PEDIDO"
                sub={items.length === 1 ? '1 producto' : `${items.length} productos`}
                renglones={items.map((it, i) => ({
                  clave: `${it.producto_id}-${i}`,
                  cantidad: Number(it.cantidad) || 0,
                  nombre: it.match,
                  detalle: [`en la charla: ${it.pedido}`, it.precio != null ? `${numero(Number(it.cantidad) || 0, 2)} × ${pesos(it.precio)}` : 'sin precio en el sistema'].join(' · '),
                  destacado: it.precioDistinto && it.precioDicho != null ? `En la charla se dijo ${pesos(it.precioDicho)} · el sistema cobra ${pesos(it.precio ?? 0)}` : undefined,
                  importe: it.precio != null ? pesos((Number(it.cantidad) || 0) * it.precio) : undefined,
                  acciones: (
                    <div className="flex items-center gap-2">
                      <div className="w-24 shrink-0">
                        <Entrada
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={it.cantidad}
                          onChange={(e) => cambiar({ items: items.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x)) })}
                          aria-label={`Cantidad de ${it.match}`}
                          className="text-right"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => cambiar({ items: items.filter((_, j) => j !== i) })}
                        aria-label={`Sacar ${it.match}`}
                        className={unir('ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-marca-suave hover:text-marca-hondo', FOCO)}
                      >
                        <IconoCerrar className="size-5" />
                      </button>
                    </div>
                  ),
                }))}
                total={total != null ? { etiqueta: 'Total con precios del sistema', valor: pesos(total) } : undefined}
              />
            ) : (
              <Aviso tono="atencion">La IA no encontró un pedido en esta charla. Si lo hay, cargalo con «Pedido por WhatsApp».</Aviso>
            )}
            {armado.sinMatch.length > 0 && (
              <Aviso tono="atencion">No encontré en el catálogo: {armado.sinMatch.join(', ')}. Queda anotado en el pedido para que lo vean al prepararlo.</Aviso>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre">
                <Entrada value={armado.nombre ?? ''} onChange={(e) => cambiar({ nombre: e.target.value })} autoComplete="off" />
              </Campo>
              <Campo etiqueta="Entrega">
                <Selector
                  value={armado.tipo ?? 'retiro'}
                  onChange={(e) => cambiar({ tipo: e.target.value as 'retiro' | 'envio' })}
                  opciones={[{ valor: 'retiro', etiqueta: 'Retira en el local' }, { valor: 'envio', etiqueta: 'Envío a domicilio' }]}
                />
              </Campo>
              {armado.tipo === 'envio' && (
                <Campo etiqueta="Dirección de entrega" obligatorio error={faltaDireccion ? 'Falta la dirección' : undefined} className="sm:col-span-2">
                  <Entrada value={armado.direccion ?? ''} onChange={(e) => cambiar({ direccion: e.target.value })} autoComplete="off" />
                </Campo>
              )}
              <Campo etiqueta="Día">
                <Entrada type="date" value={armado.entregaFecha ?? ''} onChange={(e) => cambiar({ entregaFecha: e.target.value || null })} />
              </Campo>
              <Campo etiqueta="Horario">
                <Entrada value={armado.franja ?? ''} onChange={(e) => cambiar({ franja: e.target.value })} autoComplete="off" />
              </Campo>
              <Campo etiqueta="Cómo paga">
                <Selector value={armado.formaPago ?? ''} onChange={(e) => cambiar({ formaPago: e.target.value || null })} opciones={FORMAS} />
              </Campo>
              <Campo etiqueta="Lo recibe">
                <Entrada value={armado.recibe ?? ''} onChange={(e) => cambiar({ recibe: e.target.value })} autoComplete="off" />
              </Campo>
              <Campo etiqueta="Notas para quien lo prepara" className="sm:col-span-2">
                <AreaTexto rows={2} value={armado.notas ?? ''} onChange={(e) => cambiar({ notas: e.target.value })} />
              </Campo>
            </div>
            {error && <Aviso tono="error">{error}</Aviso>}
          </div>

          <section aria-label="La charla" className="min-w-0 rounded-2xl bg-crema-claro p-3 lg:sticky lg:top-0 lg:self-start">
            <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60">La charla · últimos {armado.charla.length} mensajes</h3>
            <ol className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {armado.charla.map((m, i) => (
                <li key={i} className={unir('max-w-[92%] rounded-xl px-3 py-2 text-sm break-words whitespace-pre-line', m.de === 'cliente' ? 'bg-white text-tinta' : 'ml-auto bg-tinta/[0.06] text-tinta/80')}>
                  <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-tinta/60">{QUIEN[m.de]}</span>
                  {m.texto}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}
