'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, BotonLink, Cargando, Entrada, Etiqueta, Modal, Pestanas, Selector, Tarjeta, Vacio, unir } from './kit';
import type { TonoEtiqueta } from './kit';
import { fecha, fechaHora, hoyISO, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// Mercadería por llegar (23/10/2026). Pedido de Leandro: «que haya un módulo de
// cuándo vamos a estar recibiendo esa mercadería». Cuando se aprueba la nota de
// pedido, el pedido sale por WhatsApp y le pregunta al proveedor para qué día;
// lo que contesta lo lee el bot y la fecha aparece acá. Si no contesta o no se
// le entiende, también aparece acá, para que una persona la anote a mano.
//
// La segunda pestaña es la otra mitad: sin el WhatsApp del proveedor cargado
// el pedido no puede salir solo.

type Orden = {
  id: string; folio: string; estado: string; proveedor: string; proveedorId: string | null; telefono: string | null;
  sucursal: string; total: number; productos: number; unidades: number; enviadaEn: string | null;
  whatsappEstado: string | null; entregaEstado: 'esperando' | 'confirmada' | 'sin_respuesta' | 'a_revisar' | null;
  fecha: string | null; fechaPedida: string | null; horario: string | null; respuesta: string | null; faltantes: string | null;
};
type Proveedor = { id: string; nombre: string; telefono: string | null; productos: number; pedidos: number };

const ESTADO_ENTREGA: Record<string, { texto: string; tono: TonoEtiqueta }> = {
  confirmada: { texto: 'Fecha confirmada', tono: 'ok' },
  esperando: { texto: 'Esperando respuesta', tono: 'info' },
  sin_respuesta: { texto: 'No contestó', tono: 'atencion' },
  a_revisar: { texto: 'Contestó: revisar', tono: 'atencion' },
};

function sumarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// en qué grupo cae cada orden: lo atrasado y lo de hoy arriba
function grupoDe(o: Orden, hoy: string): string {
  if (!o.fecha) return 'sin';
  if (o.fecha < hoy) return 'atrasado';
  if (o.fecha === hoy) return 'hoy';
  if (o.fecha === sumarDias(hoy, 1)) return 'manana';
  if (o.fecha <= sumarDias(hoy, 7)) return 'semana';
  return 'despues';
}
const GRUPOS: { clave: string; titulo: string; sub?: string }[] = [
  { clave: 'atrasado', titulo: 'Atrasado', sub: 'La fecha que dio el proveedor ya pasó y todavía no se recibió' },
  { clave: 'hoy', titulo: 'Llega hoy' },
  { clave: 'manana', titulo: 'Llega mañana' },
  { clave: 'semana', titulo: 'En los próximos 7 días' },
  { clave: 'despues', titulo: 'Más adelante' },
  { clave: 'sin', titulo: 'Sin fecha confirmada', sub: 'El proveedor todavía no dijo cuándo entrega' },
];

export function PorLlegar({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [vista, setVista] = useState<'llegar' | 'whatsapp'>('llegar');
  const [sucursalId, setSucursalId] = useState('');
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fijando, setFijando] = useState<Orden | null>(null);

  const cargarOrdenes = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/por-llegar?recurso=ordenes${sucursalId ? `&sucursalId=${encodeURIComponent(sucursalId)}` : ''}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer los pedidos');
      setOrdenes(j);
    } catch (e: any) { setError(e.message); setOrdenes([]); }
  }, [sucursalId]);

  const cargarProveedores = useCallback(async () => {
    try {
      const r = await fetch('/api/por-llegar?recurso=proveedores');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer los proveedores');
      setProveedores(j);
    } catch (e: any) { setError(e.message); setProveedores([]); }
  }, []);

  useEffect(() => { cargarOrdenes(); }, [cargarOrdenes]);
  useEffect(() => { cargarProveedores(); }, [cargarProveedores]);

  const hoy = hoyISO();
  const grupos = useMemo(() => {
    const m = new Map<string, Orden[]>();
    for (const o of ordenes ?? []) {
      const g = grupoDe(o, hoy);
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    return m;
  }, [ordenes, hoy]);
  const sinTelefono = (proveedores ?? []).filter((p) => !p.telefono).length;
  const aRevisar = (ordenes ?? []).filter((o) => o.entregaEstado === 'a_revisar' || o.entregaEstado === 'sin_respuesta').length;

  return (
    <div className="space-y-4">
      <Pestanas
        valor={vista}
        onCambiar={setVista}
        opciones={[
          { valor: 'llegar', etiqueta: 'Por llegar', cuenta: ordenes?.length },
          { valor: 'whatsapp', etiqueta: 'WhatsApp de proveedores', cuenta: sinTelefono || undefined },
        ]}
      />
      {error && <Aviso tono="error">{error}</Aviso>}

      {vista === 'llegar' && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {sucursales.length > 1 && (
              <label className="min-w-0 flex-1 text-sm sm:max-w-xs">
                <span className="mb-1 block text-tinta/70">Sucursal</span>
                <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
                  opciones={[{ valor: '', etiqueta: 'Todas' }, ...sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre.replace(/^Suc\s+/, '') }))]} />
              </label>
            )}
            <Boton variante="secundario" tamano="chico" onClick={cargarOrdenes}>Actualizar</Boton>
          </div>
          {aRevisar > 0 && (
            <Aviso tono="atencion" titulo={`${aRevisar} pedido${aRevisar === 1 ? '' : 's'} sin fecha clara`}>
              El proveedor no contestó o no se entendió la fecha. Llamalo o escribile y anotala con «Anotar fecha».
            </Aviso>
          )}
          {ordenes == null ? <Cargando /> : ordenes.length === 0 ? (
            <Vacio titulo="No hay mercadería en camino" texto="Cuando se aprueba un pedido a proveedor aparece acá, con la fecha que confirme." />
          ) : GRUPOS.filter((g) => grupos.get(g.clave)?.length).map((g) => (
            <section key={g.clave} className="space-y-2">
              <div>
                <h2 className={unir('text-sm font-semibold uppercase tracking-wide', g.clave === 'atrasado' ? 'text-marca-hondo' : 'text-tinta/70')}>
                  {g.titulo} · {grupos.get(g.clave)!.length}
                </h2>
                {g.sub && <p className="text-xs text-tinta/60">{g.sub}</p>}
              </div>
              {grupos.get(g.clave)!.map((o) => <TarjetaOrden key={o.id} o={o} atrasado={g.clave === 'atrasado'} onFijar={() => setFijando(o)} />)}
            </section>
          ))}
        </>
      )}

      {vista === 'whatsapp' && <WhatsappProveedores proveedores={proveedores} onCambio={cargarProveedores} />}

      {fijando && <FijarFecha orden={fijando} onCerrar={() => setFijando(null)} onListo={() => { setFijando(null); cargarOrdenes(); }} />}
    </div>
  );
}

