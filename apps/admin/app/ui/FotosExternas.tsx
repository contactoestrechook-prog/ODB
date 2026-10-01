'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Entrada, Tarjeta, ROTULO } from './kit';

// Fotos de producto por código de barras (EZ Catalog de Huggian). La tarjeta
// muestra si la clave está cargada y funciona, cuántos productos activos con
// código esperan foto, y trae las fotos en tandas hasta terminar. También
// busca la foto de un producto puntual por su SKU.
type Estado = { configurada: boolean; conexion: 'ok' | 'error' | 'sin_clave'; mensaje: string; muestra?: any; sinFoto: number; consultadosHoy: number; fotosTraidas: number; porMinuto: number };
// El catálogo a veces devuelve la ficha de otro producto con nuestro código (a
// un vino, pintura). Esas no se guardan solas: quedan acá para mirarlas.
// Control de calidad: el catálogo externo saca muchas fotos de bases
// colaborativas (Open Food Facts), donde la gente fotografía el producto con el
// celular. Una foto con la mano y la mesa de madera queda peor que no tener foto.
type Calidad = { conFoto: number; revisadas: number; sacadas: number; sinRevisar: number; modelo: string };
type Dudosa = { id: string; sku: string; ean: string; nuestro: string; externo: string | null; marca: string | null; urlExterna: string | null; motivo: string | null };

