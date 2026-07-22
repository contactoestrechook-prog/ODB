'use client';

import { useState } from 'react';

const pesos = (n: any) =>
  n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString('es-AR');
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

  return (
    <div className="space-y-5">
      {/* filtros de período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((pr) => (
            <button
              key={pr.id}
              onClick={() => elegirPreset(pr.id)}
              className={'rounded-full px-3.5 py-1.5 text-xs font-medium border ' +
                (preset === pr.id ? 'bg-black text-white border-black' : 'bg-white text-black border-black/15 hover:border-[#B82D25]')}
            >
              {pr.label}
            </button>
          ))}
          {preset === 'mes' && (
            <input
              type="month"
              value={mes}
              onChange={(e) => { setMes(e.target.value); void traer(`mes=${e.target.value}`, false); }}
              className="rounded-lg border border-black/15 px-2.5 py-1.5 text-xs bg-white"
            />
          )}
          {preset === 'anual' && (
            <input
              type="number"
              value={anio}
              min={2024}
              max={2100}
              onChange={(e) => { setAnio(e.target.value); if (/^\d{4}$/.test(e.target.value)) void traer(`recurso=anual&anio=${e.target.value}`, true); }}
              className="w-20 rounded-lg border border-black/15 px-2.5 py-1.5 text-xs bg-white"
            />
          )}
          {cargando && <span className="text-xs text-black/40 ml-1">actualizando…</span>}
        </div>
        {preset !== 'anual' && (
          <div className="flex items-center gap-2">
            <button onClick={csvVentas} className="rounded-full bg-white border border-black/15 text-black text-xs font-medium px-3.5 py-2 hover:border-[#B82D25]">⬇ IVA Ventas</button>
            <button onClick={csvCompras} className="rounded-full bg-white border border-black/15 text-black text-xs font-medium px-3.5 py-2 hover:border-[#B82D25]">⬇ IVA Compras</button>
          </div>
        )}
      </div>

      {/* ---- VISTA ANUAL: el año mes a mes ---- */}
      {preset === 'anual' ? (
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
            {anual?.anio ?? anio} · mes a mes
          </h2>
          {!(anual?.meses ?? []).length ? (
            <p className="px-4 py-10 text-center text-black/40 text-sm">{cargando ? 'Calculando…' : 'Sin datos para ese año.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-black min-w-[52rem]">
                <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                  <th className="px-4 py-2 font-medium">Mes</th>
                  <th className="px-4 py-2 font-medium text-right">Comp.</th>
                  <th className="px-4 py-2 font-medium text-right">Ventas</th>
                  <th className="px-4 py-2 font-medium text-right">IVA débito</th>
                  <th className="px-4 py-2 font-medium text-right">Compras</th>
                  <th className="px-4 py-2 font-medium text-right">IVA crédito</th>
                  <th className="px-4 py-2 font-medium text-right">Saldo IVA</th>
                  <th className="px-4 py-2 font-medium text-right">Perc. IVA</th>
                  <th className="px-4 py-2 font-medium text-right">Perc. IIBB</th>
                </tr></thead>
                <tbody>
                  {anual.meses.map((m: any) => (
                    <tr key={m.mes} className="border-b border-black/5 last:border-0">
                      <td className="px-4 py-2 text-xs font-medium">{MES_LABEL[Number(m.mes.slice(5, 7))]}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">{m.comprobantes}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums font-medium">{pesos(m.ventasTotal)}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums text-[#932A1F]">{pesos(m.ivaDebito)}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(m.comprasTotal)}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums text-emerald-700">{pesos(m.ivaCredito)}</td>
                      <td className={'px-4 py-2 text-right text-xs tabular-nums font-medium ' + (m.saldoIva > 0 ? 'text-[#B82D25]' : 'text-emerald-700')}>{pesos(m.saldoIva)}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(m.percepIva)}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(m.percepIibb)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-black/15 bg-[#F0EBE2]/40">
                    <td className="px-4 py-2.5 text-xs font-bold">TOTAL {anual?.anio}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{anual?.totales?.comprobantes}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{pesos(anual?.totales?.ventasTotal)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold text-[#932A1F]">{pesos(anual?.totales?.ivaDebito)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{pesos(anual?.totales?.comprasTotal)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold text-emerald-700">{pesos(anual?.totales?.ivaCredito)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{pesos(anual?.totales?.saldoIva)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{pesos(anual?.totales?.percepIva)}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums font-bold">{pesos(anual?.totales?.percepIibb)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <>
          {/* POSICIÓN IVA */}
          <section className="rounded-xl bg-white p-5">
            <h2 className="font-medium text-black text-sm mb-3">Posición IVA — {etiqueta}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                ['IVA débito (ventas)', pesos(p.ivaDebito), ''],
                ['IVA crédito (compras)', pesos(p.ivaCredito), 'text-emerald-700'],
                ['Saldo técnico', pesos(p.saldoTecnico), p.saldoTecnico > 0 ? 'text-[#932A1F]' : 'text-emerald-700'],
                ['Percepciones IVA a cuenta', pesos(p.percepcionesIvaACuenta), 'text-emerald-700'],
                [p.ivaAPagar >= 0 ? 'IVA a pagar (estimado)' : 'IVA a favor (estimado)', pesos(Math.abs(p.ivaAPagar ?? 0)), p.ivaAPagar > 0 ? 'text-[#B82D25] font-bold' : 'text-emerald-700 font-bold'],
              ].map(([l, val, cls]: any) => (
                <div key={l} className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                  <p className={`text-lg font-semibold leading-none ${cls || 'text-black'}`}>{val}</p>
                  <p className="text-[11px] text-black/45 mt-1">{l}</p>
                </div>
              ))}
            </div>
          </section>

          {/* IIBB */}
          <section className="rounded-xl bg-white p-5">
            <h2 className="font-medium text-black text-sm mb-3">Ingresos Brutos (ARBA · Prov. de Buenos Aires)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-black">{pesos(p.baseIibb)}</p>
                <p className="text-[11px] text-black/45 mt-1">Base imponible (ventas netas devengadas)</p>
              </div>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-emerald-700">{pesos(p.percepcionesIibbACuenta)}</p>
                <p className="text-[11px] text-black/45 mt-1">Percepciones IIBB sufridas (a cuenta)</p>
              </div>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-black/40">{pesos(p.retenciones)}</p>
                <p className="text-[11px] text-black/45 mt-1">Retenciones bancarias/SIRCREB (sin fuente aún)</p>
              </div>
            </div>
            <p className="text-xs text-black/45 mt-3">
              El impuesto se calcula con la alícuota de tu actividad (la define el contador). Acá tiene la base y los pagos a cuenta listos.
            </p>
          </section>

          {/* VENTAS */}
          <section className="rounded-xl bg-white p-5">
            <h2 className="font-medium text-black text-sm mb-3">IVA Ventas</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-black">{v.facturacion?.cantidad ?? 0} + {v.electronicosCaja?.cantidad ?? 0}</p>
                <p className="text-[11px] text-black/45 mt-1">Comprobantes (facturación + electrónicos caja)</p>
              </div>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-black">{pesos(v.totales?.neto)}</p>
                <p className="text-[11px] text-black/45 mt-1">Neto gravado</p>
              </div>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-[#932A1F]">{pesos(v.totales?.iva)}</p>
                <p className="text-[11px] text-black/45 mt-1">IVA débito</p>
              </div>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-3.5">
                <p className="text-lg font-semibold leading-none text-black">{pesos(v.totales?.total)}</p>
                <p className="text-[11px] text-black/45 mt-1">Total</p>
              </div>
            </div>
            {(v.facturacion?.porAlicuota ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {v.facturacion.porAlicuota.map((a: any) => (
                  <span key={a.alicuota} className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs text-black">
                    {a.alicuota}% · neto {pesos(a.neto)} · IVA <span className="font-semibold">{pesos(a.iva)}</span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* COMPRAS */}
          <section className="rounded-xl bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
              <h2 className="font-medium text-black text-sm">IVA Compras ({c.cantidad ?? 0} facturas)</h2>
              {c.estimadas > 0 && (
                <span className="text-xs text-amber-700">⚠ {c.estimadas} con IVA estimado al 21% (sin discriminar)</span>
              )}
            </div>
            {(c.filas ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-black/40 text-sm">Sin facturas de proveedor cargadas en el período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-black min-w-[52rem]">
                  <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-4 py-2 font-medium">Proveedor</th>
                    <th className="px-4 py-2 font-medium">Comprobante</th>
                    <th className="px-4 py-2 font-medium text-right">Neto</th>
                    <th className="px-4 py-2 font-medium text-right">IVA</th>
                    <th className="px-4 py-2 font-medium text-right">Perc. IVA</th>
                    <th className="px-4 py-2 font-medium text-right">Perc. IIBB</th>
                    <th className="px-4 py-2 font-medium text-right">Total</th>
                  </tr></thead>
                  <tbody>
                    {(c.filas ?? []).slice(0, 100).map((f: any, i: number) => (
                      <tr key={i} className="border-b border-black/5 last:border-0">
                        <td className="px-4 py-2 text-xs text-black/55 whitespace-nowrap">{f.fecha}</td>
                        <td className="px-4 py-2 text-xs max-w-44 truncate">{f.proveedor}{f.cuit ? ` (${f.cuit})` : ''}</td>
                        <td className="px-4 py-2 text-xs">{f.comprobante}{f.estimado ? ' *' : ''}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(f.neto)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums text-emerald-700">{pesos(f.iva)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(f.percepcionIva)}</td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{pesos(f.percepcionIibb)}</td>
                        <td className="px-4 py-2 text-right text-xs font-medium tabular-nums">{pesos(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-black/45 px-1">
            Los CSV bajan los libros completos con coma decimal (Excel argentino). Las percepciones de IVA e IIBB sufridas en compras
            se computan como pagos a cuenta. Las facturas marcadas con * no tienen el IVA discriminado y se estiman al 21 % — cargalas
            con el detalle en Compras para que el libro quede exacto.
          </p>
        </>
      )}
    </div>
  );
}
