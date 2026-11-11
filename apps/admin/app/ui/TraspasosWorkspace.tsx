'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, Entrada, Etiqueta, Pestanas, Selector, Tarjeta, Vacio, unir, useConfirmar } from './kit';
import { ROTULO } from './kit/clases';
import { fechaHora, pesos } from '../lib/formato';
import { CamaraCodigo } from './CamaraCodigo';

// ============================================================
// TRASPASOS ENTRE LOCALES (Leandro, 10/11/2026: «bien completo, que no le
// falte nada»). Un local PIDE (con sugerencias: lo que le falta y al otro le
// sobra), el otro PREPARA escaneando y MANDA (sale de su stock, queda en
// camino, con remito), alguien lo LLEVA, el que pidió RECIBE contando (entra
// lo que llegó) y lo que no cerró lo DECIDE gerencia. Todo queda en el
// historial, valorizado al costo. La API: apps/api/src/traspasos.
// ============================================================

type Item = { productoId: string; sku: string | null; nombre: string; pedido: number | null; enviado: number; recibido: number | null; diferencia: number; costo: number | null; nota: string | null; resolucion: string | null };
type Traspaso = {
  id: string; numero: number; estado: 'pedido' | 'en_transito' | 'con_diferencias' | 'recibida' | 'anulada';
  origen: { id: string; nombre: string }; destino: { id: string; nombre: string }; llevaId: string | null;
  creadoEn: string; pedidaEn: string | null; enviadaEn: string | null; entregadaEn: string | null; recibidaEn: string | null; cerradaEn: string | null; anuladaEn: string | null;
  pidio: string | null; envio: string | null; lleva: string | null; recibio: string | null; anulo: string | null;
  nota: string | null; notaRecepcion: string | null; motivoAnulacion: string | null;
  items: Item[]; valor: number; diferencias: number; sinResolver: number;
};
type Datos = { traspasos: Traspaso[]; sucursales: { id: string; nombre: string }[]; personas: { id: string; nombre: string; rol: string }[]; miSucursal: string | null; rol: string | null; veTodo: boolean; decideDiferencias: boolean };
type Renglon = { sku: string; nombre: string; cantidad: number; pedido?: number | null; nota?: string };
type Vista = 'pedir' | 'mandar' | 'camino' | 'diferencias' | 'historial';

const ESTADO: Record<Traspaso['estado'], { texto: string; tono: 'info' | 'atencion' | 'ok' | 'neutro' | 'error' }> = {
  pedido: { texto: 'Pedido', tono: 'atencion' },
  en_transito: { texto: 'En camino', tono: 'info' },
  con_diferencias: { texto: 'Con diferencias', tono: 'error' },
  recibida: { texto: 'Recibido', tono: 'ok' },
  anulada: { texto: 'Anulado', tono: 'neutro' },
};
const cant = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 }));
const corto = (s: string) => s.replace(/^Suc\.?\s+/i, '');
const esCodigo = (t: string) => /^\d{6,14}$/.test(String(t ?? '').replace(/\s/g, ''));

