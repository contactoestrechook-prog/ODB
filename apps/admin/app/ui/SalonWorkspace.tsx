'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Campo, Entrada, Etiqueta, Pestanas, Selector, Tarjeta, Vacio, unir, useConfirmar } from './kit';
import { numero } from '../lib/formato';
import { ArmadoPantalla } from './ArmadoPantalla';

// OP SALÓN (Leandro, 5/11/2026). El que está en el salón con el celular:
//  · Armar: los pedidos que le asignó la caja (con la comanda en la mano). Va
//    sumando al carro —escaneando o tocando— y cada carga queda con la hora:
//    así se mide cuánto tarda en arrancar, en armar y el ritmo por producto.
//  · Stock: cuánto hay y DÓNDE está cada producto en cada sucursal.
//  · Puerta de depósito: lo que baja con remito se carga acá y espera la factura;
//    no suma al stock hasta que administración lo confirma.

type Item = { productoId: string; sku: string | null; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null };
type Carga = { id: number; productoId: string; cantidad: number; creadoEn: string };
type PedidoArmar = {
  id: string; estado: string; canal: string; origen: string; codigo: string; cliente: string | null; notas: string | null;
  sucursal: string | null; asignadoNombre: string | null; asignadoEn: string; primeraCarga: string | null; cargas: Carga[]; items: Item[];
};
type ProductoStock = { id: string; sku: string; nombre: string; sucursales: { sucursalId: string; sucursal: string; cantidad: number; ubicacion: string | null }[] };
type Vista = 'armar' | 'stock' | 'puerta';

async function api<T = any>(metodo: 'GET' | 'POST', params: Record<string, unknown>): Promise<T> {
  const r = metodo === 'GET'
    ? await fetch(`/api/salon?${new URLSearchParams(params as Record<string, string>)}`, { cache: 'no-store' })
    : await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join(' · ') : d?.message ?? 'No pude hablar con el sistema');
  return d as T;
}

/** mm:ss (o h:mm:ss) desde una hora */
function reloj(desde: string, ahora: number) {
  const s = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function useAhora(cada = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), cada); return () => clearInterval(t); }, [cada]);
  return ahora;
}

export function SalonWorkspace({ proveedores, sucursales, sucursalPropia, verTodos }: {
  proveedores: { id: string; nombre: string }[];
  sucursales: { id: string; nombre: string }[];
  sucursalPropia: string | null;
  /** dueño, gerente, depósito, caja: ven los pedidos de todos */
  verTodos: boolean;
}) {
  const [vista, setVista] = useState<Vista>('armar');
  const [pendientes, setPendientes] = useState<number | undefined>(undefined);
  return (
    <div className="space-y-4">
      <Pestanas<Vista>
        etiquetaAccesible="Secciones del salón"
        valor={vista}
        onCambiar={setVista}
        aLoAncho
        opciones={[
          { valor: 'armar', etiqueta: 'Armar pedidos', cuenta: pendientes },
          { valor: 'stock', etiqueta: 'Stock y ubicación' },
          { valor: 'puerta', etiqueta: 'Puerta de depósito' },
        ]}
      />
      {vista === 'armar' && <Armar verTodos={verTodos} onCuenta={setPendientes} />}
      {vista === 'stock' && <Stock sucursalPropia={sucursalPropia} />}
      {vista === 'puerta' && <PuertaDeposito proveedores={proveedores} sucursales={sucursales} sucursalPropia={sucursalPropia} />}
    </div>
  );
}

// ───────────────────────── Armar ─────────────────────────

