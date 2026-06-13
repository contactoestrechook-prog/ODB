import Link from 'next/link';
import { Header } from '../../ui/Header';
import { apiFetch } from '../../../lib/api';
import { AccionesComprobante } from '../../ui/AccionesComprobante';

const pesos = (n: number) =>
  '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIPOS: Record<string, string> = {
  FA: 'FACTURA', FB: 'FACTURA', FC: 'FACTURA',
  NCA: 'NOTA DE CRÉDITO', NCB: 'NOTA DE CRÉDITO', NCC: 'NOTA DE CRÉDITO',
  NDA: 'NOTA DE DÉBITO', NDB: 'NOTA DE DÉBITO', NDC: 'NOTA DE DÉBITO',
  REM: 'REMITO', REC: 'RECIBO', ANT: 'ANTICIPO', SIN: 'COMPROBANTE INTERNO',
};

export const dynamic = 'force-dynamic';

export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/facturacion/comprobantes/${id}`);
  if (!res.ok) {
    return (
      <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
        <Header activo="/facturacion" />
        <p className="max-w-3xl mx-auto p-6 text-sm text-[#932A1F]">No existe el comprobante.</p>
      </main>
    );
  }
  const c = await res.json();
  const letra = ['FA', 'NCA', 'NDA'].includes(c.tipo) ? 'A' : ['FB', 'NCB', 'NDB'].includes(c.tipo) ? 'B' : ['FC', 'NCC', 'NDC'].includes(c.tipo) ? 'C' : 'X';
  const fiscal = letra !== 'X';
  const discrimina = letra === 'A';
  const numero = `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64 print:bg-white print:pl-0">
      <div className="print:hidden">
        <Header activo="/facturacion" />
      </div>
      <div className="max-w-3xl mx-auto p-6 space-y-4 print:p-0 print:max-w-none">
        <div className="flex items-center justify-between print:hidden">
          <Link href="/facturacion" className="text-xs text-black/50 hover:text-black">← Volver a facturación</Link>
          <AccionesComprobante id={c.id} estado={c.estado} esFiscalDebito={['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'].includes(c.tipo)} />
        </div>

        {/* comprobante imprimible */}
        <section className="bg-white rounded-xl print:rounded-none overflow-hidden relative">
          {c.estado === 'anulado' && (
            <p className="absolute inset-0 flex items-center justify-center text-6xl font-black text-[#B82D25]/15 rotate-[-18deg] pointer-events-none">
              ANULADO
            </p>
          )}
          {/* encabezado */}
          <div className="grid grid-cols-[1fr_auto_1fr] border-b border-black/15">
            <div className="p-5">
              <p className="text-lg font-semibold tracking-[0.25em] text-black">O.D.B</p>
              <p className="text-[10px] tracking-[0.2em] text-[#B82D25] font-semibold">PREMIUM MARKET</p>
              <p className="text-[11px] text-black/55 mt-2 leading-relaxed">
                O.D.B Premium Market<br />
                Outlet de bebidas y almacén · Argentina<br />
                IVA Responsable Inscripto
              </p>
            </div>
            <div className="px-6 py-4 border-x border-black/15 text-center">
              <p className="text-4xl font-black text-black leading-none">{letra}</p>
              {fiscal && <p className="text-[9px] text-black/45 mt-1">COD. {c.tipo}</p>}
            </div>
            <div className="p-5 text-right">
              <p className="text-sm font-semibold text-black">{TIPOS[c.tipo]}</p>
              <p className="font-mono text-sm text-black mt-1">N° {numero}</p>
              <p className="text-xs text-black/55 mt-1">
                Fecha: {new Date(c.emitido_en).toLocaleDateString('es-AR')}
              </p>
              {fiscal && (
                <p className="text-[10px] text-black/45 mt-2">
                  {c.cae ? `CAE ${c.cae} · vto ${c.cae_vencimiento}` : 'CAE pendiente de ARCA'}
                </p>
              )}
            </div>
          </div>

          {/* receptor */}
          <div className="px-5 py-3 border-b border-black/10 text-sm text-black grid sm:grid-cols-2 gap-1">
            <p><span className="text-black/45 text-xs">Señor/es:</span> {c.receptor?.nombre ?? 'Consumidor final'}</p>
            <p><span className="text-black/45 text-xs">{c.receptor?.doc_tipo ?? 'Doc'}:</span> {c.receptor?.doc_numero ?? '—'}</p>
            <p><span className="text-black/45 text-xs">Cond. IVA:</span> {(c.receptor?.condicion_iva ?? 'consumidor final').replaceAll('_', ' ')}</p>
            <p><span className="text-black/45 text-xs">Cond. pago:</span> {c.condicion_pago === 'cta_cte' ? 'Cuenta corriente' : 'Contado'}</p>
            {c.receptor?.domicilio && <p className="sm:col-span-2"><span className="text-black/45 text-xs">Domicilio:</span> {c.receptor.domicilio}</p>}
            {c.referencia && (
              <p className="sm:col-span-2 text-xs text-black/55">
                Ref.: {TIPOS[c.referencia.tipo]} {String(c.referencia.punto_venta).padStart(4, '0')}-{String(c.referencia.numero).padStart(8, '0')}
              </p>
            )}
          </div>

          {/* renglones */}
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="text-left text-[11px] text-black/45 border-b border-black/10">
                <th className="px-5 py-2 font-medium">Descripción</th>
                <th className="px-2 py-2 font-medium text-right">Cant.</th>
                <th className="px-2 py-2 font-medium text-right">{discrimina ? 'P. unit. (neto)' : 'P. unitario'}</th>
                {discrimina && <th className="px-2 py-2 font-medium text-right">IVA</th>}
                <th className="px-5 py-2 font-medium text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {(c.items ?? []).map((i: any, idx: number) => {
                const alic = Number(i.alicuota ?? 21);
                const renglon = Number(i.precioUnitario) * Number(i.cantidad);
                const unitNeto = alic > 0 ? Number(i.precioUnitario) / (1 + alic / 100) : Number(i.precioUnitario);
                return (
                  <tr key={idx} className="border-b border-black/5">
                    <td className="px-5 py-2">
                      {i.descripcion}
                      {i.sku && <span className="text-[10px] text-black/35 ml-2">[{i.sku}]</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{i.cantidad}</td>
                    <td className="px-2 py-2 text-right">{pesos(discrimina ? unitNeto : i.precioUnitario)}</td>
                    {discrimina && <td className="px-2 py-2 text-right text-xs">{alic} %</td>}
                    <td className="px-5 py-2 text-right">{pesos(discrimina ? unitNeto * i.cantidad : renglon)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* totales */}
          <div className="px-5 py-4 flex justify-end">
            <div className="w-72 space-y-1 text-sm text-black">
              {discrimina && (
                <>
                  <p className="flex justify-between"><span className="text-black/55">Neto gravado</span><span>{pesos(c.neto)}</span></p>
                  {(c.iva_detalle ?? []).map((d: any) => (
                    <p key={d.alicuota} className="flex justify-between">
                      <span className="text-black/55">IVA {d.alicuota} %</span>
                      <span>{pesos(d.monto)}</span>
                    </p>
                  ))}
                </>
              )}
              <p className="flex justify-between text-base font-semibold border-t border-black/15 pt-2">
                <span>TOTAL</span><span>{pesos(c.total)}</span>
              </p>
            </div>
          </div>

          {c.observaciones && (
            <p className="px-5 pb-4 text-xs text-black/55">Obs.: {c.observaciones}</p>
          )}
          {!fiscal && (
            <p className="px-5 pb-4 text-[10px] text-black/40">
              Documento no válido como factura.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
