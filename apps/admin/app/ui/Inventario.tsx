'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { BotonLink, Chips, Etiqueta, FOCO, FOCO_ADENTRO, Girador, ROTULO, TablaResponsiva, Tarjeta, TarjetaCabecera, TarjetaCuerpo, unir } from './kit';
import { BotonVolver } from './BotonVolver';
import { GraficoNivel, GraficoPlata, GraficoVentas, Leyenda, tonoDeSucursal } from './InventarioGraficos';
import { fecha, fechaHora, pesos } from '../lib/formato';
import {
  conSigno, cuantoAlcanza, estadoDeSucursal, periodoEnPalabras, porDia, unidades,
  type FichaInventario, type ResultadoInventario,
} from '../lib/inventario';

// ============================================================
// INVENTARIO DE PRODUCTO (Leandro, 5/11/2026: «un botón de inventario de
// producto con buscador, muy buenas gráficas»).
//
// Para quién: quien compra, quien carga las facturas y quien atiende. Buscan un
// producto y quieren saber, en este orden: cuánto hay y dónde, si alcanza, cómo
// llegó el stock a ese número, cuánto se vende y a cuánto se compra. Con eso
// deciden pedir, pasar de una sucursal a la otra o revisar un conteo.
//
// La pantalla va en ese orden. Lo que explica está plegado y cada número lleva
// a su detalle (el gráfico o los movimientos de donde sale).
// ============================================================

const RECIENTES = 'odb_inventario_recientes';
type Reciente = { sku: string; nombre: string };

