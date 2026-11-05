'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { FOCO, unir } from './kit';
import { fecha, hora, pesos } from '../lib/formato';
import {
  caminoEscalonado, conSigno, escala, inicioDelDia, marcasDeTiempo, marcasDelEje, nivelEn, periodoEnPalabras, porDia,
  separarRotulos, unidades, valorEn,
  type FichaInventario, type MarcaDeTiempo, type MovimientoInventario, type PuntoPlata,
} from '../lib/inventario';

// ============================================================
// Los tres gráficos de «Inventario de producto» (5/11/2026), dibujados en SVG
// al ancho real de la tarjeta (el texto no se estira ni se achica):
//  - GraficoNivel: cuánto hubo en cada sucursal, en escalones.
//  - GraficoVentas: cuánto se vendió por día en cada período del sistema viejo.
//  - GraficoPlata: a cuánto se compra y a cuánto se vende.
// Un solo eje por gráfico. Al pasar el mouse, tocar o moverse con las flechas
// aparece el detalle de ese punto; los números enteros están en la tabla de
// cada tarjeta. Los tonos de los datos son los de globals.css (dato-1/2/3).
// ============================================================

// 1 y 2 son las sucursales, en el orden en que las manda el servidor; una
// tercera no inventa un color: va en gris. Las clases van escritas enteras
// para que Tailwind las encuentre.
const TONOS = [
  { trazo: 'stroke-dato-1', relleno: 'fill-dato-1', fondo: 'bg-dato-1' },
  { trazo: 'stroke-dato-2', relleno: 'fill-dato-2', fondo: 'bg-dato-2' },
];
const TONO_GRIS = { trazo: 'stroke-tinta/60', relleno: 'fill-tinta/60', fondo: 'bg-tinta/60' };
export const tonoDeSucursal = (indice: number) => TONOS[indice] ?? TONO_GRIS;

const DIA = 86_400_000;
const CLASE_EJE = 'importe fill-tinta/60 text-xs';
const CLASE_ROTULO = 'importe fill-tinta text-xs font-semibold';

function useAncho(ref: RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.round(el.clientWidth));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [ref]);
  return ancho;
}

/** Las flechas mueven el detalle de un punto al otro; Escape lo saca. */
function teclasDe(cuantos: number, activa: number | null, elegir: (i: number | null) => void) {
  return (e: KeyboardEvent) => {
    if (!cuantos) return;
    const desde = activa ?? cuantos - 1;
    const destino =
      e.key === 'ArrowLeft' ? (activa == null ? cuantos - 1 : Math.max(0, desde - 1))
        : e.key === 'ArrowRight' ? (activa == null ? 0 : Math.min(cuantos - 1, desde + 1))
          : e.key === 'Home' ? 0
            : e.key === 'End' ? cuantos - 1
              : null;
    if (destino != null) {
      e.preventDefault();
      elegir(destino);
    } else if (e.key === 'Escape') elegir(null);
  };
}

/** El cartel con el detalle de un punto: al costado de la línea, sin salirse de la tarjeta. */
function Globo({ x, ancho, arriba, children }: { x: number; ancho: number; arriba: number; children: ReactNode }) {
  const w = Math.min(236, ancho - 8);
  const izquierda = x + 12 + w <= ancho - 4 ? x + 12 : Math.max(4, x - 12 - w);
  return (
    <div
      className="pointer-events-none absolute z-contenido space-y-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs leading-snug text-tinta shadow-flotante"
      style={{ left: izquierda, top: arriba, width: w }}
    >
      {children}
    </div>
  );
}

function Punto({ clase }: { clase: string }) {
  return <span className={unir('inline-block size-2 shrink-0 rounded-full', clase)} aria-hidden="true" />;
}

/** La referencia de colores: una raya del color de cada serie con su nombre. */
export function Leyenda({ items }: { items: { nombre: ReactNode; fondo: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta/70">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span className={unir('inline-block h-0.5 w-4 shrink-0 rounded-full', it.fondo)} aria-hidden="true" />
          {it.nombre}
        </li>
      ))}
    </ul>
  );
}