function Armar({ verTodos, onCuenta }: { verTodos: boolean; onCuenta: (n: number) => void }) {
  const [pedidos, setPedidos] = useState<PedidoArmar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  // los que cerró a mano no se le vuelven a abrir solos
  const cerrados = useRef(new Set<string>());
  const [finalizado, setFinalizado] = useState<string | null>(null);
  const ahora = useAhora();

  const cargar = useCallback(async () => {
    try {
      const d = await api<PedidoArmar[]>('GET', { recurso: 'pedidos', ...(verTodos ? { todos: '1' } : {}) });
      setPedidos(d);
      onCuenta(d.length);
      // el op salón: apenas le asignan un pedido, se le abre a pantalla completa
      if (!verTodos) {
        setAbierto((ya) => {
          if (ya && d.some((p) => p.id === ya)) return ya;
          const nuevo = d.find((p) => !cerrados.current.has(p.id));
          if (nuevo) { try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ } }
          return nuevo?.id ?? null;
        });
      }
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [verTodos, onCuenta]);

  useEffect(() => { cargar(); const t = setInterval(cargar, 8000); return () => clearInterval(t); }, [cargar]);

  const actual = pedidos?.find((p) => p.id === abierto) ?? null;
  return (
    <div className="space-y-3">
      {actual && (
        <ArmadoPantalla
          p={actual}
          ahora={ahora}
          onVolver={() => { cerrados.current.add(actual.id); setAbierto(null); }}
          onTerminado={(texto) => { cerrados.current.add(actual.id); setAbierto(null); setFinalizado(texto); }}
          onCambio={cargar}
          enviar={(cuerpo) => api('POST', cuerpo)}
        />
      )}
      {finalizado && <Aviso tono="ok" titulo="¡Listo!">{finalizado}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      {pedidos === null && !error && <p className="text-sm text-tinta/60">Buscando tus pedidos…</p>}
      {pedidos?.length === 0 && (
        <Vacio titulo="No tenés pedidos para armar" texto="Cuando la caja te asigne uno, aparece acá solo." />
      )}
      {pedidos?.map((p) => {
        const total = p.items.length;
        const listos = p.items.filter((i) => i.enCarro >= i.cantidad).length;
        return (
          <button key={p.id} type="button" onClick={() => { cerrados.current.delete(p.id); setAbierto(p.id); }} className="block w-full text-left">
            <Tarjeta className="transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-none text-tinta">{p.codigo}</p>
                  <p className="mt-1 truncate text-sm text-tinta/70">{p.cliente ?? 'Cliente sin nombre'}{verTodos && p.asignadoNombre ? ` · arma ${p.asignadoNombre}` : ''}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="importe text-2xl font-bold text-marca">{reloj(p.asignadoEn, ahora)}</p>
                  <p className="text-xs text-tinta/60">{p.primeraCarga ? 'armando' : 'sin arrancar'}</p>
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-crema">
                <div className="h-2 rounded-full bg-ok transition-all" style={{ width: `${total ? (listos / total) * 100 : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-tinta/60">{listos} de {total} productos en el carro</p>
            </Tarjeta>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── Stock y ubicación ─────────────────────────

function Stock({ sucursalPropia }: { sucursalPropia: string | null }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ProductoStock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar(texto = q) {
    if (texto.trim().length < 2) return;
    setBuscando(true);
    try { setRes(await api<ProductoStock[]>('GET', { recurso: 'stock', q: texto.trim() })); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setBuscando(false); }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="flex gap-2">
        <Entrada autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Producto" placeholder="Nombre, código o escaneá" className="flex-1" />
        <Boton type="submit" cargando={buscando} disabled={q.trim().length < 2}>Buscar</Boton>
      </form>
      {error && <Aviso tono="error">{error}</Aviso>}
      {res?.length === 0 && <Vacio titulo="No encontré ese producto" texto="Probá con otra palabra o escaneá el código." />}
      {res?.map((p) => (
        <Tarjeta key={p.id} className="!p-3">
          <p className="font-medium text-tinta">{p.nombre}</p>
          <p className="text-xs text-tinta/50">{p.sku}</p>
          <ul className="mt-2 divide-y divide-black/5">
            {(p.sucursales.length ? p.sucursales : []).sort((a, b) => Number(b.sucursalId === sucursalPropia) - Number(a.sucursalId === sucursalPropia)).map((s) => (
              <UbicacionSucursal key={s.sucursalId} productoId={p.id} s={s} />
            ))}
            {!p.sucursales.length && <li className="py-2 text-sm text-tinta/60">Sin stock cargado en ninguna sucursal</li>}
          </ul>
        </Tarjeta>
      ))}
    </div>
  );
}

function UbicacionSucursal({ productoId, s }: { productoId: string; s: ProductoStock['sucursales'][number] }) {
  const [valor, setValor] = useState(s.ubicacion ?? '');
  const [guardado, setGuardado] = useState(s.ubicacion ?? '');
  const [estado, setEstado] = useState<'quieto' | 'guardando' | 'ok' | 'error'>('quieto');
  async function guardar() {
    setEstado('guardando');
    try { await api('POST', { accion: 'ubicacion', productoId, sucursalId: s.sucursalId, ubicacion: valor }); setGuardado(valor.trim()); setEstado('ok'); }
    catch { setEstado('error'); }
  }
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-tinta/70">{s.sucursal}</span>
        <span className={unir('importe text-lg font-bold', s.cantidad > 0 ? 'text-tinta' : 'text-marca')}>{numero(s.cantidad, 2)}</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="mt-1 flex gap-2">
        <Entrada value={valor} onChange={(e) => { setValor(e.target.value); setEstado('quieto'); }} aria-label={`Lugar en ${s.sucursal}`} placeholder="Dónde está" maxLength={80} className="flex-1" />
        <Boton type="submit" tamano="chico" variante="secundario" disabled={valor.trim() === guardado} cargando={estado === 'guardando'}>Guardar</Boton>
      </form>
      {estado === 'ok' && <p className="mt-1 text-xs text-ok">Lugar guardado</p>}
      {estado === 'error' && <p className="mt-1 text-xs text-marca">No se pudo guardar</p>}
    </li>
  );
}

// ───────────────────────── Puerta de depósito ─────────────────────────

type Renglon = { sku: string; nombre: string; cantidad: number; vencimiento: string };

function PuertaDeposito({ proveedores, sucursales, sucursalPropia }: { proveedores: { id: string; nombre: string }[]; sucursales: { id: string; nombre: string }[]; sucursalPropia: string | null }) {
  const [proveedorId, setProveedorId] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursalPropia ?? (sucursales.length === 1 ? sucursales[0].id : ''));
  const [remito, setRemito] = useState('');
  const [notas, setNotas] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<ProductoStock[]>([]);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [esperan, setEsperan] = useState<any[] | null>(null);

  const cargarEsperan = useCallback(async () => {
    try { setEsperan(await api<any[]>('GET', { recurso: 'ingresos', estado: 'todos' })); } catch { setEsperan([]); }
  }, []);
  useEffect(() => { cargarEsperan(); }, [cargarEsperan]);

  function agregar(sku: string, nombre: string) {
    setRenglones((xs) => {
      const i = xs.findIndex((x) => x.sku === sku);
      if (i >= 0) return xs.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + 1 } : x));
      return [{ sku, nombre, cantidad: 1, vencimiento: '' }, ...xs];
    });
    setBusca('');
    setSug([]);
  }

  async function buscar() {
    const t = busca.trim();
    if (t.length < 2) return;
    try {
      const c = await api('GET', { recurso: 'codigo', codigo: t });
      if (c?.encontrado) { agregar(c.sku, c.nombre); setAviso(null); return; }
      const r = await api<ProductoStock[]>('GET', { recurso: 'stock', q: t });
      if (r.length === 1) agregar(r[0].sku, r[0].nombre);
      else { setSug(r.slice(0, 8)); if (!r.length) setAviso({ tono: 'error', texto: 'Ese producto no está en el sistema: avisale a administración' }); }
    } catch (e: any) { setAviso({ tono: 'error', texto: e.message }); }
  }

  async function enviar() {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await api('POST', {
        accion: 'ingreso', proveedorId, sucursalId, numeroRemito: remito, notas,
        items: renglones.map((x) => ({ sku: x.sku, cantidad: x.cantidad, vencimiento: x.vencimiento || undefined })),
      });
      setAviso({ tono: 'ok', texto: `Ingreso #${r.numero} cargado. Espera la factura: cuando administración lo confirme, suma al stock.` });
      setRenglones([]); setRemito(''); setNotas('');
      cargarEsperan();
    } catch (e: any) { setAviso({ tono: 'error', texto: e.message }); }
    finally { setEnviando(false); }
  }

  const listo = proveedorId && sucursalId && remito.trim() && renglones.length && renglones.every((r) => r.cantidad > 0);

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Proveedor" obligatorio>
            <Selector value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} vacio="Elegí el proveedor" opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.nombre }))} />
          </Campo>
          <Campo etiqueta="N.º de remito" obligatorio>
            <Entrada value={remito} onChange={(e) => setRemito(e.target.value)} />
          </Campo>
          {sucursales.length > 1 && (
            <Campo etiqueta="Sucursal" obligatorio>
              <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} vacio="Elegí la sucursal" opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} />
            </Campo>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="flex gap-2">
          <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Producto que bajó" placeholder="Escaneá o buscá lo que bajó" className="flex-1" />
          <Boton type="submit" variante="secundario" disabled={busca.trim().length < 2}>Sumar</Boton>
        </form>
        {sug.length > 0 && (
          <ul className="divide-y divide-black/5 rounded-lg border border-black/10 bg-white">
            {sug.map((s) => (
              <li key={s.id}><button type="button" onClick={() => agregar(s.sku, s.nombre)} className="w-full px-3 py-2 text-left text-sm hover:bg-crema-claro">{s.nombre} <span className="text-tinta/50">· {s.sku}</span></button></li>
            ))}
          </ul>
        )}

        {renglones.length > 0 && (
          <ul className="divide-y divide-black/5">
            {renglones.map((r, j) => (
              <li key={r.sku} className="space-y-1.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium text-tinta">{r.nombre}</span>
                  <Boton tamano="chico" variante="fantasma" onClick={() => setRenglones((xs) => xs.filter((_, k) => k !== j))}>Quitar</Boton>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <div>
                    <span className="mb-1 block text-xs text-tinta/60">Cantidad</span>
                    <Entrada type="number" inputMode="decimal" min={0} step="any" value={String(r.cantidad)} aria-label={`Cantidad de ${r.nombre}`}
                      onChange={(e) => setRenglones((xs) => xs.map((x, k) => (k === j ? { ...x, cantidad: Number(e.target.value) } : x)))} />
                  </div>
                  <div className="min-w-0">
                    <span className="mb-1 block text-xs text-tinta/60">Vence (si tiene)</span>
                    <Entrada type="date" value={r.vencimiento} aria-label={`Vencimiento de ${r.nombre}`}
                      onChange={(e) => setRenglones((xs) => xs.map((x, k) => (k === j ? { ...x, vencimiento: e.target.value } : x)))} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Campo etiqueta="Notas para administración">
          <Entrada value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} />
        </Campo>
        {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
        <Boton anchoCompleto onClick={enviar} disabled={!listo} cargando={enviando}>
          Enviar a administración{renglones.length ? ` (${renglones.length} producto${renglones.length === 1 ? '' : 's'})` : ''}
        </Boton>
        <p className="text-xs text-tinta/60">No suma al stock todavía: entra cuando administración lo confirma con la factura.</p>
      </Tarjeta>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-tinta">Últimos ingresos</h2>
        {esperan?.length === 0 && <p className="text-sm text-tinta/60">Todavía no hay ingresos por puerta de depósito.</p>}
        <ul className="space-y-2">
          {esperan?.slice(0, 15).map((i) => (
            <li key={i.id}>
              <Tarjeta className="!p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-tinta">#{i.numero} · {i.proveedor?.nombre ?? 'Proveedor'} · remito {i.numero_remito}</p>
                  <EstadoIngreso estado={i.estado} />
                </div>
                <p className="text-xs text-tinta/60">{(i.items ?? []).length} productos · {new Date(i.creado_en).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}{i.creadoPorNombre ? ` · ${i.creadoPorNombre}` : ''}</p>
                {i.estado === 'rechazado' && i.motivo_rechazo && <p className="mt-1 text-xs text-marca">Rechazado: {i.motivo_rechazo}</p>}
              </Tarjeta>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function EstadoIngreso({ estado }: { estado: string }) {
  if (estado === 'ingresado') return <Etiqueta tono="ok">En stock</Etiqueta>;
  if (estado === 'rechazado') return <Etiqueta tono="error">Rechazado</Etiqueta>;
  return <Etiqueta tono="atencion" punto>Espera factura</Etiqueta>;
}
