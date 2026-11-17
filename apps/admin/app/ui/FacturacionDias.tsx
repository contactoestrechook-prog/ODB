'use client';

// Facturación › «Facturado por día» (17/11/2026). Columnas por día del mes,
// apiladas por sucursal (los colores fijos de las sucursales: dato-1 Sant
// Thomas, dato-2 Santa Inés), y el mismo día del mes anterior como línea gris.
// Los días que todavía no llegaron del sistema anterior van rayados, para que
// el mes no parezca «parado». Se dibuja en píxeles reales (ResizeObserver): con
// un viewBox que se estira, en el celular los números del eje quedaban de 6 px.

import { useEffect, useMemo, useRef, useState } from 'react';
import { pesos } from '../lib/formato';
import { unir } from './kit';

export type DiaSucursales = { dia: number; fecha: string; st: number; si: number; otros: number; comprobantes: number };
export type DiaAnterior = { dia: number; fecha: string; neto: number };

const SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const diaCorto = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${SEMANA[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};

// «$ 2 millones», «$ 500 mil»: sin M ni k (en Argentina «M» se lee miles)
export function montoEje(n: number): string {
  if (n === 0) return '$ 0';
  if (n >= 1e6) {
    const v = n / 1e6;
    const t = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
    return `$ ${t} ${v === 1 ? 'millón' : 'millones'}`;
  }
  if (n >= 1e3) return `$ ${Math.round(n / 1e3)} mil`;
  return pesos(n);
}

// Tope del eje redondo: 1, 2, 2,5 o 5 por potencia de diez
function topeLindo(max: number): { tope: number; paso: number } {
  if (max <= 0) return { tope: 1e6, paso: 5e5 };
  const pot = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const paso = (m * pot) / 2;
    if (paso * 4 >= max) {
      const pasos = Math.ceil(max / paso);
      return { tope: pasos * paso, paso };
    }
  }
  return { tope: 10 * pot, paso: 2.5 * pot };
}

const IZQ = 92; // lugar para «$ 2,5 millones»
const ABAJO = 26;

