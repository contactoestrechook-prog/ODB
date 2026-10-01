import { BotonVolver } from '../../ui/BotonVolver';
import { apiFetch } from '../../../lib/api';
import { AccionesComprobante } from '../../ui/AccionesComprobante';
import { Aviso, Monto, Tarjeta } from '../../ui/kit';
import { Pantalla } from '../../ui/kit/Pantalla';
import { fecha } from '../../lib/formato';

// Al imprimir sale solo el comprobante: se esconden el menú, la barra del
// celular y el buscador (los hermanos del contenido dentro de <main>) y el
// contenido va a todo el ancho de la hoja. <Pantalla> todavía no tiene una
// opción para esto.
const IMPRIMIBLE =
  'print:max-w-none print:p-0 [main:has(>&)>:not(&)]:print:hidden [main:has(>&)]:print:bg-white [main:has(>&)]:print:pl-0';

const TIPOS: Record<string, string> = {
  FA: 'FACTURA', FB: 'FACTURA', FC: 'FACTURA',
  NCA: 'NOTA DE CRÉDITO', NCB: 'NOTA DE CRÉDITO', NCC: 'NOTA DE CRÉDITO',
  NDA: 'NOTA DE DÉBITO', NDB: 'NOTA DE DÉBITO', NDC: 'NOTA DE DÉBITO',
  REM: 'REMITO', REC: 'RECIBO', ANT: 'ANTICIPO', SIN: 'COMPROBANTE INTERNO',
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque',
  tarjeta: 'Tarjeta', deposito: 'Depósito', retencion: 'Retención', nota_credito: 'Nota de crédito',
};

const ROTULO_COMPROBANTE = 'mb-1.5 text-xs font-semibold uppercase tracking-wide text-tinta/60';

export const dynamic = 'force-dynamic';

