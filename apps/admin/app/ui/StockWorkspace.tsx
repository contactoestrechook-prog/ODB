'use client';

import { useEffect, useState, type Key, type ReactNode } from 'react';
import { AccionesStock } from './AccionesStock';
import { BotonPromo } from './BotonPromo';
import {
  Boton,
  Cargando,
  Entrada,
  Etiqueta,
  IconoOk,
  Kpi,
  Monto,
  Pestanas,
  Selector,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  type ColumnaTabla,
  type TonoEtiqueta,
} from './kit';
import { fecha, fechaHora, numero } from '../lib/formato';

// Las copias viejas hacían Math.round(Number(n) || 0): "no hay dato" se veía 0.
const num = (n: any) => numero(n ?? 0);

const MOV_LABEL: Record<string, string> = {
  venta: 'Venta', devolucion: 'Devolución', compra: 'Compra', ajuste: 'Ajuste', merma: 'Merma',
  transferencia_salida: 'Transf. salida', transferencia_entrada: 'Transf. entrada',
  reserva: 'Reserva', liberacion_reserva: 'Reserva liberada',
};

const TABS = [
  ['resumen', 'Resumen'], ['reposicion', 'Reposición'], ['vencimientos', 'Vencimientos'],
  ['negativos', 'Stock negativo'], ['rotacion', 'Sin rotación'], ['abc', 'Análisis ABC'],
  ['movimientos', 'Movimientos'],
] as const;

// Clases del análisis ABC: el mismo tono en las tarjetas y en la tabla.
const TONO_ABC: Record<string, TonoEtiqueta> = { A: 'ok', B: 'info', C: 'neutro' };

// Producto + SKU (y lo que venga después) en dos renglones, sin salirse del ancho.
function Producto({ nombre, detalle }: { nombre: ReactNode; detalle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="break-words font-medium text-tinta">{nombre}</p>
      {detalle ? <p className="break-words text-xs font-normal text-tinta/60">{detalle}</p> : null}
    </div>
  );
}