async function api(p: string, cuerpo?: Record<string, unknown>) {
  const r = cuerpo
    ? await fetch('/api/traspasos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p, ...cuerpo }) })
    : await fetch(`/api/traspasos?p=${p}`, { cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message ?? 'No se pudo');
  return d;
}

export function TraspasosWorkspace() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [local, setLocal] = useState('');
  const [vista, setVista] = useState<Vista>('mandar');
  const [abierto, setAbierto] = useState<{ modo: 'mandar' | 'recibir' | 'nuevo'; t: Traspaso | null } | null>(null);

  // Desde Compras («Pedir el traspaso», 11/11/2026): /traspasos?para=<local que
  // lo necesita>. Abre directo en Pedir, parado en ese local y con la
  // sugerencia ya buscada. Quien solo opera su local sigue en el suyo.
  const [paraLocal] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('para') ?? ''));

  const cargar = useCallback(async () => {
    try {
      const d: Datos = await api('');
      setDatos(d);
      const pedido = (d.veTodo || !d.miSucursal) && d.sucursales.some((s) => s.id === paraLocal) ? paraLocal : '';
      setLocal((l) => l || pedido || d.miSucursal || d.sucursales[0]?.id || '');
    } catch (e: any) { setError(e.message); }
  }, [paraLocal]);
  useEffect(() => { cargar(); }, [cargar]);

  const otros = useMemo(() => (datos?.sucursales ?? []).filter((s) => s.id !== local), [datos, local]);
  const del = (t: Traspaso) => t.origen?.id === local || t.destino?.id === local || datos?.veTodo;
  const ts = (datos?.traspasos ?? []).filter(del);
  const paraMandar = ts.filter((t) => t.estado === 'pedido' && t.origen.id === local);
  const misPedidos = ts.filter((t) => t.estado === 'pedido' && t.destino.id === local);
  const enCamino = ts.filter((t) => t.estado === 'en_transito');
  const conDif = ts.filter((t) => t.estado === 'con_diferencias');
  const historial = ts.filter((t) => t.estado === 'recibida' || t.estado === 'anulada');

  useEffect(() => {
    // arranca donde hay algo que hacer
    if (!datos) return;
    if (paraLocal && local === paraLocal) { setVista('pedir'); return; }
    if (paraMandar.length) setVista('mandar');
    else if (enCamino.some((t) => t.destino.id === local)) setVista('camino');
    else if (datos.decideDiferencias && conDif.length) setVista('diferencias');
    else setVista('pedir');
  }, [datos?.traspasos.length, local]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !datos) return <Aviso tono="error">{error}</Aviso>;
  if (!datos) return <Cargando />;
  const nombreLocal = datos.sucursales.find((s) => s.id === local)?.nombre ?? '';
  const listo = (texto: string) => { setAviso(texto); setAbierto(null); setError(''); cargar(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-tinta/70">Estás en</p>
        {datos.veTodo || !datos.miSucursal ? (
          <Chips
            opciones={datos.sucursales.map((s) => ({ valor: s.id, etiqueta: corto(s.nombre) }))}
            valor={local}
            onCambiar={(v: string) => { setLocal(v); setAbierto(null); }}
          />
        ) : <b className="text-tinta">{corto(nombreLocal)}</b>}
      </div>
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {abierto ? (
        abierto.modo === 'recibir' && abierto.t ? (
          <Recibir t={abierto.t} cerrar={() => setAbierto(null)} listo={listo} setError={setError} />
        ) : (
          <Mandar t={abierto.t} local={local} otros={otros} personas={datos.personas} cerrar={() => setAbierto(null)} listo={listo} setError={setError} />
        )
      ) : (
        <>
          <Pestanas
            aLoAncho
            etiquetaAccesible="Traspasos"
            valor={vista}
            onCambiar={(v: Vista) => setVista(v)}
            opciones={[
              { valor: 'pedir', etiqueta: 'Pedir', cuenta: misPedidos.length || undefined },
              { valor: 'mandar', etiqueta: 'Para mandar', cuenta: paraMandar.length || undefined },
              { valor: 'camino', etiqueta: 'En camino', cuenta: enCamino.length || undefined },
              { valor: 'diferencias', etiqueta: 'Diferencias', cuenta: conDif.length || undefined },
              { valor: 'historial', etiqueta: 'Historial' },
            ]}
          />

          {vista === 'pedir' && (
            <div className="space-y-4">
              <Pedir local={local} otros={otros} listo={listo} setError={setError} sugerirAlAbrir={!!paraLocal && local === paraLocal} />
              {misPedidos.length > 0 && (
                <section className="space-y-2">
                  <p className={ROTULO}>Lo que ya pediste</p>
                  {misPedidos.map((t) => <Fila key={t.id} t={t} local={local} datos={datos} acciones={<Anular t={t} listo={listo} setError={setError} />} />)}
                </section>
              )}
            </div>
          )}

          {vista === 'mandar' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto text-sm text-tinta/70">{paraMandar.length ? 'Lo que te pidieron. Preparalo escaneando y mandalo.' : 'Nadie le pidió nada a este local.'}</p>
                <Boton variante="secundario" onClick={() => setAbierto({ modo: 'nuevo', t: null })}>Mandar sin pedido</Boton>
              </div>
              {paraMandar.map((t) => (
                <Fila key={t.id} t={t} local={local} datos={datos} acciones={<>
                  <Boton onClick={() => setAbierto({ modo: 'mandar', t })}>Preparar y mandar</Boton>
                  <Anular t={t} listo={listo} setError={setError} texto="No lo vamos a mandar" />
                </>} />
              ))}
            </div>
          )}

          {vista === 'camino' && (
            <div className="space-y-3">
              {!enCamino.length && <Vacio titulo="No hay nada en camino" />}
              {enCamino.map((t) => (
                <Fila key={t.id} t={t} local={local} datos={datos} acciones={<>
                  {(t.destino.id === local || datos.veTodo) && <Boton onClick={() => setAbierto({ modo: 'recibir', t })}>Recibir</Boton>}
                  <Remito t={t} />
                  {datos.decideDiferencias && <Anular t={t} listo={listo} setError={setError} texto="Anular el envío" />}
                </>} />
              ))}
            </div>
          )}

          {vista === 'diferencias' && (
            <div className="space-y-3">
              {!conDif.length && <Vacio titulo="No hay diferencias para resolver" />}
              {conDif.map((t) => <Diferencias key={t.id} t={t} decide={datos.decideDiferencias} listo={listo} setError={setError} />)}
            </div>
          )}

          {vista === 'historial' && <Historial ts={historial} local={local} datos={datos} />}
        </>
      )}
    </div>
  );
}

