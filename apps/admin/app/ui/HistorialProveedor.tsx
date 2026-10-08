'use client';

import { useEffect, useMemo, useState } from 'react';
import { Aviso, BotonLink, CLASES_ENTRADA, Cargando, Chips, Etiqueta, Kpi, TablaResponsiva, Tarjeta, Vacio, unir, type ColumnaTabla } from './kit';
import { fecha, numero, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// ============================================================
// LO QUE NOS VENDE CADA PROVEEDOR (8/10/2026). Leandro: «cada vez que una
// factura ingresa el sistema tiene que ir guardando todos los productos que
// ese proveedor trabaja, para luego en la mesa de compras tener info valiosa».
// Sale de compras_historial (cada renglón de cada factura registrada) y de lo
// que ya se sabía del proveedor (su lista de precios, las recepciones). La
// cuenta está en la API (compras/historial-compras.ts, con tests).
// ============================================================

type Producto = {
  sku: string; codigo: string | null; nombre: string; codigoProveedor: string | null;
  compras: number; primeraCompra: string | null; ultimaCompra: string | null;
  ultimoPrecio: number | null; precioAnterior: number | null; variacionPct: number | null;
  bonificacionPct: number | null; unidadesPorBulto: number | null; unidadesTotales: number;
  promedioPorCompra: number | null; cadaCuantosDias: number | null; costoUnitario: number | null; soloVinculo: boolean;
};
type SinVincular = { descripcion: string; codigoProveedor: string | null; compras: number; ultimaCompra: string; ultimoPrecio: number | null; bonificacionPct: number | null; unidadesTotales: number };
type Resumen = {
  proveedor: { id: string; nombre: string; leadTimeDias: number | null; condicionPago: string | null };
  comprobantes: number; primeraCompra: string | null; ultimaCompra: string | null; netoComprado: number;
  productos: Producto[]; sinVincular: SinVincular[];
};

const hoy = () => new Date().toISOString().slice(0, 10);
const haceDias = (f: string | null) => (f ? Math.max(0, Math.round((Date.parse(hoy()) - Date.parse(f)) / 86_400_000)) : null);
const nombreConCodigo = (p: Producto) => (p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre);

function Variacion({ p }: { p: Producto }) {
  if (p.variacionPct == null) return <span className="text-tinta/60">—</span>;
  const tono = p.variacionPct > 0.5 ? 'error' : p.variacionPct < -0.5 ? 'ok' : 'neutro';
  return (
    <span className="inline-flex flex-col items-end">
      <Etiqueta tono={tono}>{p.variacionPct > 0 ? '+' : ''}{numero(p.variacionPct, 1)}%</Etiqueta>
      <span className="mt-0.5 text-xs text-tinta/60">antes {pesos(p.precioAnterior)}</span>
    </span>
  );
}

const COLUMNAS: ColumnaTabla<Producto>[] = [
  {
    clave: 'producto', titulo: 'Producto', principal: true, ancho: 'min-w-64',
    celda: (p) => (
      <div className="min-w-0">
        <p className="break-words font-medium text-tinta">{nombreConCodigo(p)}</p>
        {p.codigoProveedor && <p className="text-xs text-tinta/60">Código del proveedor: {p.codigoProveedor}</p>}
      </div>
    ),
  },
  {
    clave: 'ultima', titulo: 'Última compra',
    celda: (p) => p.soloVinculo
      ? <span className="text-xs text-tinta/60">Sin factura leída{p.ultimaCompra ? ` · visto ${fecha(p.ultimaCompra, 'corta')}` : ''}</span>
      : <span>{fecha(p.ultimaCompra)}<span className="block text-xs text-tinta/60">hace {haceDias(p.ultimaCompra)} días</span></span>,
  },
  {
    clave: 'precio', titulo: 'Último precio', importe: true,
    celda: (p) => p.ultimoPrecio == null ? '—' : (
      <span>{pesos(p.ultimoPrecio, { decimales: true })}{p.bonificacionPct ? <span className="block text-xs text-tinta/60">con {numero(p.bonificacionPct, 1)}% bonif.</span> : null}</span>
    ),
  },
  { clave: 'variacion', titulo: 'Cambio', alinear: 'derecha', celda: (p) => <Variacion p={p} /> },
  {
    clave: 'compras', titulo: 'Compras', importe: true,
    celda: (p) => p.compras ? (
      <span>{p.compras} {p.compras === 1 ? 'vez' : 'veces'}{p.cadaCuantosDias ? <span className="block text-xs text-tinta/60">cada {p.cadaCuantosDias} días</span> : null}</span>
    ) : '—',
  },
  {
    clave: 'cantidad', titulo: 'Por compra', importe: true, ocultarEnMovil: false,
    celda: (p) => p.promedioPorCompra ? (
      <span>{numero(p.promedioPorCompra, 1)} unid.{p.unidadesPorBulto ? <span className="block text-xs text-tinta/60">bulto ×{numero(p.unidadesPorBulto)}</span> : null}</span>
    ) : '—',
  },
  { clave: 'costo', titulo: 'Costo final c/u', importe: true, celda: (p) => (p.costoUnitario ? pesos(p.costoUnitario) : '—') },
];

export function HistorialProveedor() {
  const [proveedores, setProveedores] = useState<{ id: string; razon_social: string; productos: number }[]>([]);
  const [provId, setProvId] = useState('');
  const [datosDe, setDatos] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [vista, setVista] = useState<'comprados' | 'todo' | 'sinVincular'>('comprados');
  // los datos solo valen para el proveedor elegido
  const datos = datosDe && datosDe.proveedor.id === provId ? datosDe : null;

  useEffect(() => {
    fetch('/api/compras?recurso=proveedores-lista', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProveedores(Array.isArray(d) ? d : []))
      .catch(() => setError('No pude traer los proveedores'));
  }, []);

  useEffect(() => {
    if (!provId) return;
    let vigente = true;
    setCargando(true); setError(''); setBusca('');
    fetch(`/api/compras?recurso=historial-proveedor&id=${encodeURIComponent(provId)}`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.message ?? 'No se pudo traer el historial'); return d; })
      .then((d) => { if (vigente) { setDatos(d); setVista(d.productos?.some((p: Producto) => !p.soloVinculo) ? 'comprados' : 'todo'); } })
      .catch((e) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [provId]);

  const comprados = useMemo(() => (datos?.productos ?? []).filter((p) => !p.soloVinculo), [datos]);
  const filas = useMemo(() => {
    const base = vista === 'comprados' ? comprados : datos?.productos ?? [];
    return filtrarPorBusqueda(base, busca, (p) => `${p.codigo ?? ''} ${p.nombre} ${p.codigoProveedor ?? ''} ${p.sku}`);
  }, [datos, comprados, vista, busca]);
  const sueltos = useMemo(() => filtrarPorBusqueda(datos?.sinVincular ?? [], busca, (s) => `${s.descripcion} ${s.codigoProveedor ?? ''}`), [datos, busca]);
  const suben = comprados.filter((p) => (p.variacionPct ?? 0) > 0.5).length;

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-tinta">Lo que nos vende cada proveedor</h2>
          <p className="text-sm text-tinta/70">Sale de cada factura que se registra: qué productos trae, a cuánto, cada cuánto y en qué cantidades. También lo que vino y no está vinculado a un producto de la casa.</p>
        </div>
        <label className="block max-w-md">
          <span className="sr-only">Proveedor</span>
          <select value={provId} onChange={(e) => setProvId(e.target.value)} className={CLASES_ENTRADA}>
            <option value="">Elegí un proveedor…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}{p.productos ? ` · ${p.productos} productos` : ''}</option>)}
          </select>
        </label>
      </Tarjeta>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargando && <Cargando texto="Juntando sus facturas…" />}

      {datos && !cargando && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi etiqueta="Facturas leídas" valor={numero(datos.comprobantes)} sub={datos.primeraCompra ? `desde el ${fecha(datos.primeraCompra)}` : 'todavía ninguna'} />
            <Kpi etiqueta="Neto comprado" valor={pesos(datos.netoComprado)} sub={datos.ultimaCompra ? `última el ${fecha(datos.ultimaCompra)}` : undefined} />
            <Kpi etiqueta="Comprados" valor={numero(comprados.length)} sub={`${numero(datos.productos.length - comprados.length)} más que trabaja`} />
            <Kpi etiqueta="Subieron" valor={numero(suben)} tono={suben ? 'atencion' : 'neutro'} sub="de precio contra la compra anterior" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Chips
              etiquetaAccesible="Qué mostrar"
              valor={vista}
              onCambiar={(v) => setVista(v as typeof vista)}
              opciones={[
                { valor: 'comprados', etiqueta: 'Comprados', cuenta: comprados.length },
                { valor: 'todo', etiqueta: 'Todo lo que trabaja', cuenta: datos.productos.length },
                { valor: 'sinVincular', etiqueta: 'Sin vincular', cuenta: datos.sinVincular.length },
              ]}
            />
            <input
              value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o código…" aria-label="Buscar en lo que vende"
              className={unir(CLASES_ENTRADA, 'max-w-xs')}
            />
            <BotonLink href={`/pedido-proveedor?proveedor=${encodeURIComponent(datos.proveedor.id)}`} variante="secundario" tamano="chico" className="ml-auto">Pedirle algo</BotonLink>
          </div>

          {vista === 'sinVincular' ? (
            sueltos.length ? (
              <Tarjeta relleno={false} className="divide-y divide-black/[0.06]">
                {sueltos.map((s, k) => (
                  <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-tinta">{s.codigoProveedor ? <span className="mr-1.5 font-mono text-xs text-tinta/60">{s.codigoProveedor}</span> : null}{s.descripcion}</p>
                      <p className="text-xs text-tinta/60">{s.compras} {s.compras === 1 ? 'factura' : 'facturas'} · última el {fecha(s.ultimaCompra)} · {numero(s.unidadesTotales, 1)} unid. en total</p>
                    </div>
                    <p className="importe text-right font-semibold text-tinta">{pesos(s.ultimoPrecio, { decimales: true })}{s.bonificacionPct ? <span className="block text-xs font-normal text-tinta/60">con {numero(s.bonificacionPct, 1)}% bonif.</span> : null}</p>
                  </div>
                ))}
              </Tarjeta>
            ) : <Vacio titulo="Todo vinculado" texto="Todos los renglones de sus facturas están vinculados a un producto de la casa." />
          ) : (
            <TablaResponsiva
              etiqueta={`Lo que nos vende ${datos.proveedor.nombre}`}
              columnas={COLUMNAS}
              filas={filas}
              claveFila="sku"
              vacio={<Vacio titulo={busca ? 'Nada con esa búsqueda' : 'Todavía no hay facturas suyas leídas'} texto={busca ? 'Probá con otra palabra o con el código.' : 'Se va llenando solo con cada factura que se registra por foto.'} />}
            />
          )}
        </>
      )}
      {!datos && !cargando && !error && (
        <Vacio titulo="Elegí un proveedor" texto="Vas a ver cada producto que nos vendió, el último precio, cuánto cambió y cada cuánto se le compra." />
      )}
    </div>
  );
}