function EjeTiempo({ marcas, x, y, alto }: { marcas: MarcaDeTiempo[]; x: (ms: number) => number; y: number; alto: number }) {
  return (
    <g aria-hidden="true">
      {marcas.map((m) => (
        <g key={m.ms}>
          <line x1={x(m.ms)} x2={x(m.ms)} y1={y} y2={y + 4} className="stroke-black/20" />
          <text x={x(m.ms)} y={y + alto - 6} textAnchor="middle" className={CLASE_EJE}>{m.etiqueta}</text>
        </g>
      ))}
    </g>
  );
}

function EjeCantidad({ marcas, y, x0, x1, texto }: { marcas: number[]; y: (v: number) => number; x0: number; x1: number; texto: (v: number) => string }) {
  return (
    <g aria-hidden="true">
      {marcas.map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-black/25' : 'stroke-black/[0.07]'} />
          <text x={x0 - 8} y={y(v)} dominantBaseline="middle" textAnchor="end" className={CLASE_EJE}>{texto(v)}</text>
        </g>
      ))}
    </g>
  );
}

const CLASE_CAJA = unir('relative w-full touch-pan-y select-none rounded-xl', FOCO);

// ------------------------------------------------------------
// Cuánto hubo: el stock de cada sucursal, en escalones
// ------------------------------------------------------------
export function GraficoNivel({ ficha }: { ficha: FichaInventario }) {
  const caja = useRef<HTMLDivElement>(null);
  const ancho = useAncho(caja);
  const [activa, setActiva] = useState<number | null>(null);
  const porPeso = ficha.producto.porPeso;

  const hasta = Date.parse(ficha.nivel.hasta);
  const primero = ficha.nivel.desde ? Date.parse(ficha.nivel.desde) : hasta - 30 * DIA;
  const desde = primero - Math.max(2 * DIA, (hasta - primero) * 0.03);

  // dónde se para el detalle: en cada cambio de stock (lo del mismo minuto va junto) y en hoy
  const paradas: { ms: number; movimientos: MovimientoInventario[] }[] = [];
  for (const mv of [...ficha.movimientos].filter((v) => v.cambio !== 0).sort((a, b) => a.id - b.id)) {
    const ms = Date.parse(mv.en);
    const ultima = paradas[paradas.length - 1];
    if (ultima && ms - ultima.ms < 60_000) {
      ultima.movimientos.push(mv);
      ultima.ms = ms;
    } else paradas.push({ ms, movimientos: [mv] });
  }
  paradas.push({ ms: hasta, movimientos: [] });

  const valores = ficha.nivel.series.flatMap((s) => [s.inicial, ...s.puntos.map((p) => p.saldo)]);
  const marcas = marcasDelEje(Math.min(0, ...valores), Math.max(0, ...valores), 4);
  const alto = ancho < 520 ? 220 : 270;
  const m = { arriba: 14, derecha: 54, abajo: 30, izquierda: 44 };
  const x = escala(desde, hasta, m.izquierda, Math.max(m.izquierda + 1, ancho - m.derecha));
  const y = escala(marcas[0], marcas[marcas.length - 1], alto - m.abajo, m.arriba);
  const nombreDe = (id: string) => ficha.sucursales.find((s) => s.id === id)?.nombre ?? '';
  const indiceDe = (id: string) => ficha.sucursales.findIndex((s) => s.id === id);
  const yFinal = separarRotulos(ficha.nivel.series.map((s) => y(nivelEn(s, hasta))), 15, m.arriba + 6, alto - m.abajo - 2);

  const mover = (e: PointerEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.ownerSVGElement!.getBoundingClientRect().left;
    let mejor = 0;
    paradas.forEach((p, i) => { if (Math.abs(x(p.ms) - px) < Math.abs(x(paradas[mejor].ms) - px)) mejor = i; });
    setActiva(mejor);
  };
  const p = activa != null ? paradas[activa] : null;
  const esHoy = activa === paradas.length - 1;

  return (
    <div
      ref={caja}
      className={CLASE_CAJA}
      tabIndex={0}
      role="group"
      aria-label="Gráfico del stock en el tiempo. Con las flechas se recorre cada cambio."
      onKeyDown={teclasDe(paradas.length, activa, setActiva)}
      onBlur={() => setActiva(null)}
    >
      {ancho > 0 && (
        <svg width={ancho} height={alto} className="block overflow-visible">
          <EjeCantidad marcas={marcas} y={y} x0={m.izquierda} x1={ancho - m.derecha} texto={(v) => unidades(v)} />
          <EjeTiempo marcas={marcasDeTiempo(desde, hasta, ancho < 520 ? 4 : 7)} x={x} y={alto - m.abajo} alto={m.abajo} />
          {p && <line x1={x(p.ms)} x2={x(p.ms)} y1={m.arriba} y2={alto - m.abajo} className="stroke-tinta/30" />}
          {ficha.nivel.series.map((s, i) => {
            const tono = tonoDeSucursal(indiceDe(s.sucursalId));
            const puntos = [{ x: x(desde), y: y(s.inicial) }, ...s.puntos.map((pt) => ({ x: x(Date.parse(pt.en)), y: y(pt.saldo) }))];
            const fin = nivelEn(s, hasta);
            return (
              <g key={s.sucursalId}>
                <path d={caminoEscalonado(puntos, x(hasta))} pathLength={1} fill="none" strokeWidth={2} strokeLinejoin="round" className={unir(tono.trazo, 'animate-trazo motion-reduce:animate-none')} />
                <circle cx={x(hasta)} cy={y(fin)} r={4} strokeWidth={2} className={unir(tono.relleno, 'stroke-white')} />
                <text x={x(hasta) + 9} y={yFinal[i]} dominantBaseline="middle" className={CLASE_ROTULO}>{unidades(fin)}</text>
                {p && !esHoy && <circle cx={x(p.ms)} cy={y(nivelEn(s, p.ms))} r={4.5} strokeWidth={2} className={unir(tono.relleno, 'stroke-white')} />}
              </g>
            );
          })}
          <rect
            x={m.izquierda} y={0} width={Math.max(0, ancho - m.izquierda)} height={alto} fill="transparent"
            onPointerMove={mover} onPointerDown={mover} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActiva(null); }}
          />
        </svg>
      )}
      {ancho > 0 && p && (
        <Globo x={x(p.ms)} ancho={ancho} arriba={m.arriba}>
          <p className="font-semibold">{esHoy ? 'Hoy' : `${fecha(p.ms, 'completa')} · ${hora(p.ms)}`}</p>
          {p.movimientos.map((mv) => (
            <p key={mv.id} className="flex items-baseline gap-1.5">
              <Punto clase={tonoDeSucursal(indiceDe(mv.sucursalId)).fondo} />
              <span className="min-w-0 flex-1">{mv.que}</span>
              <span className="importe font-semibold">{conSigno(mv.cambio, porPeso)}</span>
            </p>
          ))}
          <div className="space-y-0.5 border-t border-black/[0.06] pt-1 text-tinta/70">
            {ficha.nivel.series.map((s) => (
              <p key={s.sucursalId} className="flex items-baseline gap-1.5">
                <Punto clase={tonoDeSucursal(indiceDe(s.sucursalId)).fondo} />
                <span className="min-w-0 flex-1">{esHoy ? 'Hay' : 'Quedaron'} en {nombreDe(s.sucursalId)}</span>
                <span className="importe font-semibold text-tinta">{unidades(nivelEn(s, p.ms), porPeso)}</span>
              </p>
            ))}
          </div>
        </Globo>
      )}
      <p className="sr-only" aria-live="polite">
        {p ? `${esHoy ? 'Hoy' : fecha(p.ms, 'completa')}. ${p.movimientos.map((mv) => `${mv.que} en ${nombreDe(mv.sucursalId)}: ${conSigno(mv.cambio, porPeso)}`).join('. ')} ${ficha.nivel.series.map((s) => `${nombreDe(s.sucursalId)}: ${unidades(nivelEn(s, p.ms), porPeso)}`).join(', ')}.` : ''}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// Cuánto se vende: unidades por día en cada período del sistema viejo
