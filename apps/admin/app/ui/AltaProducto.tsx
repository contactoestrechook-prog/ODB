'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

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
  volumenMl: '', unidadesPack: '', graduacion: '', esAlcohol: false,
  controlaVencimiento: false, alicuotaIva: '21', aliasBusqueda: '', descripcion: '',
  costo: '', precio: '', precioCaja: '', precioMayorista: '',
};

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

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

  const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';
  const etiqueta = 'text-xs text-black/50';

  return (
    <div className="max-w-3xl mx-auto p-6 pb-32">
      <div className="flex items-center gap-3 mb-1">
        <Link href={volverA ?? '/productos'} className="text-sm text-black/50 hover:text-black">←</Link>
        <h1 className="text-xl font-semibold text-black">Nuevo producto</h1>
      </div>
      <p className="text-sm text-black/50 mb-6">
        El SKU se asigna solo. El rubro y la marca que no existan se crean al guardar.
      </p>

      {hecho && (
        <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
          Cargado: <b>{hecho.nombre}</b> · SKU {hecho.sku}.{' '}
          <Link href={`/productos/${hecho.sku}`} className="underline">Ver la ficha</Link> · seguí con el próximo.
        </div>
      )}

      {/* 1 · QUÉ ES */}
      <section className="rounded-2xl bg-white p-5 space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Identificación</h2>

        <div>
          <label className={etiqueta}>Código de barras</label>
          <input
            value={form.codigoBarras}
            onChange={(e) => campo('codigoBarras', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); refNombre.current?.focus(); } }}
            placeholder="Pasá el lector o escribilo"
            inputMode="numeric"
            autoFocus={!form.codigoBarras}
            className={`${input} font-mono ${codigoDe ? 'border-[#B82D25] bg-[#B82D25]/5' : ''}`}
          />
          {codigoDe ? (
            <p className="mt-1.5 text-xs text-[#B82D25]">
              Ese código ya es de <b>{codigoDe.nombre}</b> (SKU {codigoDe.sku}).{' '}
              <Link href={`/productos/${codigoDe.sku}`} className="underline">Abrí esa ficha</Link> y cargale el stock ahí:
              si lo creás de nuevo, las existencias quedan partidas entre dos productos.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-black/40">Sin código igual se puede cargar, pero después no escanea en caja ni en recepción.</p>
          )}

          {codigosExtra.map((c, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <input
                value={c}
                onChange={(e) => setCodigosExtra((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="Otro código (el del bulto, el del pack)"
                inputMode="numeric"
                className={`${input} font-mono`}
              />
              <button onClick={() => setCodigosExtra((xs) => xs.filter((_, j) => j !== i))} className="text-black/40 hover:text-[#B82D25] px-1">✕</button>
            </div>
          ))}
          <button onClick={() => setCodigosExtra((xs) => [...xs, ''])} className="mt-1.5 text-xs text-[#B82D25] hover:underline">
            + Agregar otro código de barras
          </button>
        </div>

        <div>
          <label className={etiqueta}>Nombre <span className="text-[#B82D25]">*</span></label>
          <input
            ref={refNombre}
            value={form.nombre}
            onChange={(e) => campo('nombre', e.target.value)}
            placeholder="Como lo busca el vendedor: Fernet Branca 750cc"
            autoFocus={!!form.codigoBarras}
            className={input}
          />
          {parecidos.length > 0 && !ignorarParecidos && (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5">
              <p className="text-xs text-amber-900 font-medium">Ya hay {parecidos.length === 1 ? 'uno parecido' : `${parecidos.length} parecidos`} en el catálogo:</p>
              <ul className="mt-1 space-y-0.5">
                {parecidos.map((p) => (
                  <li key={p.sku} className="text-xs text-amber-900">
                    <Link href={`/productos/${p.sku}`} className="underline">{p.nombre}</Link>
                    {p.marca ? ` · ${p.marca}` : ''} · SKU {p.sku}{p.activo ? '' : ' · dado de baja'}
                  </li>
                ))}
              </ul>
              <button onClick={() => setIgnorarParecidos(true)} className="mt-1.5 text-xs text-amber-900/70 underline">
                Ninguno es este, sigo
              </button>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={etiqueta}>Rubro</label>
            <input value={form.rubro} onChange={(e) => campo('rubro', e.target.value)} list="rubros" placeholder="Ej: Aguas" className={input} />
            <datalist id="rubros">{rubros.map((r) => <option key={r.id} value={r.nombre} />)}</datalist>
          </div>
          <div>
            <label className={etiqueta}>Marca</label>
            <input value={form.marca} onChange={(e) => campo('marca', e.target.value)} list="marcas" placeholder="Ej: Quilmes" className={input} />
            <datalist id="marcas">{marcas.map((m) => <option key={m.id} value={m.nombre} />)}</datalist>
          </div>
          <div>
            <label className={etiqueta}>SKU</label>
            <input value={form.sku} onChange={(e) => campo('sku', e.target.value)} placeholder="se asigna solo" className={`${input} font-mono`} />
          </div>
        </div>
      </section>

      {/* 2 · FICHA */}
      <section className="mt-4 rounded-2xl bg-white p-5 space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Ficha</h2>
        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <label className={etiqueta}>Medida (cc)</label>
            <input value={form.volumenMl} onChange={(e) => campo('volumenMl', e.target.value)} type="number" placeholder="750" className={input} />
          </div>
          <div>
            <label className={etiqueta}>Unidades por bulto</label>
            <input value={form.unidadesPack} onChange={(e) => campo('unidadesPack', e.target.value)} type="number" placeholder="1" className={input} />
          </div>
          <div>
            <label className={etiqueta}>Graduación (%)</label>
            <input
              value={form.graduacion}
              onChange={(e) => {
                campo('graduacion', e.target.value);
                if (Number(e.target.value) > 0) campo('esAlcohol', true); // con alcohol, es +18 sí o sí
              }}
              type="number" placeholder="—" className={input}
            />
          </div>
          <div>
            <label className={etiqueta}>IVA</label>
            <select value={form.alicuotaIva} onChange={(e) => campo('alicuotaIva', e.target.value)} className={input}>
              {IVA.map((v) => <option key={v} value={v}>{v} %</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-black">
            <input type="checkbox" checked={form.esAlcohol} onChange={(e) => campo('esAlcohol', e.target.checked)} className="accent-[#B82D25] w-4 h-4" />
            Bebida alcohólica (+18)
          </label>
          <label className="flex items-center gap-2 text-sm text-black">
            <input type="checkbox" checked={form.controlaVencimiento} onChange={(e) => campo('controlaVencimiento', e.target.checked)} className="accent-[#B82D25] w-4 h-4" />
            Controla vencimiento
          </label>
        </div>

        <div>
          <label className={etiqueta}>Cómo lo pide el cliente</label>
          <input
            value={form.aliasBusqueda}
            onChange={(e) => campo('aliasBusqueda', e.target.value)}
            placeholder="fernet chico, birra litro, agua con gas"
            className={input}
          />
          <p className="mt-1 text-[11px] text-black/40">
            Lo usan el buscador y el bot de WhatsApp. Si el cliente lo nombra de una manera y la etiqueta dice otra, va acá.
          </p>
        </div>

        <div>
          <label className={etiqueta}>Descripción (opcional)</label>
          <textarea value={form.descripcion} onChange={(e) => campo('descripcion', e.target.value)} rows={2} className={input} />
        </div>
      </section>

      {/* FOTO */}
      <section className="mt-4 rounded-2xl bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Foto</h2>
        <div className="flex items-center gap-4">
          {fotoUrl ? (
            <img src={fotoUrl} alt="" className="h-24 w-24 rounded-lg object-cover border border-black/10" />
          ) : (
            <span className="h-24 w-24 rounded-lg bg-[#F0EBE2] flex items-center justify-center text-xs text-black/35">sin foto</span>
          )}
          <div className="text-sm">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFoto(f);
                setFotoUrl(f ? URL.createObjectURL(f) : null);
              }}
              className="text-sm text-black/70 file:mr-3 file:rounded-full file:border-0 file:bg-[#B82D25] file:px-4 file:py-2 file:text-white file:text-sm"
            />
            <p className="mt-1 text-[11px] text-black/40">
              La ve el vendedor en la caja y el cliente en el catálogo. Sacala derecha y con la etiqueta a la vista.
            </p>
          </div>
        </div>
      </section>

      {/* PROVEEDORES QUE LO TRAEN */}
      <section className="mt-4 rounded-2xl bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Proveedores que lo traen</h2>
        <p className="text-[11px] text-black/40 -mt-1">
          Con el código que usa cada proveedor en su factura, la próxima entrada de ese proveedor lo reconoce sola y no hay que vincularlo a mano.
        </p>
        {provs.map((pv, i) => (
          <div key={i} className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
            <div>
              <label className={etiqueta}>Proveedor</label>
              <select
                value={pv.proveedorId}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, proveedorId: e.target.value } : x)))}
                className={input}
              >
                <option value="">Elegí…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Su código</label>
              <input
                value={pv.codigoProveedor}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, codigoProveedor: e.target.value } : x)))}
                placeholder="opcional"
                className={`${input} sm:w-36 font-mono`}
              />
            </div>
            <div>
              <label className={etiqueta}>Costo</label>
              <input
                value={pv.costo}
                onChange={(e) => setProvs((xs) => xs.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))}
                type="number" placeholder="$" className={`${input} sm:w-28`}
              />
            </div>
            <button onClick={() => setProvs((xs) => xs.filter((_, j) => j !== i))} className="pb-2.5 text-black/40 hover:text-[#B82D25]">✕</button>
          </div>
        ))}
        <button onClick={() => setProvs((xs) => [...xs, { proveedorId: '', codigoProveedor: '', costo: '' }])} className="text-xs text-[#B82D25] hover:underline">
          + Agregar proveedor
        </button>
      </section>

      {/* 3 · PLATA */}
      <section className="mt-4 rounded-2xl bg-white p-5 space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Precios</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={etiqueta}>Costo de compra (sin IVA)</label>
            <input value={form.costo} onChange={(e) => campo('costo', e.target.value)} type="number" placeholder="$" className={input} />
          </div>
          <div>
            <label className={etiqueta}>Precio de venta</label>
            <input value={form.precio} onChange={(e) => campo('precio', e.target.value)} type="number" placeholder="$" className={input} />
          </div>
        </div>

        {precioSugerido != null && (
          <button
            onClick={() => campo('precio', String(precioSugerido))}
            className="text-xs rounded-full border border-[#B82D25]/30 text-[#B82D25] px-3 py-1.5 hover:bg-[#B82D25]/5"
          >
            Usar el margen de {form.rubro} ({margenRubro} %) → {pesos(precioSugerido)}
          </button>
        )}

        {margen != null && (
          <p className={`text-xs font-medium ${margen < 0 ? 'text-[#B82D25]' : margen < 10 ? 'text-amber-700' : 'text-emerald-700'}`}>
            Margen: {margen} %{margen < 0 ? ' — estarías vendiendo abajo del costo' : margen < 10 ? ' — muy bajo, revisalo' : ''}
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className={etiqueta}>Precio por caja cerrada (opcional)</label>
            <input value={form.precioCaja} onChange={(e) => campo('precioCaja', e.target.value)} type="number" placeholder="$" className={input} />
          </div>
          <div>
            <label className={etiqueta}>Precio mayorista (opcional)</label>
            <input value={form.precioMayorista} onChange={(e) => campo('precioMayorista', e.target.value)} type="number" placeholder="$" className={input} />
          </div>
        </div>
      </section>

      {/* 4 · STOCK */}
      <section className="mt-4 rounded-2xl bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-semibold text-black">Stock por sucursal</h2>
        <p className="text-[11px] text-black/40 -mt-1">
          La cantidad inicial entra como ajuste, con tu nombre. Si la mercadería llega por remito, dejala en cero y cargala en Recepción.
        </p>
        {sucursales.map((s) => (
          <div key={s.id} className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-3 sm:col-span-1 text-sm text-black/70 pb-2">{s.nombre}</div>
            <div>
              <label className={etiqueta}>Cantidad</label>
              <input
                value={stock[s.id]?.cantidad ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], cantidad: e.target.value } }))}
                type="number" placeholder="0" className={input}
              />
            </div>
            <div>
              <label className={etiqueta}>Mínimo</label>
              <input
                value={stock[s.id]?.minimo ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], minimo: e.target.value } }))}
                type="number" placeholder="0" className={input}
              />
            </div>
            <div>
              <label className={etiqueta}>Reponer en</label>
              <input
                value={stock[s.id]?.reposicion ?? ''}
                onChange={(e) => setStock((x) => ({ ...x, [s.id]: { ...x[s.id], reposicion: e.target.value } }))}
                type="number" placeholder="0" className={input}
              />
            </div>
          </div>
        ))}
      </section>

      {error && <p className="mt-4 rounded-lg bg-[#B82D25]/10 p-3 text-sm text-[#B82D25]">{error}</p>}

      {/* barra fija: cargar de a muchos sin perder el botón de vista */}
      <div className="fixed bottom-0 left-0 right-0 lg:pl-64 bg-white/95 backdrop-blur border-t border-black/10 p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-end gap-3">
          <Link href={volverA ?? '/productos'} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</Link>
          <button
            onClick={() => guardar(true)}
            disabled={!listo}
            className="rounded-full border border-[#B82D25] text-[#B82D25] text-sm font-medium px-5 py-2.5 hover:bg-[#B82D25]/5 disabled:opacity-40"
          >
            Guardar y cargar otro
          </button>
          <button
            onClick={() => guardar(false)}
            disabled={!listo}
            className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-40"
          >
            {guardando ? 'Guardando…' : 'Guardar producto'}
          </button>
        </div>
      </div>
    </div>
  );
}
