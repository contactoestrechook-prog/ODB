'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AreaTexto, Aviso, Boton, Campo, Entrada, Etiqueta, IconoOk, Kpi, Monto, TablaResponsiva, Tarjeta, TarjetaCabecera, clasesBoton } from './kit';
import { pesos } from '../lib/formato';
import { coincideBusqueda } from '../lib/busqueda';

// íconos de línea propios de esta pantalla (en lugar de 📎 y 🎤)
function IconoClip({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.5 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" />
    </svg>
  );
}
function IconoMicrofono({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function ComparadorWorkspace({ comparacion, directorio, stats }: { comparacion: any[]; directorio: any[]; stats: any }) {
  const router = useRouter();
  const [aviso, setAviso] = useState('');

  // ---- cargar lista ----
  const [nombre, setNombre] = useState('');
  const [markup, setMarkup] = useState('1.6');
  const [efectivo, setEfectivo] = useState('0');
  const [texto, setTexto] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [analisis, setAnalisis] = useState<any>(null);
  const [aplicado, setAplicado] = useState(false);
  // aclaración por voz/texto (bonificaciones)
  const [aclaracion, setAclaracion] = useState('');
  const [escuchando, setEscuchando] = useState(false);
  const [interpretacion, setInterpretacion] = useState<any>(null);

  const masBaratoEn: Record<string, number> = {};
  for (const c of comparacion) masBaratoEn[c.prov_min] = (masBaratoEn[c.prov_min] ?? 0) + 1;

  const factor = interpretacion?.factorCosto ?? 1;
  const aplicaA = (desc: string) =>
    interpretacion?.alcance === 'producto' && interpretacion?.productoMencionado
      ? coincideBusqueda(desc, interpretacion.productoMencionado)
      : true;

  const analizar = async () => {
    if (!nombre.trim()) { setAviso('Poné el nombre del proveedor.'); return; }
    if (!texto.trim() && !file) { setAviso('Pegá la lista o subí un archivo (PDF/imagen).'); return; }
    setAviso(''); setCargando(true); setAnalisis(null); setAplicado(false);
    try {
      const body: any = { accion: 'analizar', proveedorNombre: nombre.trim(), markup: Number(markup), descuentoEfectivo: Number(efectivo), texto: texto.trim() || undefined };
      if (file) body.archivo = { base64: await fileToBase64(file), mime: file.type, nombre: file.name };
      const res = await fetch('/api/comparador', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'No se pudo analizar');
      setAnalisis(d);
    } catch (e) { setAviso(e instanceof Error ? e.message : 'Error'); }
    setCargando(false);
  };

  const aplicar = async () => {
    if (!analisis) return;
    setCargando(true); setAviso('');
    try {
      const items = analisis.paraAplicar.map((it: any) =>
        factor !== 1 && aplicaA(it.descripcion) ? { ...it, costo: Math.round(Number(it.costo) * factor) } : it);
      const body = { accion: 'aplicar', proveedorNombre: analisis.proveedorNombre, markup: analisis.markup, descuentoEfectivo: analisis.descuentoEfectivo, items };
      const res = await fetch('/api/comparador', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'No se pudo aplicar');
      setAplicado(true); setAviso(`Aplicado: ${d.aplicados} productos actualizados con costo y precio.`);
      router.refresh();
    } catch (e) { setAviso(e instanceof Error ? e.message : 'Error'); }
    setCargando(false);
  };

  const guardar = async (id: string) => {
    setAviso('');
    const cp = (document.getElementById(`cp-${id}`) as HTMLInputElement)?.value ?? '';
    const de = Number((document.getElementById(`de-${id}`) as HTMLInputElement)?.value || 0);
    const res = await fetch('/api/comparador', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, condicionPago: cp, descuentoEfectivo: de }) });
    const d = await res.json();
    setAviso(res.ok ? 'Condiciones actualizadas.' : d.message ?? 'Error');
    if (res.ok) router.refresh();
  };

  const dictar = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setAviso('Tu navegador no soporta dictado por voz. Escribí la aclaración a mano.'); return; }
    const rec = new SR();
    rec.lang = 'es-AR'; rec.interimResults = true; rec.continuous = false;
    setEscuchando(true);
    rec.onresult = (e: any) => setAclaracion(Array.from(e.results).map((r: any) => r[0].transcript).join(' '));
    rec.onerror = () => setEscuchando(false);
    rec.onend = () => setEscuchando(false);
    rec.start();
  };
  const interpretar = async () => {
    if (!aclaracion.trim()) return;
    setCargando(true); setAviso('');
    try {
      const res = await fetch('/api/comparador', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'interpretar', texto: aclaracion.trim() }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'No se pudo interpretar');
      setInterpretacion(d);
    } catch (e) { setAviso(e instanceof Error ? e.message : 'Error'); }
    setCargando(false);
  };

  // vista de los ítems con la bonificación aplicada (recalcula barato/caro)
  const vista = (analisis?.items ?? []).map((it: any) => {
    const f = aplicaA(it.descripcion) ? factor : 1;
    const ce = Math.round(it.costo * (1 - (analisis.descuentoEfectivo || 0) / 100) * f);
    let esMasBarato = it.esMasBarato, diffPct = it.diffPct;
    if (it.conComun) { esMasBarato = ce < it.costoOtro; diffPct = it.costoOtro ? Math.round(((ce - it.costoOtro) / it.costoOtro) * 100) : 0; }
    return { ...it, costoEfectivo: ce, esMasBarato, diffPct };
  });
  const resumenV = analisis ? {
    masBarato: vista.filter((i: any) => i.conComun && i.esMasBarato).length,
    masCaro: vista.filter((i: any) => i.conComun && !i.esMasBarato && i.diffPct > 0).length,
    ahorroPotencial: Math.round(vista.filter((i: any) => i.conComun && i.esMasBarato).reduce((s: number, i: any) => s + (i.costoOtro - i.costoEfectivo), 0)),
  } : { masBarato: 0, masCaro: 0, ahorroPotencial: 0 };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* KPIs */}
      {/* los rótulos largos bajan de renglón en vez de cortarse con "…" (en el celular la tarjeta mide 165 px) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta={<span className="whitespace-normal">Proveedores</span>} valor={stats?.proveedores ?? directorio.length} />
        <Kpi etiqueta={<span className="whitespace-normal">Productos comparables</span>} valor={stats?.productosComparables ?? comparacion.length} />
        <Kpi etiqueta={<span className="whitespace-normal">Ahorro potencial</span>} valor={<Monto valor={stats?.ahorroPotencial ?? 0} />} tono="ok" />
        <Kpi etiqueta={<span className="whitespace-normal">Dependencia del principal</span>} valor={(stats?.dependenciaPct ?? 0) + '%'} tono={(stats?.dependenciaPct ?? 0) >= 60 ? 'atencion' : 'neutro'} />
      </div>

      {stats?.principal && (stats?.dependenciaPct ?? 0) >= 50 && (
        <Aviso tono="atencion">
          Le comprás el <b>{stats.dependenciaPct}%</b> de tus productos a <b>{stats.principal.nombre}</b> ({stats.principal.productos}). Diversificar proveedores baja el riesgo y mejora precios — cargá otras listas abajo para comparar.
        </Aviso>
      )}

      {aviso && <Aviso tono={aplicado ? 'ok' : 'neutro'}>{aviso}</Aviso>}

      {/* ===== CARGAR LISTA DE PROVEEDOR ===== */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera
          titulo={<span className="flex items-center gap-2"><span className="inline-block size-1.5 shrink-0 rounded-full bg-marca" aria-hidden="true" /> Cargar lista de un proveedor y analizarla</span>}
        />
        <div className="space-y-3 p-4 sm:p-5">
          <p className="text-sm text-tinta/60">Pegá la lista (o subí el PDF/foto que te mandaron). La leemos con IA, la matcheamos con tu catálogo y te decimos en qué productos es más barato o más caro que tus proveedores actuales — antes de aplicar nada.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
            <Campo etiqueta="Proveedor" className="col-span-2 sm:col-span-1">
              <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. Distribuidora Norte" />
            </Campo>
            <Campo etiqueta="Markup (× costo)">
              <Entrada value={markup} onChange={(e) => setMarkup(e.target.value)} type="number" step="0.05" className="importe" />
            </Campo>
            <Campo etiqueta="% desc. efectivo">
              <Entrada value={efectivo} onChange={(e) => setEfectivo(e.target.value)} type="number" step="0.5" className="importe" />
            </Campo>
          </div>
          <AreaTexto aria-label="Texto de la lista" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Pegá acá el texto de la lista (producto y precio por renglón)…" className="font-mono" />
          <div className="flex flex-wrap items-center gap-2">
            <label className={clasesBoton({ variante: 'secundario', tamano: 'chico', className: 'min-w-0 cursor-pointer' })}>
              <IconoClip className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{file ? file.name : 'Subir PDF / imagen'}</span>
              <input type="file" accept=".pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file && <Boton variante="fantasma" tamano="chico" onClick={() => setFile(null)}>quitar</Boton>}
            <Boton variante={analisis ? 'secundario' : 'primario'} onClick={analizar} disabled={cargando} className="w-full sm:ml-auto sm:w-auto">
              {cargando ? 'Analizando…' : 'Analizar lista'}
            </Boton>
          </div>

          {analisis && (
            <div className="mt-2 overflow-hidden rounded-xl border border-black/[0.06]">
              <div className="flex flex-wrap gap-x-4 gap-y-1 bg-crema-claro px-4 py-3 text-sm text-tinta">
                <span><b>{analisis.extraidos}</b> productos leídos</span>
                <span><b>{analisis.matcheados}</b> matchean tu catálogo</span>
                <span className="text-ok">más barato en <b>{resumenV.masBarato}</b></span>
                <span className="text-atencion">más caro en <b>{resumenV.masCaro}</b></span>
                {resumenV.ahorroPotencial > 0 && <span className="text-ok">ahorro potencial <b className="importe">{pesos(resumenV.ahorroPotencial)}</b></span>}
                {factor !== 1 && <span className="text-marca-hondo">bonif. aplicada ×{factor} (−{interpretacion.equivaleADescuentoPct}%)</span>}
              </div>
              {vista.length > 0 && (
                <div className="max-h-80 overflow-y-auto overscroll-contain">
                  <TablaResponsiva
                    sinMarco
                    etiqueta="Productos de la lista analizada"
                    filas={vista}
                    claveFila={(_: any, i: number) => i}
                    columnas={[
                      {
                        clave: 'producto', titulo: 'Producto (lista)', principal: true,
                        celda: (it: any) => <><p className="break-words leading-tight">{it.descripcion}</p><p className="break-words text-xs font-normal text-tinta/60">→ {it.match}</p></>,
                      },
                      { clave: 'costo', titulo: 'Costo efvo.', importe: true, celda: (it: any) => <span className="font-medium">{pesos(it.costoEfectivo)}</span> },
                      {
                        clave: 'vs', titulo: 'vs proveedor actual',
                        celda: (it: any) => it.conComun ? (
                          <span className={it.esMasBarato ? 'text-ok' : 'text-atencion'}>
                            {it.esMasBarato ? '✓ más barato' : `▲ ${it.diffPct}% más caro`} que {it.provOtro} ({pesos(it.costoOtro)})
                          </span>
                        ) : <span className="text-tinta/60">nuevo / sin comparación</span>,
                      },
                    ]}
                  />
                </div>
              )}
              {/* aclaración por voz/texto (bonificaciones) */}
              <div className="border-t border-black/[0.06] bg-crema-claro/60 px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-tinta"><IconoMicrofono className="size-4 shrink-0" /> Aclaración del proveedor (voz o texto)</p>
                <p className="mb-2 text-xs text-tinta/60">Ej.: “si compro 6 cajas me regala 2”, “2x1 en cerveza”, “10% pagando en efectivo”. La IA la interpreta y recalcula los costos de arriba.</p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Boton variante={escuchando ? 'primario' : 'secundario'} tamano="chico" onClick={dictar} disabled={escuchando}
                    icono={<IconoMicrofono className="size-4" />}
                    className={escuchando ? 'animate-pulse motion-reduce:animate-none' : undefined}>
                    {escuchando ? 'Escuchando…' : 'Dictar'}
                  </Boton>
                  <Entrada aria-label="Aclaración del proveedor" value={aclaracion} onChange={(e) => setAclaracion(e.target.value)} placeholder="…o escribí la aclaración"
                    className="order-first col-span-2 sm:order-none sm:min-w-0 sm:flex-1" />
                  <Boton variante="secundario" tamano="chico" onClick={interpretar} disabled={cargando || !aclaracion.trim()}>Interpretar</Boton>
                </div>
                {interpretacion && (
                  <p className="mt-2 break-words rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-sm text-tinta/80">
                    <b className="text-marca-hondo">{interpretacion.equivaleADescuentoPct > 0 ? `−${interpretacion.equivaleADescuentoPct}% costo` : 'sin cambio'}</b> · {interpretacion.explicacion}
                    {interpretacion.alcance === 'producto' && interpretacion.productoMencionado && <span className="text-tinta/60"> (solo “{interpretacion.productoMencionado}”)</span>}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3 border-t border-black/[0.06] px-4 py-3 sm:flex-row sm:items-center">
                <p className="text-xs text-tinta/60">Aplicar guarda la lista, da de alta el proveedor y actualiza costo + precio de venta (costo × markup) de los matcheados{factor !== 1 ? ', con la bonificación aplicada' : ''}.</p>
                <Boton onClick={aplicar} disabled={cargando || aplicado} className="shrink-0 sm:ml-auto" icono={aplicado ? <IconoOk className="size-4" /> : undefined}>
                  {aplicado ? 'Aplicado' : cargando ? 'Aplicando…' : 'Aplicar al catálogo'}
                </Boton>
              </div>
            </div>
          )}
        </div>
      </Tarjeta>

      {/* Directorio de proveedores */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Proveedores (${directorio.length})`} />
        <div className="divide-y divide-black/[0.06]">
          {directorio.map((p) => (
            <div key={p.id} className="grid grid-cols-2 gap-3 px-4 py-3 sm:flex sm:flex-wrap sm:items-end sm:px-5">
              <div className="col-span-2 min-w-0 sm:min-w-40 sm:flex-1">
                <p className="break-words text-sm font-semibold text-tinta">{p.razon_social}</p>
                <p className="mt-0.5 text-xs text-tinta/60">
                  {p.productos} producto(s){masBaratoEn[p.razon_social] > 0 && <span className="text-ok"> · el más barato en {masBaratoEn[p.razon_social]}</span>}
                </p>
              </div>
              <Campo etiqueta="Condición de pago" id={`cp-${p.id}`} className="sm:w-44">
                <Entrada defaultValue={p.condicion_pago ?? ''} placeholder="contado / 30 días" />
              </Campo>
              <Campo etiqueta="% desc. efectivo" id={`de-${p.id}`} className="sm:w-32">
                <Entrada type="number" step="0.5" defaultValue={p.descuento_efectivo ?? 0} className="importe" />
              </Campo>
              <Boton variante="secundario" onClick={() => guardar(p.id)} className="col-span-2 sm:col-span-1">Guardar</Boton>
            </div>
          ))}
        </div>
      </Tarjeta>

      {/* Productos en común */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Productos con más de un proveedor (${comparacion.length})`} />
        <TablaResponsiva
          sinMarco
          etiqueta="Productos con más de un proveedor"
          filas={comparacion}
          claveFila="producto_id"
          vacio={<p className="px-4 py-8 text-center text-sm text-tinta/60">Todavía no hay productos en común. Aparecen a medida que cargás listas que pisan los mismos productos.</p>}
          columnas={[
            {
              clave: 'producto', titulo: 'Producto', principal: true,
              celda: (c: any) => (
                <>
                  <p className="break-words font-medium leading-tight">{c.nombre}</p>
                  {Number(c.spread_pct) > 80 && <Etiqueta tono="atencion" className="mt-1">revisar · otro pack/match</Etiqueta>}
                </>
              ),
            },
            {
              clave: 'conviene', titulo: 'Conviene comprarle a',
              celda: (c: any) => (
                <>
                  <p className="font-medium text-ok">{c.prov_min} · <span className="importe">{pesos(c.costo_min)}</span></p>
                  <p className="text-xs text-tinta/60">{c.pago_min || 'sin cond.'}{Number(c.desc_min) > 0 ? ` · ${c.desc_min}% efvo` : ''}</p>
                </>
              ),
            },
            {
              clave: 'caro', titulo: 'Más caro', alinear: 'derecha',
              celda: (c: any) => <span className="text-tinta/70">{c.prov_max}<br /><span className="importe text-tinta">{pesos(c.costo_max)}</span></span>,
            },
            {
              clave: 'dif', titulo: 'Dif.', importe: true,
              celda: (c: any) => <span className={`font-medium ${Number(c.spread_pct) > 80 ? 'text-atencion' : 'text-tinta/70'}`}>{c.spread_pct}%</span>,
            },
            { clave: 'ahorro', titulo: 'Ahorro', importe: true, celda: (c: any) => <span className="font-semibold text-ok">{pesos(c.ahorro)}</span> },
          ]}
        />
      </Tarjeta>
    </div>
  );
}
