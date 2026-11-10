'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Boton,
  Chip,
  Entrada,
  Etiqueta,
  Girador,
  IconoFlechaAbajo,
  Monto,
  ROTULO,
  Selector,
  TablaResponsiva,
  Tarjeta,
  unir,
  type ColumnaTabla,
  type TonoEtiqueta,
} from './kit';
import { numero } from '../lib/formato';

// STOCK NAVEGABLE (Leandro, 10/11/2026): «Tiene que tener muchos más filtros,
// se tiene que poder hacer por rubro, por un montón de variables. Tiene que ser
// mucho más navegable que ahora. Está muy estático».
// Todos los filtros viven en la dirección (se comparten y vuelven al recargar
// o al volver de la ficha); la base filtra, ordena, cuenta y recorta
// (stock_explorar): al navegador llegan 50 filas y los conteos.

type Fila = {
  sku: string; nombre: string; activo: boolean; por_peso: boolean; con_barras: boolean;
  rubro: string | null; marca: string | null; proveedores: string | null;
  costo: number; stock: number; minimo: number; reposicion: number;
  venta: number; por_dia: number; dias: number | null; valor: number; estado: string;
};
type Faceta = { id: string; nombre: string; n: number; valor?: number };
type Respuesta = {
  total: number; pagina: number; porPagina: number;
  totales: { unidades: number; valor: number; venta: number };
  filas: Fila[]; estados: Record<string, number>;
  rubros: Faceta[]; marcas: Faceta[]; proveedores: Faceta[];
};

const ESTADOS: { valor: string; etiqueta: string; tono: TonoEtiqueta; ayuda: string }[] = [
  { valor: 'sin_stock', etiqueta: 'Sin stock', tono: 'error', ayuda: 'No queda nada' },
  { valor: 'negativo', etiqueta: 'Negativo', tono: 'error', ayuda: 'Se vendió más de lo que había cargado' },
  { valor: 'bajo_minimo', etiqueta: 'Bajo mínimo', tono: 'atencion', ayuda: 'Por debajo del mínimo o del punto de reposición' },
  { valor: 'se_termina', etiqueta: 'Se termina', tono: 'atencion', ayuda: 'Alcanza para 7 días o menos' },
  { valor: 'sin_movimiento', etiqueta: 'Sin movimiento', tono: 'info', ayuda: 'Hay stock y no se vendió en 30 días' },
  { valor: 'sobra', etiqueta: 'Sobra', tono: 'info', ayuda: 'Alcanza para más de 90 días' },
  { valor: 'normal', etiqueta: 'Normal', tono: 'ok', ayuda: 'Entre 7 y 90 días de venta' },
];
const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.valor, e]));

// claves de la dirección (las mismas que lee la API en explorar.ts)
const CLAVES = ['q', 'suc', 'rubro', 'marca', 'prov', 'estado', 'peso', 'barras', 'activo',
  'cant_min', 'cant_max', 'valor_min', 'valor_max', 'venta_min', 'venta_max', 'orden', 'dir', 'pag'] as const;
const DE_MAS = ['marca', 'prov', 'peso', 'barras', 'activo', 'cant_min', 'cant_max', 'valor_min', 'valor_max', 'venta_min', 'venta_max'];
const RUBROS_A_LA_VISTA = 14;
const ORDENES_MOVIL = [
  { valor: 'nombre', etiqueta: 'Ordenar por nombre' },
  { valor: 'valor:desc', etiqueta: 'Más valor primero' },
  { valor: 'stock:desc', etiqueta: 'Más stock primero' },
  { valor: 'stock', etiqueta: 'Menos stock primero' },
  { valor: 'venta:desc', etiqueta: 'Más vendidos primero' },
  { valor: 'dias', etiqueta: 'Se terminan antes' },
  { valor: 'rubro', etiqueta: 'Por rubro' },
  { valor: 'marca', etiqueta: 'Por marca' },
];

