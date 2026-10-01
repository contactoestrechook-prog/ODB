'use client';

import { useState, type ReactNode } from 'react';
import { Boton, Cargando, Chips, Entrada, IconoAtencion, TablaResponsiva, Tarjeta, TarjetaCabecera, Vacio, unir } from './kit';
import { pesos } from '../lib/formato';

const num = (n: number) => Number(n ?? 0).toFixed(2).replace('.', ',');
const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const MES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function bajarCsv(nombre: string, lineas: string[]) {
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

const hoyISO = () => new Date().toISOString().slice(0, 10);
const hace = (dias: number) => new Date(Date.now() - dias * 86400_000).toISOString().slice(0, 10);

const PRESETS: { id: string; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: 'quincena', label: 'Quincena' },
  { id: 'mes', label: 'Mes' },
  { id: 'semestre', label: 'Semestre' },
  { id: 'anual', label: 'Año mes a mes' },
];

function IconoBajar({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

// Una cifra con su rótulo, dentro de una tarjeta (posición IVA, IIBB, ventas).
function Dato({ etiqueta, valor, tono = 'text-tinta' }: { etiqueta: ReactNode; valor: ReactNode; tono?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-crema-claro p-3.5">
      <p className={unir('importe truncate text-lg font-semibold leading-tight', tono)}>{valor}</p>
      <p className="mt-1 text-xs text-tinta/60">{etiqueta}</p>
    </div>
  );
}

export function ContableWorkspace({ inicial }: { inicial: any }) {
  const [preset, setPreset] = useState('mes');
  const [mes, setMes] = useState<string>(inicial?.mes ?? new Date().toISOString().slice(0, 7));
  const [anio, setAnio] = useState<string>(String(new Date().getFullYear()));
  const [d, setD] = useState<any>(inicial);
  const [anual, setAnual] = useState<any>(null);
  const [cargando, setCargando] = useState(false);

  const traer = async (qs: string, esAnual: boolean) => {
    setCargando(true);
    try {
      const res = await fetch(`/api/contable?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      if (esAnual) setAnual(data);
      else setD(data);
    } finally {
      setCargando(false);
    }
  };

  const elegirPreset = (id: string) => {
    setPreset(id);
    if (id === 'anual') return void traer(`recurso=anual&anio=${anio}`, true);
    if (id === 'mes') return void traer(`mes=${mes}`, false);
    const rangos: Record<string, string> = {
      hoy: `desde=${hoyISO()}&hasta=${hoyISO()}`,
      '7d': `desde=${hace(6)}&hasta=${hoyISO()}`,
      quincena: `desde=${hace(14)}&hasta=${hoyISO()}`,
      semestre: `desde=${hace(182)}&hasta=${hoyISO()}`,
    };
    void traer(rangos[id], false);
  };

  const etiqueta = d?.mes ?? mes;

  const csvVentas = () => {
    const filas = d?.ventas?.facturacion?.filas ?? [];
    const lineas = [
      `Libro IVA Ventas - ${etiqueta}`,
      '',
      ['Fecha', 'Tipo', 'Comprobante', 'Receptor', 'Doc', 'Neto', 'IVA', 'Total'].map(esc).join(';'),
      ...filas.map((f: any) => [f.fecha, f.tipo, f.comprobante, f.receptor, f.docNumero ?? '', num(f.neto), num(f.iva), num(f.total)].map(esc).join(';')),
    ];
    const e = d?.ventas?.electronicosCaja;
    if (e?.cantidad > 0) {
      lineas.push([`Electrónicos de caja (${e.cantidad} FB/NC con CAE, ver módulo ARCA)`, '', '', '', '', num(e.neto), num(e.iva), num(e.total)].map(esc).join(';'));
    }
    const t = d?.ventas?.totales ?? {};
    lineas.push('', ['TOTALES', '', '', '', '', num(t.neto), num(t.iva), num(t.total)].map(esc).join(';'));
    bajarCsv(`iva-ventas-${etiqueta.replaceAll(' ', '')}.csv`, lineas);
  };

  const csvCompras = () => {
    const filas = d?.compras?.filas ?? [];
    const lineas = [
      `Libro IVA Compras - ${etiqueta}`,
      '',
      ['Fecha', 'Comprobante', 'Proveedor', 'CUIT', 'Neto', 'IVA', 'Percepción IVA', 'Percepción IIBB', 'Otros imp.', 'Total', 'IVA estimado'].map(esc).join(';'),
      ...filas.map((f: any) =>
        [f.fecha, f.comprobante, f.proveedor, f.cuit ?? '', num(f.neto), num(f.iva), num(f.percepcionIva), num(f.percepcionIibb), num(f.otrosImpuestos), num(f.total), f.estimado ? 'SI' : ''].map(esc).join(';'),
      ),
      '',
      ['TOTALES', '', '', '', num(d?.compras?.neto), num(d?.compras?.iva), num(d?.percepciones?.iva), num(d?.percepciones?.iibb), num(d?.percepciones?.otros), num(d?.compras?.total), ''].map(esc).join(';'),
    ];
    bajarCsv(`iva-compras-${etiqueta.replaceAll(' ', '')}.csv`, lineas);
  };

  const p = d?.posicion ?? {};
  const v = d?.ventas ?? {};
  const c = d?.compras ?? {};

  // la vista anual: los meses y, al final, la fila de totales (mismos campos)
  const filasAnuales: any[] = (anual?.meses ?? []).length
    ? [...anual.meses, { ...(anual?.totales ?? {}), mes: 'total', esTotal: true }]
    : [];
  const negrita = (m: any) => (m.esTotal ? 'font-bold' : '');

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* filtros de período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Chips etiquetaAccesible="Período" valor={preset} onCambiar={elegirPreset} opciones={PRESETS.map((pr) => ({ valor: pr.id, etiqueta: pr.label }))} />
          {preset === 'mes' && (
            <div className="w-44">
              <Entrada
                type="month"
                value={mes}
                onChange={(e) => { setMes(e.target.value); void traer(`mes=${e.target.value}`, false); }}
                aria-label="Mes"
              />
            </div>
          )}
          {preset === 'anual' && (
            <div className="w-28">
              <Entrada
                type="number"
                value={anio}
                min={2024}
                max={2100}
                onChange={(e) => { setAnio(e.target.value); if (/^\d{4}$/.test(e.target.value)) void traer(`recurso=anual&anio=${e.target.value}`, true); }}
                aria-label="Año"
              />
            </div>
          )}
          {cargando && <Cargando texto="actualizando…" />}
        </div>
        {preset !== 'anual' && (
          <div className="flex flex-wrap items-center gap-2">
            <Boton variante="secundario" tamano="chico" icono={<IconoBajar />} onClick={csvVentas}>IVA Ventas</Boton>
            <Boton variante="secundario" tamano="chico" icono={<IconoBajar />} onClick={csvCompras}>IVA Compras</Boton>
          </div>
        )}
      </div>

      {/* ---- VISTA ANUAL: el año mes a mes ---- */}
      {preset === 'anual' ? (
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera titulo={`${anual?.anio ?? anio} · mes a mes`} />
          {!(anual?.meses ?? []).length ? (
            cargando ? <Cargando texto="Calculando…" bloque /> : <Vacio className="m-4" titulo="Sin datos para ese año." />
          ) : (
            <TablaResponsiva
              sinMarco
              etiqueta={`${anual?.anio ?? anio} mes a mes`}
              filas={filasAnuales}
              claveFila="mes"
              columnas={[
                {
                  clave: 'mes',
                  titulo: 'Mes',
                  principal: true,
                  celda: (m) => <span className={m.esTotal ? 'font-bold' : 'font-medium'}>{m.esTotal ? `TOTAL ${anual?.anio}` : MES_LABEL[Number(m.mes.slice(5, 7))]}</span>,
                },
                { clave: 'comprobantes', titulo: 'Comp.', importe: true, celda: (m) => <span className={negrita(m)}>{m.comprobantes}</span> },
                { clave: 'ventas', titulo: 'Ventas', importe: true, celda: (m) => <span className={m.esTotal ? 'font-bold' : 'font-medium'}>{pesos(m.ventasTotal)}</span> },
                { clave: 'ivaDebito', titulo: 'IVA débito', importe: true, celda: (m) => <span className={unir('text-marca-hondo', negrita(m))}>{pesos(m.ivaDebito)}</span> },
                { clave: 'compras', titulo: 'Compras', importe: true, celda: (m) => <span className={negrita(m)}>{pesos(m.comprasTotal)}</span> },
                { clave: 'ivaCredito', titulo: 'IVA crédito', importe: true, celda: (m) => <span className={unir('text-ok', negrita(m))}>{pesos(m.ivaCredito)}</span> },
                {
                  clave: 'saldoIva',
                  titulo: 'Saldo IVA',
                  importe: true,
                  celda: (m) => (
                    <span className={m.esTotal ? 'font-bold' : unir('font-medium', m.saldoIva > 0 ? 'text-marca-hondo' : 'text-ok')}>{pesos(m.saldoIva)}</span>
                  ),
                },
                { clave: 'percepIva', titulo: 'Perc. IVA', importe: true, celda: (m) => <span className={negrita(m)}>{pesos(m.percepIva)}</span> },
                { clave: 'percepIibb', titulo: 'Perc. IIBB', importe: true, celda: (m) => <span className={negrita(m)}>{pesos(m.percepIibb)}</span> },
              ]}
            />
          )}
        </Tarjeta>
      ) : (
        <>
          {/* POSICIÓN IVA */}
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo={`Posición IVA — ${etiqueta}`} />
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-5">
              {[
                ['IVA débito (ventas)', pesos(p.ivaDebito), ''],
                ['IVA crédito (compras)', pesos(p.ivaCredito), 'text-ok'],
                ['Saldo técnico', pesos(p.saldoTecnico), p.saldoTecnico > 0 ? 'text-marca-hondo' : 'text-ok'],
                ['Percepciones IVA a cuenta', pesos(p.percepcionesIvaACuenta), 'text-ok'],
                [p.ivaAPagar >= 0 ? 'IVA a pagar (estimado)' : 'IVA a favor (estimado)', pesos(Math.abs(p.ivaAPagar ?? 0)), p.ivaAPagar > 0 ? 'text-marca-hondo font-bold' : 'text-ok font-bold'],
              ].map(([l, val, cls]: any) => (
                <Dato key={l} etiqueta={l} valor={val} tono={cls || 'text-tinta'} />
              ))}
            </div>
          </Tarjeta>

          {/* IIBB */}
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Ingresos Brutos (ARBA · Prov. de Buenos Aires)" />
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Dato etiqueta="Base imponible (ventas netas devengadas)" valor={pesos(p.baseIibb)} />
                <Dato etiqueta="Percepciones IIBB sufridas (a cuenta)" valor={pesos(p.percepcionesIibbACuenta)} tono="text-ok" />
                <Dato etiqueta="Retenciones bancarias/SIRCREB (sin fuente aún)" valor={pesos(p.retenciones)} tono="text-tinta/60" />
              </div>
              <p className="mt-3 text-xs text-tinta/60">
                El impuesto se calcula con la alícuota de tu actividad (la define el contador). Acá tiene la base y los pagos a cuenta listos.
              </p>
            </div>
          </Tarjeta>

          {/* VENTAS */}
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="IVA Ventas" />
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Dato etiqueta="Comprobantes (facturación + electrónicos caja)" valor={`${v.facturacion?.cantidad ?? 0} + ${v.electronicosCaja?.cantidad ?? 0}`} />
                <Dato etiqueta="Neto gravado" valor={pesos(v.totales?.neto)} />
                <Dato etiqueta="IVA débito" valor={pesos(v.totales?.iva)} tono="text-marca-hondo" />
                <Dato etiqueta="Total" valor={pesos(v.totales?.total)} />
              </div>
              {(v.facturacion?.porAlicuota ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {v.facturacion.porAlicuota.map((a: any) => (
                    <span key={a.alicuota} className="rounded-full bg-crema-claro px-3 py-1 text-xs text-tinta">
                      {a.alicuota}% · neto <span className="importe">{pesos(a.neto)}</span> · IVA <span className="importe font-semibold">{pesos(a.iva)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Tarjeta>

          {/* COMPRAS */}
          <Tarjeta relleno={false} className="overflow-hidden">
            <TarjetaCabecera
              titulo={`IVA Compras (${c.cantidad ?? 0} facturas)`}
              sub={c.estimadas > 0 && (
                <span className="inline-flex items-start gap-1 text-atencion">
                  <IconoAtencion className="mt-px size-4 shrink-0" />
                  {c.estimadas} con IVA estimado al 21% (sin discriminar)
                </span>
              )}
            />
            <TablaResponsiva
              sinMarco
              etiqueta="IVA Compras"
              filas={(c.filas ?? []).slice(0, 100)}
              claveFila={(_f, i) => i}
              vacio={<Vacio className="m-4" titulo="Sin facturas de proveedor cargadas en el período." />}
              columnas={[
                { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap text-tinta/70', celda: (f: any) => f.fecha },
                {
                  clave: 'proveedor',
                  titulo: 'Proveedor',
                  principal: true,
                  claseCelda: 'max-w-48',
                  celda: (f: any) => <span className="break-words">{f.proveedor}{f.cuit ? ` (${f.cuit})` : ''}</span>,
                },
                { clave: 'comprobante', titulo: 'Comprobante', celda: (f: any) => `${f.comprobante}${f.estimado ? ' *' : ''}` },
                { clave: 'neto', titulo: 'Neto', importe: true, celda: (f: any) => pesos(f.neto) },
                { clave: 'iva', titulo: 'IVA', importe: true, celda: (f: any) => <span className="text-ok">{pesos(f.iva)}</span> },
                { clave: 'percIva', titulo: 'Perc. IVA', importe: true, celda: (f: any) => pesos(f.percepcionIva) },
                { clave: 'percIibb', titulo: 'Perc. IIBB', importe: true, celda: (f: any) => pesos(f.percepcionIibb) },
                { clave: 'total', titulo: 'Total', importe: true, celda: (f: any) => <span className="font-semibold">{pesos(f.total)}</span> },
              ]}
            />
          </Tarjeta>

          <p className="px-1 text-xs text-tinta/60">
            Los CSV bajan los libros completos con coma decimal (Excel argentino). Las percepciones de IVA e IIBB sufridas en compras
            se computan como pagos a cuenta. Las facturas marcadas con * no tienen el IVA discriminado y se estiman al 21 % — cargalas
            con el detalle en Compras para que el libro quede exacto.
          </p>
        </>
      )}
    </div>
  );
}
