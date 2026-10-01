import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso, Boton, BotonLink, Entrada, Etiqueta, Selector, TablaResponsiva, Vacio, unir } from '../ui/kit';
import { FotosExternas } from '../ui/FotosExternas';
import { apiFetch } from '../../lib/api';
import { numero, pesos } from '../lib/formato';

type Producto = {
  imagenUrl: string | null;
  sku: string;
  nombre: string;
  marca: string | null;
  categoria: string | null;
  precio: number | null;
  precioLista: number | null;
  descuento: string | null;
  stockTotal: number;
  stockPorSucursal: { sucursal_id: string; cantidad: number; stock_minimo: number }[];
  esAlcohol: boolean;
};

type Respuesta = {
  total: number;
  pagina: number;
  paginas: number;
  items: Producto[];
};

type Filtros = {
  categorias: { id: string; nombre: string }[];
  marcas: { id: string; nombre: string }[];
};

export const dynamic = 'force-dynamic';

type Params = {
  buscar?: string;
  categoriaId?: string;
  marcaId?: string;
  filtro?: string;
  orden?: string;
  pagina?: string;
};

const qs = (p: Params, cambios: Partial<Params>) => {
  const merged = { ...p, ...cambios };
  const partes = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  return partes.length ? `?${partes.join('&')}` : '';
};

type Stock = Producto['stockPorSucursal'][number] | undefined;

// La cantidad de una sucursal: en rojo suave si quedó en el mínimo o abajo.
function CantidadStock({ s }: { s: Stock }) {
  const bajo = s && Number(s.cantidad) <= Number(s.stock_minimo);
  const texto = s ? Math.round(Number(s.cantidad)) : '—';
  return bajo ? (
    <Etiqueta tono="error" className="importe">{texto}</Etiqueta>
  ) : (
    <span className="importe text-tinta/70">{texto}</span>
  );
}

function Foto({ p, chica = false }: { p: Producto; chica?: boolean }) {
  const tam = chica ? 'size-10' : 'size-14';
  return p.imagenUrl ? (
    <img src={p.imagenUrl} alt="" className={unir(tam, 'shrink-0 rounded-xl object-cover')} />
  ) : (
    <span className={unir(tam, 'flex shrink-0 items-center justify-center rounded-xl bg-crema text-xs text-tinta/60')}>
      foto
    </span>
  );
}

function Precio({ p }: { p: Producto }) {
  return p.descuento ? (
    <span className="inline-flex flex-col items-end">
      <span className="importe text-xs text-tinta/60 line-through">{pesos(p.precioLista)}</span>
      <span className="importe font-semibold text-marca-hondo" title={p.descuento}>{pesos(p.precio)}</span>
    </span>
  ) : (
    <span className="importe font-semibold">{pesos(p.precio)}</span>
  );
}