export function FotosExternas() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [tot, setTot] = useState({ procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, dudosas: 0, errores: 0, restantes: 0 });
  const [ultimos, setUltimos] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [sku, setSku] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultadoSku, setResultadoSku] = useState<any>(null);
  const [dudosas, setDudosas] = useState<Dudosa[]>([]);
  const [calidad, setCalidad] = useState<Calidad | null>(null);
  const [mirando, setMirando] = useState(false);
  const [totCalidad, setTotCalidad] = useState({ revisadas: 0, sacadas: 0 });
  const pararCalidad = useRef(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const parar = useRef(false);

  const cargar = async () => { try { const r = await fetch('/api/fotos-externas', { cache: 'no-store' }); if (r.ok) setEstado(await r.json()); } catch {} };
  const cargarDudosas = async () => { try { const r = await fetch('/api/fotos-externas?que=dudosas', { cache: 'no-store' }); if (r.ok) setDudosas(await r.json()); } catch {} };
  const cargarCalidad = async () => { try { const r = await fetch('/api/fotos-externas?que=calidad', { cache: 'no-store' }); if (r.ok) setCalidad(await r.json()); } catch {} };
  useEffect(() => { cargar(); cargarDudosas(); cargarCalidad(); }, []);

  const revisarCalidad = async () => {
    if (mirando) { pararCalidad.current = true; return; }
    pararCalidad.current = false; setMirando(true);
    const acum = { revisadas: 0, sacadas: 0 };
    while (!pararCalidad.current) {
      const r = await fetch('/api/fotos-externas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'calidad', limite: 40 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(d.message ?? 'No se pudo revisar'); break; }
      acum.revisadas += Number(d.revisadas ?? 0); acum.sacadas += Number(d.sacadas ?? 0);
      setTotCalidad({ ...acum });
      if (!d.revisadas || d.faltan === 0) break;
    }
    setMirando(false); cargar(); cargarCalidad();
  };

  const resolver = async (d: Dudosa, aceptar: boolean) => {
    setResolviendo(d.id);
    try {
      await fetch('/api/fotos-externas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'dudosa', id: d.id, aceptar }) });
      setDudosas((ds) => ds.filter((x) => x.id !== d.id));
      if (aceptar) cargar();
    } catch {}
    setResolviendo(null);
  };

  const completar = async () => {
    if (corriendo) { parar.current = true; return; }
    parar.current = false; setCorriendo(true); setAviso(''); setUltimos([]);
    const acumulado = { procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, dudosas: 0, errores: 0, restantes: estado?.sinFoto ?? 0 };
    while (!parar.current) {
      const r = await fetch('/api/fotos-externas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'completar', limite: 40 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(d.message ?? 'No se pudo consultar'); break; }
      for (const k of ['procesados', 'conFoto', 'sinProducto', 'sinImagen', 'dudosas', 'errores'] as const) acumulado[k] += Number(d[k] ?? 0);
      acumulado.restantes = Number(d.restantes ?? 0);
      setTot({ ...acumulado });
      if (d.detalle?.length) setUltimos((u) => [...d.detalle, ...u].slice(0, 12));
      if (d.parado) { setAviso(d.parado); break; }
      if (!d.procesados || acumulado.restantes === 0) break;
    }
    setCorriendo(false); cargar(); cargarDudosas();
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

  const tono = estado?.conexion === 'ok' ? 'text-ok' : estado?.conexion === 'error' ? 'text-marca-hondo' : 'text-atencion';
  return (
    <Tarjeta>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={ROTULO}>Fotos por código de barras · EZ Catalog</p>
          <p className={'mt-1 text-sm font-medium ' + tono}>{estado ? estado.mensaje : 'Consultando…'}</p>
          {estado?.muestra?.nombre && <p className="break-words text-xs text-tinta/60">Prueba: {estado.muestra.nombre}{estado.muestra.marca ? ` · ${estado.muestra.marca}` : ''}{estado.muestra.imagenUrl ? ' · con foto' : ''}</p>}
          {estado && (
            <p className="mt-1 text-xs text-tinta/70">
              <b className="importe text-tinta">{estado.sinFoto.toLocaleString('es-AR')}</b> productos activos con código esperan foto · {estado.fotosTraidas.toLocaleString('es-AR')} fotos traídas hasta ahora · {estado.consultadosHoy} consultas hoy · ritmo {estado.porMinuto}/min
            </p>
          )}
        </div>
        <Boton
          variante={corriendo ? 'secundario' : 'primario'}
          onClick={completar}
          disabled={!estado || estado.conexion !== 'ok' || (!corriendo && estado.sinFoto === 0)}
          className="w-full shrink-0 sm:w-auto"
        >
          {corriendo ? 'Parar' : 'Traer fotos faltantes'}
        </Boton>
      </div>
      {(corriendo || tot.procesados > 0) && (
        <div className="mt-3 rounded-xl bg-crema-claro px-3 py-2 text-xs text-tinta/70">
          {corriendo && <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-marca motion-reduce:animate-none" />}
          {tot.procesados} consultados · <b className="text-ok">{tot.conFoto} con foto</b> · {tot.sinProducto} no están en el catálogo · {tot.sinImagen} sin imagen · {tot.dudosas} para revisar · {tot.errores} errores · faltan {tot.restantes}
          {ultimos.length > 0 && <span className="mt-1 block break-words text-tinta/60">Últimos: {ultimos.map((u) => `${u.sku} ${u.resultado === 'foto' ? '✓' : u.resultado === 'sin_producto' ? '—' : '✕'}`).join(' · ')}</span>}
        </div>
      )}
      {aviso && <Aviso tono="error" className="mt-3">{aviso}</Aviso>}
      {calidad && calidad.conFoto > 0 && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-black/[0.06] bg-crema-claro px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-tinta/70">
            <b className="text-tinta">Calidad de las fotos.</b> El catálogo externo trae muchas fotos caseras (una mano, la mesa de madera, la góndola de fondo): esas se sacan y el producto queda sin foto, que se ve mejor.
            <span className="mt-0.5 block">{calidad.revisadas.toLocaleString('es-AR')} miradas · <b className="text-tinta">{calidad.sacadas.toLocaleString('es-AR')} sacadas</b> · {calidad.sinRevisar.toLocaleString('es-AR')} sin mirar
              {mirando && <> · <span className="text-marca-hondo">{totCalidad.revisadas} en esta pasada, {totCalidad.sacadas} sacadas</span></>}
            </span>
          </div>
          <Boton
            variante="secundario"
            onClick={revisarCalidad}
            disabled={!mirando && calidad.sinRevisar === 0}
            className="w-full shrink-0 sm:w-auto"
          >
            {mirando ? 'Parar' : 'Revisar calidad'}
          </Boton>
        </div>
      )}
      {dudosas.length > 0 && (
        <div className="mt-3 rounded-xl border border-atencion/20 bg-atencion-suave p-3">
          <p className="text-sm font-semibold text-atencion">{dudosas.length} {dudosas.length === 1 ? 'foto para revisar' : 'fotos para revisar'}</p>
          <p className="mt-0.5 text-xs text-tinta/70">El catálogo devolvió otro nombre para estos códigos. Mirá la foto: si es el producto, aceptala; si no, descartala y no se vuelve a pedir.</p>
          <ul className="mt-2 space-y-2">
            {dudosas.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-2">
                {d.urlExterna
                  ? <img src={d.urlExterna} alt="" className="size-14 shrink-0 rounded-xl border border-black/[0.06] object-contain" />
                  : <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-black/[0.06] text-xs text-tinta/60">sin foto</span>}
                <div className="min-w-0 flex-1 basis-40">
                  <p className="min-w-0 break-words text-sm font-medium text-tinta">{d.nuestro}</p>
                  <p className="min-w-0 break-words text-xs text-tinta/70">En el catálogo: {d.externo ?? '—'}{d.marca ? ` · ${d.marca}` : ''}</p>
                  <p className="min-w-0 break-all text-xs text-tinta/60">{d.sku} · {d.ean}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Boton variante="secundario" tamano="chico" disabled={resolviendo === d.id || !d.urlExterna} onClick={() => resolver(d, true)}>Es este</Boton>
                  <Boton variante="peligro" tamano="chico" disabled={resolviendo === d.id} onClick={() => resolver(d, false)}>No es</Boton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Entrada
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') buscarSku(); }}
          placeholder="SKU de un producto"
          aria-label="SKU de un producto"
          className="min-w-0 flex-1 basis-36 sm:max-w-44"
        />
        <Boton variante="secundario" onClick={buscarSku} disabled={buscando || !sku.trim() || estado?.conexion !== 'ok'}>
          {buscando ? 'Buscando…' : 'Buscar su foto por código'}
        </Boton>
        {resultadoSku && (
          <span className="flex min-w-0 basis-full items-center gap-2 text-sm">
            {resultadoSku.imagenUrl && <img src={resultadoSku.imagenUrl + '?v=' + Date.now()} alt="" className="size-10 shrink-0 rounded-xl object-cover" />}
            <span className={'min-w-0 break-words ' + (resultadoSku.resultado === 'foto' ? 'text-ok' : 'text-tinta/70')}>
              {resultadoSku.resultado === 'foto' ? `Foto guardada${resultadoSku.nombreExterno ? ` · en el catálogo figura como "${resultadoSku.nombreExterno}"` : ''}`
                : resultadoSku.resultado === 'sin_producto' ? 'Ese código no está en el catálogo externo'
                : resultadoSku.resultado === 'sin_imagen' ? `Está en el catálogo (${resultadoSku.nombreExterno ?? '—'}) pero sin foto`
                : resultadoSku.detalle ?? 'No se pudo'}
            </span>
          </span>
        )}
      </div>
    </Tarjeta>
  );
}
