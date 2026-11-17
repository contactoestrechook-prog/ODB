'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { numero, porcentaje } from '../../lib/formato';
import { Aviso, Boton, Chips, Entrada, FOCO_ADENTRO, ROTULO, Selector, Tarjeta, unir } from '../kit';
import { api, sucursalCorta, type ProductoStock } from './comun';

// STOCK Y UBICACIÓN (rediseño del 17/11/2026). Al 17/11 había 5.197 productos
// con stock en Sant Thomas y 2.179 en Santa Inés, y NINGUNO con lugar cargado:
// sin lugar, la lista de armado sale por orden alfabético y el que arma camina
// de más. Esta pestaña es para cargarlos rápido: por categoría (toda la góndola
// de Malbec de una), producto por producto con Enter, o buscando uno.

type Lugares = {
  sucursalId: string | null;
  sucursal: string | null;
  sucursales: { sucursalId: string; sucursal: string; conStock: number; conLugar: number }[];
  categorias: { categoriaId: string | null; categoria: string; conStock: number; sinLugar: number }[];
  lugaresUsados: string[];
};
type SinLugar = { productoId: string; sku: string | null; nombre: string; cantidad: number };

export function Stock({ sucursalPropia }: { sucursalPropia: string | null }) {
  const [suc, setSuc] = useState<string | null>(sucursalPropia);
  const [lugares, setLugares] = useState<Lugares | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [buscado, setBuscado] = useState<{ texto: string; res: ProductoStock[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const listaLugares = useId();

  const cargarLugares = useCallback(async (s: string | null) => {
    try {
      const d = await api<Lugares>('GET', { recurso: 'lugares', ...(s ? { sucursalId: s } : {}) });
      setLugares(d);
      setSuc(d.sucursalId);
      setCat((c) => c ?? (d.categorias.find((x) => x.sinLugar > 0) ?? d.categorias[0])?.categoriaId ?? 'sin');
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargarLugares(sucursalPropia); }, [cargarLugares, sucursalPropia]);

  async function buscar(texto = q) {
    if (texto.trim().length < 2) return;
    setBuscando(true);
    try { setBuscado({ texto: texto.trim(), res: await api<ProductoStock[]>('GET', { recurso: 'stock', q: texto.trim() }) }); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setBuscando(false); }
  }

  // cada lugar guardado suma al contador de arriba sin volver a pedir todo
  const sumarLugar = (categoriaId: string | null | undefined, n = 1) => setLugares((l) => l && ({
    ...l,
    sucursales: l.sucursales.map((s) => (s.sucursalId === l.sucursalId ? { ...s, conLugar: Math.min(s.conStock, s.conLugar + n) } : s)),
    categorias: categoriaId === undefined ? l.categorias : l.categorias.map((c) => ((c.categoriaId ?? 'sin') === (categoriaId ?? 'sin') ? { ...c, sinLugar: Math.max(0, c.sinLugar - n) } : c)),
  }));
  const anotarLugar = (lugar: string) => setLugares((l) => (l && lugar && !l.lugaresUsados.includes(lugar) ? { ...l, lugaresUsados: [...l.lugaresUsados, lugar].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })) } : l));

  const actual = lugares?.sucursales.find((s) => s.sucursalId === lugares.sucursalId);
  const categoria = lugares?.categorias.find((c) => (c.categoriaId ?? 'sin') === cat) ?? null;
  const pendientes = lugares?.categorias.filter((c) => c.sinLugar > 0) ?? [];

  return (
    <div className="space-y-5">
      <datalist id={listaLugares}>{lugares?.lugaresUsados.map((l) => <option key={l} value={l} />)}</datalist>

      {!sucursalPropia && lugares && lugares.sucursales.length > 1 && (
        <Chips etiquetaAccesible="Sucursal" valor={suc ?? ''} onCambiar={(v) => { setCat(null); setLugares(null); cargarLugares(v); }} desplazable
          opciones={lugares.sucursales.map((s) => ({ valor: s.sucursalId, etiqueta: sucursalCorta(s.sucursal) }))} />
      )}

      {/* cuánto falta: la cifra que manda en esta pestaña */}
      <Tarjeta>
        {actual ? (
          <>
            <p className={ROTULO}>Lugares cargados · {sucursalCorta(actual.sucursal)}</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="importe text-3xl font-bold leading-none tracking-tight text-tinta">{numero(actual.conLugar)} <span className="text-base font-semibold text-tinta/60">de {numero(actual.conStock)}</span></p>
              <p className="text-sm text-tinta/70">productos con stock tienen su lugar ({porcentaje(actual.conStock ? actual.conLugar / actual.conStock : 0, 0, { fraccion: true })})</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-crema-hondo" role="img" aria-label={`${numero(actual.conLugar)} de ${numero(actual.conStock)} con lugar`}>
              <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${actual.conStock ? Math.max(actual.conLugar ? 1 : 0, (actual.conLugar / actual.conStock) * 100) : 0}%` }} />
            </div>
            <p className="mt-2 text-xs text-tinta/60">
              {actual.conLugar < actual.conStock
                ? 'Sin lugar, la lista de armado sale por orden alfabético. Elegí una categoría y cargá el lugar de toda la góndola de una; después afinás los que estén en otro lado.'
                : 'Todo lo que tiene stock tiene su lugar: la lista de armado sale en el orden en que se camina el salón.'}
            </p>
          </>
        ) : error ? <Aviso tono="error">{error}</Aviso> : <p className="text-sm text-tinta/60">Contando los lugares…</p>}
      </Tarjeta>

      {/* buscar uno: para corregir o mirar cuánto hay en cada sucursal */}
      <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="flex gap-2">
        <Entrada value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setBuscado(null); }} aria-label="Buscar un producto" placeholder="Buscar un producto: nombre, código o escaneá" className="flex-1" />
        <Boton type="submit" variante="secundario" cargando={buscando} disabled={q.trim().length < 2}>Buscar</Boton>
      </form>

      {buscado ? (
        <Resultados buscado={buscado} listaLugares={listaLugares} sucursalPropia={sucursalPropia} onCerrar={() => { setBuscado(null); setQ(''); }}
          onGuardado={(conLugarAntes, lugar, sucursalId) => { anotarLugar(lugar); if (!conLugarAntes && lugar && sucursalId === lugares?.sucursalId) sumarLugar(undefined); }} />
      ) : lugares && suc && (
        <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* las categorías: las que más faltan primero */}
          <div className="min-w-0">
            <div className="lg:hidden">
              <Selector aria-label="Categoría" value={cat ?? ''} onChange={(e) => setCat(e.target.value)}
                opciones={lugares.categorias.map((c) => ({ valor: c.categoriaId ?? 'sin', etiqueta: `${nombreCat(c.categoria)} · ${c.sinLugar ? `faltan ${numero(c.sinLugar)}` : 'completa'}` }))} />
            </div>
            <Tarjeta relleno={false} className="hidden max-h-[calc(100dvh-12rem)] overflow-y-auto lg:block">
              <p className={unir(ROTULO, 'sticky top-0 border-b border-black/[0.06] bg-white px-4 py-2.5')}>Categorías · {numero(pendientes.length)} por completar</p>
              <ul>
                {lugares.categorias.map((c) => {
                  const id = c.categoriaId ?? 'sin';
                  const hecho = c.conStock - c.sinLugar;
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => setCat(id)} aria-current={cat === id || undefined}
                        className={unir('block w-full border-l-2 px-4 py-2 text-left transition-colors', cat === id ? 'border-marca bg-marca-suave/60' : 'border-transparent hover:bg-crema-claro', FOCO_ADENTRO)}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={unir('min-w-0 truncate text-sm', cat === id ? 'font-semibold text-tinta' : 'text-tinta')}>{nombreCat(c.categoria)}</span>
                          <span className={unir('importe shrink-0 text-xs', c.sinLugar ? 'text-tinta/60' : 'font-semibold text-ok')}>{c.sinLugar ? numero(c.sinLugar) : 'Lista'}</span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-crema-hondo">
                          <span className="block h-full rounded-full bg-ok" style={{ width: `${c.conStock ? (hecho / c.conStock) * 100 : 0}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          </div>

          {categoria ? (
            <CargaCategoria key={`${suc}|${cat}`} sucursalId={suc} categoria={categoria} listaLugares={listaLugares}
              onGuardado={(n, lugar) => { anotarLugar(lugar); sumarLugar(categoria.categoriaId, n); }} />
          ) : <Tarjeta><p className="text-sm text-tinta/70">Elegí una categoría.</p></Tarjeta>}
        </div>
      )}
    </div>
  );
}