// ---- una tarjeta de traspaso ---------------------------------------------

function Fila({ t, local, datos, acciones }: { t: Traspaso; local: string; datos: Datos; acciones?: React.ReactNode }) {
  const [ver, setVer] = useState(false);
  const e = ESTADO[t.estado];
  const sale = t.origen.id === local;
  return (
    <Tarjeta className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta tono={e.tono}>{e.texto}</Etiqueta>
        <span className="font-semibold text-tinta">#{t.numero} · {corto(t.origen.nombre)} → {corto(t.destino.nombre)}</span>
        {!datos.veTodo && <span className="text-xs text-tinta/60">{sale ? '(sale de acá)' : '(viene para acá)'}</span>}
        <span className="ml-auto text-xs text-tinta/60">{t.items.length} producto{t.items.length === 1 ? '' : 's'}{t.valor ? ` · ${pesos(t.valor)} al costo` : ''}</span>
      </div>
      <p className="text-xs text-tinta/70">
        {t.pidio && <>Pidió {t.pidio} el {fechaHora(t.pedidaEn)}. </>}
        {t.enviadaEn && <>Salió el {fechaHora(t.enviadaEn)}{t.envio ? ` (${t.envio})` : ''}. </>}
        {t.lleva && <>Lo lleva {t.lleva}{t.entregadaEn ? `, lo dejó el ${fechaHora(t.entregadaEn)}` : ''}. </>}
        {t.recibidaEn && <>Lo recibió {t.recibio ?? 'alguien'} el {fechaHora(t.recibidaEn)}. </>}
        {t.anuladaEn && <>Anulado por {t.anulo ?? 'alguien'}: «{t.motivoAnulacion}». </>}
        {t.nota && <>Nota: «{t.nota}». </>}
        {t.notaRecepcion && <>Al recibir: «{t.notaRecepcion}».</>}
      </p>
      <button type="button" onClick={() => setVer(!ver)} className="text-xs font-medium text-marca underline-offset-2 hover:underline">{ver ? 'Ocultar los productos' : 'Ver los productos'}</button>
      {ver && <Productos t={t} />}
      {acciones && <div className="flex flex-wrap gap-2 pt-1">{acciones}</div>}
    </Tarjeta>
  );
}

