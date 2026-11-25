'use client';

// PRESUPUESTOS (25/11/2026). Leandro, por Juan Pablo: «llama alguien y dice tengo una fiesta en
// casa, me gustaría poner vinos, papas fritas, etc., y que los chicos puedan pasarle un
// presupuesto a raíz de lo que pida el cliente». Lo arma cualquiera del local:
//  1. el celular del cliente y lo que pide (buscando por nombre o código), con precio y stock;
//  2. «Mandar por WhatsApp»: le llega la tarjeta roja y el PDF; el precio vale 48 horas;
//  3. si acepta, «Pasar a pedido»: entra como pedido nuevo y suena en las cajas.
// Los precios los pone el servidor; acá se muestran.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, Boton, Campo, Chips, Entrada, Etiqueta, Modal, Selector, AreaTexto, Vacio, useConfirmar, unir, FOCO, type TonoEtiqueta } from './kit';
import { pesos } from '../lib/formato';

export type Sucursal = { id: string; nombre: string };
type Renglon = { productoId: string; sku: string | null; nombre: string; cantidad: number; precio: number; stock?: number };
export type PresupuestoFila = {
  id: string; numero: number; sucursalId: string; sucursal: string | null;
  clienteNombre: string | null; clienteTelefono: string; nota: string | null;
  items: Renglon[]; total: number; estado: 'borrador' | 'enviado' | 'aceptado' | 'anulado' | 'vencido';
  venceEn: string; creadoEn: string; creadoPor: string | null; enviadoEn: string | null; envioError: string | null;
  pedido: { id: string; codigo: string | null; estado: string | null } | null;
};
type Encontrado = { productoId: string; sku: string | null; nombre: string; precio: number | null; stock: number | null };
type Filtro = 'abiertos' | 'aceptados' | 'vencidos' | 'todos';

const ESTADO: Record<PresupuestoFila['estado'], { texto: string; tono: TonoEtiqueta }> = {
  borrador: { texto: 'Sin mandar', tono: 'atencion' },
  enviado: { texto: 'Mandado', tono: 'info' },
  aceptado: { texto: 'Pasó a pedido', tono: 'ok' },
  vencido: { texto: 'Vencido', tono: 'neutro' },
  anulado: { texto: 'Anulado', tono: 'neutro' },
};
const PAGOS = [['', 'No lo dijo'], ['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta'], ['mercadopago', 'Mercado Pago']] as const;
const ZONA = 'America/Argentina/Buenos_Aires';

const telefonoLegible = (t: string) => String(t ?? '').replace(/^549(\d{2})(\d{4})(\d{4})$/, '$1 $2-$3');
const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
const cant = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 3 }));
const totalDe = (rs: Renglon[]) => rs.reduce((s, r) => s + Math.round(r.cantidad * r.precio * 100), 0) / 100;

