'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, Cargando, Entrada, Etiqueta, TablaResponsiva, Tarjeta, TarjetaCabecera, TarjetaCuerpo, type ColumnaTabla, type TonoEtiqueta } from './kit';
import { fecha, fechaHora, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// Balanzas (11/11/2026): la lista de PLU con precio para iTegra, qué cambió desde
// la última vez que se bajó y lo que no puede ir a la balanza.

type Tipo = 'P' | 'N';
type Item = { plu: string; nombre: string; nombreSistema: string; sku: string; tipo: Tipo; precio: number; precioDesde: string | null; porUnidadSumado: boolean };
type Problema = { sku: string; nombre: string; plu: string | null; motivo: 'sin_plu' | 'plu_repetido' | 'sin_precio' };
type Foto = { plu: string; nombre: string; tipo: Tipo; precio: number };
type Cambio = { plu: string; nombre: string; cambios: ('alta' | 'precio' | 'nombre' | 'tipo' | 'baja')[]; antes: Foto | null; ahora: Foto | null };
type Datos = {
  faltaMigracion: boolean;
  items: Item[];
  problemas: Problema[];
  cambios: Cambio[];
  ultima: { fecha: string; quien: string | null; modo: 'completo' | 'cambios'; cantidad: number } | null;
  resumen: { total: number; porPeso: number; porUnidad: number };
};
type Sugerencia = { sku: string; nombre: string };

const TIPO_TEXTO: Record<Tipo, string> = { P: 'Por kilo', N: 'Por unidad' };
const CAMBIO_TEXTO: Record<Cambio['cambios'][number], { texto: string; tono: TonoEtiqueta }> = {
  alta: { texto: 'Nuevo', tono: 'info' },
  precio: { texto: 'Precio', tono: 'atencion' },
  nombre: { texto: 'Nombre', tono: 'neutro' },
  tipo: { texto: 'Kilo / unidad', tono: 'neutro' },
  baja: { texto: 'Ya no va', tono: 'error' },
};
const MOTIVO_TEXTO: Record<Problema['motivo'], (p: Problema) => string> = {
  sin_plu: () => 'No tiene PLU. Cargáselo en la ficha del producto.',
  sin_precio: () => 'No tiene precio en la lista Minorista.',
  plu_repetido: (p) => `El PLU ${p.plu} lo tiene otro producto de la lista. La balanza guarda uno solo.`,
};

const precioDe = (f: Foto | null) => (f ? `${pesos(f.precio)}${f.tipo === 'P' ? ' el kilo' : ''}` : '—');

export function BalanzasLista({ puedeMarcar }: { puedeMarcar: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<'completo' | 'cambios' | null>(null);
  const [bajado, setBajado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [marcando, setMarcando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/balanzas', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer la lista');
      setDatos(j as Datos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude traer la lista');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Sumar un producto por unidad: la búsqueda de siempre del panel
  useEffect(() => {
    if (busca.trim().length < 2) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`);
      if (r.ok) setSugerencias(((await r.json()).items ?? []).slice(0, 8));
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function bajar(modo: 'completo' | 'cambios') {
    setBajando(modo); setBajado(null); setError(null);
    // Las bajas no viajan en el archivo y, una vez bajada la lista, dejan de
    // figurar en «Desde la última vez»: van en el aviso para borrarlas a mano.
    const bajas = (datos?.cambios ?? []).filter((c) => c.cambios.includes('baja'));
    try {
      const r = await fetch(`/api/balanzas?archivo=${modo}`, { cache: 'no-store' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? 'No pude armar el archivo');
      }
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'odb-balanzas.csv';
      const cantidad = Number(r.headers.get('X-Cantidad')) || null;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const borrar = bajas.length
        ? ` Borrá a mano de la balanza: ${bajas.map((b) => `PLU ${b.plu} (${b.antes?.nombre ?? b.nombre})`).join(', ')}.`
        : '';
      setBajado(`Bajaste ${nombre}${cantidad ? ` con ${cantidad} ${cantidad === 1 ? 'producto' : 'productos'}` : ''}. Cargalo en iTegra y mandalo a las balanzas.${borrar}`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude armar el archivo');
    } finally {
      setBajando(null);
    }
  }

  async function marcar(sku: string, enBalanza: boolean) {
    setMarcando(sku); setError(null);
    try {
      const r = await fetch('/api/balanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, enBalanza }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude guardar el cambio');
      if (enBalanza) { setBusca(''); setSugerencias([]); }
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude guardar el cambio');
    } finally {
      setMarcando(null);
    }
  }

  const items = datos?.items ?? [];
  const visibles = useMemo(() => {
    const q = filtro.trim();
    if (!q) return items;
    if (/^\d+$/.test(q)) return items.filter((i) => i.plu.startsWith(q.replace(/^0+/, '') || '0'));
    return filtrarPorBusqueda(items, q, (i) => `${i.nombreSistema} ${i.nombre}`);
  }, [items, filtro]);
  const enLista = useMemo(() => new Set(items.map((i) => i.sku)), [items]);

  if (!datos && !error) return <Cargando texto="Armando la lista de las balanzas…" />;

  const cambios = datos?.cambios ?? [];
  const cambiosQueViajan = cambios.filter((c) => !c.cambios.includes('baja')).length;
  const bajas = cambios.length - cambiosQueViajan;

  const columnas: ColumnaTabla<Item>[] = [
    { clave: 'plu', titulo: 'PLU', celda: (i) => <span className="font-semibold tabular-nums">{i.plu}</span>, ancho: 'w-20' },
    {
      clave: 'nombre', titulo: 'Producto', principal: true,
      celda: (i) => (
        <div className="min-w-0">
          <p className="font-medium text-tinta">{i.nombre}</p>
          <p className="text-xs text-tinta/60">{i.nombreSistema}</p>
        </div>
      ),
    },
    { clave: 'tipo', titulo: 'Se vende', celda: (i) => TIPO_TEXTO[i.tipo], ancho: 'w-28' },
    { clave: 'precio', titulo: 'Precio', importe: true, celda: (i) => <span>{pesos(i.precio)}{i.tipo === 'P' && <span className="text-tinta/60"> el kilo</span>}</span>, ancho: 'w-36' },
    { clave: 'desde', titulo: 'Desde', celda: (i) => fecha(i.precioDesde, 'corta'), ocultarEnMovil: true, ancho: 'w-24' },
    ...(puedeMarcar ? [{
      clave: 'acciones', titulo: '', acciones: true, ancho: 'w-24',
      celda: (i: Item) => i.porUnidadSumado
        ? <Boton variante="fantasma" tamano="chico" disabled={marcando === i.sku} onClick={() => marcar(i.sku, false)}>Sacar</Boton>
        : null,
    } satisfies ColumnaTabla<Item>] : []),
  ];

  const columnasCambios: ColumnaTabla<Cambio>[] = [
    { clave: 'plu', titulo: 'PLU', celda: (c) => <span className="font-semibold tabular-nums">{c.plu}</span>, ancho: 'w-20' },
    { clave: 'nombre', titulo: 'Producto', principal: true, celda: (c) => <span className="font-medium">{c.ahora?.nombre ?? c.antes?.nombre ?? c.nombre}</span> },
    {
      clave: 'que', titulo: 'Qué cambió', ancho: 'w-44',
      celda: (c) => <div className="flex flex-wrap gap-1">{c.cambios.map((k) => <Etiqueta key={k} tono={CAMBIO_TEXTO[k].tono}>{CAMBIO_TEXTO[k].texto}</Etiqueta>)}</div>,
    },
    { clave: 'antes', titulo: 'Antes', celda: (c) => precioDe(c.antes), ancho: 'w-36' },
    {
      clave: 'ahora', titulo: 'Ahora', ancho: 'w-44',
      celda: (c) => c.ahora ? precioDe(c.ahora) : <span className="text-marca-hondo">Borralo de la balanza</span>,
    },
  ];

  return (
    <>
      {error && <Aviso tono="error">{error}</Aviso>}

      {datos?.faltaMigracion ? (
        <Aviso tono="atencion" titulo="Falta un paso en la base">La lista de las balanzas necesita la migración de balanzas. Avisale a MetoGroup.</Aviso>
      ) : datos && (
        <>
          <Tarjeta relleno={false}>
            <TarjetaCabecera
              titulo="La lista para iTegra"
              sub={`${datos.resumen.total} productos: ${datos.resumen.porPeso} por kilo y ${datos.resumen.porUnidad} por unidad`}
            />
            <TarjetaCuerpo className="space-y-4">
              <p className="text-sm text-tinta/70">
                Cada producto va con su PLU, el nombre como lo imprime la balanza y el precio de la lista Minorista, el mismo que cobra la caja. La lista es la misma para las balanzas de las dos sucursales.
              </p>
              <p className="text-sm text-tinta">
                {datos.ultima ? (
                  <>
                    La última vez la bajó {datos.ultima.quien ?? 'alguien'} el {fechaHora(datos.ultima.fecha)}
                    {datos.ultima.modo === 'cambios' ? ' (solo los cambios)' : ''}.{' '}
                    {cambios.length === 0 ? 'Desde entonces no cambió nada: las balanzas están al día.' : `Desde entonces hay ${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'}.`}
                  </>
                ) : (
                  'Todavía no se bajó nunca. Bajá la lista completa y cargala en iTegra.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={() => bajar('completo')} disabled={!!bajando || datos.resumen.total === 0}>
                  {bajando === 'completo' ? 'Armando…' : 'Bajar la lista completa'}
                </Boton>
                {datos.ultima && cambiosQueViajan > 0 && (
                  <Boton variante="secundario" onClick={() => bajar('cambios')} disabled={!!bajando}>
                    {bajando === 'cambios' ? 'Armando…' : `Bajar solo ${cambiosQueViajan === 1 ? 'el cambio' : `los ${cambiosQueViajan} cambios`}`}
                  </Boton>
                )}
              </div>
              {bajado && <Aviso tono="ok">{bajado}</Aviso>}
              <details className="rounded-xl bg-crema-claro px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-tinta">Cómo se carga en iTegra</summary>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-tinta/70">
                  <li>En iTegra: Archivo › Importar › Desde archivo, y elegí «PLU&apos;s».</li>
                  <li>Elegí el archivo que bajaste.</li>
                  <li>«Importar desde la fila»: 2. La primera fila tiene los nombres de las columnas.</li>
                  <li>Separador de campos: caracteres especiales, con el punto y coma (;).</li>
                  <li>Los campos, en este orden: Número de PLU, Código de PLU, Nombre de PLU, Tipo de PLU, Precio, Código de Departamento y Código de etiqueta.</li>
                  <li>Guardar e Importar. Después mandá la lista a las balanzas desde iTegra.</li>
                  <li>Una balanza apagada cuando se mandó la lista queda con los precios viejos: fijate que todas estén prendidas.</li>
                </ol>
                <p className="mt-3 text-tinta/60">P es pesable (precio por kilo) y N, por unidad. El número de PLU es el mismo que sale en la etiqueta y lee la caja.</p>
              </details>
            </TarjetaCuerpo>
          </Tarjeta>

          {datos.ultima && cambios.length > 0 && (
            <Tarjeta relleno={false}>
              <TarjetaCabecera
                titulo="Desde la última vez"
                sub={bajas > 0 ? `${cambiosQueViajan} para mandar a las balanzas y ${bajas} para borrar a mano` : `${cambiosQueViajan} para mandar a las balanzas`}
              />
              <TablaResponsiva columnas={columnasCambios} filas={cambios} claveFila={(c) => `${c.plu}-${c.cambios.join()}`} sinMarco etiqueta="Cambios desde la última bajada" />
            </Tarjeta>
          )}

          {datos.problemas.length > 0 && (
            <Tarjeta relleno={false}>
              <TarjetaCabecera titulo="No entran en la lista" sub={`${datos.problemas.length} ${datos.problemas.length === 1 ? 'producto por peso no puede' : 'productos por peso no pueden'} ir a la balanza hasta corregirlos`} />
              <TarjetaCuerpo>
                <ul className="divide-y divide-black/[0.06]">
                  {datos.problemas.map((p) => (
                    <li key={`${p.sku}-${p.motivo}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                      <Link href={`/productos/${encodeURIComponent(p.sku)}`} className="font-medium text-tinta underline decoration-black/20 underline-offset-2 hover:decoration-marca">{p.nombre}</Link>
                      <span className="text-tinta/70">{MOTIVO_TEXTO[p.motivo](p)}</span>
                    </li>
                  ))}
                </ul>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

          <Tarjeta relleno={false}>
            <TarjetaCabecera titulo="Los productos de la balanza" sub="Los que se venden por peso van siempre. Los que se venden por unidad con etiqueta de balanza se suman a mano." />
            <div className="space-y-3 px-4 pt-4 sm:px-5">
              {puedeMarcar && (
                <div className="relative">
                  <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Sumar un producto por unidad" aria-label="Buscar un producto por unidad para sumarlo a la balanza" />
                  {sugerencias.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
                      {sugerencias.map((s) => (
                        <div key={s.sku} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{s.nombre}</span>
                          {enLista.has(s.sku)
                            ? <span className="shrink-0 text-xs text-tinta/60">Ya está</span>
                            : <Boton tamano="chico" variante="secundario" disabled={marcando === s.sku} onClick={() => marcar(s.sku, true)}>Sumar</Boton>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Entrada value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar en la lista por nombre o PLU" aria-label="Buscar en la lista por nombre o PLU" />
            </div>
            <TablaResponsiva
              columnas={columnas}
              filas={visibles}
              claveFila="plu"
              sinMarco
              etiqueta="Productos de la balanza"
              pie={filtro ? `${visibles.length} de ${items.length}` : `${items.length} productos`}
            />
          </Tarjeta>
        </>
      )}
    </>
  );
}