function Productos({ t }: { t: Traspaso }) {
  const recibido = t.items.some((i) => i.recibido != null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <thead><tr className={unir(ROTULO, 'text-left')}><th className="py-1">Producto</th><th className="text-right">Pedido</th><th className="text-right">Salió</th>{recibido && <><th className="text-right">Llegó</th><th className="text-right">Dif.</th></>}</tr></thead>
        <tbody>
          {t.items.map((i) => (
            <tr key={i.productoId} className="border-t border-black/[0.06]">
              <td className="py-1.5 pr-2 text-tinta">{i.nombre}{i.nota && <span className="block text-xs text-tinta/60">«{i.nota}»</span>}</td>
              <td className="text-right text-tinta/70">{cant(i.pedido)}</td>
              <td className="text-right font-medium">{cant(i.enviado)}</td>
              {recibido && <><td className="text-right font-medium">{cant(i.recibido)}</td>
                <td className={unir('text-right font-semibold', i.diferencia < 0 ? 'text-marca-hondo' : i.diferencia > 0 ? 'text-atencion' : 'text-tinta/40')}>{i.diferencia ? `${i.diferencia > 0 ? '+' : ''}${cant(i.diferencia)}` : '—'}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Remito({ t }: { t: Traspaso }) {
  if (t.estado === 'pedido') return null;
  return <a href={`/api/documento?tipo=traspaso&id=${t.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-full border border-black/15 bg-white px-3.5 text-sm font-medium text-tinta hover:border-black/25">Remito</a>;
}

function Anular({ t, listo, setError, texto }: { t: Traspaso; listo: (s: string) => void; setError: (s: string) => void; texto?: string }) {
  const { pedirTexto, dialogo } = useConfirmar();
  return (
    <>
      <Boton variante="peligro" onClick={async () => {
        const motivo = await pedirTexto({
          titulo: `${texto ?? 'Anular'} · #${t.numero}`,
          texto: t.estado === 'en_transito' ? 'Lo que salió vuelve al stock de ' + corto(t.origen.nombre) + '.' : 'El pedido se cierra sin mandar nada.',
          campo: { etiqueta: 'Motivo', obligatorio: true },
          variante: 'peligro', textoConfirmar: 'Anular',
        });
        if (!motivo) return;
        try { await api(`${t.id}/anular`, { motivo }); listo(`Traspaso #${t.numero} anulado.`); } catch (e: any) { setError(e.message); }
      }}>{texto ?? 'Anular'}</Boton>
      {dialogo}
    </>
  );
}

// ---- elegir productos: buscador, pistola y cámara ------------------------

function useBuscador(agregar: (p: { sku: string; nombre: string }, cuantos?: number) => void) {
  const [texto, setTexto] = useState('');
  const [sug, setSug] = useState<any[]>([]);
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState('');
  useEffect(() => {
    if (texto.trim().length < 2 || esCodigo(texto)) { setSug([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(texto)}`);
      if (r.ok) setSug((await r.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);
  const porCodigo = async (crudo: string) => {
    const c = String(crudo).replace(/\D/g, '');
    setTexto(''); setSug([]);
    const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(c)}`);
    const items: any[] = r.ok ? (await r.json()).items ?? [] : [];
    const p = items.find((x) => String(x.codigo ?? '').replace(/\D/g, '') === c) ?? (items.length === 1 ? items[0] : null);
    if (p) { agregar({ sku: p.sku, nombre: p.nombre }); setMensaje(`+1 ${p.nombre}`); } else setMensaje(`El código ${c} no está en el catálogo: buscalo por nombre.`);
  };
  const ui = (
    <div className="relative">
      <div className="flex gap-2">
        <Entrada
          value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre o código de barras (pistola)" aria-label="Buscar un producto" className="min-w-0 flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (esCodigo(texto)) porCodigo(texto); else if (sug.length === 1) { agregar({ sku: sug[0].sku, nombre: sug[0].nombre }); setTexto(''); setSug([]); } } }}
        />
        <Boton variante="secundario" onClick={() => setCamara(true)}>Escanear</Boton>
      </div>
      {mensaje && <p className="mt-1 text-xs text-tinta/70">{mensaje}</p>}
      {sug.length > 0 && (
        <div className="absolute z-contenido mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
          {sug.map((p) => (
            <button key={p.sku} type="button" onClick={() => { agregar({ sku: p.sku, nombre: p.nombre }); setTexto(''); setSug([]); setMensaje(`+ ${p.nombre}`); }} className="block min-h-11 w-full border-b border-black/[0.06] px-3 py-2 text-left text-sm last:border-0 hover:bg-crema-claro">
              {p.nombre} <span className="text-xs text-tinta/60">{p.sku}</span>
            </button>
          ))}
        </div>
      )}
      {camara && <CamaraCodigo onCerrar={() => setCamara(false)} onCodigo={(c) => { setCamara(false); porCodigo(c); }} />}
    </div>
  );
  return ui;
}

function Lista({ renglones, cambiar, quitar, conPedido, conNota }: { renglones: Renglon[]; cambiar: (sku: string, n: number, nota?: string) => void; quitar?: (sku: string) => void; conPedido?: boolean; conNota?: boolean }) {
  if (!renglones.length) return <p className="text-sm text-tinta/60">Todavía no hay productos.</p>;
  return (
    <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06] bg-white">
      {renglones.map((r) => (
        <li key={r.sku} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm text-tinta">{r.nombre}{conPedido && r.pedido != null && <span className="block text-xs text-tinta/60">Pedido: {cant(r.pedido)}</span>}</span>
          {conNota && <Entrada value={r.nota ?? ''} onChange={(e) => cambiar(r.sku, r.cantidad, e.target.value)} placeholder="nota (ej.: vino roto)" aria-label={`Nota de ${r.nombre}`} className="w-40" />}
          <Entrada type="number" inputMode="decimal" min={0} value={String(r.cantidad)} onChange={(e) => cambiar(r.sku, Math.max(0, Number(e.target.value) || 0), r.nota)} aria-label={`Cantidad de ${r.nombre}`} className={unir('w-20 text-right', conPedido && r.pedido != null && r.cantidad !== r.pedido && 'border-atencion')} />
          {quitar && <button type="button" onClick={() => quitar(r.sku)} className="text-xs text-tinta/60 hover:text-marca-hondo">quitar</button>}
        </li>
      ))}
    </ul>
  );
}

