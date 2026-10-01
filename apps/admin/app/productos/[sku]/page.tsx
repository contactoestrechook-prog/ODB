import { Pantalla } from '../../ui/kit/Pantalla';
import { Aviso, BotonLink, Etiqueta, Kpi, Monto, TablaResponsiva, Tarjeta, TarjetaCabecera } from '../../ui/kit';
import { SubirFoto } from '../../ui/SubirFoto';
import { apiFetch } from '../../../lib/api';
import { EditarProducto } from '../../ui/EditarProducto';
import { BotonVolver } from '../../ui/BotonVolver';
import { fecha, pesos } from '../../lib/formato';

const TIPO_MOV: Record<string, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  compra: 'Compra',
  ajuste: 'Ajuste',
  merma: 'Merma',
  transferencia_salida: 'Transf. salida',
  transferencia_entrada: 'Transf. entrada',
};

export const dynamic = 'force-dynamic';

// Lista vacía dentro de una tarjeta: una línea, sin la caja grande de <Vacio>.
const vacioChico = (texto: string) => <p className="px-4 py-4 text-sm text-tinta/60 sm:px-5">{texto}</p>;

export default async function FichaProducto({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  let p: any = null;
  let filtros: any = { categorias: [], marcas: [] };
  try {
    const [res, rf] = await Promise.all([
      apiFetch(`/productos/${encodeURIComponent(sku)}/detalle`),
      apiFetch('/catalogo/filtros'),
    ]);
    if (res.ok) p = await res.json();
    if (rf.ok) filtros = await rf.json();
  } catch {}

  if (!p) {
    return (
      <Pantalla activo="/productos" ancho="normal">
        <Aviso
          tono="error"
          accion={<BotonLink href="/productos" variante="secundario" tamano="chico">Volver</BotonLink>}
        >
          No existe el producto {sku}.
        </Aviso>
      </Pantalla>
    );
  }

  const margenPct = p.costo && p.precio ? Math.round(((p.precio - p.costo) / p.costo) * 100) : null;
  const linea = `${p.sku} · ${p.marca ?? 'sin marca'} · ${p.categoria ?? 'sin categoría'}`;

  return (
    <Pantalla activo="/productos" ancho="normal" titulo={String(p.nombre ?? sku)} bajada={linea}>
      <BotonVolver href="/productos" label="Volver a productos" />

      <Tarjeta className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:gap-5">
        <div className="flex items-center gap-3 sm:flex-col sm:items-center">
          {p.imagenUrl ? (
            <img src={p.imagenUrl} alt={p.nombre} className="size-24 shrink-0 rounded-xl object-cover sm:size-32" />
          ) : (
            <div className="flex size-24 shrink-0 items-center justify-center rounded-xl bg-crema text-sm text-tinta/60 sm:size-32">
              sin foto
            </div>
          )}
          <SubirFoto sku={p.sku} />
        </div>

        <div className="min-w-0 space-y-2">
          {/* en escritorio el nombre y la línea de datos ya están en la cabecera */}
          <div className="lg:hidden">
            <h2 className="break-words text-xl font-bold leading-snug text-tinta">{p.nombre}</h2>
            <p className="mt-1 break-words text-sm text-tinta/60">{linea}</p>
          </div>
          {(p.esAlcohol || p.descuento) && (
            <div className="flex flex-wrap gap-2">
              {p.esAlcohol && <Etiqueta>+18</Etiqueta>}
              {p.descuento && <Etiqueta tono="error">{p.descuento}</Etiqueta>}
            </div>
          )}
          {p.codigosBarras?.length > 0 && (
            <p className="break-all font-mono text-xs text-tinta/60">{p.codigosBarras.join(' · ')}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-black/[0.06] pt-4 sm:items-end sm:border-0 sm:pt-0 sm:text-right">
          <div>
            {p.descuento && <p className="importe text-sm text-tinta/60 line-through">{pesos(p.precioLista)}</p>}
            <p className="importe text-3xl font-bold tracking-tight text-tinta">{pesos(p.precio)}</p>
            <p className="mt-1 text-xs text-tinta/60">
              costo <span className="importe">{pesos(p.costo)}</span> {margenPct != null && `· margen ${margenPct} %`}
            </p>
            {!p.activo && (
              <p className="mt-1 text-xs font-semibold text-marca-hondo">Pausado: no se vende</p>
            )}
          </div>
          <EditarProducto producto={p} rubros={filtros.categorias} marcas={filtros.marcas} />
        </div>
      </Tarjeta>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          etiqueta="Vendido (30 días)"
          valor={`${p.ventas30dias.unidades} u.`}
          sub={`${p.ventas30dias.porDia}/día`}
        />
        <Kpi etiqueta="Facturado (30 días)" valor={<Monto valor={p.ventas30dias.facturado} />} />
        <Kpi etiqueta="Margen (30 días)" valor={<Monto valor={p.ventas30dias.margen} />} />
        <Kpi etiqueta="Stock total" valor={`${Math.round(p.stockTotal)} u.`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Stock por sucursal" />
          <TablaResponsiva
            sinMarco
            etiqueta="Stock por sucursal"
            filas={p.stockPorSucursal as any[]}
            claveFila={(_, i) => i}
            vacio={<></>}
            tarjetaMovil={(s: any) => (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{s.sucursal}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <StockSucursal s={s} />
                  <span className="importe text-xs text-tinta/60">mín. {Math.round(Number(s.stock_minimo))}</span>
                </span>
              </div>
            )}
            columnas={[
              { clave: 'sucursal', titulo: 'Sucursal', celda: (s: any) => s.sucursal },
              { clave: 'cantidad', titulo: 'Stock', importe: true, celda: (s: any) => <StockSucursal s={s} /> },
              {
                clave: 'minimo',
                titulo: 'Mínimo',
                importe: true,
                celda: (s: any) => <span className="text-xs text-tinta/60">mín. {Math.round(Number(s.stock_minimo))}</span>,
              },
            ]}
          />
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Proveedores" />
          <TablaResponsiva
            sinMarco
            etiqueta="Proveedores"
            filas={p.proveedores as any[]}
            claveFila={(_, i) => i}
            vacio={vacioChico('Sin proveedor asignado')}
            tarjetaMovil={(pr: any) => (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words">{pr.proveedor?.razon_social}</p>
                  <p className="text-xs text-tinta/60">
                    {pr.codigo_proveedor ?? 's/cód.'} · entrega {pr.proveedor?.lead_time_dias} días
                  </p>
                </div>
                <span className="importe shrink-0 font-semibold">{pesos(pr.ultimo_costo)}</span>
              </div>
            )}
            columnas={[
              {
                clave: 'proveedor',
                titulo: 'Proveedor',
                celda: (pr: any) => (
                  <>
                    <p>{pr.proveedor?.razon_social}</p>
                    <p className="text-xs text-tinta/60">
                      {pr.codigo_proveedor ?? 's/cód.'} · entrega {pr.proveedor?.lead_time_dias} días
                    </p>
                  </>
                ),
              },
              {
                clave: 'costo',
                titulo: 'Último costo',
                importe: true,
                celda: (pr: any) => <span className="font-semibold">{pesos(pr.ultimo_costo)}</span>,
              },
            ]}
          />
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Historial de costos" />
          <TablaResponsiva
            sinMarco
            etiqueta="Historial de costos"
            filas={p.historialCostos as any[]}
            claveFila={(_, i) => i}
            vacio={vacioChico('Sin cambios registrados')}
            tarjetaMovil={(c: any) => (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-words text-xs text-tinta/60">
                  {fecha(c.creado_en)} · {c.proveedor?.razon_social ?? c.origen}
                </span>
                <span className="importe shrink-0 font-semibold">{pesos(c.costo)}</span>
              </div>
            )}
            columnas={[
              { clave: 'fecha', titulo: 'Fecha', celda: (c: any) => <span className="text-xs text-tinta/60">{fecha(c.creado_en)}</span> },
              {
                clave: 'origen',
                titulo: 'Origen',
                celda: (c: any) => <span className="text-xs text-tinta/60">{c.proveedor?.razon_social ?? c.origen}</span>,
              },
              { clave: 'costo', titulo: 'Costo', importe: true, celda: (c: any) => <span className="font-semibold">{pesos(c.costo)}</span> },
            ]}
          />
        </Tarjeta>

        <Tarjeta relleno={false}>
          <TarjetaCabecera titulo="Últimos movimientos de stock" />
          <TablaResponsiva
            sinMarco
            etiqueta="Últimos movimientos de stock"
            filas={p.movimientos as any[]}
            claveFila={(_, i) => i}
            vacio={vacioChico('Sin movimientos')}
            tarjetaMovil={(m: any) => (
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p>{TIPO_MOV[m.tipo] ?? m.tipo}</p>
                  <p className="break-words text-xs text-tinta/60">
                    {fecha(m.creado_en)} · {m.sucursal?.nombre}
                  </p>
                </div>
                <CantidadMovimiento m={m} />
              </div>
            )}
            columnas={[
              { clave: 'fecha', titulo: 'Fecha', celda: (m: any) => <span className="text-xs text-tinta/60">{fecha(m.creado_en)}</span> },
              { clave: 'tipo', titulo: 'Tipo', celda: (m: any) => <span className="text-xs">{TIPO_MOV[m.tipo] ?? m.tipo}</span> },
              { clave: 'sucursal', titulo: 'Sucursal', celda: (m: any) => <span className="text-xs text-tinta/60">{m.sucursal?.nombre}</span> },
              { clave: 'cantidad', titulo: 'Cantidad', importe: true, celda: (m: any) => <CantidadMovimiento m={m} /> },
            ]}
          />
        </Tarjeta>
      </div>
    </Pantalla>
  );
}

// Stock de una sucursal: en rojo suave si quedó en el mínimo o abajo.
function StockSucursal({ s }: { s: any }) {
  return Number(s.cantidad) <= Number(s.stock_minimo) ? (
    <Etiqueta tono="error" className="importe">{Math.round(Number(s.cantidad))} u.</Etiqueta>
  ) : (
    <span className="importe font-semibold">{Math.round(Number(s.cantidad))} u.</span>
  );
}

function CantidadMovimiento({ m }: { m: any }) {
  return (
    <span className={'importe shrink-0 font-semibold ' + (Number(m.cantidad) < 0 ? 'text-marca-hondo' : '')}>
      {Number(m.cantidad) > 0 ? '+' : ''}
      {Math.round(Number(m.cantidad))}
    </span>
  );
}