// ------------------------------------------------------------
export function GraficoVentas({ ficha }: { ficha: FichaInventario }) {
  const caja = useRef<HTMLDivElement>(null);
  const ancho = useAncho(caja);
  const [activa, setActiva] = useState<number | null>(null);
  const porPeso = ficha.producto.porPeso;

  // un panel por sucursal con historia (dos períodos o más); todos con la misma escala
  const paneles = ficha.ventas
    .map((v) => ({ ...v, indice: ficha.sucursales.findIndex((s) => s.id === v.sucursalId), sucursal: ficha.sucursales.find((s) => s.id === v.sucursalId) }))
    .filter((v) => v.periodos.length >= 2 && v.sucursal);
  if (!paneles.length) return null;

  const todos = paneles.flatMap((v) => v.periodos);
  const desde = Math.min(...todos.map((pd) => inicioDelDia(pd.desde)));
  const hasta = Math.max(...todos.map((pd) => inicioDelDia(pd.hasta) + DIA));
  const ritmos = paneles.map((v) => v.sucursal?.ritmoDia ?? 0);
  const marcas = marcasDelEje(0, Math.max(...todos.map((pd) => pd.porDia), ...ritmos), 3);
  const alto = ancho < 520 ? 170 : 200;
  const m = { arriba: 16, derecha: 10, abajo: 30, izquierda: 44 };
  const x = escala(desde, hasta, m.izquierda, Math.max(m.izquierda + 1, ancho - m.derecha));
  const y = escala(0, marcas[marcas.length - 1], alto - m.abajo, m.arriba);
  // las barras de todos los paneles, de corrido, para recorrerlas con las flechas
  const barras = paneles.flatMap((v, panel) => v.periodos.map((pd) => ({ panel, pd, x0: x(inicioDelDia(pd.desde)) + 1, x1: x(inicioDelDia(pd.hasta) + DIA) - 1 })));
  const b = activa != null ? barras[activa] : null;

  return (
    <div
      ref={caja}
      className={unir(CLASE_CAJA, 'space-y-3')}
      tabIndex={0}
      role="group"
      aria-label="Gráfico de unidades vendidas por día en cada período. Con las flechas se recorre cada período."
      onKeyDown={teclasDe(barras.length, activa, setActiva)}
      onBlur={() => setActiva(null)}
    >
      {ancho > 0 && paneles.map((v, panel) => {
        const tono = tonoDeSucursal(v.indice);
        const ritmo = v.sucursal?.ritmoDia ?? 0;
        return (
          <div key={v.sucursalId} className="relative">
            {paneles.length > 1 && <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-tinta/70"><Punto clase={tono.fondo} />{v.sucursal?.nombre}</p>}
            <svg width={ancho} height={alto} className="block overflow-visible">
              <EjeCantidad marcas={marcas} y={y} x0={m.izquierda} x1={ancho - m.derecha} texto={(val) => unidades(val)} />
              <EjeTiempo marcas={marcasDeTiempo(desde, hasta, ancho < 520 ? 4 : 7)} x={x} y={alto - m.abajo} alto={m.abajo} />
              {barras.map((br, i) => {
                if (br.panel !== panel) return null;
                const w = Math.max(1, br.x1 - br.x0);
                const tope = y(br.pd.porDia), base = y(0);
                const r = Math.min(4, w / 2, base - tope);
                return (
                  <g key={br.pd.desde}>
                    {br.pd.porDia > 0 && (
                      <path
                        d={`M${br.x0} ${base}V${tope + r}Q${br.x0} ${tope} ${br.x0 + r} ${tope}H${br.x0 + w - r}Q${br.x0 + w} ${tope} ${br.x0 + w} ${tope + r}V${base}Z`}
                        className={unir(tono.relleno, 'origin-bottom animate-crece transition-opacity [transform-box:fill-box] motion-reduce:animate-none', activa != null && activa !== i && 'opacity-55')}
                      />
                    )}
                    <rect
                      x={br.x0 - 1} y={0} width={w + 2} height={alto - m.abajo} fill="transparent"
                      onPointerEnter={() => setActiva(i)} onPointerDown={() => setActiva(i)}
                      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActiva(null); }}
                    />
                  </g>
                );
              })}
              {ritmo > 0 && (
                <g aria-hidden="true" className="pointer-events-none">
                  <line x1={m.izquierda} x2={ancho - m.derecha} y1={y(ritmo)} y2={y(ritmo)} strokeDasharray="4 4" className="stroke-tinta/50" />
                  <text x={ancho - m.derecha} y={y(ritmo) - 6} textAnchor="end" strokeWidth={4} className="importe fill-tinta stroke-white text-xs font-semibold [paint-order:stroke]">
                    Ritmo de hoy: {porDia(ritmo)}
                  </text>
                </g>
              )}
            </svg>
            {b && b.panel === panel && (
              <Globo x={(b.x0 + b.x1) / 2} ancho={ancho} arriba={(paneles.length > 1 ? 20 : 0) + m.arriba}>
                <p className="font-semibold first-letter:uppercase">{periodoEnPalabras(b.pd)}</p>
                <p className="flex items-baseline gap-1.5">
                  <Punto clase={tono.fondo} />
                  <span className="min-w-0 flex-1">{unidades(b.pd.unidades, porPeso)} {porPeso ? '' : b.pd.unidades === 1 ? 'unidad ' : 'unidades '}en {b.pd.dias} {b.pd.dias === 1 ? 'día' : 'días'}</span>
                </p>
                <p className="importe font-semibold">{porDia(b.pd.porDia)}</p>
              </Globo>
            )}
          </div>
        );
      })}
      <p className="sr-only" aria-live="polite">
        {b ? `${paneles[b.panel].sucursal?.nombre}, ${periodoEnPalabras(b.pd)}: ${unidades(b.pd.unidades, porPeso)} en ${b.pd.dias} días, ${porDia(b.pd.porDia)}.` : ''}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// A cuánto se compra y a cuánto se vende: dos escalones y, entre los dos, lo que se gana
// ------------------------------------------------------------
export function GraficoPlata({ ficha }: { ficha: FichaInventario }) {
  const caja = useRef<HTMLDivElement>(null);
  const ancho = useAncho(caja);
  const [activa, setActiva] = useState<number | null>(null);
  const costos = ficha.plata?.costos ?? [];
  const precios = ficha.plata?.precios ?? [];
  if (!costos.length && !precios.length) return null;

  const hasta = Date.parse(ficha.nivel.hasta);
  const tiempos = [...new Set([...costos, ...precios].map((pt) => Date.parse(pt.en)))].sort((a, c) => a - c);
  const primero = tiempos[0];
  const desde = primero - Math.max(2 * DIA, (hasta - primero) * 0.03);
  const paradas = [...tiempos, hasta];
  const marcas = marcasDelEje(0, Math.max(...costos.map((c) => c.valor), ...precios.map((pr) => pr.valor)), 4);
  const alto = ancho < 520 ? 220 : 250;
  const m = { arriba: 14, derecha: 64, abajo: 30, izquierda: 62 };
  const x = escala(desde, hasta, m.izquierda, Math.max(m.izquierda + 1, ancho - m.derecha));
  const y = escala(0, marcas[marcas.length - 1], alto - m.abajo, m.arriba);
  const camino = (puntos: PuntoPlata[]) => caminoEscalonado(puntos.map((pt) => ({ x: x(Date.parse(pt.en)), y: y(pt.valor) })), x(hasta));
  const costoHoy = costos.length ? costos[costos.length - 1].valor : null;
  const precioHoy = precios.length ? precios[precios.length - 1].valor : null;
  const yFinal = separarRotulos([precioHoy, costoHoy].map((v) => (v == null ? -1000 : y(v))), 15, m.arriba + 6, alto - m.abajo - 2);

  const mover = (e: PointerEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.ownerSVGElement!.getBoundingClientRect().left;
    let mejor = 0;
    paradas.forEach((ms, i) => { if (Math.abs(x(ms) - px) < Math.abs(x(paradas[mejor]) - px)) mejor = i; });
    setActiva(mejor);
  };
  const ms = activa != null ? paradas[activa] : null;
  const esHoy = activa === paradas.length - 1;
  const costoAhi = ms != null ? valorEn(costos, ms) : null;
  const precioAhi = ms != null ? valorEn(precios, ms) : null;
  const margenAhi = costoAhi && precioAhi && costoAhi.valor > 0 ? Math.round(((precioAhi.valor - costoAhi.valor) / costoAhi.valor) * 100) : null;

  return (
    <div
      ref={caja}
      className={CLASE_CAJA}
      tabIndex={0}
      role="group"
      aria-label="Gráfico del costo de compra y del precio de venta en el tiempo. Con las flechas se recorre cada cambio."
      onKeyDown={teclasDe(paradas.length, activa, setActiva)}
      onBlur={() => setActiva(null)}
    >
      {ancho > 0 && (
        <svg width={ancho} height={alto} className="block overflow-visible">
          <EjeCantidad marcas={marcas} y={y} x0={m.izquierda} x1={ancho - m.derecha} texto={(v) => pesos(v)} />
          <EjeTiempo marcas={marcasDeTiempo(desde, hasta, ancho < 520 ? 4 : 6)} x={x} y={alto - m.abajo} alto={m.abajo} />
          {/* entre el precio y el costo, lo que se gana */}
          {paradas.slice(0, -1).map((t, i) => {
            const c = valorEn(costos, t), pr = valorEn(precios, t);
            if (!c || !pr) return null;
            const arriba = Math.min(y(c.valor), y(pr.valor));
            return <rect key={t} x={x(t)} y={arriba} width={Math.max(0, x(paradas[i + 1]) - x(t))} height={Math.abs(y(c.valor) - y(pr.valor))} className="fill-dato-3/10" />;
          })}
          {ms != null && <line x1={x(ms)} x2={x(ms)} y1={m.arriba} y2={alto - m.abajo} className="stroke-tinta/30" />}
          {precios.length > 0 && <path d={camino(precios)} pathLength={1} fill="none" strokeWidth={2} strokeLinejoin="round" className="animate-trazo stroke-tinta/70 motion-reduce:animate-none" />}
          {costos.length > 0 && <path d={camino(costos)} pathLength={1} fill="none" strokeWidth={2} strokeLinejoin="round" className="animate-trazo stroke-dato-3 motion-reduce:animate-none" />}
          {precioHoy != null && (
            <g>
              <circle cx={x(hasta)} cy={y(precioHoy)} r={4} strokeWidth={2} className="fill-tinta/70 stroke-white" />
              <text x={x(hasta) + 9} y={yFinal[0]} dominantBaseline="middle" className={CLASE_ROTULO}>{pesos(precioHoy)}</text>
            </g>
          )}
          {costoHoy != null && (
            <g>
              <circle cx={x(hasta)} cy={y(costoHoy)} r={4} strokeWidth={2} className="fill-dato-3 stroke-white" />
              <text x={x(hasta) + 9} y={yFinal[1]} dominantBaseline="middle" className={CLASE_ROTULO}>{pesos(costoHoy)}</text>
            </g>
          )}
          {ms != null && !esHoy && precioAhi && <circle cx={x(ms)} cy={y(precioAhi.valor)} r={4.5} strokeWidth={2} className="fill-tinta/70 stroke-white" />}
          {ms != null && !esHoy && costoAhi && <circle cx={x(ms)} cy={y(costoAhi.valor)} r={4.5} strokeWidth={2} className="fill-dato-3 stroke-white" />}
          <rect
            x={m.izquierda} y={0} width={Math.max(0, ancho - m.izquierda)} height={alto} fill="transparent"
            onPointerMove={mover} onPointerDown={mover} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActiva(null); }}
          />
        </svg>
      )}
      {ancho > 0 && ms != null && (
        <Globo x={x(ms)} ancho={ancho} arriba={m.arriba}>
          <p className="font-semibold">{esHoy ? 'Hoy' : fecha(ms, 'completa')}</p>
          {precioAhi && (
            <p className="flex items-baseline gap-1.5">
              <Punto clase="bg-tinta/70" />
              <span className="min-w-0 flex-1">Precio de venta</span>
              <span className="importe font-semibold">{pesos(precioAhi.valor)}</span>
            </p>
          )}
          {costoAhi && (
            <div>
              <p className="flex items-baseline gap-1.5">
                <Punto clase="bg-dato-3" />
                <span className="min-w-0 flex-1">Costo</span>
                <span className="importe font-semibold">{pesos(costoAhi.valor, { decimales: true })}</span>
              </p>
              {(costoAhi.proveedor || costoAhi.origen) && <p className="pl-3.5 text-tinta/60">{[costoAhi.proveedor, costoAhi.origen].filter(Boolean).join(' · ')}</p>}
            </div>
          )}
          {margenAhi != null && <p className="border-t border-black/[0.06] pt-1 text-tinta/70">Se le gana <span className="importe font-semibold text-tinta">{margenAhi} %</span> sobre el costo</p>}
        </Globo>
      )}
      <p className="sr-only" aria-live="polite">
        {ms != null ? `${esHoy ? 'Hoy' : fecha(ms, 'completa')}. ${precioAhi ? `Precio de venta ${pesos(precioAhi.valor)}. ` : ''}${costoAhi ? `Costo ${pesos(costoAhi.valor, { decimales: true })}. ` : ''}${margenAhi != null ? `Margen ${margenAhi} por ciento.` : ''}` : ''}
      </p>
    </div>
  );
}