function useRenglones(inicial: Renglon[] = []) {
  const [renglones, set] = useState<Renglon[]>(inicial);
  const agregar = (p: { sku: string; nombre: string }, cuantos = 1) => set((xs) => {
    const ya = xs.find((x) => x.sku === p.sku);
    return ya ? xs.map((x) => (x.sku === p.sku ? { ...x, cantidad: x.cantidad + cuantos } : x)) : [...xs, { sku: p.sku, nombre: p.nombre, cantidad: cuantos }];
  });
  const cambiar = (sku: string, n: number, nota?: string) => set((xs) => xs.map((x) => (x.sku === sku ? { ...x, cantidad: n, nota } : x)));
  const quitar = (sku: string) => set((xs) => xs.filter((x) => x.sku !== sku));
  return { renglones, set, agregar, cambiar, quitar };
}

// ---- pedir ---------------------------------------------------------------

function Pedir({ local, otros, listo, setError, sugerirAlAbrir }: { local: string; otros: Datos['sucursales']; listo: (s: string) => void; setError: (s: string) => void; sugerirAlAbrir?: boolean }) {
  const [origen, setOrigen] = useState(otros[0]?.id ?? '');
  const { renglones, set, agregar, cambiar, quitar } = useRenglones();
  const [sug, setSug] = useState<any[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const buscador = useBuscador(agregar);
  useEffect(() => { setOrigen(otros[0]?.id ?? ''); setSug(null); }, [local]); // eslint-disable-line react-hooks/exhaustive-deps
  const sugerir = async () => {
    setBuscando(true);
    try { setSug(await api(`sugerencias&origen=${origen}&destino=${local}`)); } catch (e: any) { setError(e.message); } finally { setBuscando(false); }
  };
  // viniendo de Compras, la sugerencia ya está buscada al abrir
  useEffect(() => { if (sugerirAlAbrir && origen) sugerir(); }, [sugerirAlAbrir]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-tinta">Pedirle a</span>
        <Selector value={origen} onChange={(e) => { setOrigen(e.target.value); setSug(null); }} opciones={otros.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} className="w-56" />
        <Boton variante="secundario" onClick={sugerir} cargando={buscando}>¿Qué me conviene pedir?</Boton>
      </div>
      {sug && (
        <div className="rounded-xl bg-crema-claro p-3">
          {!sug.length ? <p className="text-sm text-tinta/70">No hay nada que te falte y al otro local le sobre.</p> : <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm text-tinta">{sug.length} producto{sug.length === 1 ? '' : 's'} que te faltan (para {14} días de venta o tu mínimo) y al otro le sobran. La venta es el ritmo que usa Compras.</p>
              <Boton variante="secundario" onClick={() => { for (const s of sug) if (!renglones.some((r) => r.sku === s.sku)) set((xs) => [...xs, { sku: s.sku, nombre: s.nombre, cantidad: s.sugerido }]); }}>Agregar todos</Boton>
            </div>
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {sug.map((s) => (
                <li key={s.sku} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 text-tinta">{s.nombre}<span className="block text-xs text-tinta/60">Tenés {cant(s.stockDestino)}{s.diasCubiertosDestino != null ? ` (${cant(s.diasCubiertosDestino)} días)` : ''} · vendés {cant(s.vendidas30Destino)} por mes · allá hay {cant(s.stockOrigen)}</span></span>
                  <b>{cant(s.sugerido)}</b>
                  <button type="button" disabled={renglones.some((r) => r.sku === s.sku)} onClick={() => set((xs) => [...xs, { sku: s.sku, nombre: s.nombre, cantidad: s.sugerido }])} className="text-xs font-medium text-marca disabled:text-tinta/40">{renglones.some((r) => r.sku === s.sku) ? 'agregado' : 'agregar'}</button>
                </li>
              ))}
            </ul>
          </>}
        </div>
      )}
      {buscador}
      <Lista renglones={renglones} cambiar={cambiar} quitar={quitar} />
      <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota para el otro local (opcional)" aria-label="Nota del pedido" />
      <div className="flex justify-end">
        <Boton disabled={!origen || !renglones.some((r) => r.cantidad > 0) || guardando} cargando={guardando} onClick={async () => {
          setGuardando(true);
          try {
            const t = await api('pedir', { origenId: origen, destinoId: local, items: renglones.filter((r) => r.cantidad > 0).map((r) => ({ sku: r.sku, cantidad: r.cantidad })), nota });
            listo(`Pedido #${t.numero} hecho: le llegó el aviso a ${corto(t.origen.nombre)}.`);
          } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
        }}>Pedir {renglones.filter((r) => r.cantidad > 0).length || ''} producto{renglones.filter((r) => r.cantidad > 0).length === 1 ? '' : 's'}</Boton>
      </div>
    </Tarjeta>
  );
}

// ---- preparar y mandar (con pedido o sin pedido) -------------------------

function Mandar({ t, local, otros, personas, cerrar, listo, setError }: { t: Traspaso | null; local: string; otros: Datos['sucursales']; personas: Datos['personas']; cerrar: () => void; listo: (s: string) => void; setError: (s: string) => void }) {
  const inicial: Renglon[] = (t?.items ?? []).map((i) => ({ sku: i.sku ?? '', nombre: i.nombre, cantidad: i.pedido ?? 0, pedido: i.pedido }));
  const { renglones, set, agregar, cambiar, quitar } = useRenglones(inicial);
  const [destino, setDestino] = useState(t?.destino.id ?? otros[0]?.id ?? '');
  const [lleva, setLleva] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const buscador = useBuscador(agregar);
  const total = renglones.filter((r) => r.cantidad > 0).length;
  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-base font-semibold text-tinta">{t ? `Preparar el pedido #${t.numero} para ${corto(t.destino.nombre)}` : 'Mandar sin pedido'}</p>
        <Boton variante="secundario" onClick={cerrar}>Volver</Boton>
      </div>
      {!t && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-tinta">Mandar a</span>
          <Selector value={destino} onChange={(e) => setDestino(e.target.value)} opciones={otros.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} className="w-56" />
        </div>
      )}
      {t && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-tinta/70">
          <span className="mr-auto">Cada vez que escaneás un producto suma 1. Si no hay, poné 0: el otro local ve que no salió.</span>
          <Boton variante="secundario" tamano="chico" onClick={() => set((xs) => xs.map((x) => ({ ...x, cantidad: 0 })))}>Contar desde cero escaneando</Boton>
        </div>
      )}
      {buscador}
      <Lista renglones={renglones} cambiar={cambiar} quitar={t ? undefined : quitar} conPedido={!!t} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Selector value={lleva} onChange={(e) => setLleva(e.target.value)} aria-label="Quién lo lleva" vacio="¿Quién lo lleva? (opcional)" opciones={personas.map((p) => ({ valor: p.id, etiqueta: `${p.nombre}${p.rol === 'repartidor' ? ' · repartidor' : ''}` }))} />
        <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota del envío" />
      </div>
      <p className="text-xs text-tinta/60">Al mandar, sale del stock de {otros.length ? 'este local' : ''} y queda en camino hasta que el otro local lo reciba. Sale el remito para que viaje con la mercadería.</p>
      <div className="flex justify-end">
        <Boton disabled={!total || guardando || (!t && !destino)} cargando={guardando} onClick={async () => {
          setGuardando(true);
          try {
            const items = renglones.map((r) => ({ sku: r.sku, cantidad: r.cantidad })).filter((r) => r.sku && (t ? true : r.cantidad > 0));
            const nuevo = t
              ? await api(`${t.id}/enviar`, { items, llevaId: lleva || null, nota })
              : await api('enviar', { origenId: local, destinoId: destino, items, llevaId: lleva || null, nota });
            window.open(`/api/documento?tipo=traspaso&id=${nuevo.id}`, '_blank');
            listo(`Traspaso #${nuevo.numero} en camino a ${corto(nuevo.destino.nombre)}. Se abrió el remito para imprimir.`);
          } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
        }}>Mandar {total} producto{total === 1 ? '' : 's'}</Boton>
      </div>
    </Tarjeta>
  );
}

