'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AreaTexto, Aviso, BarraInferior, Boton, BotonLink, Campo, Entrada, IconoCerrar, Selector, Tarjeta, clasesBoton,
} from './kit';
import { BotonVolver } from './BotonVolver';
import { pesos } from '../lib/formato';

// Alta de producto completa. Antes era un modal con seis campos: entraba el
// nombre y el precio, y todo lo demás (medida, unidades por bulto, IVA,
// vencimiento, mínimos de reposición, precio por caja) quedaba sin cargar aunque
// la base lo soporta. Además no avisaba nada: dos personas cargando mercadería
// creaban el mismo artículo dos veces y el stock quedaba partido al medio.
//
// Acá: se revisa el código y el nombre CONTRA el catálogo mientras escriben, el
// precio se propone con el margen del rubro, y se puede encadenar un alta atrás
// de otra sin volver al listado.

type Opcion = { id: string; nombre: string; margenSugerido?: number | null };
type Sucursal = { id: string; nombre: string };
type Proveedor = { id: string; razon_social: string };
type Parecido = { sku: string; nombre: string; marca: string | null; activo: boolean };

const IVA = [21, 10.5, 27, 0];

const FORM = {
  codigoBarras: '', nombre: '', marca: '', rubro: '', sku: '',
  volumenMl: '', unidadesPack: '', graduacion: '', esAlcohol: false, plu: '', vendidoPorPeso: false,
  controlaVencimiento: false, alicuotaIva: '21', aliasBusqueda: '', descripcion: '',
  costo: '', precio: '', precioCaja: '', precioMayorista: '',
};

// Mismo redondeo de góndola que el servidor (apps/api/src/compras/precio.ts):
// a la centena, de 50 para arriba sube.
const redondearPrecio = (p: number) => {
  const n = Number(p) || 0;
  if (n <= 0) return 0;
  if (n < 100) return Math.round(n);
  return Math.round(n / 100) * 100;
};

