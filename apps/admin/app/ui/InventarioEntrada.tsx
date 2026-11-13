'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Aviso, Boton, BotonLink, Chip, FOCO, FOCO_ADENTRO, Girador, ROTULO, Tarjeta, unir } from './kit';
import { InventarioBuscador, InventarioFicha } from './Inventario';
import { tonoDeSucursal } from './InventarioGraficos';
import { pesos } from '../lib/formato';
import {
  TRAMO, TRAMOS, VISTA, alcanzaCorto, porDia, unidades,
  type Entrada, type FichaInventario, type FilaEntrada, type Tramo, type Vista,
} from '../lib/inventario';

// ============================================================
// INVENTARIO DE PRODUCTO, LA ENTRADA (Leandro, 13/11/2026: «le podríamos dar
// una mejora superlativa… ¿no te parece que está súper pobre?»).
//
// Antes: un buscador y diez productos con dos números, en media pantalla.
// Ahora, a pantalla completa:
//   1. arriba, cómo está el stock entero: cuántos productos hay, cuánto valen y
//      cuánto alcanza lo que hay en cada sucursal (cada tramo se toca);
//   2. a la izquierda, la lista para recorrer (los que más se venden, los que
//      no hay, los que se terminan, los que sobran, los que no se venden y los
//      números que hay que contar);
//   3. a la derecha, la ficha del producto abierta, como en Aprobaciones: se
//      pasa de uno a otro sin cambiar de página (también con ↑ ↓).
// En el celular, la lista; cada producto abre su ficha como antes (?sku=).
// ============================================================

/** desde este ancho la lista y la ficha van una al lado de la otra (en las
 *  clases va escrito entero, min-[1400px]:…, porque Tailwind solo ve el texto) */
const ANCHO_DOS = 1400;

function useDosPaneles() {
  const [dos, setDos] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${ANCHO_DOS}px)`);
    const ver = () => setDos(m.matches);
    ver();
    m.addEventListener('change', ver);
    return () => m.removeEventListener('change', ver);
  }, []);
  return dos;
}

// Lo que ya se trajo queda un minuto (lo mismo que dura la lectura del motor en
// el servidor): en el celular cada ficha es otra página y al volver no se espera.
const CACHE_MS = 60_000;
const cacheEntradas = new Map<string, { en: number; datos: Entrada }>();
const deCache = (clave: string) => {
  const c = cacheEntradas.get(clave);
  return c && Date.now() - c.en < CACHE_MS ? c.datos : null;
};

async function pedirEntrada(sucursal: string, vista?: Vista, desde?: number): Promise<Entrada> {
  const sp = new URLSearchParams();
  if (sucursal) sp.set('sucursal', sucursal);
  if (vista) sp.set('vista', vista);
  if (desde) sp.set('desde', String(desde));
  const r = await fetch(`/api/inventario/entrada?${sp}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const miles = (n: number) => n.toLocaleString('es-AR');
const nombreCorto = (nombre: string) => nombre.replace(/^Saint\s+/i, 'S. ').replace(/^Santa\s+/i, 'Sta. ');
const Punto = ({ clase }: { clase: string }) => <span className={unir('inline-block size-2 shrink-0 rounded-full', clase)} aria-hidden="true" />;
/** las listas que muestran cuánta plata hay parada */
const CON_PLATA: Vista[] = ['de_mas', 'sin_ventas', 'meses'];
/** las listas que siempre tienen su chip; las otras aparecen cuando se tocan en el gráfico */
const FIJAS: Vista[] = ['se_vende', 'sin_stock', 'semana', 'de_mas', 'sin_ventas', 'revisar'];
/** el nombre corto de cada lista, para los chips (el largo va de título) */
const CHIP: Record<Vista, string> = {
  se_vende: 'Más se venden', sin_stock: 'No hay', semana: 'Se terminan', mes: '1 a 4 semanas',
  meses: '1 a 4 meses', de_mas: 'Sobran', sin_ventas: 'Sin ventas', revisar: 'Para revisar',
};

