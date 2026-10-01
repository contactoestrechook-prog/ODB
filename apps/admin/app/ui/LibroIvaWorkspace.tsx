'use client';

import { useState, type ReactNode } from 'react';
import { Boton, Cargando, Entrada, Kpi, Monto, Pestanas, ROTULO, Tarjeta, TarjetaCabecera, Vacio, unir } from './kit';
import { fecha } from '../lib/formato';

const TIPO_LABEL: Record<string, string> = {
  FA: 'Fact. A', FB: 'Fact. B', FC: 'Fact. C',
  NCA: 'NC A', NCB: 'NC B', NCC: 'NC C', NDA: 'ND A', NDB: 'ND B', NDC: 'ND C',
};

// Los libros quedan como tabla de verdad (también en el papel): en el celular
// scrollean de costado dentro de su tarjeta.
const TH = unir(ROTULO, 'whitespace-nowrap px-2 py-2.5 text-left');
const TH_IMPORTE = unir(ROTULO, 'whitespace-nowrap px-2 py-2.5 text-right');
const TD = 'px-2 py-2 align-top';
const TD_IMPORTE = 'importe whitespace-nowrap px-2 py-2 text-right align-top';

// En el celular cada comprobante va como un renglón apilado; la tabla queda
// para escritorio y para el papel (al imprimir sale siempre la tabla).
function RenglonMovil({ titulo, fechaTexto, quien, neto, iva, total, esTotal = false }: {
  titulo: ReactNode; fechaTexto?: string; quien?: ReactNode; neto: unknown; iva: unknown; total: unknown; esTotal?: boolean;
}) {
  return (
    <li className={unir('px-4 py-3', esTotal && 'border-t-2 border-black/15')}>
      <div className="flex items-start justify-between gap-3">
        <p className={unir('min-w-0 text-sm', esTotal ? 'font-semibold' : 'font-medium')}>{titulo}</p>
        <Monto valor={total || 0} decimales className="shrink-0 text-sm font-semibold" />
      </div>
      {(quien || fechaTexto) && (
        <p className="mt-0.5 break-words text-xs text-tinta/70">
          {fechaTexto && <span className="text-tinta/60">{fechaTexto} · </span>}
          {quien}
        </p>
      )}
      <p className="mt-1 text-xs text-tinta/60">
        Neto <Monto valor={neto || 0} decimales className="text-tinta" /> · IVA <Monto valor={iva || 0} decimales className="text-tinta" />
      </p>
    </li>
  );
}