export function AltaProducto({ rubros, marcas, sucursales, proveedores = [] }: { rubros: Opcion[]; marcas: Opcion[]; sucursales: Sucursal[]; proveedores?: Proveedor[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const volverA = params.get('volver');

  const [form, setForm] = useState<typeof FORM>({ ...FORM, codigoBarras: params.get('codigo') ?? '' });
  const [stock, setStock] = useState<Record<string, { cantidad: string; minimo: string; reposicion: string }>>(
    Object.fromEntries(sucursales.map((s) => [s.id, { cantidad: '', minimo: '', reposicion: '' }])),
  );
  // el código del bulto es distinto al de la unidad: se cargan los que haga falta
  const [codigosExtra, setCodigosExtra] = useState<string[]>([]);
  // foto: se sube DESPUÉS de crear (la API la guarda contra el SKU)
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  // proveedores que lo traen, con el código con el que ellos lo facturan
  const [provs, setProvs] = useState<{ proveedorId: string; codigoProveedor: string; costo: string }[]>([]);
  const [codigoDe, setCodigoDe] = useState<{ sku: string; nombre: string } | null>(null);
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [ignorarParecidos, setIgnorarParecidos] = useState(false);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState<{ sku: string; nombre: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const refNombre = useRef<HTMLInputElement>(null);

  const campo = (k: keyof typeof FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // el rubro elegido trae su margen: con eso se propone el precio de venta
  const margenRubro = useMemo(() => {
    const r = rubros.find((x) => x.nombre.toLowerCase() === form.rubro.trim().toLowerCase());
    return r?.margenSugerido != null ? Number(r.margenSugerido) : null;
  }, [form.rubro, rubros]);

  const costo = Number(form.costo) || 0;
  const precio = Number(form.precio) || 0;
  const margen = costo > 0 && precio > 0 ? Math.round(((precio - costo) / costo) * 100) : null;
  const precioSugerido = costo > 0 && margenRubro != null ? redondearPrecio(costo * (1 + margenRubro / 100)) : null;

  // ¿ese código ya es de alguien? Se pregunta al catálogo, no a la memoria de nadie
  useEffect(() => {
    const codigo = form.codigoBarras.trim();
    if (codigo.length < 6) { setCodigoDe(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/producto/revisar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo }),
        });
        const d = await r.json();
        setCodigoDe(d?.codigoDe ?? null);
      } catch { /* si no se puede revisar, el API lo rechaza igual al guardar */ }
    }, 350);
    return () => clearTimeout(t);
  }, [form.codigoBarras]);

  // ¿ya existe uno que se llama casi igual?
  useEffect(() => {
    const nombre = form.nombre.trim();
    if (nombre.length < 4) { setParecidos([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/producto/revisar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre }),
        });
        const d = await r.json();
        setParecidos(d?.parecidos ?? []);
        setIgnorarParecidos(false);
      } catch { /* el aviso es una ayuda, no un requisito */ }
    }, 400);
    return () => clearTimeout(t);
  }, [form.nombre]);

  const listo = form.nombre.trim().length > 1 && !codigoDe && !guardando;

  const guardar = async (seguirCargando: boolean) => {
    setGuardando(true);
    setError('');
    try {
      const stockInicial = sucursales.map((s) => ({
        sucursalId: s.id,
        cantidad: Number(stock[s.id]?.cantidad) || 0,
        minimo: Number(stock[s.id]?.minimo) || 0,
        reposicion: Number(stock[s.id]?.reposicion) || 0,
      }));
      const num = (v: string) => (Number(v) > 0 ? Number(v) : undefined);
      const res = await fetch('/api/producto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          rubro: form.rubro.trim() || undefined,
          marca: form.marca.trim() || undefined,
          sku: form.sku.trim() || undefined,
          codigoBarras: form.codigoBarras.trim() || undefined,
          codigosBarras: codigosExtra.map((c) => c.trim()).filter(Boolean),
          proveedores: provs
            .filter((p) => p.proveedorId)
            .map((p) => ({ proveedorId: p.proveedorId, codigoProveedor: p.codigoProveedor.trim() || undefined, costo: Number(p.costo) > 0 ? Number(p.costo) : undefined })),
          descripcion: form.descripcion.trim() || undefined,
          aliasBusqueda: form.aliasBusqueda.trim() || undefined,
          esAlcohol: form.esAlcohol,
          plu: form.plu || undefined,
          vendidoPorPeso: form.vendidoPorPeso,
          controlaVencimiento: form.controlaVencimiento,
          volumenMl: num(form.volumenMl),
          unidadesPack: num(form.unidadesPack),
          graduacion: num(form.graduacion),
          alicuotaIva: Number(form.alicuotaIva),
          costo: num(form.costo),
          precio: num(form.precio),
          precioCaja: num(form.precioCaja),
          precioMayorista: num(form.precioMayorista),
          stockInicial,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d?.message ?? 'No se pudo crear el producto'); return; }

      // la foto va después: la API la guarda contra el SKU recién asignado. Si
      // falla, el producto ya está creado — se avisa y se sigue.
      if (foto && d?.sku) {
        try {
          const fd = new FormData();
          fd.append('sku', d.sku);
          fd.append('imagen', foto);
          const rf = await fetch('/api/imagen', { method: 'POST', body: fd });
          if (!rf.ok) setError('El producto quedó creado, pero la foto no se pudo subir. Cargala desde su ficha.');
        } catch {
          setError('El producto quedó creado, pero la foto no se pudo subir. Cargala desde su ficha.');
        }
      }

      if (volverA) { router.push(volverA); return; }
      if (!seguirCargando) { router.push(`/productos/${d.sku}`); return; }

      // encadenar altas: se conservan rubro y marca, que suelen repetirse
      setHecho({ sku: d.sku, nombre: form.nombre.trim() });
      setForm((f) => ({ ...FORM, rubro: f.rubro, marca: f.marca, alicuotaIva: f.alicuotaIva }));
      setStock(Object.fromEntries(sucursales.map((s) => [s.id, { cantidad: '', minimo: '', reposicion: '' }])));
      setParecidos([]);
      setCodigoDe(null);
      setCodigosExtra([]);
      setFoto(null);
      setFotoUrl(null);
      setProvs([]);
      refNombre.current?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('No pude guardar. Fijate la conexión y probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  // título de cada tarjeta, enlaces dentro de textos y casillas de 44 px
  const TITULO = 'text-base font-semibold text-tinta';
  const ENLACE = 'font-medium underline underline-offset-2 hover:text-marca-hondo';
  const CASILLA = 'flex min-h-11 items-center gap-2 text-sm text-tinta';
  const CHECK = 'size-5 shrink-0 accent-marca';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <BotonVolver href={volverA ?? '/productos'} />
        <p className="text-sm text-tinta/70">
          El SKU se asigna solo. El rubro y la marca que no existan se crean al guardar.
        </p>
      </div>

      {hecho && (
        <Aviso tono="ok">
          Cargado: <b>{hecho.nombre}</b> · SKU {hecho.sku}.{' '}
          <Link href={`/productos/${hecho.sku}`} className={ENLACE}>Ver la ficha</Link> · seguí con el próximo.
        </Aviso>
      )}

      {/* 1 · QUÉ ES */}
      <Tarjeta className="space-y-4">
        <h2 className={TITULO}>Identificación</h2>

        <div>
          <Campo
            etiqueta="Código de barras"
            error={
              codigoDe ? (
                <>
                  Ese código ya es de <b>{codigoDe.nombre}</b> (SKU {codigoDe.sku}).{' '}
                  <Link href={`/productos/${codigoDe.sku}`} className={ENLACE}>Abrí esa ficha</Link> y cargale el stock ahí:
                  si lo creás de nuevo, las existencias quedan partidas entre dos productos.
                </>
              ) : undefined
            }
            ayuda="Sin código igual se puede cargar, pero después no escanea en caja ni en recepción."
          >
            <Entrada
              value={form.codigoBarras}
              onChange={(e) => campo('codigoBarras', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); refNombre.current?.focus(); } }}
              placeholder="Pasá el lector o escribilo"
              inputMode="numeric"
              autoFocus={!form.codigoBarras}
              className="font-mono"
            />
          </Campo>

          {codigosExtra.map((c, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <Entrada
                value={c}
                onChange={(e) => setCodigosExtra((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="Otro código (el del bulto, el del pack)"
                inputMode="numeric"
                aria-label="Otro código de barras"
                className="min-w-0 flex-1 font-mono"
              />
              <Boton
                variante="fantasma"
                aria-label="Quitar este código"
                onClick={() => setCodigosExtra((xs) => xs.filter((_, j) => j !== i))}
                icono={<IconoCerrar />}
                className="shrink-0"
              />
            </div>
          ))}
          <Boton variante="fantasma" tamano="chico" onClick={() => setCodigosExtra((xs) => [...xs, ''])} className="mt-2">
            + Agregar otro código de barras
          </Boton>
        </div>

        <div>
          <Campo etiqueta="Nombre" obligatorio>
            <Entrada
              ref={refNombre}
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Como lo busca el vendedor: Fernet Branca 750cc"
              autoFocus={!!form.codigoBarras}
            />
          </Campo>
          {parecidos.length > 0 && !ignorarParecidos && (
            <Aviso
              tono="atencion"
              className="mt-2"
              titulo={`Ya hay ${parecidos.length === 1 ? 'uno parecido' : `${parecidos.length} parecidos`} en el catálogo:`}
              accion={
                <Boton variante="secundario" tamano="chico" onClick={() => setIgnorarParecidos(true)}>
                  Ninguno es este, sigo
                </Boton>
              }
            >
              <ul className="space-y-0.5">
                {parecidos.map((p) => (
                  <li key={p.sku} className="break-words">
                    <Link href={`/productos/${p.sku}`} className={ENLACE}>{p.nombre}</Link>
                    {p.marca ? ` · ${p.marca}` : ''} · SKU {p.sku}{p.activo ? '' : ' · dado de baja'}
                  </li>
                ))}
              </ul>
            </Aviso>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Rubro">
            <Entrada value={form.rubro} onChange={(e) => campo('rubro', e.target.value)} list="rubros" placeholder="Ej: Aguas" />
          </Campo>
          <datalist id="rubros">{rubros.map((r) => <option key={r.id} value={r.nombre} />)}</datalist>
          <Campo etiqueta="Marca">
            <Entrada value={form.marca} onChange={(e) => campo('marca', e.target.value)} list="marcas" placeholder="Ej: Quilmes" />
          </Campo>
          <datalist id="marcas">{marcas.map((m) => <option key={m.id} value={m.nombre} />)}</datalist>
          <Campo etiqueta="SKU">
            <Entrada value={form.sku} onChange={(e) => campo('sku', e.target.value)} placeholder="se asigna solo" className="font-mono" />
          </Campo>
        </div>
      </Tarjeta>

      {/* 2 · FICHA */}
      <Tarjeta className="space-y-4">
        <h2 className={TITULO}>Ficha</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo etiqueta="Medida (cc)">
            <Entrada value={form.volumenMl} onChange={(e) => campo('volumenMl', e.target.value)} type="number" placeholder="750" />
          </Campo>
          <Campo etiqueta="Unidades por bulto">
            <Entrada value={form.unidadesPack} onChange={(e) => campo('unidadesPack', e.target.value)} type="number" placeholder="1" />
          </Campo>
          <Campo etiqueta="Graduación (%)">
            <Entrada
              value={form.graduacion}
              onChange={(e) => {
                campo('graduacion', e.target.value);
                if (Number(e.target.value) > 0) campo('esAlcohol', true); // con alcohol, es +18 sí o sí
              }}
              type="number" placeholder="—"
            />
          </Campo>
          <Campo etiqueta="IVA">
            <Selector value={form.alicuotaIva} onChange={(e) => campo('alicuotaIva', e.target.value)}>
              {IVA.map((v) => <option key={v} value={v}>{v} %</option>)}
            </Selector>
          </Campo>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <label className={CASILLA}>
            <input type="checkbox" checked={form.esAlcohol} onChange={(e) => campo('esAlcohol', e.target.checked)} className={CHECK} />
            Bebida alcohólica (+18)
          </label>
          <label className={CASILLA} title="La balanza manda gramos y el precio es por kilo">
            <input type="checkbox" checked={form.vendidoPorPeso} onChange={(e) => campo('vendidoPorPeso', e.target.checked)} className={CHECK} />
            Se vende por peso (balanza)
          </label>
          <label className={CASILLA}>
            PLU balanza
            <span className="w-28">
              <Entrada value={form.plu} onChange={(e) => campo('plu', e.target.value.replace(/\D/g, ''))} placeholder="ej: 3931" inputMode="numeric" />
            </span>
          </label>
          <label className={CASILLA}>
            <input type="checkbox" checked={form.controlaVencimiento} onChange={(e) => campo('controlaVencimiento', e.target.checked)} className={CHECK} />
            Controla vencimiento
          </label>
        </div>

        <Campo
          etiqueta="Cómo lo pide el cliente"
          ayuda="Lo usan el buscador y el bot de WhatsApp. Si el cliente lo nombra de una manera y la etiqueta dice otra, va acá."
        >
          <Entrada
            value={form.aliasBusqueda}
            onChange={(e) => campo('aliasBusqueda', e.target.value)}
            placeholder="fernet chico, birra litro, agua con gas"
          />
        </Campo>

        <Campo etiqueta="Descripción (opcional)">
          <AreaTexto value={form.descripcion} onChange={(e) => campo('descripcion', e.target.value)} rows={2} />
        </Campo>
      </Tarjeta>

      {/* FOTO */}
      <Tarjeta className="space-y-3">
        <h2 className={TITULO}>Foto</h2>
        <div className="flex items-center gap-4">
          {fotoUrl ? (
            <img src={fotoUrl} alt="" className="size-24 shrink-0 rounded-xl border border-black/[0.06] object-cover" />
          ) : (
            <span className="flex size-24 shrink-0 items-center justify-center rounded-xl bg-crema text-xs text-tinta/60">sin foto</span>
          )}
          <div className="min-w-0 space-y-2 text-sm">
            <label className={clasesBoton({ variante: 'secundario', tamano: 'chico' })}>
              {fotoUrl ? 'Cambiar foto' : 'Elegir foto'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFoto(f);
                  setFotoUrl(f ? URL.createObjectURL(f) : null);
                }}
                className="sr-only"
              />
            </label>
            <p className="text-xs text-tinta/60">
              La ve el vendedor en la caja y el cliente en el catálogo. Sacala derecha y con la etiqueta a la vista.
            </p>
          </div>
        </div>
      </Tarjeta>

      {/* PROVEEDORES QUE LO TRAEN */}
      <Tarjeta className="space-y-3">
        <div>
          <h2 className={TITULO}>Proveedores que lo traen</h2>
          <p className="mt-1 text-xs text-tinta/60">
            Con el código que usa cada proveedor en su factura, la próxima entrada de ese proveedor lo reconoce sola y no hay que vincularlo a mano.
          </p>
        </div>
        {provs.map((pv, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-xl border border-black/[0.06] p-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_auto] sm:border-0 sm:p-0"
          >
            <Campo etiqueta="Proveedor" className="col-span-3 sm:col-span-1">
              <Selector
                value={pv.proveedorId}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, proveedorId: e.target.value } : x)))}
                vacio="Elegí…"
                opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.razon_social }))}
              />
            </Campo>
            <Campo etiqueta="Su código">
              <Entrada
                value={pv.codigoProveedor}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, codigoProveedor: e.target.value } : x)))}
                placeholder="opcional"
                className="font-mono"
              />
            </Campo>
            <Campo etiqueta="Costo">
              <Entrada
                value={pv.costo}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))}
                type="number" prefijo="$"
              />
            </Campo>
            <Boton
              variante="fantasma"
              aria-label="Quitar este proveedor"
              onClick={() => setProvs((xs) => xs.filter((_, j) => j !== i))}
              icono={<IconoCerrar />}
            />
          </div>
        ))}
        <Boton
          variante="fantasma"
          tamano="chico"
          onClick={() => setProvs((xs) => [...xs, { proveedorId: '', codigoProveedor: '', costo: '' }])}
        >
          + Agregar proveedor
        </Boton>
      </Tarjeta>

      {/* 3 · PLATA */}
      <Tarjeta className="space-y-4">
        <h2 className={TITULO}>Precios</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Costo de compra (sin IVA)">
            <Entrada value={form.costo} onChange={(e) => campo('costo', e.target.value)} type="number" prefijo="$" />
          </Campo>
          <Campo etiqueta="Precio de venta">
            <Entrada value={form.precio} onChange={(e) => campo('precio', e.target.value)} type="number" prefijo="$" />
          </Campo>
        </div>

        {precioSugerido != null && (
          <Boton variante="secundario" tamano="chico" onClick={() => campo('precio', String(precioSugerido))}>
            Usar el margen de {form.rubro} ({margenRubro} %) → <span className="importe">{pesos(precioSugerido)}</span>
          </Boton>
        )}

        {margen != null && (
          <p className={`text-sm font-medium ${margen < 0 ? 'text-marca-hondo' : margen < 10 ? 'text-atencion' : 'text-ok'}`}>
            Margen: {margen} %{margen < 0 ? ' — estarías vendiendo abajo del costo' : margen < 10 ? ' — muy bajo, revisalo' : ''}
          </p>
        )}

        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <Campo etiqueta="Precio por caja cerrada (opcional)">
            <Entrada value={form.precioCaja} onChange={(e) => campo('precioCaja', e.target.value)} type="number" prefijo="$" />
          </Campo>
          <Campo etiqueta="Precio mayorista (opcional)">
            <Entrada value={form.precioMayorista} onChange={(e) => campo('precioMayorista', e.target.value)} type="number" prefijo="$" />
          </Campo>
        </div>
      </Tarjeta>

      {/* 4 · STOCK */}
      <Tarjeta className="space-y-3">
        <div>
          <h2 className={TITULO}>Stock por sucursal</h2>
          <p className="mt-1 text-xs text-tinta/60">
            La cantidad inicial entra como ajuste, con tu nombre. Si la mercadería llega por remito, dejala en cero y cargala en Recepción.
          </p>
        </div>
        {sucursales.map((s) => (
          <div key={s.id} className="grid grid-cols-3 items-end gap-3 sm:grid-cols-4">
            <div className="col-span-3 break-words pb-1 text-sm font-medium text-tinta/70 sm:col-span-1 sm:pb-2.5">{s.nombre}</div>
            <Campo etiqueta="Cantidad">
              <Entrada
                value={stock[s.id]?.cantidad ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], cantidad: e.target.value } }))}
                type="number" placeholder="0"
              />
            </Campo>
            <Campo etiqueta="Mínimo">
              <Entrada
                value={stock[s.id]?.minimo ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], minimo: e.target.value } }))}
                type="number" placeholder="0"
              />
            </Campo>
            <Campo etiqueta="Reponer en">
              <Entrada
                value={stock[s.id]?.reposicion ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], reposicion: e.target.value } }))}
                type="number" placeholder="0"
              />
            </Campo>
          </div>
        ))}
      </Tarjeta>

      {error && <Aviso tono="error">{error}</Aviso>}

      {/* barra fija: cargar de a muchos sin perder el botón de vista */}
      <BarraInferior etiqueta="Guardar el producto">
        <BotonLink href={volverA ?? '/productos'} variante="fantasma" className="max-sm:hidden">Cancelar</BotonLink>
        <Boton variante="secundario" onClick={() => guardar(true)} disabled={!listo}>
          Guardar y cargar otro
        </Boton>
        <Boton onClick={() => guardar(false)} disabled={!listo}>
          {guardando ? 'Guardando…' : 'Guardar producto'}
        </Boton>
      </BarraInferior>
    </div>
  );
}