// ---- recibir -------------------------------------------------------------

function Recibir({ t, cerrar, listo, setError }: { t: Traspaso; cerrar: () => void; listo: (s: string) => void; setError: (s: string) => void }) {
  const inicial: Renglon[] = t.items.filter((i) => i.enviado > 0).map((i) => ({ sku: i.sku ?? '', nombre: i.nombre, cantidad: i.enviado, pedido: i.enviado, nota: '' }));
  const { renglones, set, agregar, cambiar } = useRenglones(inicial);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const buscador = useBuscador(agregar);
  const distinto = renglones.some((r) => r.cantidad !== (r.pedido ?? 0));
  const recibir = async (todo: boolean) => {
    setGuardando(true);
    try {
      const r = await api(`${t.id}/recibir`, todo ? { items: null, nota } : { items: renglones.map((x) => ({ sku: x.sku, cantidad: x.cantidad, nota: x.nota || null })), nota });
      listo(r.estado === 'con_diferencias'
        ? `Traspaso #${t.numero} recibido con diferencias: entró lo que llegó y gerencia decide el resto.`
        : `Traspaso #${t.numero} recibido: entró todo al stock.`);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };
  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-base font-semibold text-tinta">Recibir el traspaso #{t.numero} de {corto(t.origen.nombre)}</p>
        <Boton variante="secundario" onClick={cerrar}>Volver</Boton>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-tinta/70">
        <span className="mr-auto">Contá lo que llegó. Si todo coincide con lo que salió, tocá «Llegó todo».</span>
        <Boton variante="secundario" tamano="chico" onClick={() => set((xs) => xs.map((x) => ({ ...x, cantidad: 0 })))}>Contar desde cero escaneando</Boton>
      </div>
      {buscador}
      <Lista renglones={renglones} cambiar={cambiar} conPedido conNota />
      <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota de la recepción (opcional)" aria-label="Nota de la recepción" />
      <div className="flex flex-wrap justify-end gap-2">
        {!distinto && <Boton variante="ok" onClick={() => recibir(true)} cargando={guardando} disabled={guardando}>Llegó todo</Boton>}
        {distinto && <Boton onClick={() => recibir(false)} cargando={guardando} disabled={guardando}>Recibir con lo contado ({renglones.filter((r) => r.cantidad !== (r.pedido ?? 0)).length} con diferencia)</Boton>}
      </div>
    </Tarjeta>
  );
}