export function LibroIvaWorkspace({ inicial }: { inicial: any }) {
  const [data, setData] = useState<any>(inicial);
  const [periodo, setPeriodo] = useState<string>(inicial?.periodo ?? new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState<'ventas' | 'compras'>('ventas');
  const [cargando, setCargando] = useState(false);

  const cambiarPeriodo = async (p: string) => {
    setPeriodo(p);
    setCargando(true);
    const r = await fetch(`/api/libro-iva?periodo=${p}`).then((x) => x.json()).catch(() => null);
    if (r) setData(r);
    setCargando(false);
  };

  const v = data?.ventas ?? { filas: [], porAlicuota: [], totales: {}, cantidad: 0 };
  const co = data?.compras ?? { filas: [], totales: {}, cantidad: 0, estimadas: 0 };
  const res = data?.resumen ?? { ivaDebito: 0, ivaCredito: 0, saldo: 0 };
  const aPagar = (res.saldo ?? 0) >= 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm text-tinta/70">
          Período
          <span className="w-44">
            <Entrada type="month" value={periodo} onChange={(e) => cambiarPeriodo(e.target.value)} />
          </span>
        </label>
        {cargando && <Cargando />}
        <Boton variante="secundario" onClick={() => window.print()} className="ml-auto">Imprimir</Boton>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi etiqueta="IVA débito (ventas)" valor={<Monto valor={res.ivaDebito || 0} decimales />} sub={`${v.cantidad} comp.`} />
        <Kpi etiqueta="IVA crédito (compras)" valor={<Monto valor={res.ivaCredito || 0} decimales />} sub={`${co.cantidad} fact.`} />
        <Kpi
          etiqueta={aPagar ? 'Saldo a pagar a la AFIP' : 'Saldo técnico a favor'}
          valor={<Monto valor={Math.abs(res.saldo) || 0} decimales />}
          tono={aPagar ? 'error' : 'ok'}
        />
      </div>

      {/* tabs */}
      <Pestanas
        etiquetaAccesible="Libros"
        className="print:hidden"
        valor={tab}
        onCambiar={setTab}
        opciones={[
          { valor: 'ventas', etiqueta: `Ventas (${v.cantidad})` },
          { valor: 'compras', etiqueta: `Compras (${co.cantidad})` },
        ]}
      />

      {/* VENTAS */}
      {tab === 'ventas' && (
        <Tarjeta relleno={false} className="overflow-hidden print:rounded-none print:border-0 print:shadow-none">
          <TarjetaCabecera titulo={`Libro IVA Ventas · ${periodo}`} />
          {v.filas.length === 0 ? <Vacio className="m-4" titulo="Sin comprobantes en el período." /> : (
            <>
              <ul className="divide-y divide-black/[0.06] md:hidden print:hidden" aria-label="Libro IVA Ventas">
                {v.filas.map((f: any, i: number) => (
                  <RenglonMovil
                    key={i}
                    titulo={<><span className="text-xs text-tinta/70">{TIPO_LABEL[f.tipo] ?? f.tipo}</span> <span className="font-mono text-xs">{f.comprobante}</span></>}
                    fechaTexto={fecha(f.fecha)}
                    quien={<>{f.receptor}{f.docNumero ? <span className="text-tinta/60"> · {f.docNumero}</span> : ''}</>}
                    neto={f.neto}
                    iva={f.iva}
                    total={f.total}
                  />
                ))}
                <RenglonMovil esTotal titulo="Totales" neto={v.totales.neto} iva={v.totales.iva} total={v.totales.total} />
              </ul>
              <div className="hidden overflow-x-auto md:block print:block">
                <table className="tabla-kit w-full text-sm text-tinta">
                  <thead>
                    <tr className="border-b border-black/[0.06]">
                      <th className={unir(TH, 'pl-4 sm:pl-5')}>Comprobante</th>
                      <th className={TH}>Fecha</th>
                      <th className={TH}>Receptor</th>
                      <th className={TH_IMPORTE}>Neto</th>
                      <th className={TH_IMPORTE}>IVA</th>
                      <th className={unir(TH_IMPORTE, 'pr-4 sm:pr-5')}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {v.filas.map((f: any, i: number) => (
                      <tr key={i}>
                        <td className={unir(TD, 'whitespace-nowrap pl-4 sm:pl-5')}><span className="text-xs text-tinta/70">{TIPO_LABEL[f.tipo] ?? f.tipo}</span> <span className="font-mono text-xs">{f.comprobante}</span></td>
                        <td className={unir(TD, 'whitespace-nowrap text-xs text-tinta/70')}>{fecha(f.fecha)}</td>
                        <td className={unir(TD, 'min-w-40 text-xs')}>{f.receptor}{f.docNumero ? <span className="text-tinta/60"> · {f.docNumero}</span> : ''}</td>
                        <td className={TD_IMPORTE}><Monto valor={f.neto || 0} decimales /></td>
                        <td className={TD_IMPORTE}><Monto valor={f.iva || 0} decimales /></td>
                        <td className={unir(TD_IMPORTE, 'pr-4 sm:pr-5')}><Monto valor={f.total || 0} decimales /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black/15 font-semibold">
                      <td className="px-2 py-2.5 pl-4 sm:pl-5" colSpan={3}>Totales</td>
                      <td className={TD_IMPORTE}><Monto valor={v.totales.neto || 0} decimales /></td>
                      <td className={TD_IMPORTE}><Monto valor={v.totales.iva || 0} decimales /></td>
                      <td className={unir(TD_IMPORTE, 'pr-4 sm:pr-5')}><Monto valor={v.totales.total || 0} decimales /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
          {v.porAlicuota?.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-black/[0.06] px-4 py-3 text-xs text-tinta/70 sm:px-5">
              {v.porAlicuota.map((a: any) => (
                <span key={a.alicuota}>IVA {a.alicuota}%: neto <Monto valor={a.neto || 0} decimales /> · <Monto valor={a.iva || 0} decimales /></span>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {/* COMPRAS */}
      {tab === 'compras' && (
        <Tarjeta relleno={false} className="overflow-hidden print:rounded-none print:border-0 print:shadow-none">
          <TarjetaCabecera
            titulo={`Libro IVA Compras · ${periodo}`}
            accion={co.estimadas > 0 && <span className="text-xs font-medium text-marca-hondo">{co.estimadas} con IVA estimado</span>}
          />
          {co.filas.length === 0 ? <Vacio className="m-4" titulo="Sin facturas de proveedor en el período." /> : (
            <>
              <ul className="divide-y divide-black/[0.06] md:hidden print:hidden" aria-label="Libro IVA Compras">
                {co.filas.map((f: any, i: number) => (
                  <RenglonMovil
                    key={i}
                    titulo={<span className="font-mono text-xs">{f.comprobante}{f.estimado && <span className="ml-1 text-marca-hondo" title="IVA estimado">*</span>}</span>}
                    fechaTexto={fecha(f.fecha)}
                    quien={<>{f.proveedor}{f.cuit ? <span className="text-tinta/60"> · {f.cuit}</span> : ''}</>}
                    neto={f.neto}
                    iva={f.iva}
                    total={f.total}
                  />
                ))}
                <RenglonMovil esTotal titulo="Totales" neto={co.totales.neto} iva={co.totales.iva} total={co.totales.total} />
              </ul>
              <div className="hidden overflow-x-auto md:block print:block">
                <table className="tabla-kit w-full text-sm text-tinta">
                  <thead>
                    <tr className="border-b border-black/[0.06]">
                      <th className={unir(TH, 'pl-4 sm:pl-5')}>Factura</th>
                      <th className={TH}>Fecha</th>
                      <th className={TH}>Proveedor</th>
                      <th className={TH_IMPORTE}>Neto</th>
                      <th className={TH_IMPORTE}>IVA</th>
                      <th className={unir(TH_IMPORTE, 'pr-4 sm:pr-5')}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {co.filas.map((f: any, i: number) => (
                      <tr key={i}>
                        <td className={unir(TD, 'whitespace-nowrap pl-4 font-mono text-xs sm:pl-5')}>{f.comprobante}{f.estimado && <span className="ml-1 text-marca-hondo" title="IVA estimado">*</span>}</td>
                        <td className={unir(TD, 'whitespace-nowrap text-xs text-tinta/70')}>{fecha(f.fecha)}</td>
                        <td className={unir(TD, 'min-w-40 text-xs')}>{f.proveedor}{f.cuit ? <span className="text-tinta/60"> · {f.cuit}</span> : ''}</td>
                        <td className={TD_IMPORTE}><Monto valor={f.neto || 0} decimales /></td>
                        <td className={TD_IMPORTE}><Monto valor={f.iva || 0} decimales /></td>
                        <td className={unir(TD_IMPORTE, 'pr-4 sm:pr-5')}><Monto valor={f.total || 0} decimales /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black/15 font-semibold">
                      <td className="px-2 py-2.5 pl-4 sm:pl-5" colSpan={3}>Totales</td>
                      <td className={TD_IMPORTE}><Monto valor={co.totales.neto || 0} decimales /></td>
                      <td className={TD_IMPORTE}><Monto valor={co.totales.iva || 0} decimales /></td>
                      <td className={unir(TD_IMPORTE, 'pr-4 sm:pr-5')}><Monto valor={co.totales.total || 0} decimales /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
          {co.estimadas > 0 && (
            <p className="border-t border-black/[0.06] px-4 py-3 text-xs text-tinta/60 sm:px-5">* IVA estimado al 21% (la factura se cargó sin desglose). Cargá neto e IVA al registrar la factura para que el libro sea exacto.</p>
          )}
        </Tarjeta>
      )}
    </div>
  );
}