async function llamar(body: Record<string, unknown>) {
  const r = await fetch('/api/presupuestos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join(' ') : d?.message ?? 'No se pudo');
  return d;
}

export function PresupuestosWorkspace({ inicial, sucursales, miSucursal }: { inicial: PresupuestoFila[]; sucursales: Sucursal[]; miSucursal: string | null }) {
  const [lista, setLista] = useState(inicial);
  const [filtro, setFiltro] = useState<Filtro>('abiertos');
  const [abierto, setAbierto] = useState<PresupuestoFila | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (f: Filtro) => {
    try {
      const r = await fetch(`/api/presupuestos?recurso=lista&filtro=${f}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'No pude traer los presupuestos');
      setLista(d); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Sin conexión'); }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          etiquetaAccesible="Qué presupuestos ver"
          desplazable
          valor={filtro}
          onCambiar={(v) => { setFiltro(v as Filtro); void cargar(v as Filtro); }}
          opciones={[
            { valor: 'abiertos', etiqueta: 'Abiertos' },
            { valor: 'aceptados', etiqueta: 'Pasaron a pedido' },
            { valor: 'vencidos', etiqueta: 'Vencidos o anulados' },
            { valor: 'todos', etiqueta: 'Todos' },
          ]}
        />
        <Boton onClick={() => setAbierto('nuevo')} className="ml-auto">Nuevo presupuesto</Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      {lista.length ? (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setAbierto(p)} className={unir('flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-crema-claro', FOCO)}>
                <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-tinta/60">N.º {p.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-tinta">{p.clienteNombre || telefonoLegible(p.clienteTelefono)}</span>
                  <span className="block truncate text-xs text-tinta/60">
                    {p.items.length} {p.items.length === 1 ? 'producto' : 'productos'} · lo armó {p.creadoPor?.split(' ')[0] ?? '—'} · {cuando(p.creadoEn)}
                  </span>
                </span>
                <Etiqueta tono={ESTADO[p.estado].tono}>{p.estado === 'aceptado' && p.pedido?.codigo ? `Pedido ${p.pedido.codigo}` : ESTADO[p.estado].texto}</Etiqueta>
                <span className="importe w-28 shrink-0 text-right font-semibold text-tinta">{pesos(p.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Vacio
          titulo={filtro === 'abiertos' ? 'No hay presupuestos abiertos' : 'No hay presupuestos acá'}
          texto="Cuando llame alguien que quiere saber cuánto le sale lo que necesita, armale uno y mandáselo por WhatsApp."
          accion={<Boton onClick={() => setAbierto('nuevo')}>Nuevo presupuesto</Boton>}
        />
      )}

      {abierto && (
        <EditorPresupuesto
          key={abierto === 'nuevo' ? 'nuevo' : abierto.id}
          inicial={abierto === 'nuevo' ? null : abierto}
          sucursales={sucursales}
          miSucursal={miSucursal}
          onCerrar={() => setAbierto(null)}
          onCambio={() => void cargar(filtro)}
        />
      )}
    </div>
  );
}

/* ---------- armar, mandar y pasar a pedido ---------- */

function EditorPresupuesto({ inicial, sucursales, miSucursal, onCerrar, onCambio }: {
  inicial: PresupuestoFila | null; sucursales: Sucursal[]; miSucursal: string | null; onCerrar: () => void; onCambio: () => void;
}) {
  const [p, setP] = useState<PresupuestoFila | null>(inicial);
  const [nombre, setNombre] = useState(inicial?.clienteNombre ?? '');
  const [telefono, setTelefono] = useState(inicial ? telefonoLegible(inicial.clienteTelefono) : '');
  const [nota, setNota] = useState(inicial?.nota ?? '');
  const [sucursalId, setSucursalId] = useState(inicial?.sucursalId ?? miSucursal ?? sucursales[0]?.id ?? '');
  const [renglones, setRenglones] = useState<Renglon[]>(inicial?.items ?? []);
  const [cambiado, setCambiado] = useState(!inicial);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [aPedido, setAPedido] = useState(false);
  const { confirmar, dialogo } = useConfirmar();

  // trae el presupuesto con el stock de hoy
  useEffect(() => {
    if (!inicial) return;
    fetch(`/api/presupuestos?recurso=uno&id=${inicial.id}`, { cache: 'no-store' })
      .then(async (r) => { if (r.ok) { const d = await r.json(); setP(d); setRenglones(d.items ?? []); } })
      .catch(() => null);
  }, [inicial]);

  const cerrado = p?.estado === 'aceptado' || p?.estado === 'anulado';
  const total = totalDe(renglones);
  const tocar = (f: () => void) => { f(); setCambiado(true); setListo(null); };

  const agregar = (e: Encontrado) => tocar(() => setRenglones((rs) => {
    const ya = rs.find((r) => r.productoId === e.productoId);
    if (ya) return rs.map((r) => (r.productoId === e.productoId ? { ...r, cantidad: r.cantidad + 1 } : r));
    return [...rs, { productoId: e.productoId, sku: e.sku, nombre: e.nombre, cantidad: 1, precio: Number(e.precio), stock: e.stock ?? undefined }];
  }));

  const guardar = async (): Promise<PresupuestoFila | null> => {
    if (!cambiado && p) return p;
    setOcupado('guardar'); setError(null);
    try {
      const d = await llamar({ accion: 'guardar', id: p?.id, clienteNombre: nombre, clienteTelefono: telefono, nota, sucursalId, items: renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidad })) });
      setP(d); setRenglones(d.items ?? []); setCambiado(false); onCambio();
      return d;
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); return null; }
    finally { setOcupado(null); }
  };

  const mandar = async () => {
    const g = await guardar();
    if (!g) return;
    setOcupado('mandar'); setError(null);
    try {
      const d = await llamar({ accion: 'enviar', id: g.id });
      setP(d); setRenglones(d.items ?? []); onCambio();
      setListo(`Listo: le llegó a ${telefonoLegible(d.clienteTelefono)} por WhatsApp. Los precios valen hasta ${cuando(d.venceEn)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No salió'); }
    finally { setOcupado(null); }
  };

  const pdf = async () => {
    const g = await guardar();
    if (g) window.open(`/api/presupuestos?recurso=pdf&id=${g.id}`, '_blank');
  };

  const anular = async () => {
    if (!p || !(await confirmar({ titulo: `¿Anular el presupuesto N.º ${p.numero}?`, texto: 'Queda en la lista como anulado. Al cliente no le llega nada.', variante: 'peligro', textoConfirmar: 'Anular' }))) return;
    setOcupado('anular');
    try { const d = await llamar({ accion: 'anular', id: p.id }); setP(d); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo'); }
    finally { setOcupado(null); }
  };

  const titulo = p ? `Presupuesto N.º ${p.numero}` : 'Nuevo presupuesto';
  const descripcion = p
    ? `${ESTADO[p.estado].texto}${p.estado === 'enviado' || p.estado === 'borrador' ? ` · vale hasta ${cuando(p.venceEn)}` : ''}${p.creadoPor ? ` · lo armó ${p.creadoPor.split(' ')[0]}` : ''}`
    : 'Lo que pide el cliente, con precio y stock. El precio vale 48 horas.';

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={titulo}
      descripcion={descripcion}
      ancho="ancho"
      bloquearCierre={!!ocupado}
      cerrarAlTocarAfuera={false}
      pie={cerrado ? <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton> : <>
        {p && <Boton variante="fantasma" onClick={anular} disabled={!!ocupado} className="text-marca sm:mr-auto">Anular</Boton>}
        <Boton variante="secundario" onClick={pdf} disabled={!!ocupado || !renglones.length}>PDF</Boton>
        {p && !cambiado && <Boton variante="secundario" onClick={() => setAPedido(true)} disabled={!!ocupado}>Pasar a pedido</Boton>}
        {cambiado && <Boton variante="secundario" onClick={() => void guardar()} cargando={ocupado === 'guardar'} disabled={!!ocupado || !renglones.length}>Guardar</Boton>}
        <Boton onClick={mandar} cargando={ocupado === 'mandar'} disabled={!!ocupado || !renglones.length || !telefono.trim()}>
          {p?.estado === 'enviado' && !cambiado ? 'Mandar de nuevo' : 'Mandar por WhatsApp'}
        </Boton>
      </>}
    >
      {dialogo}
      <div className="space-y-4">
        {error && <Aviso tono="error">{error}</Aviso>}
        {listo && <Aviso tono="ok">{listo}</Aviso>}
        {p?.envioError && !listo && <Aviso tono="atencion">La última vez el WhatsApp no salió: {p.envioError}</Aviso>}
        {p?.estado === 'vencido' && <Aviso tono="atencion">Pasaron las 48 horas. Si lo mandás de nuevo, sale con los precios de hoy y vale 48 horas más.</Aviso>}
        {p?.estado === 'aceptado' && <Aviso tono="ok">Pasó a pedido{p.pedido?.codigo ? ` ${p.pedido.codigo}` : ''}: está en Pedidos.</Aviso>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Celular del cliente" obligatorio>
            <Entrada inputMode="tel" autoComplete="off" value={telefono} onChange={(e) => tocar(() => setTelefono(e.target.value))} disabled={cerrado} />
          </Campo>
          <Campo etiqueta="Nombre">
            <Entrada value={nombre} onChange={(e) => tocar(() => setNombre(e.target.value))} disabled={cerrado} />
          </Campo>
          {sucursales.length > 1 && (
            <Campo etiqueta="Sale de">
              <Selector value={sucursalId} onChange={(e) => tocar(() => setSucursalId(e.target.value))} disabled={cerrado}
                opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre.replace(/^Suc\s+/, '') }))} />
            </Campo>
          )}
          <Campo etiqueta="Nota (va en el PDF)" className={sucursales.length > 1 ? '' : 'sm:col-span-2'}>
            <Entrada value={nota} onChange={(e) => tocar(() => setNota(e.target.value))} maxLength={500} disabled={cerrado} />
          </Campo>
        </div>

        {!cerrado && <Buscador sucursalId={sucursalId} onElegir={agregar} />}

        {renglones.length ? (
          <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
            <ul className="divide-y divide-black/[0.06]">
              {renglones.map((r) => {
                const falta = r.stock != null && r.stock < r.cantidad;
                return (
                  <li key={r.productoId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="break-words text-sm font-semibold text-tinta">{r.nombre}</p>
                      <p className="text-xs text-tinta/60">
                        {pesos(r.precio)} c/u{r.sku ? ` · ${r.sku}` : ''}
                        {falta && <span className="font-semibold text-marca"> · hay {cant(Math.max(0, r.stock!))} en el local</span>}
                      </p>
                    </div>
                    <Entrada
                      aria-label={`Cantidad de ${r.nombre}`} type="number" inputMode="decimal" min={0} step="any" className="importe w-20 text-right"
                      value={String(r.cantidad)} disabled={cerrado}
                      onChange={(e) => { const v = Number(e.target.value); tocar(() => setRenglones((rs) => rs.map((x) => (x.productoId === r.productoId ? { ...x, cantidad: Number.isFinite(v) ? v : 0 } : x)))); }}
                    />
                    <span className="importe w-28 text-right text-sm font-semibold text-tinta">{pesos(Math.round(r.cantidad * r.precio * 100) / 100)}</span>
                    {!cerrado && (
                      <button type="button" aria-label={`Sacar ${r.nombre}`} onClick={() => tocar(() => setRenglones((rs) => rs.filter((x) => x.productoId !== r.productoId)))}
                        className={unir('grid size-9 place-items-center rounded-full text-tinta/50 hover:bg-marca-suave hover:text-marca', FOCO)}>×</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between bg-tinta px-4 py-3 text-white">
              <span className="text-xs font-bold uppercase tracking-wide">Total</span>
              <span className="importe text-xl font-bold">{pesos(total)}</span>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-tinta/60">Buscá arriba lo que pide el cliente: cada producto que tocás se suma acá.</p>
        )}
        {renglones.some((r) => !(r.cantidad > 0)) && <Aviso tono="atencion">Hay una cantidad en cero: poné cuántos o sacá el producto.</Aviso>}
      </div>

      {aPedido && p && <PasarAPedido p={p} onCerrar={() => setAPedido(false)} onListo={(d) => { setP(d); setAPedido(false); onCambio(); setListo(`Entró como pedido ${d.pedidoCodigo ?? ''}: suena en las cajas como cualquier pedido nuevo.`); }} />}
    </Modal>
  );
}

/* ---------- el buscador: lo más parecido primero, con precio y stock ---------- */

function Buscador({ sucursalId, onElegir }: { sucursalId: string; onElegir: (e: Encontrado) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Encontrado[] | null>(null);
  const turno = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) return;
    const mio = ++turno.current;
    const t = setTimeout(() => {
      fetch(`/api/presupuestos?recurso=productos&q=${encodeURIComponent(texto)}&sucursalId=${encodeURIComponent(sucursalId)}`, { cache: 'no-store' })
        .then(async (r) => { const d = await r.json(); if (mio === turno.current) setRes(r.ok && Array.isArray(d) ? d : []); })
        .catch(() => mio === turno.current && setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sucursalId]);

  // con menos de dos letras no se muestra nada (sin tocar el estado desde el efecto)
  const mostrar = q.trim().length >= 2 ? res : null;
  const visibles = useMemo(() => (mostrar ?? []).slice(0, 12), [mostrar]);
  return (
    <div className="space-y-2">
      <Campo etiqueta="Agregar producto">
        <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código" autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'Enter' && visibles[0]?.precio != null) { e.preventDefault(); onElegir(visibles[0]); setQ(''); } }} />
      </Campo>
      {mostrar !== null && (
        visibles.length ? (
          <ul className="max-h-72 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.08] bg-white">
            {visibles.map((e) => (
              <li key={e.productoId}>
                <button type="button" disabled={e.precio == null} onClick={() => { onElegir(e); setQ(''); }}
                  className={unir('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-crema-claro disabled:cursor-not-allowed disabled:opacity-50', FOCO)}>
                  <span className="min-w-0 flex-1 break-words text-tinta">{e.nombre}{e.sku ? <span className="text-tinta/50"> · {e.sku}</span> : null}</span>
                  {e.stock != null && <span className={unir('shrink-0 text-xs', e.stock > 0 ? 'text-tinta/60' : 'font-semibold text-marca')}>{e.stock > 0 ? `hay ${cant(e.stock)}` : 'sin stock'}</span>}
                  <span className="importe w-24 shrink-0 text-right font-semibold text-tinta">{e.precio != null ? pesos(e.precio) : 'sin precio'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-tinta/60">No encontré «{q.trim()}».</p>
      )}
    </div>
  );
}

/* ---------- pasar a pedido: cómo lo recibe y cómo paga ---------- */

function PasarAPedido({ p, onCerrar, onListo }: { p: PresupuestoFila; onCerrar: () => void; onListo: (d: PresupuestoFila & { pedidoCodigo?: string }) => void }) {
  const [tipo, setTipo] = useState<'retiro' | 'envio'>('retiro');
  const [direccion, setDireccion] = useState('');
  const [formaPago, setFormaPago] = useState('');
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    setOcupado(true); setError(null);
    try { onListo(await llamar({ accion: 'pedido', id: p.id, tipo, direccion, formaPago: formaPago || null, notas })); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo'); }
    finally { setOcupado(false); }
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Pasar a pedido el N.º ${p.numero}`}
      descripcion={`${p.clienteNombre || telefonoLegible(p.clienteTelefono)} · ${pesos(p.total)}`}
      bloquearCierre={ocupado}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar} disabled={ocupado}>Volver</Boton>
        <Boton onClick={confirmar} cargando={ocupado} disabled={ocupado || (tipo === 'envio' && !direccion.trim())}>Pasar a pedido</Boton>
      </>}
    >
      <div className="space-y-3">
        {error && <Aviso tono="error">{error}</Aviso>}
        <Chips etiquetaAccesible="Cómo lo recibe" valor={tipo} onCambiar={(v) => setTipo(v as 'retiro' | 'envio')}
          opciones={[{ valor: 'retiro', etiqueta: 'Lo retira en el local' }, { valor: 'envio', etiqueta: 'Envío a domicilio' }]} />
        {tipo === 'envio' && (
          <Campo etiqueta="Dirección de entrega" obligatorio>
            <Entrada value={direccion} onChange={(e) => setDireccion(e.target.value)} autoComplete="off" />
          </Campo>
        )}
        <Campo etiqueta="Cómo paga">
          <Selector value={formaPago} onChange={(e) => setFormaPago(e.target.value)} opciones={PAGOS.map(([valor, etiqueta]) => ({ valor, etiqueta }))} />
        </Campo>
        <Campo etiqueta="Algo más para quien lo arma">
          <AreaTexto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} />
        </Campo>
        <p className="text-xs text-tinta/60">Entra como pedido nuevo, sin tomar, con el stock reservado: suena en las cajas como cualquier otro. Si algún precio cambió desde el presupuesto, queda escrito en las notas del pedido.</p>
      </div>
    </Modal>
  );
}
