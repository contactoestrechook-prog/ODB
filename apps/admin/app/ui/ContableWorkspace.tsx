'use client';

import { useState } from 'react';

const pesos = (n: any) =>
  n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n))).toLocaleString('es-AR');
const num = (n: number) => Number(n ?? 0).toFixed(2).replace('.', ',');
const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;

function bajarCsv(nombre: string, lineas: string[]) {
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ContableWorkspace({ inicial }: { inicial: any }) {
  const [mes, setMes] = useState<string>(inicial?.mes ?? new Date().toISOString().slice(0, 7));
  const [d, setD] = useState<any>(inicial);
  const [cargando, setCargando] = useState(false);

  const cambiarMes = async (nuevo: string) => {
    setMes(nuevo);
    setCargando(true);
    try {
      const res = await fetch(`/api/contable?mes=${encodeURIComponent(nuevo)}`);
      if (res.ok) setD(await res.json());
    } finally {
      setCargando(false);
    }
  };

  const csvVentas = () => {
    const filas = d?.ventas?.facturacion?.filas ?? [];
    const lineas = [
      `Libro IVA Ventas - ${mes}`,
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
    bajarCsv(`iva-ventas-${mes}.csv`, lineas);
  };

  const csvCompras = () => {
    const filas = d?.compras?.filas ?? [];
    const lineas = [
      `Libro IVA Compras - ${mes}`,
      '',
      ['Fecha', 'Comprobante', 'Proveedor', 'CUIT', 'Neto', 'IVA', 'Percepción IVA', 'Percepción IIBB', 'Otros imp.', 'Total', 'IVA estimado'].map(esc).join(';'),
      ...filas.map((f: any) =>
        [f.fecha, f.comprobante, f.proveedor, f.cuit ?? '', num(f.neto), num(f.iva), num(f.percepcionIva), num(f.percepcionIibb), num(f.otrosImpuestos), num(f.total), f.estimado ? 'SI' : ''].map(esc).join(';'),
      ),
      '',
      ['TOTALES', '', '', '', num(d?.compras?.neto), num(d?.compras?.iva), num(d?.percepciones?.iva), num(d?.percepciones?.iibb), num(d?.percepciones?.otros), num(d?.compras?.total), ''].map(esc).join(';'),
    ];
    bajarCsv(`iva-compras-${mes}.csv`, lineas);
  };

  const p = d?.posicion ?? {};
  const v = d?.ventas ?? {};
  const c = d?.compras ?? {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/60">
          Cierre del mes en un solo lugar: IVA, percepciones e Ingresos Brutos.{cargando ? ' Actualizando…' : ''}
        </p>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => cambiarMes(e.target.value)} className="rounded-lg border border-black/15 px-3 py-2 text-sm bg-white" />
          <button onClick={csvVentas} className="rounded-full bg-white border border-black/15 text-black text-xs font-medium px-3.5 py-2 hover:border-[#B82D25]">⬇ IVA Ventas</button>
          <button onClick={csvCompras} className="rounded-full bg-white border border-black/15 text-black text-xs font-medium px-3.5 py-2 hover:border-[#B82D25]">⬇ IVA Compras</button>
        </div>
      </div>

      {/* POSICIÓN IVA */}
      <section className="rounded-xl bg-white p-5">
        <h2 className="font-medium text-black text-sm mb-3">Posición IVA — {mes}</h2>
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
          <p className="px-4 py-8 text-center text-black/40 text-sm">Sin facturas de proveedor cargadas este mes.</p>
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
    </div>
  );
}
