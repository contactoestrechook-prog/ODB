import { apiFetch } from '../../../../lib/api';
import { RegistrarCobranza } from '../../../ui/RegistrarCobranza';
import { BotonVolver } from '../../../ui/BotonVolver';
import { Aviso, Monto, TablaResponsiva, Tarjeta, Vacio, unir } from '../../../ui/kit';
import { Pantalla } from '../../../ui/kit/Pantalla';
import { fecha, pesos } from '../../../lib/formato';

export const dynamic = 'force-dynamic';

export default async function CuentaCliente({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const res = await apiFetch(`/facturacion/cuentas/${clienteId}`);
  if (!res.ok) {
    return (
      <Pantalla activo="/facturacion" ancho="angosto">
        <Aviso tono="error">No existe la cuenta.</Aviso>
      </Pantalla>
    );
  }
  const { cliente, saldo, movimientos } = await res.json();

  // saldo corrido de atrás hacia adelante
  let acumulado = saldo;
  const filas = (movimientos as any[]).map((m) => {
    const fila = { ...m, saldo: acumulado };
    acumulado -= Number(m.debe) - Number(m.haber);
    return fila;
  });

  return (
    <Pantalla activo="/facturacion">
      <div>
        <BotonVolver href="/facturacion/cuentas" label="Todas las cuentas" />
      </div>

      <Tarjeta className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="break-words text-lg font-semibold text-tinta">{cliente.razon_social ?? cliente.nombre}</h2>
          <p className="mt-0.5 text-xs text-tinta/60">
            {cliente.cuit ?? cliente.dni} · {(cliente.condicion_iva ?? '').replaceAll('_', ' ')}
            {cliente.telefono && ` · ${cliente.telefono}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="sm:text-right">
            <p className={unir('importe text-2xl font-semibold leading-none', saldo > 0 ? 'text-marca-hondo' : 'text-ok')}>
              {saldo > 0 ? pesos(saldo) : saldo < 0 ? `${pesos(-saldo)} a favor` : 'Al día'}
            </p>
            {saldo > 0 && <p className="mt-1 text-xs text-tinta/60">saldo deudor</p>}
          </div>
          <RegistrarCobranza clienteId={clienteId} nombre={cliente.razon_social ?? cliente.nombre} saldo={saldo} />
        </div>
      </Tarjeta>

      <TablaResponsiva
        etiqueta="Movimientos de la cuenta corriente"
        filas={filas}
        claveFila={(_m, i) => i}
        vacio={<Vacio titulo="Esta cuenta todavía no tiene movimientos." />}
        columnas={[
          { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap text-tinta/60', celda: (m: any) => fecha(m.creado_en) },
          { clave: 'concepto', titulo: 'Concepto', principal: true, celda: (m: any) => <span className="break-words">{m.concepto}</span> },
          { clave: 'debe', titulo: 'Debe', importe: true, celda: (m: any) => (Number(m.debe) > 0 ? <Monto valor={m.debe} /> : '') },
          { clave: 'haber', titulo: 'Haber', importe: true, celda: (m: any) => (Number(m.haber) > 0 ? <Monto valor={m.haber} className="text-ok" /> : '') },
          {
            clave: 'saldo',
            titulo: 'Saldo',
            importe: true,
            celda: (m: any) => <Monto valor={m.saldo} className={unir('font-medium', m.saldo > 0 ? 'text-marca-hondo' : 'text-tinta')} />,
          },
        ]}
      />
    </Pantalla>
  );
}
