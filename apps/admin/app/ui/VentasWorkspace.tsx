'use client';

import { useEffect, useState } from 'react';
import { BotonAnular } from './BotonAnular';
import { Boton, BotonLink, Cargando, Entrada, Kpi, Monto, Pestanas, TablaResponsiva, Tarjeta, TarjetaCabecera, FOCO, unir } from './kit';
import { fechaHora, pesos } from '../lib/formato';

const MEDIO_LABEL: Record<string, string> = { efectivo: 'Efectivo', mercadopago: 'Mercado Pago', tarjeta: 'Tarjeta', cta_cte: 'Cuenta corriente' };

const TABS = [['dia', 'Del día'], ['sucursal', 'Por sucursal'], ['medios', 'Medios de pago'], ['anuladas', 'Anuladas'], ['buscar', 'Buscar ticket']] as const;

// Tarjeta que se elige (sucursal o medio de pago): la elegida lleva el borde rojo.
const tarjetaFiltro = (activa: boolean) =>
  unir(
    'min-w-0 rounded-2xl border bg-white p-4 text-left shadow-tarjeta transition-colors active:scale-[0.98]',
    activa ? 'border-marca ring-1 ring-marca' : 'border-black/[0.06] hover:border-black/15',
    FOCO,
  );

export function VentasWorkspace({ resumen, ventas, sucursales }: { resumen: any; ventas: any[]; sucursales: any[] }) {
  const [tab, setTab] = useState('dia');
  const [lista, setLista] = useState<any[]>(ventas);
  const [cargando, setCargando] = useState(false);
  const [sucursalId, setSucursalId] = useState('');
  const [medio, setMedio] = useState('');
  const [buscar, setBuscar] = useState('');

  const cargar = async (qs: string) => {
    setCargando(true);
    try { const r = await fetch(`/api/ventas?${qs}`); const d = await r.json(); setLista(Array.isArray(d) ? d : []); }
    finally { setCargando(false); }
  };

  useEffect(() => {
    if (tab === 'dia') setLista(ventas);
    if (tab === 'sucursal') cargar(`limite=50${sucursalId ? `&sucursalId=${sucursalId}` : ''}`);
    if (tab === 'medios') cargar(`limite=50${medio ? `&medioPago=${medio}` : ''}`);
    if (tab === 'anuladas') cargar('estado=anulada&limite=50');
  }, [tab, sucursalId, medio]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs de hoy */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Facturado hoy" valor={<Monto valor={resumen?.facturado ?? 0} />} />
        <Kpi etiqueta="Tickets" valor={resumen?.tickets ?? 0} />
        <Kpi etiqueta="Ticket promedio" valor={<Monto valor={resumen?.ticketPromedio ?? 0} />} />
        <Kpi etiqueta="Descuentos" valor={<Monto valor={resumen?.descuentos ?? 0} />} />
      </div>

      <Pestanas
        etiquetaAccesible="Vistas de ventas"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {/* desgloses */}
      {tab === 'sucursal' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" aria-pressed={!sucursalId} onClick={() => setSucursalId('')} className={tarjetaFiltro(!sucursalId)}>
            <p className="text-sm font-semibold text-tinta">Todas</p>
            <p className="text-xs text-tinta/60">{resumen?.tickets ?? 0} tickets hoy</p>
          </button>
          {sucursales.map((s) => {
            const r = resumen?.porSucursal?.[s.nombre];
            return (
              <button key={s.id} type="button" aria-pressed={sucursalId === s.id} onClick={() => setSucursalId(s.id)} className={tarjetaFiltro(sucursalId === s.id)}>
                <p className="truncate text-sm font-semibold text-tinta">{s.nombre}</p>
                <p className="mt-1 truncate text-lg font-semibold text-tinta"><Monto valor={r?.facturado ?? 0} /></p>
                <p className="text-xs text-tinta/60">{r?.tickets ?? 0} tickets hoy</p>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'medios' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Object.entries(MEDIO_LABEL).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={medio === k} onClick={() => setMedio(medio === k ? '' : k)} className={tarjetaFiltro(medio === k)}>
              <p className="truncate text-sm font-semibold text-tinta">{label}</p>
              <p className="mt-1 truncate text-lg font-semibold text-tinta"><Monto valor={resumen?.porMedio?.[k] ?? 0} /></p>
              <p className="text-xs text-tinta/60">hoy</p>
            </button>
          ))}
        </div>
      )}

      {tab === 'buscar' && (
        <form onSubmit={(e) => { e.preventDefault(); cargar(`buscar=${encodeURIComponent(buscar)}&limite=50`); }} className="flex flex-col gap-2 sm:flex-row">
          <Entrada
            aria-label="Buscar ticket"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="N° de ticket, DNI o nombre del cliente…"
            className="sm:flex-1"
          />
          <Boton type="submit">Buscar</Boton>
        </form>
      )}

      {/* listado */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera
          titulo={<>{tab === 'anuladas' ? 'Ventas anuladas' : tab === 'buscar' ? 'Resultados' : 'Operaciones'}{!cargando && ` (${lista.length})`}</>}
        />
        {cargando ? <Cargando bloque />
          : lista.length === 0 ? <p className="px-4 py-8 text-center text-sm text-tinta/60">{tab === 'anuladas' ? 'No hay ventas anuladas.' : 'Sin ventas para este filtro.'}</p>
          : (
          <TablaResponsiva
            sinMarco
            etiqueta="Ventas"
            filas={lista}
            claveFila="id"
            columnas={[
              {
                clave: 'detalle',
                titulo: 'Detalle',
                principal: true,
                celda: (v) => (
                  <div className={unir('min-w-0', v.estado === 'anulada' && 'opacity-50')}>
                    <p className="break-words text-sm font-medium text-tinta">{(v.items ?? []).slice(0, 3).map((i: any) => `${i.producto?.nombre ?? '—'} ×${Math.round(Number(i.cantidad))}`).join(' · ')}{(v.items ?? []).length > 3 ? ` +${v.items.length - 3}` : ''}</p>
                    <p className="break-words text-xs font-normal text-tinta/60">{(v.pagos ?? []).map((p: any) => `${MEDIO_LABEL[p.medio] ?? p.medio} ${pesos(p.monto ?? 0)}`).join(' + ')}{v.cliente?.dni ? ` · ${v.cliente?.nombre ?? 'DNI ' + v.cliente.dni}` : ''}</p>
                  </div>
                ),
              },
              {
                clave: 'fecha',
                titulo: 'Fecha',
                ancho: 'w-32',
                celda: (v) => (
                  <div className={unir(v.estado === 'anulada' && 'opacity-50')}>
                    <p className="importe text-xs text-tinta/70">{fechaHora(v.vendida_en)}</p>
                    <p className="text-xs text-tinta/60">{v.sucursal?.nombre}</p>
                  </div>
                ),
              },
              {
                clave: 'total',
                titulo: 'Total',
                importe: true,
                celda: (v) => (
                  <div className={unir(v.estado === 'anulada' && 'opacity-50')}>
                    <p className="font-semibold"><Monto valor={v.total ?? 0} /></p>
                    {v.estado === 'anulada' && <span className="text-xs text-tinta/60">anulada · NC</span>}
                  </div>
                ),
              },
              {
                clave: 'acciones',
                titulo: '',
                acciones: true,
                celda: (v) => v.estado === 'anulada' ? null : (
                  <>
                    <BotonLink variante="secundario" tamano="chico" href={`/facturacion?venta=${v.id}&total=${v.total}`}>Facturar</BotonLink>
                    <BotonAnular ventaId={v.id} total={v.total} />
                  </>
                ),
              },
            ]}
          />
        )}
      </Tarjeta>
    </div>
  );
}