const num = (n: unknown, d = 0) => numero(n ?? 0, d);
const lista = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function StockExplorador({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  // solo lo del explorador (la vista y otras claves de la página no van a la API)
  const consulta = useMemo(() => {
    const u = new URLSearchParams();
    for (const k of CLAVES) { const v = params.get(k); if (v) u.set(k, v); }
    return u.toString();
  }, [params]);

  const [datos, setDatos] = useState<Respuesta | null>(null);
  // para qué filtros llegó la última respuesta (o falló): si no son los de ahora, está cargando
  const [respondio, setRespondio] = useState<string | null>(null);
  const [falloEn, setFalloEn] = useState<string | null>(null);
  const cargando = respondio !== consulta && falloEn !== consulta;
  const fallo = falloEn === consulta;
  const [bajando, setBajando] = useState(false);
  const [todosLosRubros, setTodosLosRubros] = useState(false);
  const [masFiltros, setMasFiltros] = useState(() => DE_MAS.some((k) => params.get(k)));
  const [texto, setTexto] = useState(params.get('q') ?? '');

  // cambia la dirección sin sumar un paso al historial: «atrás» desde la ficha vuelve acá con todo igual
  function poner(cambios: Record<string, string | null>, { mismaPagina = false } = {}) {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v) u.set(k, v); else u.delete(k); }
    if (!mismaPagina) u.delete('pag');
    const qs = u.toString();
    router.replace(qs ? `${ruta}?${qs}` : ruta, { scroll: false });
  }

  useEffect(() => {
    let vigente = true;
    fetch(`/api/stock?recurso=explorar${consulta ? `&${consulta}` : ''}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: Respuesta) => { if (vigente) { setDatos(d); setRespondio(consulta); setFalloEn(null); } })
      .catch(() => { if (vigente) setFalloEn(consulta); });
    return () => { vigente = false; };
  }, [consulta]);

  // el buscador espera a que se deje de escribir
  const ultimoQ = useRef(params.get('q') ?? '');
  useEffect(() => {
    const t = texto.trim();
    if (t === ultimoQ.current) return;
    const espera = setTimeout(() => { ultimoQ.current = t; poner({ q: t || null }); }, 300);
    return () => clearTimeout(espera);
  });
  // si la dirección cambia por otro lado (limpiar, atrás), el campo la sigue
  useEffect(() => {
    const q = params.get('q') ?? '';
    if (q !== ultimoQ.current) { ultimoQ.current = q; setTexto(q); }
  }, [params]);

  const estados = lista(params.get('estado'));
  const rubros = lista(params.get('rubro'));
  const orden = params.get('orden') ?? 'nombre';
  const desc = params.get('dir') === 'desc';
  const hayFiltros = CLAVES.some((k) => k !== 'orden' && k !== 'dir' && k !== 'pag' && params.get(k));
  const alternar = (clave: string, actuales: string[], valor: string) =>
    poner({ [clave]: (actuales.includes(valor) ? actuales.filter((x) => x !== valor) : [...actuales, valor]).join(',') || null });

  function ordenarPor(clave: string, numerica: boolean) {
    // primero lo más grande en las cifras, de la A a la Z en los textos
    if (orden !== clave) poner({ orden: clave, dir: numerica ? 'desc' : null });
    else poner({ dir: desc ? null : 'desc' });
  }

  async function bajarExcel() {
    setBajando(true);
    try {
      const r = await fetch(`/api/stock?recurso=explorar/excel${consulta ? `&${consulta}` : ''}`);
      if (!r.ok) throw new Error();
      const archivo = await r.blob();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'stock.xlsx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(archivo);
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setFalloEn(consulta);
    } finally {
      setBajando(false);
    }
  }

  const volver = `${ruta}${params.toString() ? `?${params.toString()}` : ''}`;
  const fichaDe = (f: Fila) => `/inventario?sku=${encodeURIComponent(f.sku)}&volver=${encodeURIComponent(volver)}`;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  const pagina = datos?.pagina ?? 1;
  const rubrosVista = datos ? (todosLosRubros ? datos.rubros : datos.rubros.slice(0, RUBROS_A_LA_VISTA)) : [];
  // un rubro elegido que quedó fuera de los primeros igual se ve
  for (const id of rubros) {
    const r = datos?.rubros.find((x) => x.id === id);
    if (r && !rubrosVista.includes(r)) rubrosVista.push(r);
  }

  // encabezado que ordena: tocarlo de nuevo da vuelta el orden
  const titulo = (clave: string, children: string, numerica = false) => (
    <button
      type="button"
      onClick={() => ordenarPor(clave, numerica)}
      className={unir('inline-flex items-center gap-1 uppercase hover:text-tinta', orden === clave && 'text-tinta')}
      aria-label={`Ordenar por ${children.toLowerCase()}`}
    >
      {children}
      <IconoFlechaAbajo className={unir('size-3.5 shrink-0', orden !== clave && 'opacity-0', orden === clave && !desc && 'rotate-180')} />
    </button>
  );

  const columnas: ColumnaTabla<Fila>[] = [
    {
      clave: 'producto', principal: true, titulo: titulo('nombre', 'Producto'),
      celda: (f) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-tinta">{f.nombre}</p>
          <p className="break-words text-xs text-tinta/60">
            {[f.sku, f.rubro, f.marca, f.por_peso ? 'por peso' : null, f.activo ? null : 'inactivo'].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    {
      clave: 'estado', titulo: titulo('estado', 'Estado'),
      celda: (f) => <Etiqueta tono={ESTADO[f.estado]?.tono ?? 'neutro'}>{ESTADO[f.estado]?.etiqueta ?? f.estado}</Etiqueta>,
    },
    { clave: 'stock', importe: true, titulo: titulo('stock', 'Stock', true), celda: (f) => <span className="font-medium">{num(f.stock, f.por_peso ? 2 : 0)}</span> },
    { clave: 'minimo', importe: true, ocultarEnMovil: true, titulo: titulo('minimo', 'Mínimo', true), celda: (f) => <span className="text-tinta/70">{f.minimo || f.reposicion ? num(Math.max(f.minimo, f.reposicion)) : '—'}</span> },
    { clave: 'venta', importe: true, titulo: titulo('venta', 'Vendido 30 d', true), celda: (f) => <span className="text-tinta/70">{f.venta ? num(f.venta, f.por_peso ? 1 : 0) : '—'}</span> },
    { clave: 'dias', importe: true, titulo: titulo('dias', 'Días de stock', true), celda: (f) => <span className="text-tinta/70">{f.dias == null ? '—' : num(f.dias)}</span> },
    { clave: 'costo', importe: true, ocultarEnMovil: true, titulo: titulo('costo', 'Costo', true), celda: (f) => <Monto valor={f.costo} className="text-tinta/70" /> },
    { clave: 'valor', importe: true, titulo: titulo('valor', 'Valor', true), celda: (f) => <Monto valor={f.valor} className="font-medium" /> },
  ];

  return (
    <div className="space-y-3">
      {/* buscar, sucursal, exportar */}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar producto, SKU o código"
          aria-label="Buscar producto"
          className="sm:w-72"
        />
        <Selector
          value={params.get('suc') ?? ''}
          onChange={(e) => poner({ suc: e.target.value || null })}
          aria-label="Sucursal"
          vacio="Todas las sucursales"
          opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
          className="sm:w-56"
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Boton variante="secundario" onClick={() => setMasFiltros((x) => !x)} aria-expanded={masFiltros}>
            {masFiltros ? 'Menos filtros' : 'Más filtros'}
          </Boton>
          {hayFiltros && (
            <Boton variante="fantasma" onClick={() => { setTexto(''); ultimoQ.current = ''; router.replace(ruta, { scroll: false }); }}>
              Sacar los filtros
            </Boton>
          )}
          <Boton variante="secundario" onClick={bajarExcel} disabled={bajando || !datos?.total}>
            {bajando ? 'Armando el Excel…' : `Exportar a Excel${datos?.total ? ` (${num(datos.total)})` : ''}`}
          </Boton>
        </div>
      </div>

      {/* estados: se tocan y filtran (de a varios) */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Estado del stock">
        <Chip activo={!estados.length} onClick={() => poner({ estado: null })}>Todos</Chip>
        {ESTADOS.map((e) => {
          const n = datos?.estados?.[e.valor] ?? 0;
          if (!n && !estados.includes(e.valor)) return null;
          return (
            <Chip key={e.valor} activo={estados.includes(e.valor)} cuenta={n} title={e.ayuda} onClick={() => alternar('estado', estados, e.valor)}>
              {e.etiqueta}
            </Chip>
          );
        })}
      </div>

      {masFiltros && (
        <Tarjeta>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Filtro titulo="Marca">
              <Selector
                value={params.get('marca') ?? ''}
                onChange={(e) => poner({ marca: e.target.value || null })}
                vacio="Todas las marcas"
                opciones={(datos?.marcas ?? []).map((m) => ({ valor: m.id, etiqueta: `${m.nombre} (${num(m.n)})` }))}
                aria-label="Marca"
              />
            </Filtro>
            <Filtro titulo="Proveedor">
              <Selector
                value={params.get('prov') ?? ''}
                onChange={(e) => poner({ prov: e.target.value || null })}
                vacio="Todos los proveedores"
                opciones={(datos?.proveedores ?? []).map((p) => ({ valor: p.id, etiqueta: `${p.nombre} (${num(p.n)})` }))}
                aria-label="Proveedor"
              />
            </Filtro>
            <Filtro titulo="Se vende">
              <Selector value={params.get('peso') ?? ''} onChange={(e) => poner({ peso: e.target.value || null })} aria-label="Se vende"
                vacio="Por unidad y por peso" opciones={[{ valor: 'si', etiqueta: 'Solo por peso' }, { valor: 'no', etiqueta: 'Solo por unidad' }]} />
            </Filtro>
            <Filtro titulo="Código de barras">
              <Selector value={params.get('barras') ?? ''} onChange={(e) => poner({ barras: e.target.value || null })} aria-label="Código de barras"
                vacio="Con y sin código" opciones={[{ valor: 'si', etiqueta: 'Con código de barras' }, { valor: 'no', etiqueta: 'Sin código de barras' }]} />
            </Filtro>
            <Filtro titulo="Productos">
              <Selector value={params.get('activo') ?? ''} onChange={(e) => poner({ activo: e.target.value || null })} aria-label="Activos o inactivos"
                vacio="Solo los activos" opciones={[{ valor: 'no', etiqueta: 'Solo los inactivos' }, { valor: 'todos', etiqueta: 'Activos e inactivos' }]} />
            </Filtro>
            <Rango titulo="Stock (unidades)" desde="cant_min" hasta="cant_max" params={params} poner={poner} />
            <Rango titulo="Valor ($)" desde="valor_min" hasta="valor_max" params={params} poner={poner} />
            <Rango titulo="Vendido en 30 días" desde="venta_min" hasta="venta_max" params={params} poner={poner} />
          </div>
        </Tarjeta>
      )}

      {/* rubros: se tocan y filtran (de a varios), con cuántos hay de cada uno */}
      {datos && datos.rubros.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rubros">
          <Chip activo={!rubros.length} onClick={() => poner({ rubro: null })}>Todos los rubros</Chip>
          {rubrosVista.map((r) => (
            <Chip key={r.id} activo={rubros.includes(r.id)} cuenta={r.n} onClick={() => alternar('rubro', rubros, r.id)}>{r.nombre}</Chip>
          ))}
          {datos.rubros.length > RUBROS_A_LA_VISTA && (
            <Boton variante="fantasma" tamano="chico" onClick={() => setTodosLosRubros((x) => !x)}>
              {todosLosRubros ? 'Ver menos rubros' : `Ver los ${datos.rubros.length} rubros`}
            </Boton>
          )}
        </div>
      )}

      <Tarjeta relleno={false}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-black/[0.06] px-4 py-3 sm:px-5">
          <p className="text-sm text-tinta">
            {datos ? (
              <>
                <b className="importe">{num(datos.total)}</b> productos · <span className="importe">{num(datos.totales.unidades)}</span> u. en stock ·{' '}
                <Monto valor={datos.totales.valor} className="font-semibold" />
              </>
            ) : 'Buscando…'}
          </p>
          <p className="inline-flex items-center gap-2 text-xs text-tinta/60" aria-live="polite">
            {cargando ? <><Girador className="size-4" />Actualizando…</> : fallo ? <span className="text-marca-hondo">No pude traer el stock. Probá de nuevo.</span> : 'Tocá un producto para ver su ficha'}
          </p>
        </div>
        <div className="border-b border-black/[0.06] px-4 py-3 md:hidden">
          <Selector
            value={`${orden}${desc ? ':desc' : ''}`}
            onChange={(e) => { const [o, d] = e.target.value.split(':'); poner({ orden: o === 'nombre' ? null : o, dir: d ? 'desc' : null }); }}
            aria-label="Ordenar por"
            opciones={ORDENES_MOVIL}
          />
        </div>
        <div className={unir('transition-opacity', cargando && datos && 'opacity-60')}>
          <TablaResponsiva
            sinMarco
            etiqueta="Stock de productos"
            filas={datos?.filas ?? []}
            columnas={columnas}
            claveFila="sku"
            hrefFila={fichaDe}
            tarjetaMovil={(f) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-tinta">{f.nombre}</p>
                    <p className="break-words text-xs text-tinta/60">{[f.sku, f.rubro, f.marca].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Etiqueta tono={ESTADO[f.estado]?.tono ?? 'neutro'} className="shrink-0">{ESTADO[f.estado]?.etiqueta ?? f.estado}</Etiqueta>
                </div>
                <p className="text-sm text-tinta/70">
                  <b className="importe text-tinta">{num(f.stock, f.por_peso ? 2 : 0)}</b> en stock
                  {f.venta ? <> · {num(f.venta, f.por_peso ? 1 : 0)} vendidos en 30 d</> : null}
                  {f.dias != null ? <> · {num(f.dias)} días</> : null} · <Monto valor={f.valor} />
                </p>
              </div>
            )}
            vacio={<p className="px-4 py-8 text-center text-sm text-tinta/60">{datos ? 'Ningún producto con esos filtros.' : 'Buscando…'}</p>}
          />
        </div>
        {datos && paginas > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] px-4 py-3 sm:px-5">
            <Boton variante="secundario" tamano="chico" disabled={pagina <= 1} onClick={() => poner({ pag: pagina > 2 ? String(pagina - 1) : null }, { mismaPagina: true })}>
              Anterior
            </Boton>
            <span className="text-sm text-tinta/70">Página <b className="importe text-tinta">{pagina}</b> de <span className="importe">{num(paginas)}</span></span>
            <Boton variante="secundario" tamano="chico" disabled={pagina >= paginas} onClick={() => poner({ pag: String(pagina + 1) }, { mismaPagina: true })}>
              Siguiente
            </Boton>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

function Filtro({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className={ROTULO}>{titulo}</p>
      {children}
    </div>
  );
}

// Desde / hasta: se aplica al salir del campo o con Enter (no en cada tecla)
function Rango({ titulo, desde, hasta, params, poner }: {
  titulo: string; desde: string; hasta: string;
  params: URLSearchParams | ReturnType<typeof useSearchParams>;
  poner: (c: Record<string, string | null>) => void;
}) {
  const campo = (clave: string, rotulo: string) => (
    <Entrada
      key={`${clave}-${params.get(clave) ?? ''}`}
      defaultValue={params.get(clave) ?? ''}
      inputMode="decimal"
      aria-label={`${titulo}: ${rotulo}`}
      placeholder={rotulo}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (params.get(clave) ?? '')) poner({ [clave]: v || null }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
  return (
    <div className="min-w-0 space-y-1">
      <p className={ROTULO}>{titulo}</p>
      <div className="grid grid-cols-2 gap-2">{campo(desde, 'Desde')}{campo(hasta, 'Hasta')}</div>
    </div>
  );
}