/** «vinos tintos  Cabernet» → «Vinos tintos cabernet» (las categorías vienen en cualquier caja) */
function nombreCat(n: string) {
  const t = n.replace(/\s+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ───────────────────────── una categoría ─────────────────────────

function CargaCategoria({ sucursalId, categoria, listaLugares, onGuardado }: {
  sucursalId: string;
  categoria: Lugares['categorias'][number];
  listaLugares: string;
  onGuardado: (n: number, lugar: string) => void;
}) {
  const [lista, setLista] = useState<SinLugar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todos, setTodos] = useState('');
  const [poniendo, setPoniendo] = useState(false);
  const [hechos, setHechos] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const cargar = useCallback(async () => {
    try {
      setLista(await api<SinLugar[]>('GET', { recurso: 'sinlugar', sucursalId, categoriaId: categoria.categoriaId ?? 'sin' }));
      setError(null);
    } catch (e: any) { setError(e.message); setLista([]); }
  }, [sucursalId, categoria.categoriaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const faltan = (lista ?? []).filter((p) => !hechos[p.productoId]);

  async function ponerATodos() {
    const lugar = todos.trim();
    if (!lugar) return;
    setPoniendo(true);
    setAviso(null);
    try {
      const r = await api<{ actualizados: number }>('POST', { accion: 'lugarcategoria', sucursalId, categoriaId: categoria.categoriaId ?? 'sin', ubicacion: lugar });
      setHechos((h) => ({ ...h, ...Object.fromEntries(faltan.map((p) => [p.productoId, lugar])) }));
      onGuardado(r.actualizados, lugar);
      setAviso(`${numero(r.actualizados)} ${r.actualizados === 1 ? 'producto quedó' : 'productos quedaron'} en «${lugar}».`);
      setTodos('');
    } catch (e: any) { setError(e.message); }
    finally { setPoniendo(false); }
  }

  return (
    <Tarjeta relleno={false} className="min-w-0">
      <div className="border-b border-black/[0.06] p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-base font-bold text-tinta">{nombreCat(categoria.categoria)}</h3>
          <p className="text-sm text-tinta/70">{lista ? `${numero(faltan.length)} sin lugar de ${numero(categoria.conStock)} con stock` : 'Buscando…'}</p>
        </div>
        {/* toda la góndola de una */}
        {faltan.length > 0 && categoria.categoriaId && (
          <form onSubmit={(e) => { e.preventDefault(); ponerATodos(); }} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-56">
              <span className="mb-1 block text-xs font-semibold text-tinta/70">¿Están todos en el mismo lugar?</span>
              <Entrada value={todos} onChange={(e) => setTodos(e.target.value)} list={listaLugares} maxLength={80} placeholder="Escribí el lugar" />
            </label>
            <Boton type="submit" cargando={poniendo} disabled={!todos.trim()}>Poner a los {numero(faltan.length)}</Boton>
          </form>
        )}
        {aviso && <p className="mt-2 text-sm font-semibold text-ok">{aviso}</p>}
        {error && <div className="mt-3"><Aviso tono="error">{error}</Aviso></div>}
      </div>

      {lista && lista.length > 0 && (
        <>
          <div className="hidden grid-cols-[minmax(0,1fr)_5rem_minmax(9rem,14rem)] gap-3 border-b border-black/[0.06] px-5 py-2 sm:grid">
            <span className={ROTULO}>Producto</span><span className={unir(ROTULO, 'text-right')}>Stock</span><span className={ROTULO}>Lugar · Enter guarda y pasa al siguiente</span>
          </div>
          <ul className="divide-y divide-black/[0.06]">
            {lista.map((p, i) => (
              <FilaLugar key={p.productoId} p={p} sucursalId={sucursalId} listaLugares={listaLugares} hecho={hechos[p.productoId]}
                refInput={(el) => { refs.current[i] = el; }}
                onGuardado={(lugar) => {
                  setHechos((h) => ({ ...h, [p.productoId]: lugar }));
                  onGuardado(1, lugar);
                  // al siguiente que falta
                  for (let j = i + 1; j < lista.length; j++) { if (!hechos[lista[j].productoId]) { refs.current[j]?.focus(); break; } }
                }} />
            ))}
          </ul>
        </>
      )}
      {lista && lista.length === 0 && !error && (
        <p className="p-5 text-sm text-tinta/70">Todos los productos con stock de esta categoría tienen su lugar.</p>
      )}
    </Tarjeta>
  );
}

function FilaLugar({ p, sucursalId, listaLugares, hecho, refInput, onGuardado }: {
  p: SinLugar; sucursalId: string; listaLugares: string; hecho?: string;
  refInput: (el: HTMLInputElement | null) => void; onGuardado: (lugar: string) => void;
}) {
  const [valor, setValor] = useState('');
  const [estado, setEstado] = useState<'quieto' | 'guardando' | 'error'>('quieto');
  // Enter guarda y pasa al siguiente; al irse, el campo pierde el foco y no tiene que guardar de nuevo
  const enviado = useRef<string | null>(null);
  async function guardar() {
    const lugar = valor.trim();
    if (!lugar || enviado.current === lugar) return;
    enviado.current = lugar;
    setEstado('guardando');
    try { await api('POST', { accion: 'ubicacion', productoId: p.productoId, sucursalId, ubicacion: lugar }); setEstado('quieto'); onGuardado(lugar); }
    catch { enviado.current = null; setEstado('error'); }
  }
  return (
    <li className={unir('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(9rem,14rem)] sm:px-5', hecho && 'bg-ok-suave/50')}>
      <div className="min-w-0">
        <p className="truncate text-sm text-tinta">{p.nombre}</p>
        <p className="truncate text-xs text-tinta/60">{p.sku}</p>
      </div>
      <span className="importe text-right text-sm text-tinta/70">{numero(p.cantidad, 2)}</span>
      {hecho ? (
        <p className="col-span-2 truncate text-sm font-semibold text-ok sm:col-span-1">En {hecho}</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="col-span-2 sm:col-span-1">
          <Entrada ref={refInput} value={valor} onChange={(e) => { setValor(e.target.value); setEstado('quieto'); }} list={listaLugares} maxLength={80}
            aria-label={`Lugar de ${p.nombre}`} placeholder="Dónde está" disabled={estado === 'guardando'}
            onBlur={() => { if (valor.trim()) guardar(); }} />
          {estado === 'error' && <p className="mt-1 text-xs text-marca-hondo">No se pudo guardar. Probá de nuevo.</p>}
        </form>
      )}
    </li>
  );
}

// ───────────────────────── lo buscado ─────────────────────────

function Resultados({ buscado, listaLugares, sucursalPropia, onCerrar, onGuardado }: {
  buscado: { texto: string; res: ProductoStock[] }; listaLugares: string; sucursalPropia: string | null;
  onCerrar: () => void; onGuardado: (teniaLugar: boolean, lugar: string, sucursalId: string) => void;
}) {
  return (
    <Tarjeta relleno={false}>
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
        <p className="min-w-0 truncate text-sm text-tinta"><b className="font-semibold">{numero(buscado.res.length)}</b> {buscado.res.length === 1 ? 'producto' : 'productos'} con «{buscado.texto}»</p>
        <Boton tamano="chico" variante="fantasma" onClick={onCerrar}>Volver a las categorías</Boton>
      </div>
      {buscado.res.length === 0 && <p className="p-5 text-sm text-tinta/70">No encontré ese producto. Probá con otra palabra o escaneá el código.</p>}
      <ul className="divide-y divide-black/[0.06]">
        {buscado.res.map((p) => (
          <li key={p.id} className="px-4 py-3 sm:px-5">
            <p className="text-sm font-semibold text-tinta">{p.nombre}</p>
            <p className="text-xs text-tinta/60">{p.sku}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {p.sucursales.slice().sort((a, b) => Number(b.sucursalId === sucursalPropia) - Number(a.sucursalId === sucursalPropia)).map((s) => (
                <LugarEnSucursal key={s.sucursalId} productoId={p.id} s={s} listaLugares={listaLugares} onGuardado={onGuardado} />
              ))}
              {!p.sucursales.length && <p className="text-sm text-tinta/60">Sin stock cargado en ninguna sucursal</p>}
            </div>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

function LugarEnSucursal({ productoId, s, listaLugares, onGuardado }: {
  productoId: string; s: ProductoStock['sucursales'][number]; listaLugares: string; onGuardado: (teniaLugar: boolean, lugar: string, sucursalId: string) => void;
}) {
  const [valor, setValor] = useState(s.ubicacion ?? '');
  const [guardado, setGuardado] = useState(s.ubicacion ?? '');
  const [estado, setEstado] = useState<'quieto' | 'guardando' | 'ok' | 'error'>('quieto');
  async function guardar() {
    setEstado('guardando');
    try {
      await api('POST', { accion: 'ubicacion', productoId, sucursalId: s.sucursalId, ubicacion: valor });
      onGuardado(!!guardado.trim(), valor.trim(), s.sucursalId);
      setGuardado(valor.trim()); setEstado('ok');
    } catch { setEstado('error'); }
  }
  return (
    <div className="rounded-xl bg-crema-claro px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-tinta/70">{sucursalCorta(s.sucursal)}</span>
        <span className={unir('importe text-base font-bold', s.cantidad > 0 ? 'text-tinta' : 'text-marca-hondo')}>{numero(s.cantidad, 2)}</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="mt-1.5 flex gap-2">
        <Entrada value={valor} onChange={(e) => { setValor(e.target.value); setEstado('quieto'); }} list={listaLugares} aria-label={`Lugar en ${s.sucursal}`} placeholder="Dónde está" maxLength={80} className="flex-1" />
        <Boton type="submit" tamano="chico" variante="secundario" disabled={valor.trim() === guardado} cargando={estado === 'guardando'}>Guardar</Boton>
      </form>
      {estado === 'ok' && <p className="mt-1 text-xs text-ok">Lugar guardado</p>}
      {estado === 'error' && <p className="mt-1 text-xs text-marca-hondo">No se pudo guardar</p>}
    </div>
  );
}