export function InventarioPantalla({ fichaInicial, error }: { fichaInicial: FichaInventario | null; error: string | null }) {
  const router = useRouter();
  const dosPaneles = useDosPaneles();
  const skuInicial = fichaInicial?.producto.sku ?? null;

  const [sucursal, setSucursal] = useState('');
  const [vista, setVista] = useState<Vista>('se_vende');
  const [entradas, setEntradas] = useState<Record<string, Entrada>>(() => {
    const c = deCache('');
    const inicio: Record<string, Entrada> = {};
    if (c) inicio[''] = c;
    return inicio;
  });
  const [ultimaSucursal, setUltimaSucursal] = useState('');
  const [falloEntrada, setFalloEntrada] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [mas, setMas] = useState<Record<string, { filas: FilaEntrada[]; cargando: boolean; fallo: boolean }>>({});

  const [elegido, setElegido] = useState<string | null>(skuInicial);
  const [anterior, setAnterior] = useState<string | null>(null);
  const [fichas, setFichas] = useState<Record<string, FichaInventario>>(fichaInicial ? { [fichaInicial.producto.sku]: fichaInicial } : {});
  const [falloFicha, setFalloFicha] = useState<string | null>(null);
  const panelFicha = useRef<HTMLDivElement>(null);

  // ---------- la entrada de la sucursal que se mira ----------
  const necesitaEntrada = dosPaneles || !skuInicial;
  const pedida = entradas[sucursal];
  useEffect(() => {
    if (!necesitaEntrada || pedida) return;
    let vigente = true;
    pedirEntrada(sucursal)
      .then((d) => {
        cacheEntradas.set(sucursal, { en: Date.now(), datos: d });
        if (!vigente) return;
        setEntradas((e) => ({ ...e, [sucursal]: d }));
        setUltimaSucursal(sucursal);
        setFalloEntrada(null);
      })
      .catch(() => { if (vigente) setFalloEntrada(sucursal); });
    return () => { vigente = false; };
  }, [necesitaEntrada, pedida, sucursal, intento]);

  // mientras llega otra sucursal queda la anterior, apagada
  const entrada = pedida ?? entradas[ultimaSucursal] ?? null;
  const cambiando = !pedida && falloEntrada !== sucursal;
  const claveMas = `${sucursal}|${vista}`;
  const filas = pedida ? [...pedida.vistas[vista].filas, ...(mas[claveMas]?.filas ?? [])] : entrada?.vistas[vista].filas ?? [];

  // ---------- la ficha abierta (escritorio) ----------
  // sin elegir nada, queda abierta la primera de la lista: la pantalla nunca está vacía
  const abierto = elegido ?? (dosPaneles ? filas[0]?.sku ?? null : null);
  const fichaPedida = abierto ? fichas[abierto] : undefined;
  useEffect(() => {
    if (!dosPaneles || !abierto || fichaPedida) return;
    let vigente = true;
    fetch(`/api/inventario/producto?sku=${encodeURIComponent(abierto)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const f = (await r.json()) as FichaInventario;
        if (vigente) setFichas((m) => ({ ...m, [abierto]: f }));
      })
      .catch(() => { if (vigente) setFalloFicha(abierto); });
    return () => { vigente = false; };
  }, [dosPaneles, abierto, fichaPedida]);

  const fichaVista = fichaPedida ?? (anterior ? fichas[anterior] : undefined) ?? null;
  const abriendo = !!abierto && !fichaPedida && falloFicha !== abierto;

  const elegir = (sku: string) => {
    if (!dosPaneles) {
      router.push(`/inventario?sku=${encodeURIComponent(sku)}`);
      return;
    }
    if (sku === abierto) return;
    setAnterior(fichaPedida ? abierto : anterior);
    setElegido(sku);
    setFalloFicha(null);
    window.history.replaceState(null, '', `/inventario?sku=${encodeURIComponent(sku)}`);
    // si la ficha quedó arriba, fuera de la vista, se sube hasta ella
    const top = panelFicha.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) panelFicha.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const elegirSucursal = (id: string) => {
    if (id === sucursal) return;
    const c = deCache(id);
    if (c && !entradas[id]) setEntradas((e) => ({ ...e, [id]: c }));
    setSucursal(id);
    setFalloEntrada(null);
  };
  const elegirVista = (v: Vista, suc?: string) => {
    if (suc != null) elegirSucursal(suc);
    setVista(v);
  };

  const verMas = () => {
    if (!pedida) return;
    const ya = mas[claveMas];
    if (ya?.cargando) return;
    const desde = pedida.vistas[vista].filas.length + (ya?.filas.length ?? 0);
    setMas((m) => ({ ...m, [claveMas]: { filas: ya?.filas ?? [], cargando: true, fallo: false } }));
    const v = vista, clave = claveMas;
    pedirEntrada(sucursal, v, desde)
      .then((d) => setMas((m) => ({ ...m, [clave]: { filas: [...(m[clave]?.filas ?? []), ...d.vistas[v].filas], cargando: false, fallo: false } })))
      .catch(() => setMas((m) => ({ ...m, [clave]: { filas: m[clave]?.filas ?? [], cargando: false, fallo: true } })));
  };

  const posicion = abierto ? filas.findIndex((f) => f.sku === abierto) : -1;
  const conFicha = !!skuInicial; // en el celular, la página de una ficha

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ---------- buscar y elegir sucursal ---------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1 space-y-3">
          {conFicha && (
            <BotonLink href="/inventario" variante="secundario" tamano="chico" className={unir('w-fit', 'min-[1400px]:hidden')}>
              Volver a la lista
            </BotonLink>
          )}
          <InventarioBuscador
            enPanel
            abierto={elegido && fichas[elegido] ? { sku: elegido, nombre: fichas[elegido].producto.nombre } : null}
            alAbrir={dosPaneles ? elegir : undefined}
          />
        </div>
        {entrada && entrada.sucursales.length > 1 && (
          <div className={unir('shrink-0', conFicha && 'hidden min-[1400px]:block')}>
            <p className={unir(ROTULO, 'mb-2')}>Mirar</p>
            <div role="group" aria-label="Sucursal" className="flex flex-wrap gap-2">
              <Chip activo={sucursal === ''} onClick={() => elegirSucursal('')}>Las dos<span className="hidden sm:inline"> sucursales</span></Chip>
              {entrada.sucursales.map((s, i) => (
                <Chip key={s.id} activo={sucursal === s.id} onClick={() => elegirSucursal(s.id)}>
                  <span className="inline-flex items-center gap-1.5"><Punto clase={tonoDeSucursal(i).fondo} />{s.nombre}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {/* ---------- cómo está el stock ---------- */}
      <div className={unir(conFicha && 'hidden min-[1400px]:block')}>
        <FotoDelStock entrada={entrada} sucursal={sucursal} vista={vista} cargando={cambiando} onVista={elegirVista} />
      </div>
      {falloEntrada === sucursal && (
        <Aviso tono="error">
          <span className="flex flex-wrap items-center gap-3">
            No pude traer cómo está el stock.
            <Boton variante="secundario" tamano="chico" onClick={() => { setFalloEntrada(null); setIntento((n) => n + 1); }}>Volver a intentar</Boton>
          </span>
        </Aviso>
      )}

      {/* ---------- la lista y la ficha ---------- */}
      <div className="min-[1400px]:grid min-[1400px]:grid-cols-[minmax(25rem,5fr)_minmax(0,8fr)] min-[1400px]:items-start min-[1400px]:gap-6">
        <div className={unir(conFicha && 'hidden min-[1400px]:block', 'min-[1400px]:sticky min-[1400px]:top-4')}>
          <ListaDeProductos
            entrada={entrada}
            sucursal={sucursal}
            vista={vista}
            filas={filas}
            cargando={cambiando}
            abierto={dosPaneles ? abierto : null}
            onVista={(v) => setVista(v)}
            onElegir={elegir}
            masEstado={mas[claveMas]}
            onMas={verMas}
          />
        </div>

        <div ref={panelFicha} className={unir('min-w-0 scroll-mt-4', !conFicha && 'hidden min-[1400px]:block')}>
          {dosPaneles && posicion >= 0 && filas.length > 1 && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm text-tinta/60">
                <span className="importe font-semibold text-tinta">{miles(posicion + 1)}</span> de {miles(entrada?.vistas[vista].total ?? filas.length)} en «{VISTA[vista].nombre}»
              </p>
              <div className="flex gap-2">
                <Boton variante="secundario" tamano="chico" disabled={posicion <= 0} onClick={() => elegir(filas[posicion - 1].sku)}>Anterior</Boton>
                <Boton variante="secundario" tamano="chico" disabled={posicion >= filas.length - 1} onClick={() => elegir(filas[posicion + 1].sku)}>Siguiente</Boton>
              </div>
            </div>
          )}
          {falloFicha && falloFicha === abierto && (
            <Aviso tono="error">
              <span className="flex flex-wrap items-center gap-3">
                No pude abrir la ficha de ese producto.
                <Boton variante="secundario" tamano="chico" onClick={() => setFalloFicha(null)}>Volver a intentar</Boton>
              </span>
            </Aviso>
          )}
          {fichaVista ? (
            <div className={unir('relative transition-opacity', abriendo && 'opacity-50')} aria-busy={abriendo}>
              {abriendo && (
                <p className="absolute left-1/2 top-24 z-contenido flex -translate-x-1/2 items-center gap-2 rounded-full bg-tinta px-4 py-2 text-sm font-medium text-white shadow-flotante">
                  <Girador /> Abriendo {filas.find((f) => f.sku === abierto)?.nombre ?? 'el producto'}…
                </p>
              )}
              <InventarioFicha key={fichaVista.producto.sku} ficha={fichaVista} />
            </div>
          ) : abriendo || (dosPaneles && !entrada) ? (
            <Tarjeta className="flex min-h-64 items-center justify-center">
              <p className="flex items-center gap-2 text-sm text-tinta/70"><Girador /> Abriendo la ficha…</p>
            </Tarjeta>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Arriba: cuántos productos hay, cuánto valen y cuánto alcanza lo que hay
// ------------------------------------------------------------
function FotoDelStock({ entrada, sucursal, vista, cargando, onVista }: {
  entrada: Entrada | null;
  sucursal: string;
  vista: Vista;
  cargando: boolean;
  onVista: (v: Vista, sucursal?: string) => void;
}) {
  // el rótulo va con el número que se ve (mientras llega otra sucursal queda la anterior)
  const nombreSuc = entrada?.sucursales.find((s) => s.id === entrada.sucursal)?.nombre;
  const donde = nombreSuc ? `en ${nombreSuc}` : 'en las dos sucursales';
  const cifra = 'importe mt-1 block text-2xl font-bold leading-none tracking-tight text-tinta sm:text-4xl';
  return (
    <section aria-label="Cómo está el stock" className={unir('grid gap-x-10 gap-y-5 transition-opacity xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-start 2xl:gap-x-12', cargando && entrada && 'opacity-60')}>
      <dl className="flex flex-wrap gap-x-8 gap-y-4 xl:flex-col xl:gap-y-5 xl:pt-1">
        <div>
          <dt className={ROTULO}>Productos con stock</dt>
          <dd>
            <Link href={entrada?.sucursal ? `/stock?suc=${entrada.sucursal}` : '/stock'} className={unir('group inline-block rounded-lg', FOCO)}>
              <span className={cifra}>{entrada ? miles(entrada.foto.conStock) : '—'}</span>
              <span className="mt-1 block text-sm text-tinta/60 group-hover:text-tinta sm:mt-1.5">{entrada ? `${donde} · ver en Stock →` : 'Sumando…'}</span>
            </Link>
          </dd>
        </div>
        {(!entrada || entrada.conPlata) && (
          <div>
            <dt className={ROTULO}>Valen a costo</dt>
            <dd>
              <span className={cifra}>{entrada?.foto.valor != null ? pesos(entrada.foto.valor) : '—'}</span>
              <span className="mt-1 block text-sm text-tinta/60 sm:mt-1.5">{entrada ? `lo que hay ${donde}` : 'Sumando…'}</span>
            </dd>
          </div>
        )}
      </dl>
      <Alcance entrada={entrada} sucursal={sucursal} vista={vista} onVista={onVista} />
    </section>
  );
}

/**
 * Cuánto alcanza lo que hay: una barra por sucursal partida en tramos y, al
 * lado, los números en renglones (la tabla del gráfico). Todo se toca y abre la
 * lista de ese tramo.
 */
function Alcance({ entrada, sucursal, vista, onVista }: {
  entrada: Entrada | null;
  sucursal: string;
  vista: Vista;
  onVista: (v: Vista, sucursal?: string) => void;
}) {
  const [encima, setEncima] = useState<{ suc: string; tramo: Tramo; x: number } | null>(null);
  const tramoActivo = (TRAMOS as readonly string[]).includes(vista) ? (vista as Tramo) : null;
  const sucursales = entrada?.sucursales ?? [];
  const deSuc = (id: string) => entrada?.alcance.find((a) => a.sucursalId === id);

  return (
    <>
      {/* las barras */}
      <div className="min-w-0">
        <p className={ROTULO}>Cuánto alcanza lo que hay</p>
        <p className="mt-0.5 hidden text-sm text-tinta/60 sm:block">Cada producto en su sucursal, según lo que se vende por día. Tocá un tramo para ver cuáles son.</p>
        <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
          {entrada ? sucursales.map((s, i) => {
            const a = deSuc(s.id);
            if (!a) return null;
            const apagada = !!sucursal && sucursal !== s.id;
            return (
              <div key={s.id} className={unir('relative transition-opacity', apagada && 'opacity-45')}>
                <p className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-tinta"><Punto clase={tonoDeSucursal(i).fondo} />{s.nombre}</span>
                  <span className="text-right text-tinta/60"><span className="importe">{miles(a.total)}</span> productos<span className="hidden 2xl:inline"> con stock o que se venden</span></span>
                </p>
                <div className="flex h-7 gap-0.5" onMouseLeave={() => setEncima(null)}>
                  {TRAMOS.map((t) => {
                    const n = a.tramos[t].n;
                    if (!n) return null;
                    const prendido = !tramoActivo || (tramoActivo === t && (!sucursal || sucursal === s.id));
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onVista(t, s.id)}
                        onMouseEnter={(e) => {
                          const caja = e.currentTarget.parentElement!.getBoundingClientRect();
                          const b = e.currentTarget.getBoundingClientRect();
                          setEncima({ suc: s.id, tramo: t, x: b.left - caja.left + b.width / 2 });
                        }}
                        onFocus={(e) => {
                          const caja = e.currentTarget.parentElement!.getBoundingClientRect();
                          const b = e.currentTarget.getBoundingClientRect();
                          setEncima({ suc: s.id, tramo: t, x: b.left - caja.left + b.width / 2 });
                        }}
                        onBlur={() => setEncima(null)}
                        aria-label={`${s.nombre}: ${miles(n)} ${n === 1 ? 'producto' : 'productos'} en «${TRAMO[t].nombre}»`}
                        className={unir(
                          'h-full min-w-1 transition-[opacity,transform] first:rounded-l-md last:rounded-r-md hover:scale-y-110',
                          prendido ? 'opacity-100' : 'opacity-30 hover:opacity-70',
                          FOCO,
                        )}
                        style={{ flexGrow: n, flexBasis: 0, backgroundColor: TRAMO[t].color }}
                      />
                    );
                  })}
                </div>
                {encima && encima.suc === s.id && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-9 z-contenido w-max max-w-64 -translate-x-1/2 rounded-xl bg-tinta px-3 py-2 text-xs text-white shadow-flotante"
                    style={{ left: Math.max(90, encima.x) }}
                  >
                    <p className="font-semibold">{TRAMO[encima.tramo].nombre}</p>
                    <p className="importe mt-0.5 text-white/70">
                      {s.nombre}: {miles(a.tramos[encima.tramo].n)} {a.tramos[encima.tramo].n === 1 ? 'producto' : 'productos'}
                      {a.tramos[encima.tramo].valor != null && a.tramos[encima.tramo].valor! > 0 ? ` · ${pesos(a.tramos[encima.tramo].valor)} a costo` : ''}
                    </p>
                  </div>
                )}
              </div>
            );
          }) : [0, 1].map((k) => (
            <div key={k}>
              <div className="mb-1.5 h-5 w-40 rounded-full bg-crema-hondo" />
              <div className="h-7 animate-pulse rounded-md bg-crema-hondo motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>

      {/* los números, en renglones: la tabla del gráfico */}
      <table className="w-full min-w-0 max-w-xl self-end text-sm xl:w-auto">
        <caption className="sr-only">Cuántos productos hay en cada tramo, por sucursal</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">Tramo</th>
            {sucursales.map((s, i) => (
              <th key={s.id} scope="col" className={unir(ROTULO, 'whitespace-nowrap px-2 pb-1.5 text-right font-semibold')}>
                <span className="inline-flex items-center gap-1.5"><Punto clase={tonoDeSucursal(i).fondo} />{nombreCorto(s.nombre)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TRAMOS.map((t) => (
            <tr key={t} className={unir('border-t border-black/[0.06]', tramoActivo === t && 'bg-white')}>
              <th scope="row" className="py-0 pr-4 text-left font-normal">
                <button type="button" onClick={() => onVista(t)} className={unir('flex min-h-8 w-full items-center gap-2 whitespace-nowrap rounded-md text-left text-tinta/70 hover:text-tinta', tramoActivo === t && 'font-semibold text-tinta', FOCO)}>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: TRAMO[t].color }} aria-hidden="true" />
                  <span className="sm:hidden">{TRAMO[t].corto}</span>
                  <span className="hidden sm:inline">{TRAMO[t].nombre}</span>
                </button>
              </th>
              {sucursales.map((s) => {
                const n = deSuc(s.id)?.tramos[t].n ?? 0;
                const activa = tramoActivo === t && sucursal === s.id;
                return (
                  <td key={s.id} className="p-0 text-right">
                    {entrada ? (
                      <button
                        type="button"
                        disabled={!n}
                        onClick={() => onVista(t, s.id)}
                        className={unir('importe min-h-8 w-full rounded-md px-2 text-right hover:bg-crema-claro disabled:text-tinta/40', activa ? 'font-bold text-tinta' : 'text-tinta', FOCO)}
                      >
                        {miles(n)}
                      </button>
                    ) : <span className="px-2 text-tinta/40">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ------------------------------------------------------------
// La lista para recorrer
// ------------------------------------------------------------
function ListaDeProductos({ entrada, sucursal, vista, filas, cargando, abierto, onVista, onElegir, masEstado, onMas }: {
  entrada: Entrada | null;
  sucursal: string;
  vista: Vista;
  filas: FilaEntrada[];
  cargando: boolean;
  abierto: string | null;
  onVista: (v: Vista) => void;
  onElegir: (sku: string) => void;
  masEstado?: { cargando: boolean; fallo: boolean };
  onMas: () => void;
}) {
  const resumen = entrada?.vistas[vista];
  const chips = FIJAS.includes(vista) ? FIJAS : [...FIJAS.slice(0, 3), vista, ...FIJAS.slice(3)];
  const conPlata = !!entrada?.conPlata && CON_PLATA.includes(vista);
  const sucursales = entrada?.sucursales ?? [];

  // el producto abierto (desde el buscador, Anterior o Siguiente) queda a la vista en la lista
  useEffect(() => {
    if (abierto) document.getElementById(`inv-${abierto}`)?.scrollIntoView({ block: 'nearest' });
  }, [abierto]);

  // ↑ ↓ pasan de un producto al otro (con la ficha al lado)
  const teclas = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = filas.findIndex((f) => f.sku === (abierto ?? (document.activeElement as HTMLElement | null)?.dataset.sku));
    const j = e.key === 'ArrowDown' ? Math.min(filas.length - 1, i + 1) : Math.max(0, i - 1);
    if (j === i || !filas[j]) return;
    e.preventDefault();
    if (abierto) onElegir(filas[j].sku);
    document.getElementById(`inv-${filas[j].sku}`)?.focus();
  };

  return (
    <Tarjeta relleno={false} className="flex flex-col overflow-hidden min-[1400px]:max-h-[calc(100dvh-2rem)]">
      <div className="space-y-3 border-b border-black/[0.06] px-4 pb-3 pt-4 sm:px-5">
        <div role="group" aria-label="Qué lista ver" className="flex flex-wrap gap-2">
          {chips.map((v) => (
            <Chip key={v} activo={v === vista} cuenta={entrada ? entrada.vistas[v].total : undefined} onClick={() => onVista(v)}>
              {CHIP[v]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight text-tinta">{VISTA[vista].nombre}</h2>
            <p className="mt-0.5 text-sm text-tinta/60">{VISTA[vista].bajada}</p>
          </div>
          {resumen && (
            <p className="text-right text-sm text-tinta/70">
              <span className="importe font-semibold text-tinta">{miles(resumen.total)}</span> {resumen.total === 1 ? 'producto' : 'productos'}
              {conPlata && resumen.valor ? <> · <span className="importe font-semibold text-tinta">{pesos(resumen.valor)}</span> a costo</> : null}
            </p>
          )}
        </div>
      </div>

      {/* las columnas: una por sucursal */}
      {sucursales.length > 0 && filas.length > 0 && (
        <div className="flex items-center gap-3 bg-crema-claro px-4 py-1.5 sm:px-5">
          <span className={unir(ROTULO, 'flex-1')}>Producto</span>
          {sucursales.map((s, i) => (
            <span key={s.id} className={unir(ROTULO, 'flex w-[5.5rem] items-center justify-end gap-1.5 whitespace-nowrap sm:w-24', sucursal && sucursal !== s.id && 'opacity-60')}>
              <Punto clase={tonoDeSucursal(i).fondo} />{nombreCorto(s.nombre)}
            </span>
          ))}
          {conPlata && <span className={unir(ROTULO, 'hidden w-28 text-right sm:block')}>A costo</span>}
        </div>
      )}

      {!entrada ? (
        <div className="space-y-px" aria-busy="true">
          <p className="flex items-center gap-2 px-5 py-3 text-sm text-tinta/70"><Girador /> Mirando el stock de las dos sucursales…</p>
          {Array.from({ length: 8 }).map((_, k) => (
            <div key={k} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 space-y-2"><div className="h-3.5 w-2/3 rounded-full bg-crema-hondo" /><div className="h-3 w-1/3 rounded-full bg-crema-claro" /></div>
              <div className="h-4 w-14 rounded-full bg-crema-hondo" />
              <div className="h-4 w-14 rounded-full bg-crema-hondo" />
            </div>
          ))}
        </div>
      ) : filas.length === 0 ? (
        <p className="px-5 py-6 text-sm text-tinta/70">{cargando ? 'Mirando…' : 'No hay ningún producto en esta lista.'}</p>
      ) : (
        <ul
          className={unir('min-h-0 flex-1 divide-y divide-black/[0.06] overflow-y-auto overscroll-contain transition-opacity', cargando && 'opacity-50')}
          onKeyDown={teclas}
          aria-busy={cargando}
        >
          {filas.map((f) => (
            <li key={f.sku}>
              <FilaDeLista fila={f} sucursales={sucursales} sucursal={sucursal} activa={f.sku === abierto} conPlata={conPlata} onElegir={onElegir} />
            </li>
          ))}
          {resumen && filas.length < resumen.total && (
            <li className="px-4 py-3 sm:px-5">
              <Boton variante="secundario" tamano="chico" onClick={onMas} disabled={masEstado?.cargando}>
                {masEstado?.cargando ? <><Girador /> Trayendo más…</> : masEstado?.fallo ? 'No pude traer más. Volver a intentar' : `Ver ${miles(Math.min(50, resumen.total - filas.length))} más (van ${miles(filas.length)} de ${miles(resumen.total)})`}
              </Boton>
            </li>
          )}
        </ul>
      )}
    </Tarjeta>
  );
}

/** Un producto: nombre y, por sucursal, cuánto hay y para cuántos días alcanza. */
function FilaDeLista({ fila, sucursales, sucursal, activa, conPlata, onElegir }: {
  fila: FilaEntrada;
  sucursales: { id: string; nombre: string }[];
  sucursal: string;
  activa: boolean;
  conPlata: boolean;
  onElegir: (sku: string) => void;
}) {
  return (
    <a
      id={`inv-${fila.sku}`}
      data-sku={fila.sku}
      href={`/inventario?sku=${encodeURIComponent(fila.sku)}`}
      aria-current={activa ? 'true' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return; // abrir en otra pestaña sigue andando
        e.preventDefault();
        onElegir(fila.sku);
      }}
      className={unir('relative flex items-center gap-3 px-4 py-2.5 transition-colors sm:px-5', activa ? 'bg-crema-claro' : 'hover:bg-crema-claro/60', FOCO_ADENTRO)}
    >
      {activa && <span className="absolute inset-y-0 left-0 w-1 bg-marca" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-tinta sm:block sm:truncate">{fila.nombre}</span>
        <span className={unir('block truncate text-xs', fila.motivo ? 'font-medium text-marca-hondo' : 'text-tinta/60')}>
          {fila.motivo ?? [fila.sku, fila.rubro ?? 'sin rubro', fila.ritmo > 0 ? `se vende ${porDia(fila.ritmo)}` : 'sin ventas'].join(' · ')}
        </span>
      </span>
      {sucursales.map(({ id }) => {
        const otra = !!sucursal && sucursal !== id;
        const s = fila.sucursales.find((x) => x.id === id);
        if (!s) {
          return (
            <span key={id} className={unir('w-[5.5rem] shrink-0 text-right sm:w-24', otra && 'opacity-60')}>
              <span className="block text-sm text-tinta/40">—</span>
              <span className="block text-xs text-tinta/60">no lo tiene</span>
            </span>
          );
        }
        const falta = s.ritmo > 0 && s.stock <= 0;
        return (
          <span key={s.id} className={unir('w-[5.5rem] shrink-0 text-right sm:w-24', otra && 'opacity-60')}>
            <span className={unir('importe block text-sm font-semibold', falta || s.stock < 0 ? 'text-marca-hondo' : 'text-tinta')}>{unidades(s.stock, fila.porPeso)}</span>
            <span className={unir('block truncate text-xs', falta ? 'font-medium text-marca-hondo' : 'text-tinta/60')}>
              {s.enCamino > 0 && s.stock <= 0 ? `llegan ${unidades(s.enCamino)}` : alcanzaCorto(s)}
            </span>
          </span>
        );
      })}
      {conPlata && <span className="importe hidden w-28 shrink-0 text-right text-sm text-tinta/70 sm:block">{fila.valor ? pesos(fila.valor) : '—'}</span>}
    </a>
  );
}
