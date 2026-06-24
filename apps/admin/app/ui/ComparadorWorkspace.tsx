'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));

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
      ? (desc || '').toLowerCase().includes(String(interpretacion.productoMencionado).toLowerCase())
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
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Proveedores', stats?.proveedores ?? directorio.length],
          ['Productos comparables', stats?.productosComparables ?? comparacion.length],
          ['Ahorro potencial', pesos(stats?.ahorroPotencial ?? 0), 'text-emerald-700'],
          ['Dependencia del principal', (stats?.dependenciaPct ?? 0) + '%', (stats?.dependenciaPct ?? 0) >= 60 ? 'text-amber-600' : ''],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}</p>
          </div>
        ))}
      </div>

      {stats?.principal && (stats?.dependenciaPct ?? 0) >= 50 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          ⚠ Le comprás el <b>{stats.dependenciaPct}%</b> de tus productos a <b>{stats.principal.nombre}</b> ({stats.principal.productos}). Diversificar proveedores baja el riesgo y mejora precios — cargá otras listas abajo para comparar.
        </div>
      )}

      {aviso && <p className={`rounded-lg p-3 text-sm ${aplicado ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-black/70'}`}>{aviso}</p>}

      {/* ===== CARGAR LISTA DE PROVEEDOR ===== */}
      <section className="rounded-xl bg-white overflow-hidden border border-[#B82D25]/20">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B82D25]" /> Cargar lista de un proveedor y analizarla
        </h2>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-black/50">Pegá la lista (o subí el PDF/foto que te mandaron). La leemos con IA, la matcheamos con tu catálogo y te decimos en qué productos es más barato o más caro que tus proveedores actuales — antes de aplicar nada.</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[11px] text-black/45 block mb-1">Proveedor</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. Distribuidora Norte" className="w-full rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-black/45 block mb-1">Markup (× costo)</label>
              <input value={markup} onChange={(e) => setMarkup(e.target.value)} type="number" step="0.05" className="w-24 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-black/45 block mb-1">% desc. efectivo</label>
              <input value={efectivo} onChange={(e) => setEfectivo(e.target.value)} type="number" step="0.5" className="w-24 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Pegá acá el texto de la lista (producto y precio por renglón)…" className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm font-mono" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-black/60 cursor-pointer rounded-lg border border-black/15 px-3 py-1.5 hover:bg-black/[0.03]">
              {file ? `📎 ${file.name}` : '📎 Subir PDF / imagen'}
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file && <button onClick={() => setFile(null)} className="text-xs text-black/40 hover:text-black/70">quitar</button>}
            <button onClick={analizar} disabled={cargando} className="ml-auto rounded-full bg-black text-white text-xs font-medium px-5 py-2 hover:bg-black/80 disabled:opacity-50">
              {cargando ? 'Analizando…' : 'Analizar lista'}
            </button>
          </div>

          {analisis && (
            <div className="mt-2 rounded-xl border border-black/10 overflow-hidden">
              <div className="flex flex-wrap gap-4 px-4 py-3 bg-black/[0.02] text-sm">
                <span><b>{analisis.extraidos}</b> productos leídos</span>
                <span><b>{analisis.matcheados}</b> matchean tu catálogo</span>
                <span className="text-emerald-700">más barato en <b>{resumenV.masBarato}</b></span>
                <span className="text-amber-700">más caro en <b>{resumenV.masCaro}</b></span>
                {resumenV.ahorroPotencial > 0 && <span className="text-emerald-700">ahorro potencial <b>{pesos(resumenV.ahorroPotencial)}</b></span>}
                {factor !== 1 && <span className="text-[#B82D25]">bonif. aplicada ×{factor} (−{interpretacion.equivaleADescuentoPct}%)</span>}
              </div>
              {vista.length > 0 && (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm text-black">
                    <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-black/50 border-b border-black/5">
                      <th className="px-4 py-2 font-medium">Producto (lista)</th>
                      <th className="px-4 py-2 font-medium text-right">Costo efvo.</th>
                      <th className="px-4 py-2 font-medium">vs proveedor actual</th>
                    </tr></thead>
                    <tbody>
                      {vista.map((it: any, i: number) => (
                        <tr key={i} className="border-b border-black/5 last:border-0">
                          <td className="px-4 py-2.5"><p className="leading-tight">{it.descripcion}</p><p className="text-[11px] text-black/40">→ {it.match}</p></td>
                          <td className="px-4 py-2.5 text-right font-medium">{pesos(it.costoEfectivo)}</td>
                          <td className="px-4 py-2.5">
                            {it.conComun ? (
                              <span className={it.esMasBarato ? 'text-emerald-700' : 'text-amber-700'}>
                                {it.esMasBarato ? '✓ más barato' : `▲ ${it.diffPct}% más caro`} que {it.provOtro} ({pesos(it.costoOtro)})
                              </span>
                            ) : <span className="text-black/35">nuevo / sin comparación</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* aclaración por voz/texto (bonificaciones) */}
              <div className="px-4 py-3 border-t border-black/10 bg-black/[0.015]">
                <p className="text-[12px] font-medium text-black mb-1">🎤 Aclaración del proveedor (voz o texto)</p>
                <p className="text-[11px] text-black/45 mb-2">Ej.: “si compro 6 cajas me regala 2”, “2x1 en cerveza”, “10% pagando en efectivo”. La IA la interpreta y recalcula los costos de arriba.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={dictar} disabled={escuchando} className={`rounded-full text-xs font-medium px-3 py-1.5 border ${escuchando ? 'bg-[#B82D25] text-white border-[#B82D25] animate-pulse' : 'border-black/15 hover:bg-black/[0.03]'}`}>{escuchando ? '● Escuchando…' : '🎤 Dictar'}</button>
                  <input value={aclaracion} onChange={(e) => setAclaracion(e.target.value)} placeholder="…o escribí la aclaración" className="flex-1 min-w-[180px] rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
                  <button onClick={interpretar} disabled={cargando || !aclaracion.trim()} className="rounded-full bg-black text-white text-xs font-medium px-4 py-1.5 hover:bg-black/80 disabled:opacity-50">Interpretar</button>
                </div>
                {interpretacion && (
                  <p className="mt-2 text-[12px] text-black/75 bg-white rounded-lg border border-black/10 px-3 py-2">
                    <b className="text-[#B82D25]">{interpretacion.equivaleADescuentoPct > 0 ? `−${interpretacion.equivaleADescuentoPct}% costo` : 'sin cambio'}</b> · {interpretacion.explicacion}
                    {interpretacion.alcance === 'producto' && interpretacion.productoMencionado && <span className="text-black/45"> (solo “{interpretacion.productoMencionado}”)</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 px-4 py-3 border-t border-black/10">
                <p className="text-[11px] text-black/45">Aplicar guarda la lista, da de alta el proveedor y actualiza costo + precio de venta (costo × markup) de los matcheados{factor !== 1 ? ', con la bonificación aplicada' : ''}.</p>
                <button onClick={aplicar} disabled={cargando || aplicado} className="ml-auto rounded-full bg-[#B82D25] text-white text-xs font-medium px-5 py-2 hover:bg-[#932A1F] disabled:opacity-50">
                  {aplicado ? '✓ Aplicado' : cargando ? 'Aplicando…' : 'Aplicar al catálogo'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Directorio de proveedores */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Proveedores ({directorio.length})</h2>
        <div className="divide-y divide-black/5">
          {directorio.map((p) => (
            <div key={p.id} className="flex flex-wrap items-end gap-3 px-4 py-3">
              <div className="flex-1 min-w-[160px]">
                <p className="font-medium text-black text-sm">{p.razon_social}</p>
                <p className="text-[11px] text-black/45 mt-0.5">
                  {p.productos} producto(s){masBaratoEn[p.razon_social] > 0 && <span className="text-emerald-700"> · el más barato en {masBaratoEn[p.razon_social]}</span>}
                </p>
              </div>
              <div>
                <label className="text-[11px] text-black/45 block">Condición de pago</label>
                <input id={`cp-${p.id}`} defaultValue={p.condicion_pago ?? ''} placeholder="contado / 30 días" className="w-40 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-black/45 block">% desc. efectivo</label>
                <input id={`de-${p.id}`} type="number" step="0.5" defaultValue={p.descuento_efectivo ?? 0} className="w-24 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
              </div>
              <button onClick={() => guardar(p.id)} className="rounded-full bg-black text-white text-xs font-medium px-4 py-2 hover:bg-black/80">Guardar</button>
            </div>
          ))}
        </div>
      </section>

      {/* Productos en común */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Productos con más de un proveedor ({comparacion.length})</h2>
        {comparacion.length === 0 ? (
          <p className="px-4 py-8 text-center text-black/40 text-sm">Todavía no hay productos en común. Aparecen a medida que cargás listas que pisan los mismos productos.</p>
        ) : (
          <table className="w-full text-sm text-black">
            <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium">Conviene comprarle a</th>
              <th className="px-4 py-2 font-medium text-right">Más caro</th>
              <th className="px-4 py-2 font-medium text-right">Dif.</th>
              <th className="px-4 py-2 font-medium text-right">Ahorro</th>
            </tr></thead>
            <tbody>
              {comparacion.map((c) => {
                const sosp = Number(c.spread_pct) > 80;
                return (
                  <tr key={c.producto_id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium leading-tight">{c.nombre}</p>{sosp && <span className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1 inline-block">revisar · otro pack/match</span>}</td>
                    <td className="px-4 py-3"><p className="font-medium text-emerald-800">{c.prov_min} · {pesos(c.costo_min)}</p><p className="text-[11px] text-black/45">{c.pago_min || 'sin cond.'}{Number(c.desc_min) > 0 ? ` · ${c.desc_min}% efvo` : ''}</p></td>
                    <td className="px-4 py-3 text-right text-black/55">{c.prov_max}<br /><span className="text-black/70">{pesos(c.costo_max)}</span></td>
                    <td className={`px-4 py-3 text-right font-medium ${sosp ? 'text-amber-600' : 'text-black/70'}`}>{c.spread_pct}%</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{pesos(c.ahorro)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