function TarjetaOrden({ o, atrasado, onFijar }: { o: Orden; atrasado: boolean; onFijar: () => void }) {
  const est = o.entregaEstado ? ESTADO_ENTREGA[o.entregaEstado] : null;
  return (
    <Tarjeta className={unir(atrasado && 'border border-marca/40')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-tinta">{o.proveedor}</p>
          <p className="text-xs text-tinta/60">{o.folio} · {o.sucursal} · {o.productos} producto{o.productos === 1 ? '' : 's'} · {o.unidades} u. · {pesos(o.total)}</p>
        </div>
        {est ? <Etiqueta tono={est.tono}>{est.texto}</Etiqueta>
          : <Etiqueta tono="neutro">{o.estado === 'aprobada' ? 'Aprobado, sin enviar' : 'Enviado'}</Etiqueta>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {o.fecha ? (
          <p className={unir('font-semibold', atrasado ? 'text-marca-hondo' : 'text-tinta')}>
            Entrega: {fecha(o.fecha, 'dia')}{o.horario ? ` · ${o.horario}` : ''}
          </p>
        ) : <p className="text-tinta/70">Sin fecha de entrega</p>}
        {o.enviadaEn && <p className="text-xs text-tinta/60">Pedido enviado {fechaHora(o.enviadaEn)}</p>}
      </div>
      {o.faltantes && <p className="mt-2 text-sm text-marca-hondo">Avisó que falta: {o.faltantes}</p>}
      {o.respuesta && <p className="mt-2 break-words rounded-xl bg-crema-claro px-3 py-2 text-sm text-tinta/70">«{o.respuesta}»</p>}
      {!o.telefono && <p className="mt-2 text-xs text-marca-hondo">El proveedor no tiene WhatsApp cargado: el pedido no sale solo.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <BotonLink href="/recepcion" tamano="chico">Recibir</BotonLink>
        <Boton variante="secundario" tamano="chico" onClick={onFijar}>{o.fecha ? 'Cambiar fecha' : 'Anotar fecha'}</Boton>
      </div>
    </Tarjeta>
  );
}

function FijarFecha({ orden, onCerrar, onListo }: { orden: Orden; onCerrar: () => void; onListo: () => void }) {
  const [dia, setDia] = useState(orden.fecha ?? '');
  const [horario, setHorario] = useState(orden.horario ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!dia) { setError('Elegí el día'); return; }
    setGuardando(true); setError(null);
    try {
      const r = await fetch('/api/por-llegar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'entrega', id: orden.id, fecha: dia, horario: horario.trim() || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude guardar la fecha');
      onListo();
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Fecha de entrega · ${orden.proveedor}`} ancho="chico"
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-tinta/70">{orden.folio}. Para cuando el proveedor avisó por teléfono o la respuesta no se entendió.</p>
        <label className="block text-sm">
          <span className="mb-1 block text-tinta/70">Día</span>
          <Entrada type="date" value={dia} min={hoyISO()} onChange={(e) => setDia(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-tinta/70">Horario (opcional)</span>
          <Entrada value={horario} maxLength={80} placeholder="a la mañana, de 9 a 13…" onChange={(e) => setHorario(e.target.value)} />
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

function WhatsappProveedores({ proveedores, onCambio }: { proveedores: Proveedor[] | null; onCambio: () => void }) {
  const [busca, setBusca] = useState('');
  const [soloSin, setSoloSin] = useState(true);
  if (proveedores == null) return <Cargando />;
  const sin = proveedores.filter((p) => !p.telefono).length;
  const lista = filtrarPorBusqueda(proveedores.filter((p) => !soloSin || !p.telefono), busca, (p) => p.nombre);
  return (
    <div className="space-y-3">
      <Aviso tono={sin ? 'atencion' : 'ok'}>
        {sin
          ? `${sin} de ${proveedores.length} proveedores no tienen WhatsApp cargado. Sin el número, el pedido aprobado no le llega solo ni se le puede preguntar la fecha.`
          : 'Todos los proveedores con productos tienen WhatsApp cargado.'}
        {' '}Al guardar, el sistema revisa que el número tenga WhatsApp.
      </Aviso>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar proveedor" aria-label="Buscar proveedor" /></div>
        <label className="flex items-center gap-2 text-sm text-tinta/70">
          <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} className="size-4 accent-marca" />
          Solo los que faltan
        </label>
      </div>
      {lista.length === 0 ? <Vacio titulo="Nada para mostrar" texto={busca ? 'Ningún proveedor coincide con la búsqueda.' : 'No falta ningún número.'} /> : (
        <div className="space-y-2">
          {lista.slice(0, 150).map((p) => <FilaProveedor key={p.id} p={p} onCambio={onCambio} />)}
          {lista.length > 150 && <p className="text-xs text-tinta/60">Se muestran 150 de {lista.length}: buscá para encontrar el resto.</p>}
        </div>
      )}
    </div>
  );
}

function FilaProveedor({ p, onCambio }: { p: Proveedor; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [numero, setNumero] = useState(p.telefono ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      const r = await fetch('/api/por-llegar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'whatsapp', id: p.id, telefono: numero }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude guardar el número');
      setEditando(false);
      onCambio();
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  return (
    <Tarjeta>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-tinta">{p.nombre}</p>
          <p className="text-xs text-tinta/60">
            {p.productos} producto{p.productos === 1 ? '' : 's'}{p.pedidos ? ` · ${p.pedidos} pedido${p.pedidos === 1 ? '' : 's'} en el año` : ''}
            {p.telefono ? ` · WhatsApp ${p.telefono}` : ''}
          </p>
        </div>
        {!editando && (
          <Boton variante={p.telefono ? 'fantasma' : 'secundario'} tamano="chico" onClick={() => setEditando(true)}>
            {p.telefono ? 'Cambiar' : 'Cargar WhatsApp'}
          </Boton>
        )}
      </div>
      {editando && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <Entrada type="tel" inputMode="tel" autoFocus value={numero} placeholder="11 2345-6789" aria-label={`WhatsApp de ${p.nombre}`}
              onChange={(e) => setNumero(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }} />
          </div>
          <Boton tamano="chico" onClick={guardar} disabled={guardando || !numero.trim()}>{guardando ? 'Revisando…' : 'Guardar'}</Boton>
          <Boton variante="secundario" tamano="chico" onClick={() => { setEditando(false); setError(null); setNumero(p.telefono ?? ''); }}>Cancelar</Boton>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-marca-hondo">{error}</p>}
    </Tarjeta>
  );
}