function leerRecientes(): Reciente[] {
  try {
    const lista = JSON.parse(window.localStorage.getItem(RECIENTES) ?? '[]');
    return Array.isArray(lista) ? lista.filter((r) => r && typeof r.sku === 'string' && typeof r.nombre === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function IconoLupa() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />
    </svg>
  );
}

const Punto = ({ clase }: { clase: string }) => <span className={unir('inline-block size-2 shrink-0 rounded-full', clase)} aria-hidden="true" />;

// ------------------------------------------------------------
// El buscador: nombre, código de barras o SKU. Con el lector de códigos, Enter
// abre el primero.
// ------------------------------------------------------------
export function InventarioBuscador({ abierto }: { abierto: Reciente | null }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<{ q: string; lista: ResultadoInventario[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [elegido, setElegido] = useState(0);
  const [recientes, setRecientes] = useState<Reciente[]>([]);
  const [yendo, enTransicion] = useTransition();
  const abrirPrimero = useRef(false);
  const texto = q.trim();

  const abrir = (sku: string) => {
    abrirPrimero.current = false;
    setQ('');
    setResultados(null);
    enTransicion(() => router.push(`/inventario?sku=${encodeURIComponent(sku)}`));
  };

  useEffect(() => {
    if (texto.length < 2) {
      setResultados(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    setFallo(false);
    let vigente = true;
    const espera = setTimeout(async () => {
      try {
        const r = await fetch(`/api/inventario?q=${encodeURIComponent(texto)}`);
        if (!vigente) return;
        if (!r.ok) throw new Error(String(r.status));
        const lista = (await r.json()) as ResultadoInventario[];
        if (!vigente) return;
        setResultados({ q: texto, lista });
        setElegido(0);
        // el lector de códigos manda Enter antes de que lleguen los resultados
        if (abrirPrimero.current && lista.length) abrir(lista[0].sku);
        abrirPrimero.current = false;
      } catch {
        if (vigente) setFallo(true);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 220);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
    // `abrir` cambia en cada render; lo único que dispara la búsqueda es el texto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  // lo último que se miró, en este navegador
  useEffect(() => {
    let lista = leerRecientes();
    if (abierto) {
      lista = [abierto, ...lista.filter((r) => r.sku !== abierto.sku)].slice(0, 8);
      try {
        window.localStorage.setItem(RECIENTES, JSON.stringify(lista));
      } catch {
        // sin lugar o en una ventana privada: la pantalla anda igual
      }
    }
    setRecientes(lista);
  }, [abierto?.sku, abierto?.nombre]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = resultados?.q === texto ? resultados.lista : null;
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (lista?.length) abrir(lista[Math.min(elegido, lista.length - 1)].sku);
      else if (texto.length >= 2) abrirPrimero.current = true;
    } else if (e.key === 'ArrowDown' && lista?.length) {
      e.preventDefault();
      setElegido((i) => Math.min(lista.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && lista?.length) {
      e.preventDefault();
      setElegido((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape') setQ('');
  };
  const otros = recientes.filter((r) => r.sku !== abierto?.sku);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {abierto && <BotonVolver href="/inventario" label="Volver al buscador" />}
        <label className={unir('relative block min-w-0 flex-1', !abierto && 'sm:max-w-2xl')}>
          <span className="sr-only">Buscar un producto por nombre, código de barras o SKU</span>
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tinta/60">{buscando || yendo ? <Girador className="size-5" /> : <IconoLupa />}</span>
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoFocus={!abierto}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={teclas}
            placeholder={abierto ? 'Buscar otro producto' : 'Nombre, código de barras o SKU'}
            aria-controls="inventario-resultados"
            className={unir(
              'w-full appearance-none rounded-2xl border border-black/15 bg-white pl-12 pr-4 text-base text-tinta shadow-tarjeta outline-none transition-[border-color,box-shadow]',
              'placeholder:text-tinta/40 focus:border-marca focus:ring-4 focus:ring-marca/15',
              abierto ? 'min-h-11' : 'min-h-14 sm:text-lg',
            )}
          />
        </label>
      </div>

      <div id="inventario-resultados" aria-live="polite">
        {fallo && <p className="px-1 text-sm text-marca-hondo">No pude buscar. Probá de nuevo.</p>}
        {lista && lista.length === 0 && <p className="px-1 text-sm text-tinta/70">No encontré ningún producto con «{texto}».</p>}
        {lista && lista.length > 0 && (
          <Tarjeta relleno={false} className="overflow-hidden">
            <ul className="divide-y divide-black/[0.06]">
              {lista.map((r, i) => (
                <li key={r.sku}>
                  <Link
                    href={`/inventario?sku=${encodeURIComponent(r.sku)}`}
                    onClick={(e) => { e.preventDefault(); abrir(r.sku); }}
                    onMouseEnter={() => setElegido(i)}
                    className={unir('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5', i === elegido ? 'bg-crema-claro' : 'hover:bg-crema-claro', FOCO_ADENTRO)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-tinta">{r.nombre}</p>
                      <p className="truncate text-xs text-tinta/60">{[r.sku, r.rubro ?? 'sin rubro', !r.activo && 'dado de baja'].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex shrink-0 gap-5">
                      {r.stock.map((s, k) => (
                        <div key={s.sucursalId} className="sm:w-28 sm:text-right">
                          <p className="importe text-sm font-semibold text-tinta">{unidades(s.cantidad)}</p>
                          <p className="flex items-center gap-1.5 text-xs text-tinta/60 sm:justify-end"><Punto clase={tonoDeSucursal(k).fondo} />{s.sucursal}</p>
                        </div>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>

      {!lista && otros.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className={ROTULO}>{abierto ? 'También miraste' : 'Los últimos que miraste'}</p>
          {otros.slice(0, abierto ? 4 : 8).map((r) => (
            <Link
              key={r.sku}
              href={`/inventario?sku=${encodeURIComponent(r.sku)}`}
              className={unir('inline-flex min-h-9 max-w-full items-center rounded-full border border-black/15 bg-white px-3.5 text-sm font-medium text-tinta/70 hover:border-black/25 hover:text-tinta', FOCO)}
            >
              <span className="truncate">{r.nombre}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// La ficha
// ------------------------------------------------------------
const CLASE_PLEGADO = 'text-sm text-tinta/70';
const CLASE_RESUMEN = unir('inline-flex min-h-9 cursor-pointer items-center rounded-full font-medium text-tinta/70 hover:text-tinta', FOCO);

export function InventarioFicha({ ficha }: { ficha: FichaInventario }) {
  const p = ficha.producto;
  const [filtro, setFiltro] = useState('todas');
  const [todos, setTodos] = useState(false);

  const conStock = ficha.sucursales.reduce((t, s) => t + Math.max(0, s.stock), 0);
  const movimientos = filtro === 'todas' ? ficha.movimientos : ficha.movimientos.filter((mv) => mv.sucursalId === filtro);
  const visibles = todos ? movimientos : movimientos.slice(0, 6);
  const indiceDe = (id: string) => ficha.sucursales.findIndex((s) => s.id === id);
  const nombreDe = (id: string) => ficha.sucursales.find((s) => s.id === id)?.nombre ?? '';
  const cambios = ficha.movimientos.filter((mv) => mv.cambio !== 0).length;
  const sueltas = ficha.ventas.filter((v) => v.periodos.length === 1);
  const sinVentas = ficha.ventas.filter((v) => v.periodos.length === 0);
  const conHistoria = ficha.ventas.filter((v) => v.periodos.length >= 2);
  const plata = ficha.plata;
  const cambiosDePlata = plata
    ? [
        ...plata.precios.map((pt) => ({ en: pt.en, que: 'Precio de venta', valor: pt.valor, de: 'lista Minorista' })),
        ...plata.costos.map((pt) => ({ en: pt.en, que: 'Costo', valor: pt.valor, de: [pt.proveedor, pt.origen].filter(Boolean).join(' · ') })),
      ].sort((a, b) => Date.parse(b.en) - Date.parse(a.en))
    : [];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ---------- cuánto hay y dónde ---------- */}
      <Tarjeta>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight text-tinta sm:text-2xl">{p.nombre}</h2>
            <p className="mt-1 text-sm text-tinta/60">
              {[p.sku, p.marca, p.rubro].filter(Boolean).join(' · ')}
              {p.codigos.length > 0 && <> · código <span className="importe">{p.codigos[0]}</span>{p.codigos.length > 1 && ` y ${p.codigos.length - 1} más`}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!p.activo && <Etiqueta tono="neutro">Dado de baja</Etiqueta>}
            <BotonLink href={`/productos/${encodeURIComponent(p.sku)}`} variante="secundario" tamano="chico">Ficha del producto</BotonLink>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-10">
          <a href="#cuanto-hubo" className={unir('block rounded-xl', FOCO)}>
            <p className={ROTULO}>Hay en total</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="importe text-5xl font-bold leading-none text-tinta">{unidades(ficha.total)}</span>
              <span className="text-sm text-tinta/60">{p.porPeso ? 'kg' : ficha.total === 1 ? 'unidad' : 'unidades'}</span>
            </p>
          </a>

          <div className="min-w-0">
            {/* la barra: qué parte del stock está en cada sucursal */}
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-crema-hondo" role="img" aria-label={ficha.sucursales.map((s) => `${s.nombre}: ${unidades(s.stock, p.porPeso)}`).join(', ')}>
              {conStock > 0 && ficha.sucursales.map((s, i) => s.stock > 0 && (
                <span key={s.id} className={unir('h-full', tonoDeSucursal(i).fondo)} style={{ width: `${(s.stock / conStock) * 100}%` }} />
              ))}
            </div>
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {ficha.sucursales.map((s, i) => {
                const estado = estadoDeSucursal(s);
                const alcanza = cuantoAlcanza(s.coberturaDias);
                return (
                  <a key={s.id} href="#movimientos" onClick={() => { setFiltro(s.id); setTodos(false); }} className={unir('block rounded-xl', FOCO)}>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-tinta/70"><Punto clase={tonoDeSucursal(i).fondo} />{s.nombre}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="importe text-3xl font-bold leading-none text-tinta">{unidades(s.stock, p.porPeso)}</span>
                      <Etiqueta tono={estado.tono} punto>{estado.palabra}</Etiqueta>
                    </p>
                    <p className="mt-1.5 text-sm text-tinta/70">
                      {(s.ritmoDia ?? 0) > 0
                        ? <>Se vende {porDia(s.ritmoDia ?? 0)}{alcanza && s.stock > 0 ? `: ${alcanza}` : ''}{s.enCamino > 0 && alcanza ? ', contando lo que está en camino' : ''}.</>
                        : 'No tiene ventas cargadas en esta sucursal.'}
                    </p>
                    {(s.enCamino > 0 || s.ubicacion) && (
                      <p className="mt-0.5 text-sm text-tinta/60">
                        {[s.enCamino > 0 && `En camino: ${unidades(s.enCamino, p.porPeso)}`, s.ubicacion && `Está en ${s.ubicacion}`].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {ficha.proveedor && (
          <p className="mt-5 border-t border-black/[0.06] pt-3 text-sm text-tinta/60">
            Proveedor habitual: <span className="font-medium text-tinta/70">{ficha.proveedor.nombre}</span>. Entrega en {unidades(ficha.proveedor.plazoDias)} {ficha.proveedor.plazoDias === 1 ? 'día' : 'días'}
            {ficha.proveedor.plazoFuente ? ` (${ficha.proveedor.plazoFuente.replace(/:.*$/, '')})` : ''}.
          </p>
        )}
      </Tarjeta>

      {/* ---------- cuánto hubo ---------- */}
      <Tarjeta relleno={false} id="cuanto-hubo" className="scroll-mt-20">
        <TarjetaCabecera
          titulo="Cuánto hubo"
          sub={ficha.nivel.desde ? `El stock de cada sucursal desde el ${fecha(ficha.nivel.desde, 'completa')}: ${cambios === 1 ? 'un cambio' : `${cambios} cambios`}` : 'El stock de cada sucursal'}
          accion={<Leyenda items={ficha.sucursales.map((s, i) => ({ nombre: s.nombre, fondo: tonoDeSucursal(i).fondo }))} />}
        />
        <TarjetaCuerpo className="space-y-3">
          <GraficoNivel ficha={ficha} />
          <details className={CLASE_PLEGADO}>
            <summary className={CLASE_RESUMEN}>Cómo se lee</summary>
            <p className="mt-1 max-w-3xl">
              Cada escalón es un cambio de stock: una compra cargada, una venta hecha en ODB, un ajuste o una sincronización con el sistema viejo. Mientras una
              sucursal venda con el sistema viejo, sus ventas no se ven una por una: el stock baja de golpe en cada sincronización. El detalle de cada cambio está
              en <a href="#movimientos" className="font-medium text-tinta underline underline-offset-2">Qué pasó con el stock</a>.
            </p>
          </details>
        </TarjetaCuerpo>
      </Tarjeta>

      <div className={unir('grid gap-4 sm:gap-6', plata && 'xl:grid-cols-2')}>
        {/* ---------- cuánto se vende ---------- */}
        <Tarjeta relleno={false} id="cuanto-se-vende" className="scroll-mt-20">
          <TarjetaCabecera
            titulo="Cuánto se vende"
            sub={conHistoria.length
              ? `Unidades por día en cada período del sistema viejo${conHistoria.length === 1 ? ` · ${nombreDe(conHistoria[0].sucursalId)}` : ''}`
              : 'Las ventas del sistema viejo'}
          />
          <TarjetaCuerpo className="space-y-3">
            <GraficoVentas ficha={ficha} />
            {sueltas.map((v) => (
              <p key={v.sucursalId} className="flex items-baseline gap-1.5 text-sm text-tinta/70">
                <Punto clase={tonoDeSucursal(indiceDe(v.sucursalId)).fondo} />
                <span>
                  <span className="font-medium text-tinta">{nombreDe(v.sucursalId)}</span> tiene un solo período cargado: {periodoEnPalabras(v.periodos[0])} se
                  vendieron {unidades(v.periodos[0].unidades, p.porPeso)} ({porDia(v.periodos[0].porDia)}).
                </span>
              </p>
            ))}
            {sinVentas.map((v) => (
              <p key={v.sucursalId} className="flex items-baseline gap-1.5 text-sm text-tinta/60">
                <Punto clase={tonoDeSucursal(indiceDe(v.sucursalId)).fondo} />
                <span><span className="font-medium text-tinta/70">{nombreDe(v.sucursalId)}</span> no tiene ventas cargadas.</span>
              </p>
            ))}
            {conHistoria.map((v) => (
              <details key={v.sucursalId} className={CLASE_PLEGADO}>
                <summary className={CLASE_RESUMEN}>Ver los números{conHistoria.length > 1 ? ` de ${nombreDe(v.sucursalId)}` : ''}</summary>
                <TablaResponsiva
                  className="mt-2"
                  etiqueta={`Ventas por período de ${nombreDe(v.sucursalId)}`}
                  filas={[...v.periodos].reverse()}
                  claveFila="desde"
                  columnas={[
                    { clave: 'periodo', titulo: 'Período', principal: true, celda: (pd) => <span className="first-letter:uppercase">{periodoEnPalabras(pd)}</span> },
                    { clave: 'dias', titulo: 'Días', importe: true, celda: (pd) => pd.dias },
                    { clave: 'unidades', titulo: p.porPeso ? 'Kilos' : 'Unidades', importe: true, celda: (pd) => unidades(pd.unidades) },
                    { clave: 'pordia', titulo: 'Por día', importe: true, celda: (pd) => unidades(pd.porDia) },
                  ]}
                />
              </details>
            ))}
            {ficha.sucursales.some((s) => (s.ritmoDia ?? 0) > 0) && (
              <details className={CLASE_PLEGADO}>
                <summary className={CLASE_RESUMEN}>De dónde sale el ritmo de hoy</summary>
                <p className="mt-1">
                  Es la misma cuenta que usa Mesa de compras: el último período pesa 70 % y el anterior 30 %; si en ODB se vendió más en los últimos 30 días, vale eso.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {ficha.sucursales.filter((s) => (s.ritmoDia ?? 0) > 0).map((s) => (
                    <li key={s.id}>{s.nombre}: {porDia(s.ritmoDia ?? 0)}{s.ritmoFuente ? ` (${s.ritmoFuente})` : ''}.</li>
                  ))}
                </ul>
              </details>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {/* ---------- a cuánto se compra y a cuánto se vende (la caja no lo ve) ---------- */}
        {plata && (
          <Tarjeta relleno={false} id="costo-y-precio" className="scroll-mt-20">
            <TarjetaCabecera
              titulo="A cuánto se compra y a cuánto se vende"
              sub={[
                plata.precioHoy != null && `Hoy se vende a ${pesos(plata.precioHoy)}`,
                plata.costoHoy != null && `cuesta ${pesos(plata.costoHoy, { decimales: true })}`,
                plata.margenPct != null && `se le gana ${plata.margenPct} % sobre el costo`,
              ].filter(Boolean).join(' · ') || 'Todavía no tiene costo ni precio cargados'}
            />
            <TarjetaCuerpo className="space-y-3">
              {(plata.costos.length > 0 || plata.precios.length > 0) && (
                <Leyenda items={[
                  ...(plata.precios.length ? [{ nombre: 'Precio de venta (lista Minorista)', fondo: 'bg-tinta/70' }] : []),
                  ...(plata.costos.length ? [{ nombre: 'Costo de compra', fondo: 'bg-dato-3' }] : []),
                ]} />
              )}
              <GraficoPlata ficha={ficha} />
              {plata.mayoristaHoy != null && <p className="text-sm text-tinta/70">En la lista Mayorista está a <span className="importe font-medium text-tinta">{pesos(plata.mayoristaHoy)}</span>.</p>}
              {cambiosDePlata.length > 0 && (
                <details className={CLASE_PLEGADO}>
                  <summary className={CLASE_RESUMEN}>Ver los números</summary>
                  <TablaResponsiva
                    className="mt-2"
                    etiqueta="Cambios de costo y de precio"
                    filas={cambiosDePlata}
                    claveFila={(f, i) => `${f.en}-${f.que}-${i}`}
                    columnas={[
                      { clave: 'fecha', titulo: 'Fecha', celda: (f) => fecha(f.en, 'completa') },
                      { clave: 'que', titulo: 'Qué cambió', principal: true, celda: (f) => f.que },
                      { clave: 'valor', titulo: 'Quedó en', importe: true, celda: (f) => pesos(f.valor, { decimales: true }) },
                      { clave: 'de', titulo: 'De dónde salió', celda: (f) => f.de || '—', ocultarEnMovil: true },
                    ]}
                  />
                </details>
              )}
              {plata.compras.length > 0 && (
                <details className={CLASE_PLEGADO}>
                  <summary className={CLASE_RESUMEN}>Las últimas compras cargadas ({plata.compras.length})</summary>
                  <TablaResponsiva
                    className="mt-2"
                    etiqueta="Últimas compras cargadas"
                    filas={plata.compras}
                    claveFila={(c, i) => `${c.fecha}-${c.numero}-${i}`}
                    columnas={[
                      { clave: 'fecha', titulo: 'Fecha', celda: (c) => fecha(c.fecha, 'completa') },
                      { clave: 'proveedor', titulo: 'Proveedor', principal: true, celda: (c) => c.proveedor ?? '—' },
                      { clave: 'numero', titulo: 'Comprobante', celda: (c) => c.numero ?? '—', ocultarEnMovil: true },
                      { clave: 'unidades', titulo: p.porPeso ? 'Kilos' : 'Unidades', importe: true, celda: (c) => unidades(c.unidades) },
                      { clave: 'costo', titulo: 'Costo', importe: true, celda: (c) => (c.costo != null ? pesos(c.costo, { decimales: true }) : '—') },
                    ]}
                  />
                </details>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>

      {/* ---------- qué pasó con el stock ---------- */}
      <Tarjeta relleno={false} id="movimientos" className="scroll-mt-20">
        <TarjetaCabecera
          titulo="Qué pasó con el stock"
          sub={ficha.movimientos.length ? `${ficha.movimientos.length === 1 ? 'Un movimiento' : `${ficha.movimientos.length} movimientos`}, del más nuevo al más viejo` : undefined}
          accion={ficha.movimientos.length > 0 && ficha.sucursales.length > 1 && (
            <Chips
              etiqueta="Sucursal"
              valor={filtro}
              onCambiar={(v) => { setFiltro(v); setTodos(false); }}
              opciones={[{ valor: 'todas', etiqueta: 'Todas' }, ...ficha.sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))]}
            />
          )}
        />
        {movimientos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-tinta/60 sm:px-5">
            {ficha.movimientos.length ? `No hubo movimientos en ${nombreDe(filtro)}.` : 'Todavía no hay movimientos de este producto.'}
          </p>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {visibles.map((mv) => (
              <li key={mv.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className="mt-1.5"><Punto clase={tonoDeSucursal(indiceDe(mv.sucursalId)).fondo} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-tinta">{mv.que} <span className="font-normal text-tinta/60">· {nombreDe(mv.sucursalId)}</span></p>
                  <p className="text-xs text-tinta/60">{[fechaHora(mv.en, { conAnio: true }), mv.quien, mv.motivo].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="importe text-sm font-semibold text-tinta">{mv.cambio === 0 ? 'sin cambio' : conSigno(mv.cambio, p.porPeso)}</p>
                  <p className="importe text-xs text-tinta/60">{mv.cambio === 0 ? 'había' : mv.saldo === 1 ? 'quedó' : 'quedaron'} {unidades(mv.saldo, p.porPeso)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {movimientos.length > 6 && (
          <div className="border-t border-black/[0.06] px-4 py-2 sm:px-5">
            <button type="button" onClick={() => setTodos((v) => !v)} className={unir('min-h-9 rounded-full text-sm font-medium text-tinta/70 hover:text-tinta', FOCO)}>
              {todos ? 'Mostrar solo los últimos 6' : `Ver los ${movimientos.length} movimientos`}
            </button>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
