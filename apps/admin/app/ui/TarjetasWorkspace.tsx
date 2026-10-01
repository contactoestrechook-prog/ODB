'use client';

import { Etiqueta, Kpi, TablaResponsiva, Tarjeta, TarjetaCabecera } from './kit';
import { fecha as fechaLarga, pesos } from '../lib/formato';

const fecha = (s: string | null) => fechaLarga(s, 'corta');
const TERMINAL: Record<string, string> = { getnet: 'Getnet (Santander)', clover: 'Clover' };

export function TarjetasWorkspace({ resumen, pagos }: { resumen: any; pagos: any[] }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Cobrado con tarjeta (30 días)" valor={pesos(resumen?.bruto)} sub={`${resumen?.cobros ?? 0} cobros`} />
        <Kpi etiqueta="Por acreditar" valor={pesos(resumen?.porAcreditar)} tono={resumen?.porAcreditar > 0 ? 'atencion' : 'neutro'} />
        <Kpi etiqueta="Acreditado (neto)" valor={pesos(resumen?.acreditado)} tono="ok" />
        <Kpi
          etiqueta="Comisión real"
          valor={pesos(resumen?.comisionReal)}
          tono="error"
          sub={resumen?.comisionPromedioPct != null ? `${resumen.comisionPromedioPct} % promedio` : 'se completa al conciliar'}
        />
      </div>

      {/* por terminal */}
      {(resumen?.porTerminal ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {resumen.porTerminal.map((t: any) => (
            <Tarjeta key={t.terminal}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 font-semibold text-tinta">{TERMINAL[t.terminal] ?? t.terminal}</p>
                <p className="importe text-base font-semibold text-tinta">{pesos(t.bruto)}</p>
              </div>
              <p className="mt-1 text-xs text-tinta/60">
                {t.cobros} cobros · por acreditar {pesos(t.porAcreditar)} · acreditado {pesos(t.acreditado)}
                {t.comisionReal > 0 ? ` · comisión ${pesos(t.comisionReal)}` : ''}
              </p>
            </Tarjeta>
          ))}
        </div>
      )}

      {/* próximas acreditaciones */}
      {(resumen?.proximasAcreditaciones ?? []).length > 0 && (
        <Tarjeta>
          <p className="mb-2 text-sm font-semibold text-tinta">Próximas acreditaciones estimadas</p>
          <div className="flex flex-wrap gap-2">
            {resumen.proximasAcreditaciones.map((p: any) => (
              <span key={p.fecha} className="rounded-full bg-crema px-3 py-1 text-xs text-tinta">
                {fecha(p.fecha)} · <span className="importe font-semibold">{pesos(p.bruto)}</span>
              </span>
            ))}
          </div>
        </Tarjeta>
      )}

      {/* listado */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Cobros con tarjeta (últimos 30 días · ${pagos.length})`} />
        <TablaResponsiva
          sinMarco
          etiqueta="Cobros con tarjeta"
          filas={pagos}
          claveFila="id"
          vacio={
            <p className="px-4 py-10 text-center text-sm text-tinta/60">
              Todavía no hay cobros con tarjeta registrados. Cuando la caja cobre con Getnet o Clover, aparecen acá
              con su fecha estimada de acreditación.
            </p>
          }
          columnas={[
            { clave: 'fecha', titulo: 'Fecha', celda: (p) => <span className="importe text-xs text-tinta/70">{fecha(p.fecha)}</span> },
            {
              clave: 'terminal',
              titulo: 'Terminal',
              principal: true,
              celda: (p) => <Etiqueta tono="neutro">{TERMINAL[p.terminal] ?? p.terminal ?? 'sin identificar'}</Etiqueta>,
            },
            { clave: 'sucursal', titulo: 'Sucursal', celda: (p) => <span className="text-xs text-tinta/70">{p.sucursal ?? '—'}</span> },
            { clave: 'bruto', titulo: 'Bruto', importe: true, celda: (p) => <span className="font-semibold">{pesos(p.bruto)}</span> },
            { clave: 'comision', titulo: 'Comisión', importe: true, celda: (p) => <span className="text-xs text-marca-hondo">{p.comisionReal != null ? pesos(p.comisionReal) : '—'}</span> },
            { clave: 'neto', titulo: 'Neto', importe: true, celda: (p) => <span className="text-xs">{p.netoReal != null ? pesos(p.netoReal) : '—'}</span> },
            {
              clave: 'acreditacion',
              titulo: 'Acreditación',
              alinear: 'derecha',
              celda: (p) =>
                p.estado === 'acreditada'
                  ? <Etiqueta tono="ok">acreditado {fecha(p.fechaReal)}</Etiqueta>
                  : <span className="whitespace-nowrap text-xs text-tinta/70">estimado {fecha(p.fechaEstimada)}</span>,
            },
          ]}
        />
      </Tarjeta>
      <p className="px-1 text-xs text-tinta/60">
        La comisión y el neto reales se completan al conciliar la liquidación de cada procesador (Conciliación → Acreditar,
        o automático cuando integremos Getnet y Clover por API). La fecha estimada usa el plazo típico de acreditación (2 días);
        con las liquidaciones pasa a ser la fecha exacta.
      </p>
    </div>
  );
}
