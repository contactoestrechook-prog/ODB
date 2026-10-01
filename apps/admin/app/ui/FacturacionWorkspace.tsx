'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmitirComprobante } from './EmitirComprobante';
import {
  Cargando,
  Etiqueta,
  FOCO,
  FOCO_ADENTRO,
  IconoOk,
  Kpi,
  Monto,
  Pestanas,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  Vacio,
  unir,
  type TonoEtiqueta,
} from './kit';
import { fechaHora, pesos } from '../lib/formato';

const TIPOS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'N. crédito A', NCB: 'N. crédito B', NCC: 'N. crédito C',
  NDA: 'N. débito A', NDB: 'N. débito B', NDC: 'N. débito C',
  REM: 'Remito', REC: 'Recibo', ANT: 'Anticipo', SIN: 'Interno',
};
// Tono del chip según la primera letra del tipo (F factura, N nota, R remito/recibo, A anticipo, S interno)
const CHIP: Record<string, TonoEtiqueta> = {
  F: 'info', N: 'error', R: 'neutro', A: 'atencion', S: 'neutro',
};

const TABS = [
  ['resumen', 'Resumen', ''],
  ['facturas', 'Facturas', 'FA,FB,FC'],
  ['nc', 'Notas de crédito', 'NCA,NCB,NCC'],
  ['nd', 'Notas de débito', 'NDA,NDB,NDC'],
  ['remitos', 'Remitos', 'REM'],
  ['recibos', 'Recibos y anticipos', 'REC,ANT'],
  ['cuentas', 'Cuentas corrientes', ''],
] as const;