export default async function Productos({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  let datos: Respuesta = { total: 0, pagina: 1, paginas: 1, items: [] };
  let filtros: Filtros = { categorias: [], marcas: [] };
  let sucursales: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rp, rf, rs] = await Promise.all([
      apiFetch(`/productos${qs(params, {})}`),
      apiFetch('/catalogo/filtros'),
      apiFetch('/sucursales'),
    ]);
    if (!rp.ok) throw new Error(`API respondió ${rp.status}`);
    datos = await rp.json();
    if (rf.ok) filtros = await rf.json();
    if (rs.ok) sucursales = await rs.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const hayFiltros = Boolean(params.buscar || params.categoriaId || params.marcaId || params.filtro || params.orden);

  return (
    <Pantalla activo="/productos" ancho="ancho">
      <FotosExternas />

      {/* filtros: en el celular, el buscador a lo ancho y los selectores de a dos */}
      <form className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,9.5rem))_auto]">
        <Entrada
          type="search"
          name="buscar"
          defaultValue={params.buscar ?? ''}
          placeholder="Nombre, SKU o código de barras…"
          aria-label="Buscar producto"
          className="col-span-2 sm:col-span-4 lg:col-span-1"
        />
        <Selector name="categoriaId" defaultValue={params.categoriaId ?? ''} aria-label="Categoría" vacio="Categoría">
          {filtros.categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </Selector>
        <Selector name="marcaId" defaultValue={params.marcaId ?? ''} aria-label="Marca" vacio="Marca">
          {filtros.marcas.map((m) => (
            <option key={m.id} value={m.id}>{m.nombre}</option>
          ))}
        </Selector>
        <Selector name="filtro" defaultValue={params.filtro ?? ''} aria-label="Estado" vacio="Estado">
          <option value="bajo_minimo">Bajo mínimo</option>
          <option value="promo">En promoción</option>
          <option value="sin_stock">Sin stock</option>
        </Selector>
        <Selector name="orden" defaultValue={params.orden ?? ''} aria-label="Orden" vacio="A → Z">
          <option value="nombre_desc">Z → A</option>
          <option value="recientes">Más nuevos</option>
        </Selector>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-4 lg:col-span-1">
          <Boton type="submit" className="flex-1 lg:flex-none">
            Filtrar
          </Boton>
          {hayFiltros && (
            <BotonLink href="/productos" variante="fantasma" tamano="chico">
              limpiar
            </BotonLink>
          )}
        </div>
      </form>

      <div className="flex justify-end">
        <BotonLink href="/productos/nuevo" className="w-full sm:w-auto">
          + Nuevo producto
        </BotonLink>
      </div>

      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <>
          <TablaResponsiva
            etiqueta="Productos"
            filas={datos.items}
            claveFila="sku"
            hrefFila={(p) => `/productos/${p.sku}`}
            vacio={
              <Vacio
                titulo="Sin resultados con estos filtros"
                texto="Probá con otro nombre o código, o limpiá los filtros."
                accion={hayFiltros ? <BotonLink href="/productos" variante="secundario">Limpiar filtros</BotonLink> : undefined}
              />
            }
            tarjetaMovil={(p) => {
              const [s1, s2] = p.stockPorSucursal;
              return (
                <div className="flex gap-3">
                  <Foto p={p} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug text-tinta">{p.nombre}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta/60">
                      <span className="min-w-0 break-words">
                        {p.sku} {p.marca ? `· ${p.marca}` : ''}
                      </span>
                      {p.esAlcohol && <Etiqueta>+18</Etiqueta>}
                    </p>
                    {p.categoria && <p className="mt-0.5 break-words text-xs text-tinta/60">{p.categoria}</p>}
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-sm">
                      <span className="flex items-center gap-3 text-xs text-tinta/60">
                        <span className="flex items-center gap-1">S1 <CantidadStock s={s1} /></span>
                        <span className="flex items-center gap-1">S2 <CantidadStock s={s2} /></span>
                      </span>
                      <Precio p={p} />
                    </div>
                  </div>
                </div>
              );
            }}
            columnas={[
              {
                clave: 'producto',
                titulo: 'Producto',
                principal: true,
                celda: (p) => (
                  <span className="flex items-center gap-3">
                    <Foto p={p} chica />
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{p.nombre}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-tinta/60">
                        {p.sku} {p.marca ? `· ${p.marca}` : ''}
                        {p.esAlcohol && <Etiqueta>+18</Etiqueta>}
                      </span>
                    </span>
                  </span>
                ),
              },
              { clave: 'categoria', titulo: 'Categoría', celda: (p) => <span className="text-tinta/70">{p.categoria ?? '—'}</span> },
              { clave: 'precio', titulo: 'Precio', importe: true, celda: (p) => <Precio p={p} /> },
              { clave: 's1', titulo: 'Stock S1', importe: true, celda: (p) => <CantidadStock s={p.stockPorSucursal[0]} /> },
              { clave: 's2', titulo: 'Stock S2', importe: true, celda: (p) => <CantidadStock s={p.stockPorSucursal[1]} /> },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-xs text-tinta/60">
              {numero(datos.total)} productos · página {datos.pagina} de {datos.paginas}
            </p>
            <div className="flex gap-2">
              {datos.pagina > 1 && (
                <BotonLink
                  href={`/productos${qs(params, { pagina: String(datos.pagina - 1) })}`}
                  variante="secundario"
                  tamano="chico"
                >
                  ← Anterior
                </BotonLink>
              )}
              {datos.pagina < datos.paginas && (
                <BotonLink
                  href={`/productos${qs(params, { pagina: String(datos.pagina + 1) })}`}
                  variante="secundario"
                  tamano="chico"
                >
                  Siguiente →
                </BotonLink>
              )}
            </div>
          </div>
        </>
      )}
    </Pantalla>
  );
}