// ---- diferencias (las decide gerencia) -----------------------------------

function Diferencias({ t, decide, listo, setError }: { t: Traspaso; decide: boolean; listo: (s: string) => void; setError: (s: string) => void }) {
  const [trabajando, setTrabajando] = useState('');
  const resolver = async (sku: string, resolucion: string) => {
    setTrabajando(sku);
    try { const r = await api(`${t.id}/resolver`, { sku, resolucion }); listo(r.estado === 'recibida' ? `Traspaso #${t.numero} cerrado.` : 'Diferencia resuelta.'); } catch (e: any) { setError(e.message); } finally { setTrabajando(''); }
  };
  return (
    <Tarjeta className="space-y-2">
      <p className="font-semibold text-tinta">#{t.numero} · {corto(t.origen.nombre)} → {corto(t.destino.nombre)} <span className="text-xs font-normal text-tinta/60">recibido el {fechaHora(t.recibidaEn)} por {t.recibio ?? '—'}</span></p>
      <ul className="space-y-2">
        {t.items.filter((i) => i.diferencia !== 0).map((i) => (
          <li key={i.productoId} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/[0.06] px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 text-tinta">
              <b>{i.nombre}</b>: salieron {cant(i.enviado)}, llegaron {cant(i.recibido)} → {i.diferencia < 0 ? `faltan ${cant(-i.diferencia)}` : `sobran ${cant(i.diferencia)}`}
              {i.costo ? <span className="text-tinta/60"> ({pesos(Math.abs(i.diferencia) * i.costo)} al costo)</span> : null}
              {i.nota && <span className="block text-xs text-tinta/60">«{i.nota}»</span>}
            </span>
            {i.resolucion ? <Etiqueta tono="ok">{({ vuelve_origen: 'Volvió al origen', merma: 'Merma', descontar_origen: 'Descontado del origen', queda: 'Quedó así' } as Record<string, string>)[i.resolucion]}</Etiqueta>
              : !decide ? <span className="text-xs text-tinta/60">Lo decide gerencia</span>
              : i.diferencia < 0 ? <>
                <Boton variante="secundario" tamano="chico" cargando={trabajando === i.sku} onClick={() => resolver(i.sku!, 'vuelve_origen')}>No salió: vuelve a {corto(t.origen.nombre)}</Boton>
                <Boton variante="peligro" tamano="chico" disabled={!!trabajando} onClick={() => resolver(i.sku!, 'merma')}>Se perdió: merma</Boton>
              </> : <>
                <Boton variante="secundario" tamano="chico" cargando={trabajando === i.sku} onClick={() => resolver(i.sku!, 'descontar_origen')}>Salió de más: descontar de {corto(t.origen.nombre)}</Boton>
                <Boton variante="secundario" tamano="chico" disabled={!!trabajando} onClick={() => resolver(i.sku!, 'queda')}>Queda así</Boton>
              </>}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// ---- historial -----------------------------------------------------------

function Historial({ ts, local, datos }: { ts: Traspaso[]; local: string; datos: Datos }) {
  const [filtro, setFiltro] = useState<'todo' | 'salieron' | 'entraron' | 'anulados'>('todo');
  const lista = ts.filter((t) => filtro === 'todo' || (filtro === 'anulados' ? t.estado === 'anulada' : t.estado !== 'anulada' && (filtro === 'salieron' ? t.origen.id === local : t.destino.id === local)));
  const valor = lista.filter((t) => t.estado !== 'anulada').reduce((s, t) => s + t.valor, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chips valor={filtro} onCambiar={(v: any) => setFiltro(v)} opciones={[{ valor: 'todo', etiqueta: 'Todo' }, { valor: 'salieron', etiqueta: 'Salieron de acá' }, { valor: 'entraron', etiqueta: 'Entraron acá' }, { valor: 'anulados', etiqueta: 'Anulados' }]} />
        <span className="ml-auto text-sm text-tinta/70">{lista.length} traspasos · {pesos(valor)} al costo (últimos 60 días)</span>
      </div>
      {!lista.length && <Vacio titulo="No hay traspasos" />}
      {lista.map((t) => <Fila key={t.id} t={t} local={local} datos={datos} acciones={<Remito t={t} />} />)}
    </div>
  );
}
