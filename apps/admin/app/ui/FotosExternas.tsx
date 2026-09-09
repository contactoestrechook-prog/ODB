'use client';

import { useEffect, useRef, useState } from 'react';

// Fotos de producto por código de barras (EZ Catalog de Huggian). La tarjeta
// muestra si la clave está cargada y funciona, cuántos productos activos con
// código esperan foto, y trae las fotos en tandas hasta terminar. También
// busca la foto de un producto puntual por su SKU.
type Estado = { configurada: boolean; conexion: 'ok' | 'error' | 'sin_clave'; mensaje: string; muestra?: any; sinFoto: number; consultadosHoy: number; fotosTraidas: number; porMinuto: number };

export function FotosExternas() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [tot, setTot] = useState({ procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, errores: 0, restantes: 0 });
  const [ultimos, setUltimos] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [sku, setSku] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultadoSku, setResultadoSku] = useState<any>(null);
  const parar = useRef(false);

  const cargar = async () => { try { const r = await fetch('/api/fotos-externas', { cache: 'no-store' }); if (r.ok) setEstado(await r.json()); } catch {} };
  useEffect(() => { cargar(); }, []);

  const completar = async () => {
    if (corriendo) { parar.current = true; return; }
    parar.current = false; setCorriendo(true); setAviso(''); setUltimos([]);
    const acumulado = { procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, errores: 0, restantes: estado?.sinFoto ?? 0 };
    while (!parar.current) {
      const r = await fetch('/api/fotos-externas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'completar', limite: 60 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(d.message ?? 'No se pudo consultar'); break; }
      for (const k of ['procesados', 'conFoto', 'sinProducto', 'sinImagen', 'errores'] as const) acumulado[k] += Number(d[k] ?? 0);
      acumulado.restantes = Number(d.restantes ?? 0);
      setTot({ ...acumulado });
      if (d.detalle?.length) setUltimos((u) => [...d.detalle, ...u].slice(0, 12));
      if (d.parado) { setAviso(d.parado); break; }
      if (!d.procesados || acumulado.restantes === 0) break;
    }
    setCorriendo(false); cargar();
  };

  const buscarSku = async () => {
    const s = sku.trim(); if (!s || buscando) return;
    setBuscando(true); setResultadoSku(null);
    try {
      const r = await fetch('/api/fotos-externas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'producto', sku: s }) });
      const d = await r.json().catch(() => ({}));
      setResultadoSku(r.ok ? d : { resultado: 'error', detalle: d.message ?? 'No se pudo' });
    } catch { setResultadoSku({ resultado: 'error', detalle: 'Sin conexión' }); }
    setBuscando(false); cargar();
  };

  const tono = estado?.conexion === 'ok' ? 'text-emerald-800' : estado?.conexion === 'error' ? 'text-red-700' : 'text-amber-800';
  return (
    <div className="mb-4 rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-black/45">Fotos por código de barras · EZ Catalog</p>
          <p className={'mt-1 text-sm font-medium ' + tono}>{estado ? estado.mensaje : 'Consultando…'}</p>
          {estado?.muestra?.nombre && <p className="text-xs text-black/50">Prueba: {estado.muestra.nombre}{estado.muestra.marca ? ` · ${estado.muestra.marca}` : ''}{estado.muestra.imagenUrl ? ' · con foto' : ''}</p>}
          {estado && (
            <p className="mt-1 text-xs text-black/60">
              <b className="text-black">{estado.sinFoto.toLocaleString('es-AR')}</b> productos activos con código esperan foto · {estado.fotosTraidas.toLocaleString('es-AR')} fotos traídas hasta ahora · {estado.consultadosHoy} consultas hoy · ritmo {estado.porMinuto}/min
            </p>
          )}
        </div>
        <button type="button" onClick={completar} disabled={!estado || estado.conexion !== 'ok' || (!corriendo && estado.sinFoto === 0)}
          className={'rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ' + (corriendo ? 'bg-neutral-700' : 'bg-[#B82D25]')}>
          {corriendo ? 'Parar' : 'Traer fotos faltantes'}
        </button>
      </div>
      {(corriendo || tot.procesados > 0) && (
        <div className="mt-3 rounded-xl bg-[#F0EBE2]/60 px-3 py-2 text-xs text-black/70">
          {corriendo && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#B82D25]" />}
          {tot.procesados} consultados · <b className="text-emerald-800">{tot.conFoto} con foto</b> · {tot.sinProducto} no están en el catálogo · {tot.sinImagen} sin imagen · {tot.errores} errores · faltan {tot.restantes}
          {ultimos.length > 0 && <span className="block mt-1 text-black/50">Últimos: {ultimos.map((u) => `${u.sku} ${u.resultado === 'foto' ? '✓' : u.resultado === 'sin_producto' ? '—' : '✕'}`).join(' · ')}</span>}
        </div>
      )}
      {aviso && <p className="mt-2 text-sm text-red-700">{aviso}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={sku} onChange={(e) => setSku(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') buscarSku(); }} placeholder="SKU de un producto" className="w-40 rounded-lg border border-black/15 px-3 py-1.5 text-sm" />
        <button type="button" onClick={buscarSku} disabled={buscando || !sku.trim() || estado?.conexion !== 'ok'} className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-40">{buscando ? 'Buscando…' : 'Buscar su foto por código'}</button>
        {resultadoSku && (
          <span className="flex items-center gap-2 text-sm">
            {resultadoSku.imagenUrl && <img src={resultadoSku.imagenUrl + '?v=' + Date.now()} alt="" className="h-10 w-10 rounded-lg object-cover" />}
            <span className={resultadoSku.resultado === 'foto' ? 'text-emerald-800' : 'text-black/60'}>
              {resultadoSku.resultado === 'foto' ? `Foto guardada${resultadoSku.nombreExterno ? ` · en el catálogo figura como "${resultadoSku.nombreExterno}"` : ''}`
                : resultadoSku.resultado === 'sin_producto' ? 'Ese código no está en el catálogo externo'
                : resultadoSku.resultado === 'sin_imagen' ? `Está en el catálogo (${resultadoSku.nombreExterno ?? '—'}) pero sin foto`
                : resultadoSku.detalle ?? 'No se pudo'}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