export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/facturacion/comprobantes/${id}`);
  if (!res.ok) {
    return (
      <Pantalla activo="/facturacion" ancho="angosto">
        <Aviso tono="error">No existe el comprobante.</Aviso>
      </Pantalla>
    );
  }
  const c = await res.json();

  // recibos: traer a qué facturas se imputó y con qué medios se cobró
  let reciboDet: { imputaciones: any[]; medios: any[] } | null = null;
  if (c.tipo === 'REC') {
    const rd = await apiFetch(`/facturacion/recibos/${id}`);
    if (rd.ok) {
      const d = await rd.json();
      reciboDet = { imputaciones: d.imputaciones ?? [], medios: d.medios ?? [] };
    }
  }

  const letra = ['FA', 'NCA', 'NDA'].includes(c.tipo) ? 'A' : ['FB', 'NCB', 'NDB'].includes(c.tipo) ? 'B' : ['FC', 'NCC', 'NDC'].includes(c.tipo) ? 'C' : 'X';
  const fiscal = letra !== 'X';
  const discrimina = letra === 'A';
  const numero = `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

  return (
    <Pantalla activo="/facturacion" ancho="angosto" className={IMPRIMIBLE}>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BotonVolver href="/facturacion" label="Volver a facturación" />
        <AccionesComprobante id={c.id} estado={c.estado} esFiscalDebito={['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'].includes(c.tipo)} />
      </div>

      {/* comprobante imprimible */}
      <Tarjeta relleno={false} className="relative overflow-hidden text-tinta print:rounded-none print:border-0 print:shadow-none">
        {c.estado === 'anulado' && (
          <p className="pointer-events-none absolute inset-0 flex rotate-[-18deg] items-center justify-center text-5xl font-bold text-marca/15 sm:text-6xl">
            ANULADO
          </p>
        )}
        {/* encabezado: en el celular la numeración baja debajo de la letra */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-black/15 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] print:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="p-4 sm:p-5 print:p-5">
            <p className="text-lg font-semibold tracking-[0.25em] text-tinta">O.D.B</p>
            <p className="text-xs font-semibold tracking-[0.2em] text-marca">PREMIUM MARKET</p>
            <p className="mt-2 text-xs leading-relaxed text-tinta/70">
              O.D.B Premium Market<br />
              Outlet de bebidas y almacén · Argentina<br />
              IVA Responsable Inscripto
            </p>
          </div>
          <div className="border-l border-black/15 px-5 py-4 text-center sm:border-x sm:px-6 print:border-x print:px-6">
            <p className="text-4xl font-bold leading-none text-tinta">{letra}</p>
            {fiscal && <p className="mt-1 text-xs text-tinta/60">COD. {c.tipo}</p>}
          </div>
          <div className="col-span-2 border-t border-black/15 p-4 sm:col-span-1 sm:border-t-0 sm:p-5 sm:text-right print:col-span-1 print:border-t-0 print:p-5 print:text-right">
            <p className="text-sm font-semibold text-tinta">{TIPOS[c.tipo]}</p>
            <p className="mt-1 break-words font-mono text-sm text-tinta">N° {numero}</p>
            <p className="mt-1 text-xs text-tinta/70">
              Fecha: {fecha(c.emitido_en, 'completa')}
            </p>
            {fiscal && (
              <p className="mt-2 break-words text-xs text-tinta/60">
                {c.cae ? `CAE ${c.cae} · vto ${c.cae_vencimiento}` : 'CAE pendiente de ARCA'}
              </p>
            )}
          </div>
        </div>

        {/* receptor */}
        <div className="grid gap-1 border-b border-black/[0.06] px-4 py-3 text-sm text-tinta sm:grid-cols-2 sm:px-5 print:grid-cols-2 print:px-5">
          <p className="break-words"><span className="text-xs text-tinta/60">Señor/es:</span> {c.receptor?.nombre ?? 'Consumidor final'}</p>
          <p className="break-words"><span className="text-xs text-tinta/60">{c.receptor?.doc_tipo ?? 'Doc'}:</span> {c.receptor?.doc_numero ?? '—'}</p>
          <p><span className="text-xs text-tinta/60">Cond. IVA:</span> {(c.receptor?.condicion_iva ?? 'consumidor final').replaceAll('_', ' ')}</p>
          <p><span className="text-xs text-tinta/60">Cond. pago:</span> {c.condicion_pago === 'cta_cte' ? 'Cuenta corriente' : 'Contado'}</p>
          {c.receptor?.domicilio && <p className="break-words sm:col-span-2 print:col-span-2"><span className="text-xs text-tinta/60">Domicilio:</span> {c.receptor.domicilio}</p>}
          {c.referencia && (
            <p className="text-xs text-tinta/70 sm:col-span-2 print:col-span-2">
              Ref.: {TIPOS[c.referencia.tipo]} {String(c.referencia.punto_venta).padStart(4, '0')}-{String(c.referencia.numero).padStart(8, '0')}
            </p>
          )}
        </div>

        {/* renglones: tabla de verdad (también en el papel); en el celular scrollea dentro del comprobante si no entra */}
        <div className="overflow-x-auto">
          <table className="tabla-kit w-full text-sm text-tinta">
            <thead>
              <tr className="border-b border-black/[0.06] text-left text-xs text-tinta/60">
                <th className="py-2 pl-4 pr-1.5 font-medium sm:pl-5 sm:pr-2 print:pl-5">Descripción</th>
                <th className="px-1.5 py-2 text-right font-medium sm:px-2">Cant.</th>
                <th className="px-1.5 py-2 text-right font-medium sm:px-2">{discrimina ? 'P. unit. (neto)' : 'P. unitario'}</th>
                {discrimina && <th className="px-1.5 py-2 text-right font-medium sm:px-2">IVA</th>}
                <th className="py-2 pl-1.5 pr-4 text-right font-medium sm:pl-2 sm:pr-5 print:pr-5">Importe</th>
              </tr>
            </thead>
            <tbody>
              {(c.items ?? []).map((i: any, idx: number) => {
                const alic = Number(i.alicuota ?? 21);
                const renglon = Number(i.precioUnitario) * Number(i.cantidad);
                const unitNeto = alic > 0 ? Number(i.precioUnitario) / (1 + alic / 100) : Number(i.precioUnitario);
                return (
                  <tr key={idx} className="border-b border-black/[0.06]">
                    <td className="py-2 pl-4 pr-1.5 sm:pl-5 sm:pr-2 print:pl-5">
                      <span className="break-words">{i.descripcion}</span>
                      {i.sku && <span className="ml-2 text-xs text-tinta/60">[{i.sku}]</span>}
                    </td>
                    <td className="importe px-1.5 py-2 text-right sm:px-2">{i.cantidad}</td>
                    <td className="importe px-1.5 py-2 text-right sm:px-2"><Monto valor={discrimina ? unitNeto : i.precioUnitario} decimales /></td>
                    {discrimina && <td className="importe px-1.5 py-2 text-right text-xs sm:px-2">{alic} %</td>}
                    <td className="importe py-2 pl-1.5 pr-4 text-right sm:pl-2 sm:pr-5 print:pr-5"><Monto valor={discrimina ? unitNeto * i.cantidad : renglon} decimales /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* totales */}
        <div className="flex justify-end px-4 py-4 sm:px-5 print:px-5">
          <div className="w-full space-y-1 text-sm text-tinta sm:w-72 print:w-72">
            {discrimina && (
              <>
                <p className="flex justify-between gap-3"><span className="text-tinta/70">Neto gravado</span><Monto valor={c.neto} decimales /></p>
                {(c.iva_detalle ?? []).map((d: any) => (
                  <p key={d.alicuota} className="flex justify-between gap-3">
                    <span className="text-tinta/70">IVA {d.alicuota} %</span>
                    <Monto valor={d.monto} decimales />
                  </p>
                ))}
              </>
            )}
            <p className="flex justify-between gap-3 border-t border-black/15 pt-2 text-base font-semibold">
              <span>TOTAL</span><Monto valor={c.total} decimales />
            </p>
          </div>
        </div>

        {/* recibo: facturas canceladas + medios de pago */}
        {reciboDet && (
          <div className="grid gap-5 border-t border-black/[0.06] px-4 pb-4 pt-4 text-sm sm:grid-cols-2 sm:px-5 print:grid-cols-2 print:px-5">
            <div className="min-w-0">
              <p className={ROTULO_COMPROBANTE}>Facturas canceladas</p>
              {reciboDet.imputaciones.length === 0 && <p className="text-xs text-tinta/60">—</p>}
              {reciboDet.imputaciones.map((im: any, i: number) => (
                <p key={i} className="flex justify-between gap-3 border-b border-black/[0.06] py-1">
                  <span className="min-w-0 break-words text-tinta/80">{im.factura?.etiqueta ?? 'Factura'}</span>
                  <Monto valor={im.importe} decimales className="shrink-0" />
                </p>
              ))}
            </div>
            <div className="min-w-0">
              <p className={ROTULO_COMPROBANTE}>Medios de pago</p>
              {reciboDet.medios.length === 0 && <p className="text-xs text-tinta/60">—</p>}
              {reciboDet.medios.map((m: any, i: number) => (
                <p key={i} className="flex justify-between gap-3 border-b border-black/[0.06] py-1">
                  <span className="min-w-0 break-words text-tinta/80">
                    {MEDIO_LABEL[m.medio] ?? m.medio}
                    {m.cheque && <span className="ml-1 text-xs text-tinta/60">N° {m.cheque.numero}{m.cheque.banco ? ` · ${m.cheque.banco}` : ''}</span>}
                    {m.referencia && <span className="ml-1 text-xs text-tinta/60">· {m.referencia}</span>}
                  </span>
                  <Monto valor={m.importe} decimales className="shrink-0" />
                </p>
              ))}
            </div>
          </div>
        )}

        {c.observaciones && (
          <p className="break-words px-4 pb-4 text-xs text-tinta/70 sm:px-5 print:px-5">Obs.: {c.observaciones}</p>
        )}
        {!fiscal && (
          <p className="px-4 pb-4 text-xs text-tinta/60 sm:px-5 print:px-5">
            Documento no válido como factura.
          </p>
        )}
      </Tarjeta>
    </Pantalla>
  );
}