export function FacturacionDias({
  dias,
  anterior,
  dibujarHasta,
  hoyDia,
  mostrarSucursales,
  nombreAnterior,
  onElegirDia,
  diaElegido,
}: {
  dias: DiaSucursales[];
  anterior: DiaAnterior[];
  /** Último día con datos: los siguientes van rayados. */
  dibujarHasta: number;
  /** Si el mes es el actual, el día de hoy (para cortar la raya). */
  hoyDia: number | null;
  mostrarSucursales: { st: boolean; si: boolean };
  nombreAnterior: string;
  onElegirDia?: (fecha: string) => void;
  diaElegido?: string | null;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(720);
  const [encima, setEncima] = useState<number | null>(null);
  useEffect(() => {
    if (!caja.current) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(caja.current);
    return () => ro.disconnect();
  }, []);

  const alto = ancho < 520 ? 210 : 300;
  // en el celular los montos van adentro, arriba de cada raya: al costado no entran
  const angosto = ancho < 520;
  const izq = angosto ? 4 : IZQ;
  const ARRIBA = angosto ? 20 : 10; // lugar para el monto de la raya de arriba
  const n = dias.length;
  const banda = (ancho - izq - 8) / n;
  const barra = Math.max(4, Math.min(22, banda * 0.66));
  const totalDia = (d: DiaSucursales) => Math.max(0, d.st + d.si + d.otros);
  const { tope, paso } = useMemo(() => {
    const max = Math.max(...dias.map(totalDia), ...anterior.map((d) => Math.max(0, d.neto)), 0);
    return topeLindo(max);
  }, [dias, anterior]);
  const alturaUtil = alto - ARRIBA - ABAJO;
  const y = (v: number) => ARRIBA + alturaUtil - (Math.max(0, v) / tope) * alturaUtil;
  const xCentro = (i: number) => izq + banda * i + banda / 2;
  const marcas: number[] = [];
  for (let v = 0; v <= tope + 1; v += paso) marcas.push(v);
  // en el celular, un número de día cada tanto
  const cadaCuanto = banda >= 20 ? 1 : banda >= 11 ? 2 : 5;

  // la línea del mes anterior, día por día (hasta donde tenga días)
  const linea = anterior
    .filter((d) => d.dia <= n)
    .map((d) => `${xCentro(d.dia - 1).toFixed(1)},${y(d.neto).toFixed(1)}`)
    .join(' ');

  const finDatos = Math.min(dibujarHasta, n);
  const finRaya = hoyDia != null ? Math.min(n, hoyDia) : n;
  const d = encima != null ? dias[encima] : null;
  const ant = encima != null ? anterior.find((a) => a.dia === encima + 1) : null;

  // columna con la punta redondeada (4 px) y la base recta
  const columna = (x: number, y0: number, y1: number, redondo: boolean) => {
    const h = y0 - y1;
    if (h <= 0) return '';
    const r = redondo ? Math.min(4, h, barra / 2) : 0;
    const x0 = x - barra / 2;
    const x1 = x + barra / 2;
    return `M${x0},${y0} L${x0},${y1 + r} Q${x0},${y1} ${x0 + r},${y1} L${x1 - r},${y1} Q${x1},${y1} ${x1},${y1 + r} L${x1},${y0} Z`;
  };

  return (
    <div ref={caja} className="relative w-full select-none" onMouseLeave={() => setEncima(null)}>
      <svg width={ancho} height={alto} role="img" aria-label="Facturado por día del mes, con el mes anterior como referencia" className="block">
        <defs>
          <pattern id="raya-sin-datos" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.5" className="text-tinta/10" />
          </pattern>
        </defs>

        {/* eje: rayas finas y montos en palabras */}
        {marcas.map((v) => (
          <g key={v}>
            <line x1={izq} x2={ancho - 4} y1={y(v)} y2={y(v)} className="stroke-black/[0.07]" strokeWidth={1} />
            {!angosto && <text x={izq - 8} y={y(v) + 4} textAnchor="end" className="fill-tinta/60 text-xs">{montoEje(v)}</text>}
          </g>
        ))}

        {/* días que todavía no llegaron del sistema anterior */}
        {finDatos < finRaya && (
          <g>
            <rect x={izq + banda * finDatos} y={ARRIBA} width={banda * (finRaya - finDatos)} height={alturaUtil} fill="url(#raya-sin-datos)" />
            {banda * (finRaya - finDatos) > 120 && (
              <text x={izq + banda * finDatos + (banda * (finRaya - finDatos)) / 2} y={ARRIBA + 18} textAnchor="middle" className="fill-tinta/60 text-xs">
                Todavía sin datos
              </text>
            )}
          </g>
        )}

        {/* día elegido o bajo el mouse */}
        {dias.map((dd, i) =>
          encima === i || diaElegido === dd.fecha ? (
            <rect key={`f${i}`} x={izq + banda * i} y={ARRIBA} width={banda} height={alturaUtil} className={diaElegido === dd.fecha ? 'fill-marca/10' : 'fill-tinta/[0.04]'} />
          ) : null,
        )}

        {/* columnas: Sant Thomas abajo, Santa Inés arriba; 2 px de aire entre las dos */}
        {dias.map((dd, i) => {
          const x = xCentro(i);
          const st = mostrarSucursales.st ? Math.max(0, dd.st) : 0;
          const si = mostrarSucursales.si ? Math.max(0, dd.si) : 0;
          const otros = Math.max(0, dd.otros);
          const base = y(0);
          const yStTop = y(st);
          const ySiTop = y(st + si);
          const yOtTop = y(st + si + otros);
          const tapa = otros > 0 ? 'otros' : si > 0 ? 'si' : 'st';
          return (
            <g key={i}>
              {st > 0 && <path d={columna(x, base, yStTop, tapa === 'st')} className="fill-dato-1" />}
              {si > 0 && <path d={columna(x, (st > 0 ? yStTop - 2 : base), ySiTop, tapa === 'si')} className="fill-dato-2" />}
              {otros > 0 && <path d={columna(x, ySiTop - (st + si > 0 ? 2 : 0), yOtTop, true)} className="fill-tinta/50" />}
            </g>
          );
        })}

        {/* el mes anterior: línea gris de 2 px */}
        {linea && <polyline points={linea} fill="none" className="stroke-tinta/35" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

        {/* celular: los montos arriba de las columnas, con un borde blanco para leerse */}
        {angosto && marcas.filter((v) => v > 0).map((v) => (
          <text key={`m${v}`} x={izq} y={y(v) - 5} textAnchor="start" className="fill-tinta/60 stroke-white text-xs" strokeWidth={3} paintOrder="stroke">{montoEje(v)}</text>
        ))}

        {/* números de día */}
        {dias.map((dd, i) =>
          (i + 1) % cadaCuanto === 0 || i === 0 ? (
            <text key={`t${i}`} x={xCentro(i)} y={alto - 8} textAnchor="middle" className={unir('text-xs', diaElegido === dd.fecha ? 'fill-marca-hondo font-semibold' : 'fill-tinta/60')}>
              {dd.dia}
            </text>
          ) : null,
        )}

        {/* blancos para el mouse: toda la banda del día, más grande que la columna */}
        {dias.map((dd, i) => (
          <rect
            key={`h${i}`}
            x={izq + banda * i}
            y={ARRIBA}
            width={banda}
            height={alturaUtil + ABAJO}
            fill="transparent"
            className={onElegirDia ? 'cursor-pointer' : undefined}
            onMouseEnter={() => setEncima(i)}
            onClick={() => onElegirDia?.(dd.fecha)}
          >
            <title>{`${diaCorto(dd.fecha)}: ${pesos(totalDia(dd))}`}</title>
          </rect>
        ))}
      </svg>

      {/* el detalle del día bajo el mouse */}
      {d && (
        <div
          className="pointer-events-none absolute top-0 z-contenido w-60 rounded-xl border border-black/[0.08] bg-white p-3 text-sm shadow-flotante"
          style={{ left: Math.min(Math.max(0, xCentro(encima!) - 120), ancho - 240) }}
        >
          <p className="font-semibold text-tinta">{diaCorto(d.fecha)}</p>
          {encima! + 1 > finDatos && encima! + 1 <= finRaya ? (
            <p className="mt-1 text-tinta/70">Todavía no llegaron los datos de este día.</p>
          ) : (
            <dl className="mt-1.5 space-y-1">
              <div className="flex justify-between gap-3"><dt className="text-tinta/70">Facturado</dt><dd className="importe font-semibold text-tinta">{pesos(totalDia(d))}</dd></div>
              {mostrarSucursales.st && mostrarSucursales.si && (
                <>
                  <div className="flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-tinta/70"><span className="size-2.5 rounded-sm bg-dato-1" />Sant Thomas</dt><dd className="importe text-tinta">{pesos(d.st)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-tinta/70"><span className="size-2.5 rounded-sm bg-dato-2" />Santa Inés</dt><dd className="importe text-tinta">{pesos(d.si)}</dd></div>
                </>
              )}
              <div className="flex justify-between gap-3"><dt className="text-tinta/70">Comprobantes</dt><dd className="importe text-tinta">{d.comprobantes}</dd></div>
              {ant && <div className="flex justify-between gap-3 border-t border-black/[0.06] pt-1"><dt className="text-tinta/70">El {ant.dia} de {nombreAnterior}</dt><dd className="importe text-tinta">{pesos(ant.neto)}</dd></div>}
            </dl>
          )}
          {onElegirDia && <p className="mt-2 text-xs text-tinta/60">Tocá para ver sus comprobantes</p>}
        </div>
      )}
    </div>
  );
}
