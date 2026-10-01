import { apiFetch } from '../../lib/api';
import { Aviso, Etiqueta, FOCO, Kpi, Monto, TablaResponsiva, Tarjeta, TarjetaCabecera, unir } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';
import { fecha, numero, pesos } from '../lib/formato';

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cta_cte: 'Cuenta corriente',
};

// Colores de la barra de medios de pago (en orden)
const COLORES_MEDIO = ['bg-marca', 'bg-tinta', 'bg-marca-hondo', 'bg-crema-hondo'];

export const dynamic = 'force-dynamic';

function TablaRanking({
  titulo,
  filas,
  valor,
  formato,
}: {
  titulo: string;
  filas: any[];
  valor: string;
  formato: 'unidades' | 'pesos';
}) {
  const max = Math.max(...filas.map((f) => f[valor]), 1);
  return (
    <Tarjeta relleno={false} className="overflow-hidden">
      <TarjetaCabecera titulo={titulo} />
      <ul className="divide-y divide-black/[0.06]">
        {filas.map((f) => (
          <li key={f.sku ?? f.nombre} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs text-tinta">{f.nombre}</p>
              <div className="mt-1 h-1.5 rounded-full bg-crema">
                <div
                  className="h-1.5 rounded-full bg-marca"
                  style={{ width: `${Math.max((f[valor] / max) * 100, 2)}%` }}
                />
              </div>
            </div>
            <p className="importe shrink-0 text-right text-xs font-medium text-tinta">
              {formato === 'pesos' ? pesos(f[valor]) : `${f[valor]} u.`}
            </p>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// Semáforo de cobertura: días que dura el stock al ritmo de venta.
function chipCobertura(dias: number | null) {
  if (dias == null) return <span className="text-xs text-tinta/60">s/d</span>;
  return (
    <Etiqueta tono={dias <= 7 ? 'error' : dias <= 15 ? 'atencion' : 'ok'} punto={dias <= 7}>
      {dias} d
    </Etiqueta>
  );
}

function TablaCobertura({ filas }: { filas: any[] }) {
  const urgentes = filas.filter((f) => f.coberturaDias != null && f.coberturaDias <= 7).length;
  return (
    <Tarjeta relleno={false} className="overflow-hidden">
      <TarjetaCabecera
        titulo="Más vendidos · cobertura de stock"
        sub={
          <>
            {urgentes > 0 ? <span className="font-medium text-marca-hondo">{urgentes} para reponer ya</span> : 'stock cubierto'} · tocá los días para ver el stock
          </>
        }
      />
      <TablaResponsiva
        sinMarco
        etiqueta="Más vendidos y cobertura de stock"
        filas={filas}
        claveFila={(f: any) => f.sku ?? f.nombre}
        columnas={[
          {
            clave: 'producto',
            titulo: 'Producto',
            principal: true,
            celda: (f: any) => (
              <>
                <p className="break-words text-sm font-medium">{f.nombre}</p>
                <p className="text-xs font-normal text-tinta/60">{f.sku}</p>
              </>
            ),
          },
          { clave: 'vendidas', titulo: 'Vendidas (30d)', importe: true, claseCelda: 'whitespace-nowrap', celda: (f: any) => `${f.unidades} u.` },
          { clave: 'stock', titulo: 'Stock', importe: true, claseCelda: 'whitespace-nowrap', celda: (f: any) => `${f.stock} u.` },
          {
            clave: 'cobertura',
            titulo: 'Cobertura',
            alinear: 'derecha',
            celda: (f: any) =>
              f.sku ? (
                <a
                  href={`/stock?sku=${encodeURIComponent(f.sku)}`}
                  className={unir('inline-flex min-h-11 items-center rounded-full hover:opacity-80 md:min-h-0', FOCO)}
                  title="Ver el stock de este producto"
                >
                  {chipCobertura(f.coberturaDias)}
                </a>
              ) : (
                chipCobertura(f.coberturaDias)
              ),
          },
        ]}
      />
    </Tarjeta>
  );
}

export default async function Estadisticas() {
  let d: any = null;
  let error: string | null = null;
  try {
    const res = await apiFetch('/estadisticas');
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    d = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  if (!d) {
    return (
      <Pantalla activo="/estadisticas">
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      </Pantalla>
    );
  }

  const maxDia = Math.max(...d.ventasPorDia.map((v: any) => v.total), 1);
  const totalMedios = d.porMedio.reduce((s: number, m: any) => s + m.total, 0) || 1;

  return (
    <Pantalla activo="/estadisticas" ancho="ancho">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi etiqueta="Facturado (30 días)" valor={<Monto valor={d.totales.facturado} />} className="col-span-2 md:col-span-1" />
        <Kpi etiqueta="Tickets" valor={numero(d.totales.tickets)} />
        <Kpi etiqueta="Ticket promedio" valor={<Monto valor={d.totales.ticketPromedio} />} />
        <Kpi etiqueta="Descuentos otorgados" valor={<Monto valor={d.totales.descuentos} />} tono="error" className="col-span-2 md:col-span-1" />
      </div>

      {d.historico && (
        <Aviso tono="info">
          Los rankings incluyen las ventas del sistema anterior del{' '}
          {fecha(d.historico.desde, 'corta')} al{' '}
          {fecha(d.historico.hasta, 'corta')}{' '}
          ({numero(d.historico.unidades)} unidades). La facturación y los tickets arrancan con las ventas
          cargadas en este sistema.
        </Aviso>
      )}

      {d.totales.tickets > 0 && (
        <Tarjeta>
          <h2 className="mb-3 text-base font-semibold text-tinta">Ventas por día (30 días)</h2>
          <div className="flex h-36 items-end gap-[3px]">
            {d.ventasPorDia.map((v: any) => (
              <div
                key={v.fecha}
                className="min-w-0 flex-1 rounded-t-sm bg-marca transition-colors hover:bg-marca-hondo"
                style={{ height: `${Math.max((v.total / maxDia) * 100, 1.5)}%` }}
                title={`${v.fecha}: ${pesos(v.total)} (${v.tickets} tickets)`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-tinta/60">
            <span>hace 30 días</span>
            <span>hoy</span>
          </div>
        </Tarjeta>
      )}

      {d.ganadores.length > 0 && (
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera titulo="Ganadores del momento (aceleran su ritmo esta semana)" />
          <ul className="divide-y divide-black/[0.06]">
            {d.ganadores.map((g: any) => (
              <li key={g.sku} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-tinta">{g.nombre}</p>
                  <p className="text-xs text-tinta/60">{g.sku} · {g.unidades7} u. esta semana</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <Etiqueta tono="ok">▲ +{g.crecimientoPct} %</Etiqueta>
                  <span className="importe text-xs text-tinta/60 sm:w-28 sm:text-right">margen {pesos(g.margen)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {d.topCobertura?.length > 0 && <TablaCobertura filas={d.topCobertura} />}

      <div className="grid gap-4 md:grid-cols-2">
        <TablaRanking titulo="Más vendidos (unidades)" filas={d.topUnidades} valor="unidades" formato="unidades" />
        {d.peores.length > 0 && (
          <TablaRanking titulo="Peores (candidatos a liquidar)" filas={d.peores} valor="unidades" formato="unidades" />
        )}
        {d.topFacturacion.length > 0 && (
          <TablaRanking titulo="Más facturación" filas={d.topFacturacion} valor="facturado" formato="pesos" />
        )}
        {d.topMargen.length > 0 && (
          <TablaRanking titulo="Más margen (la plata de verdad)" filas={d.topMargen} valor="margen" formato="pesos" />
        )}
      </div>

      {d.porMedio.length > 0 && (
        <Tarjeta>
          <h2 className="mb-3 text-base font-semibold text-tinta">Medios de pago (30 días)</h2>
          <div className="flex h-7 overflow-hidden rounded-full">
            {d.porMedio.map((m: any, i: number) => (
              <div
                key={m.medio}
                className={COLORES_MEDIO[i % 4]}
                style={{ width: `${(m.total / totalMedios) * 100}%` }}
                title={`${MEDIO_LABEL[m.medio] ?? m.medio}: ${pesos(m.total)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-tinta/70">
            {d.porMedio.map((m: any, i: number) => (
              <span key={m.medio} className="flex items-center gap-1.5">
                <span className={unir('inline-block size-2.5 shrink-0 rounded-full', COLORES_MEDIO[i % 4])} />
                {MEDIO_LABEL[m.medio] ?? m.medio} · {pesos(m.total)} ({Math.round((m.total / totalMedios) * 100)} %)
              </span>
            ))}
          </div>
        </Tarjeta>
      )}
    </Pantalla>
  );
}