const numero = (c: any) => `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

export function FacturacionWorkspace({
  resumen, cuentas, sucursales, ventaInicial,
}: {
  resumen: any; cuentas: any[]; sucursales: any[]; ventaInicial?: { id: string; total: number } | null;
}) {
  const [tab, setTab] = useState<string>(ventaInicial ? 'facturas' : 'resumen');
  const [cache, setCache] = useState<Record<string, any[]>>({});
  const [cargando, setCargando] = useState(false);

  const tabDef = TABS.find((t) => t[0] === tab)!;
  const porCobrar = cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  useEffect(() => {
    const filtro = tabDef[2];
    if (!filtro || cache[tab]) return;
    setCargando(true);
    fetch(`/api/facturacion?tipo=${filtro}&limite=150`)
      .then((r) => r.json())
      .then((d) => setCache((c) => ({ ...c, [tab]: Array.isArray(d) ? d : [] })))
      .finally(() => setCargando(false));
  }, [tab]);

  const G = resumen?.grupos ?? {};
  const grupoTotal = (k: string) => G[k]?.total ?? 0;
  const grupoCant = (k: string) => G[k]?.cantidad ?? 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* indicadores */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi etiqueta="Facturado hoy" valor={<Monto valor={resumen?.facturadoHoy ?? 0} />} />
          <Kpi etiqueta="IVA débito del mes" valor={<Monto valor={resumen?.ivaMes ?? 0} />} />
          <button
            type="button"
            onClick={() => setTab('cuentas')}
            className={unir('col-span-2 rounded-2xl text-left transition-transform active:scale-[0.99] sm:col-span-1', FOCO)}
          >
            <Kpi
              etiqueta="Por cobrar"
              valor={<Monto valor={resumen?.porCobrar ?? porCobrar} />}
              sub={`${resumen?.cuentasActivas ?? 0} ctas →`}
              tono="atencion"
              className="h-full hover:border-black/15"
            />
          </button>
        </div>
        <div className="shrink-0">
          <EmitirComprobante sucursales={sucursales} ventaInicial={ventaInicial ?? null} />
        </div>
      </div>

      {/* pestañas */}
      <Pestanas
        etiquetaAccesible="Comprobantes"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {/* RESUMEN */}
      {tab === 'resumen' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['facturas', 'Facturas emitidas', 'F'],
            ['notasCredito', 'Notas de crédito', 'N'],
            ['notasDebito', 'Notas de débito', 'N'],
            ['remitos', 'Remitos', 'R'],
            ['recibos', 'Recibos y anticipos', 'R'],
            ['internos', 'Comprobantes internos', 'S'],
          ].map(([k, label, chip]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                const map: Record<string, string> = { facturas: 'facturas', notasCredito: 'nc', notasDebito: 'nd', remitos: 'remitos', recibos: 'recibos', internos: 'recibos' };
                setTab(map[k] ?? 'facturas');
              }}
              className={unir(
                'min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4 text-left shadow-tarjeta transition-colors hover:border-black/15 sm:p-5',
                FOCO,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Etiqueta tono={CHIP[chip]}>{label}</Etiqueta>
                <span className="importe text-xs text-tinta/60">{grupoCant(k)}</span>
              </div>
              <p className="mt-2 truncate text-xl font-semibold text-tinta">
                <Monto valor={grupoTotal(k)} />
              </p>
              <p className="mt-0.5 text-xs text-tinta/60">este mes</p>
            </button>
          ))}
        </div>
      )}

      {/* CUENTAS CORRIENTES */}
      {tab === 'cuentas' && (
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera
            titulo={`Cuentas corrientes (${cuentas.length})`}
            accion={<span className="importe text-sm font-semibold text-atencion">{pesos(porCobrar)} por cobrar</span>}
          />
          {cuentas.length === 0 && <Vacio className="m-4" titulo="Sin movimientos de cuenta corriente." />}
          <ul className="divide-y divide-black/[0.06]">
            {cuentas.map((c) => (
              <li key={c.cliente?.id}>
                <Link
                  href={`/facturacion/cuentas/${c.cliente?.id}`}
                  className={unir('flex min-h-11 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
                >
                  <div className="min-w-0 text-sm text-tinta">
                    <p className="break-words font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p>
                    <p className="text-xs text-tinta/60">{c.cliente?.dni} {c.cliente?.telefono && `· ${c.cliente.telefono}`}</p>
                  </div>
                  <p className={unir('importe shrink-0 text-sm font-semibold', c.saldo > 0 ? 'text-marca-hondo' : 'text-ok')}>
                    {c.saldo > 0 ? `debe ${pesos(c.saldo ?? 0)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {/* LISTADOS DE COMPROBANTES */}
      {tabDef[2] && (
        cargando ? (
          <Tarjeta>
            <Cargando bloque />
          </Tarjeta>
        ) : (
          <TablaResponsiva
            etiqueta={tabDef[1]}
            filas={cache[tab] ?? []}
            claveFila="id"
            hrefFila={(c) => `/facturacion/${c.id}`}
            vacio={<Vacio titulo="Sin comprobantes de este tipo todavía." />}
            columnas={[
              {
                clave: 'comprobante',
                titulo: 'Comprobante',
                principal: true,
                celda: (c) => (
                  <span className={unir('inline-flex flex-wrap items-center gap-2', c.estado === 'anulado' && 'opacity-60')}>
                    <Etiqueta tono={CHIP[c.tipo[0]] ?? CHIP.S}>{TIPOS[c.tipo] ?? c.tipo}</Etiqueta>
                    <span className="font-mono text-xs">{numero(c)}</span>
                    {c.estado === 'anulado' && <Etiqueta tono="error">ANULADO</Etiqueta>}
                  </span>
                ),
              },
              {
                clave: 'receptor',
                titulo: 'Receptor',
                celda: (c) => (
                  <span className={unir('inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', c.estado === 'anulado' && 'opacity-60')}>
                    <span className="min-w-0 break-words">{c.cliente?.razon_social ?? c.cliente?.nombre ?? c.receptor?.nombre ?? 'Consumidor final'}</span>
                    {c.condicion_pago === 'cta_cte' && <Etiqueta tono="atencion">CTA CTE</Etiqueta>}
                  </span>
                ),
              },
              {
                clave: 'fecha',
                titulo: 'Fecha',
                claseCelda: 'whitespace-nowrap',
                celda: (c) => <span className={unir('text-tinta/60', c.estado === 'anulado' && 'opacity-60')}>{fechaHora(c.emitido_en)}</span>,
              },
              {
                clave: 'cae',
                titulo: 'CAE',
                alinear: 'centro',
                celda: (c) =>
                  ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'].includes(c.tipo)
                    ? c.cae
                      ? <span className="inline-flex text-ok" title="Con CAE"><IconoOk className="size-5" /><span className="sr-only">Con CAE</span></span>
                      : <Etiqueta tono="atencion">pend.</Etiqueta>
                    : <span className="text-tinta/40">—</span>,
              },
              {
                clave: 'total',
                titulo: 'Total',
                importe: true,
                celda: (c) => <Monto valor={c.total ?? 0} className={unir('font-semibold', c.estado === 'anulado' && 'opacity-60')} />,
              },
            ]}
          />
        )
      )}
    </div>
  );
}