export function StockWorkspace({
  resumen, valorizacion, criticos, vencimientos, sucursales, transferencias,
}: {
  resumen: any; valorizacion: any; criticos: any[]; vencimientos: any; sucursales: any[]; transferencias: any[];
}) {
  const [tab, setTab] = useState('resumen');
  const [data, setData] = useState<Record<string, any>>({});
  const [cargando, setCargando] = useState(false);
  const [movFiltro, setMovFiltro] = useState({ tipo: '', sucursalId: '', dias: '', sku: '' });
  // consulta puntual de stock por producto (cuando se entra con ?sku= desde Estadísticas)
  const [consulta, setConsulta] = useState<any>(null);

  async function cargar(recurso: string, qs = '') {
    setCargando(true);
    try {
      const res = await fetch(`/api/stock?recurso=${recurso}${qs}`);
      const d = await res.json();
      setData((x) => ({ ...x, [recurso]: d }));
    } finally {
      setCargando(false);
    }
  }

  async function consultarProducto(sku: string) {
    const res = await fetch(`/api/pos-stock?q=${encodeURIComponent(sku)}`);
    if (res.ok) { const d = await res.json(); setConsulta(Array.isArray(d) ? d.find((p: any) => p.sku === sku) ?? d[0] : null); }
  }

  // deep-link desde Estadísticas: /stock?sku=XXX → va a Movimientos filtrado por ese producto y muestra su stock
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('sku');
    if (sku) {
      setMovFiltro((f) => ({ ...f, sku }));
      setTab('movimientos');
      consultarProducto(sku);
      cargar('movimientos', `&limite=150&sku=${encodeURIComponent(sku)}`);
    }
  }, []);

  useEffect(() => {
    if (tab === 'negativos' && !data['negativos']) cargar('negativos');
    if (tab === 'abc' && !data['abc']) cargar('abc');
    if (tab === 'rotacion' && !data['sin-rotacion']) cargar('sin-rotacion', '&dias=30');
    if (tab === 'movimientos' && !data['movimientos'] && !movFiltro.sku) cargar('movimientos', '&limite=100');
  }, [tab]);

  const aplicarMovFiltro = () => {
    const qs = `&limite=150${movFiltro.tipo ? `&tipo=${movFiltro.tipo}` : ''}${movFiltro.sucursalId ? `&sucursalId=${movFiltro.sucursalId}` : ''}${movFiltro.dias ? `&dias=${movFiltro.dias}` : ''}${movFiltro.sku ? `&sku=${encodeURIComponent(movFiltro.sku)}` : ''}`;
    if (movFiltro.sku) consultarProducto(movFiltro.sku); else setConsulta(null);
    cargar('movimientos', qs);
  };

  const r = resumen ?? {};
  const valorMax = Math.max(...(valorizacion?.rubros ?? []).map((x: any) => Number(x.valor)), 1);

  return (
    <div className="space-y-4 sm:space-y-6">
      <AccionesStock sucursales={sucursales} transferencias={transferencias} />

      {/* KPIs: en el celular el valor del inventario va abreviado ($250M) para no cortarse */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi
          etiqueta="Valor inventario"
          valor={
            <>
              <Monto valor={r.valor_inventario ?? 0} corto className="md:hidden" />
              <Monto valor={r.valor_inventario ?? 0} className="hidden md:inline" />
            </>
          }
        />
        <Kpi etiqueta="SKUs activos" valor={num(r.skus_activos)} />
        <Kpi etiqueta="Unidades" valor={num(r.unidades)} />
        <Kpi etiqueta="Con stock" valor={num(r.con_stock)} />
        <Kpi etiqueta="Bajo reposición" valor={num(r.bajo_reposicion)} tono={r.bajo_reposicion > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Negativos" valor={num(r.negativos)} tono={r.negativos > 0 ? 'error' : 'neutro'} />
      </div>

      {/* pestañas */}
      <Pestanas
        etiquetaAccesible="Vistas de stock"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => {
          const badge = k === 'reposicion' ? criticos.length : k === 'vencimientos' ? (vencimientos?.lotes?.length ?? 0) : k === 'negativos' ? r.negativos : 0;
          return { valor: k, etiqueta: label, cuenta: badge ? Number(badge) : undefined };
        })}
      />

      {/* RESUMEN: valorización por rubro y sucursal */}
      {tab === 'resumen' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Valor por rubro (top 12)" />
            <div className="space-y-3 p-4 sm:p-5">
              {(valorizacion?.rubros ?? []).slice(0, 12).map((x: any) => (
                <div key={x.rubro}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm text-tinta">
                    <span className="min-w-0 break-words">{x.rubro} <span className="text-xs text-tinta/60">· {x.skus} SKUs</span></span>
                    <Monto valor={x.valor ?? 0} className="shrink-0 font-medium" />
                  </div>
                  <div className="h-1.5 rounded-full bg-crema-hondo">
                    <div className="h-1.5 rounded-full bg-tinta/70" style={{ width: `${Math.max((Number(x.valor) / valorMax) * 100, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Tarjeta>
          <Tarjeta relleno={false} className="h-fit">
            <TarjetaCabecera titulo="Valor por sucursal" />
            <div className="divide-y divide-black/[0.06]">
              {(valorizacion?.sucursales ?? []).map((s: any) => (
                <div key={s.sucursal} className="flex items-baseline justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-tinta">{s.sucursal}</p>
                    <p className="text-xs text-tinta/60">{s.skus} SKUs · {num(s.unidades)} u.</p>
                  </div>
                  <Monto valor={s.valor ?? 0} className="shrink-0 text-lg font-semibold text-tinta" />
                </div>
              ))}
            </div>
          </Tarjeta>
        </div>
      )}

      {/* REPOSICIÓN */}
      {tab === 'reposicion' && (
        <Tabla
          titulo={`Bajo punto de reposición (${criticos.length})`}
          vacio="Ningún producto por debajo de su punto de reposición."
          filas={criticos}
          claveFila={(c: any) => `${c.sku}-${c.sucursal}`}
          columnas={[
            { clave: 'producto', titulo: 'Producto', principal: true, celda: (c: any) => <Producto nombre={c.producto} detalle={c.sku} /> },
            { clave: 'sucursal', titulo: 'Sucursal', celda: (c: any) => <span className="text-tinta/70">{c.sucursal}</span> },
            { clave: 'stock', titulo: 'Stock', importe: true, celda: (c: any) => <Etiqueta tono="error">{num(c.cantidad)}</Etiqueta> },
            { clave: 'minimo', titulo: 'Mínimo', importe: true, celda: (c: any) => <span className="text-tinta/70">{num(c.stock_minimo)}</span> },
            { clave: 'reposicion', titulo: 'Reposición', importe: true, celda: (c: any) => <span className="text-tinta/70">{num(c.punto_reposicion)}</span> },
          ]}
        />
      )}

      {/* VENCIMIENTOS */}
      {tab === 'vencimientos' && (
        <Tabla
          titulo="Vencimientos próximos (45 días)"
          vacio="Sin vencimientos próximos."
          extra={vencimientos?.capitalEnRiesgo ? <span className="text-sm font-medium text-marca-hondo"><Monto valor={vencimientos.capitalEnRiesgo} /> en riesgo</span> : null}
          filas={vencimientos?.lotes ?? []}
          claveFila={(_: any, i: number) => i}
          columnas={[
            { clave: 'producto', titulo: 'Producto', principal: true, celda: (l: any) => <Producto nombre={l.producto} detalle={`${l.sku} · lote ${l.lote}`} /> },
            { clave: 'sucursal', titulo: 'Sucursal', celda: (l: any) => <span className="text-tinta/70">{l.sucursal}</span> },
            {
              clave: 'vence', titulo: 'Vence', alinear: 'derecha',
              celda: (l: any) => (
                <Etiqueta tono={l.estado === 'vencido' || l.estado === 'critico' ? 'error' : l.estado === 'pronto' ? 'atencion' : 'neutro'}>
                  {l.estado === 'vencido' ? 'VENCIDO' : `${l.dias} días`}
                </Etiqueta>
              ),
            },
            { clave: 'unidades', titulo: 'Unidades', importe: true, celda: (l: any) => <span className="text-tinta/70">{l.cantidad}</span> },
            {
              clave: 'accion', titulo: 'Acción', alinear: 'derecha',
              celda: (l: any) => (
                l.estado === 'vencido' ? <span className="text-xs font-medium text-marca-hondo">retirar / merma</span>
                  : l.descuentoSugerido ? <BotonPromo sku={l.sku} nombre={l.producto} porcentaje={l.descuentoSugerido} />
                  : <span className="text-xs text-tinta/60">vigilar</span>
              ),
            },
          ]}
        />
      )}

      {/* NEGATIVOS */}
      {tab === 'negativos' && (
        cargando && !data['negativos'] ? <CargandoTabla /> :
        <Tabla
          titulo={`Stock negativo (${(data['negativos'] ?? []).length})`}
          vacio={<span className="inline-flex items-center gap-2"><IconoOk className="size-5 shrink-0 text-ok" />No hay stock negativo. El inventario está sano.</span>}
          filas={data['negativos'] ?? []}
          claveFila={(_: any, i: number) => i}
          columnas={[
            { clave: 'producto', titulo: 'Producto', principal: true, celda: (n: any) => <Producto nombre={n.producto} detalle={n.sku} /> },
            { clave: 'sucursal', titulo: 'Sucursal', celda: (n: any) => <span className="text-tinta/70">{n.sucursal}</span> },
            { clave: 'stock', titulo: 'Stock', importe: true, celda: (n: any) => <Etiqueta tono="error">{n.cantidad}</Etiqueta> },
            { clave: 'capital', titulo: 'Capital', importe: true, celda: (n: any) => <Monto valor={Number(n.cantidad) * Number(n.costo) || 0} className="text-tinta/70" /> },
          ]}
        />
      )}

      {/* SIN ROTACIÓN */}
      {tab === 'rotacion' && (
        cargando && !data['sin-rotacion'] ? <CargandoTabla /> :
        <Tabla
          titulo="Sin rotación — con stock pero sin ventas en 30 días (capital dormido)"
          vacio="Todo el stock rotó en los últimos 30 días."
          filas={data['sin-rotacion'] ?? []}
          claveFila={(_: any, i: number) => i}
          columnas={[
            { clave: 'producto', titulo: 'Producto', principal: true, celda: (x: any) => <Producto nombre={x.producto} detalle={x.sku} /> },
            { clave: 'unidades', titulo: 'Unidades', importe: true, celda: (x: any) => <span className="text-tinta/70">{num(x.unidades)}</span> },
            { clave: 'capital', titulo: 'Capital dormido', importe: true, celda: (x: any) => <Monto valor={x.capital ?? 0} className="font-medium text-marca-hondo" /> },
            { clave: 'ultima', titulo: 'Última venta', alinear: 'derecha', celda: (x: any) => <span className="text-xs text-tinta/60">{x.ultima_venta ? fecha(x.ultima_venta) : 'nunca'}</span> },
          ]}
        />
      )}

      {/* ABC */}
      {tab === 'abc' && (
        cargando && !data['abc'] ? <CargandoTabla /> : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[['A', 'Generan el 80% de la venta'], ['B', 'El siguiente 15%'], ['C', 'El último 5% (cola larga)']].map(([clase, desc]) => {
                const n = (data['abc'] ?? []).filter((x: any) => x.clase === clase).length;
                return (
                  <Tarjeta key={clase} relleno={false} className="p-3 sm:p-5">
                    <Etiqueta tono={TONO_ABC[clase]}>Clase {clase}</Etiqueta>
                    <p className="importe mt-2 text-xl font-bold text-tinta sm:text-2xl sm:font-semibold">{n}</p>
                    <p className="text-xs text-tinta/60">{desc}</p>
                  </Tarjeta>
                );
              })}
            </div>
            <Tabla
              titulo="Productos por facturación (30 días)"
              vacio="Sin ventas en el período."
              filas={data['abc'] ?? []}
              claveFila={(_: any, i: number) => i}
              columnas={[
                { clave: 'clase', titulo: 'Clase', celda: (x: any) => <Etiqueta tono={TONO_ABC[x.clase] ?? 'neutro'}>{x.clase}</Etiqueta> },
                { clave: 'producto', titulo: 'Producto', principal: true, celda: (x: any) => <Producto nombre={x.producto} detalle={x.sku} /> },
                { clave: 'facturado', titulo: 'Facturado 30d', importe: true, celda: (x: any) => <Monto valor={x.facturado ?? 0} className="font-medium" /> },
                { clave: 'acumulado', titulo: 'Acumulado', importe: true, celda: (x: any) => <span className="text-xs text-tinta/60">{x.acum_pct}%</span> },
              ]}
            />
          </div>
        )
      )}

      {/* MOVIMIENTOS (kardex con filtros) */}
      {tab === 'movimientos' && (
        <div className="space-y-3">
          {/* stock del producto consultado (deep-link desde Estadísticas) */}
          {consulta && (
            <Tarjeta>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-tinta">{consulta.nombre}</p>
                  <p className="break-words text-xs text-tinta/60">{consulta.sku}{consulta.codigo ? ` · ${consulta.codigo}` : ''}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="importe text-2xl font-semibold leading-none text-tinta">{num(consulta.total)}</p>
                  <p className="mt-1 text-xs text-tinta/60">unidades en total</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(consulta.sucursales ?? []).map((s: any) => (
                  <Etiqueta key={s.sucursal} tono={Number(s.cantidad) < 0 ? 'error' : 'neutro'}>
                    {s.sucursal}: <b className="importe">{num(s.cantidad)}</b>
                  </Etiqueta>
                ))}
              </div>
            </Tarjeta>
          )}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Entrada
              value={movFiltro.sku}
              onChange={(e) => setMovFiltro((f) => ({ ...f, sku: e.target.value }))}
              placeholder="SKU / producto"
              aria-label="SKU o producto"
              className="sm:w-44"
            />
            <Selector
              value={movFiltro.tipo}
              onChange={(e) => setMovFiltro((f) => ({ ...f, tipo: e.target.value }))}
              aria-label="Tipo de movimiento"
              className="sm:w-48"
            >
              <option value="">Todos los tipos</option>
              {Object.entries(MOV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>
            <Selector
              value={movFiltro.sucursalId}
              onChange={(e) => setMovFiltro((f) => ({ ...f, sucursalId: e.target.value }))}
              aria-label="Sucursal"
              className="sm:w-52"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Selector>
            <Selector
              value={movFiltro.dias}
              onChange={(e) => setMovFiltro((f) => ({ ...f, dias: e.target.value }))}
              aria-label="Fecha"
              className="sm:w-48"
            >
              <option value="">Cualquier fecha</option>
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
            </Selector>
            <Boton onClick={aplicarMovFiltro}>Filtrar</Boton>
          </div>
          {cargando ? <CargandoTabla /> : (
            <Tabla
              titulo={`Movimientos (${(data['movimientos'] ?? []).length})`}
              vacio="Sin movimientos para ese filtro."
              filas={data['movimientos'] ?? []}
              claveFila="id"
              columnas={[
                { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap', celda: (m: any) => <span className="text-xs text-tinta/60">{fechaHora(m.creado_en)}</span> },
                {
                  clave: 'producto', titulo: 'Producto', principal: true,
                  celda: (m: any) => <Producto nombre={m.producto?.nombre} detalle={`${m.producto?.sku ?? ''}${m.motivo ? ` · ${m.motivo}` : ''}`} />,
                },
                { clave: 'sucursal', titulo: 'Sucursal', celda: (m: any) => <span className="text-xs text-tinta/70">{m.sucursal?.nombre}</span> },
                { clave: 'tipo', titulo: 'Tipo', celda: (m: any) => <span className="text-xs">{MOV_LABEL[m.tipo] ?? m.tipo}</span> },
                // quién lo hizo. Sin nombre: venta web o del bot, o un movimiento
                // viejo de antes de que se guardara el autor (transferencias hasta oct/2026)
                { clave: 'quien', titulo: 'Quién', celda: (m: any) => <span className="text-xs text-tinta/70">{m.usuario?.nombre ?? '—'}</span> },
                {
                  clave: 'cantidad', titulo: 'Cantidad', importe: true,
                  celda: (m: any) => {
                    const salida = Number(m.cantidad) < 0;
                    return <span className={`font-medium ${salida ? 'text-marca-hondo' : 'text-ok'}`}>{salida ? '' : '+'}{num(m.cantidad)}</span>;
                  },
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CargandoTabla() {
  return (
    <Tarjeta relleno={false}>
      <Cargando bloque />
    </Tarjeta>
  );
}

// Una tabla de stock: tarjeta con título (y algo a la derecha) y la tabla del
// kit adentro, que en el celular se ve como tarjetas.
function Tabla<T>({
  titulo, vacio, filas, columnas, claveFila, extra,
}: {
  titulo: string;
  vacio: ReactNode;
  filas: T[];
  columnas: ColumnaTabla<T>[];
  claveFila: keyof T | ((fila: T, indice: number) => Key);
  extra?: ReactNode;
}) {
  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera titulo={titulo} accion={extra} />
      <TablaResponsiva
        sinMarco
        etiqueta={titulo}
        filas={filas}
        columnas={columnas}
        claveFila={claveFila}
        vacio={<p className="px-4 py-8 text-center text-sm text-tinta/60">{vacio}</p>}
      />
    </Tarjeta>
  );
}
