'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso, Boton, BotonLink, Cargando, Chip, Entrada, Modal, Tarjeta, unir, FOCO, useConfirmar } from './kit';
import { hora } from '../lib/formato';

// ============================================================
// CONTAR UN ARQUEO DESDE EL CELULAR (24/10/2026).
//
// Pensada para caminar el local con una mano:
//   · Escanear con el lector de mano (teclea el código y Enter, no hace falta
//     tocar nada) o con la cámara del celular.
//   · El lugar (Góndola 3, Depósito, Heladera…) queda fijo hasta cambiarlo: el
//     mismo producto en dos lugares se suma solo.
//   · Conteo ciego: nunca se ve lo que dice el sistema.
//   · «Escaneo rápido»: cada lectura suma 1 (para contar pasando el lector
//     producto por producto).
//   · Sin señal no se pierde nada: cada lectura se guarda en el celular y se
//     manda cuando vuelve la conexión (cada una tiene su id: nunca se duplica).
// ============================================================

type Arqueo = {
  id: string; nombre: string; estado: string; sucursal: string; ciego: boolean;
  lugares: string[]; aRecontar: { sku: string; nombre: string; foto: string | null }[];
  misLecturas: { id: string; sku: string; nombre: string; cantidad: number; ubicacion: string | null; reconteo: boolean; creadoEn: string; anulada: boolean }[];
};
type Producto = {
  sku: string; nombre: string; foto: string | null; unidadesPack: number; porPeso: boolean; activo: boolean;
  yaContadoPorMi: number; yaContadoTotal: number; reconteo: boolean; cantidadSugerida: number | null;
};
type Pendiente = { id: string; sku: string; nombre: string; cantidad: number; ubicacion: string; codigo: string | null; reconteo: boolean; intentos: number; error?: string };

const guardado = {
  leer<T>(k: string, def: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  escribir(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: igual se intenta mandar */ } },
};
const nuevoId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const vibrar = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* no todos vibran */ } };

export function ArqueoContar({ id }: { id: string }) {
  const [arqueo, setArqueo] = useState<Arqueo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lugar, setLugar] = useState('');
  const [cambiandoLugar, setCambiandoLugar] = useState(false);
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [opciones, setOpciones] = useState<Producto[]>([]);
  const [producto, setProducto] = useState<(Producto & { codigo: string | null }) | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [rapido, setRapido] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error' | 'atencion'; texto: string } | null>(null);
  const [cola, setCola] = useState<Pendiente[]>([]);
  const [camara, setCamara] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null);
  const [vista, setVista] = useState<'contar' | 'recontar' | 'mias'>('contar');
  const { confirmar, dialogo } = useConfirmar();
  const cantRef = useRef<HTMLInputElement>(null);
  const buffer = useRef(''); const reloj = useRef<any>(null);
  const claveCola = `arqueo-cola-${id}`; const claveLugar = `arqueo-lugar-${id}`;

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/arqueo?ruta=${id}/contar`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude abrir el arqueo');
      setArqueo(j); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [id]);

  useEffect(() => {
    cargar();
    setCola(guardado.leer<Pendiente[]>(claveCola, []));
    const l = guardado.leer<string>(claveLugar, '');
    setLugar(l); if (!l) setCambiandoLugar(true);
  }, [cargar, claveCola, claveLugar]);

  // ---- mandar la cola: ahora y cada 8 s mientras quede algo ----
  const mandando = useRef(false);
  const mandarCola = useCallback(async () => {
    if (mandando.current) return;
    mandando.current = true;
    try {
      let actual = guardado.leer<Pendiente[]>(claveCola, []);
      for (const p of [...actual]) {
        try {
          const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruta: `${id}/registros`, id: p.id, sku: p.sku, cantidad: p.cantidad, ubicacion: p.ubicacion, codigo: p.codigo, reconteo: p.reconteo }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            actual = actual.filter((x) => x.id !== p.id);
          } else if (r.status >= 400 && r.status < 500) {
            // la base la rechazó (arqueo cerrado, cantidad inválida): no se reintenta, se avisa
            actual = actual.map((x) => x.id === p.id ? { ...x, intentos: 99, error: j?.message ?? 'Rechazada' } : x);
          } else {
            actual = actual.map((x) => x.id === p.id ? { ...x, intentos: x.intentos + 1 } : x);
            break;
          }
        } catch { break; } // sin conexión: se reintenta después
      }
      guardado.escribir(claveCola, actual); setCola(actual);
      if (!actual.some((x) => x.intentos < 99)) cargar();
    } finally { mandando.current = false; }
  }, [id, claveCola, cargar]);
  useEffect(() => {
    const t = setInterval(() => { if (guardado.leer<Pendiente[]>(claveCola, []).some((x) => x.intentos < 99)) mandarCola(); }, 8000);
    window.addEventListener('online', mandarCola);
    return () => { clearInterval(t); window.removeEventListener('online', mandarCola); };
  }, [mandarCola, claveCola]);

  const anotar = useCallback((p: Producto & { codigo: string | null }, cant: number) => {
    const fila: Pendiente = { id: nuevoId(), sku: p.sku, nombre: p.nombre, cantidad: cant, ubicacion: lugar, codigo: p.codigo, reconteo: p.reconteo, intentos: 0 };
    const nueva = [...guardado.leer<Pendiente[]>(claveCola, []), fila];
    guardado.escribir(claveCola, nueva); setCola(nueva);
    vibrar(40);
    setAviso({ tono: 'ok', texto: `Guardado: ${cant} ${p.porPeso ? 'kg' : cant === 1 ? 'unidad' : 'unidades'} · ${p.nombre}` });
    mandarCola();
  }, [lugar, claveCola, mandarCola]);

  // ---- identificar lo escaneado o escrito ----
  const identificar = useCallback(async (q: string) => {
    const t = q.trim();
    if (t.length < 2) return;
    if (!lugar) { setCambiandoLugar(true); setAviso({ tono: 'atencion', texto: 'Primero decí en qué lugar estás contando' }); return; }
    setBuscando(true); setAviso(null); setOpciones([]);
    try {
      const r = await fetch(`/api/arqueo?ruta=${id}/identificar&q=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude buscar');
      const items: Producto[] = j.items ?? [];
      const esCodigo = /^\d{6,}$/.test(t);
      if (!items.length) {
        vibrar([80, 60, 80]);
        if (esCodigo) setNoEncontrado(t);
        else setAviso({ tono: 'atencion', texto: `No encontré «${t}». Probá con otra palabra o escaneá el código.` });
        return;
      }
      if (items.length === 1) {
        const p = { ...items[0], codigo: esCodigo ? t : null };
        if (rapido && !p.porPeso) { anotar(p, 1); setProducto(null); setTexto(''); return; }
        setProducto(p); setTexto('');
        setCantidad(p.cantidadSugerida != null ? String(p.cantidadSugerida) : '');
        setTimeout(() => cantRef.current?.focus(), 50);
        return;
      }
      setOpciones(items);
    } catch (e: any) {
      setAviso({ tono: 'error', texto: e.message ?? 'Sin conexión: probá de nuevo' });
    } finally { setBuscando(false); }
  }, [id, lugar, rapido, anotar]);

  // lector de mano: teclea en ráfaga y termina en Enter, sin casillero enfocado
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const donde = e.target as HTMLElement;
      if (donde && (donde.tagName === 'INPUT' || donde.tagName === 'TEXTAREA' || donde.isContentEditable)) return;
      if (e.key === 'Enter') { const c = buffer.current.trim(); buffer.current = ''; if (c) identificar(c); return; }
      if (e.key.length === 1) { buffer.current += e.key; clearTimeout(reloj.current); reloj.current = setTimeout(() => { buffer.current = ''; }, 250); }
    };
    window.addEventListener('keydown', alTeclear);
    return () => { window.removeEventListener('keydown', alTeclear); clearTimeout(reloj.current); };
  }, [identificar]);

  async function guardar() {
    if (!producto) return;
    const n = Number(String(cantidad).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || cantidad.trim() === '') { setAviso({ tono: 'error', texto: 'Escribí la cantidad' }); return; }
    if (!producto.porPeso && !Number.isInteger(n)) { setAviso({ tono: 'error', texto: 'Este producto se cuenta por unidad' }); return; }
    if (n > 500 && !(await confirmar({ titulo: `¿Seguro que son ${n}?`, texto: producto.nombre, textoConfirmar: 'Sí, guardar' }))) return;
    anotar(producto, n);
    setProducto(null); setCantidad('');
  }

  async function anular(registroId: string) {
    if (!(await confirmar({ titulo: '¿Anular esta lectura?', texto: 'Se descuenta de lo contado. Queda registrado quién la anuló.', variante: 'peligro', textoConfirmar: 'Anular' }))) return;
    const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruta: `${id}/registros/${registroId}/anular` }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setAviso({ tono: 'error', texto: j?.message ?? 'No pude anularla' }); else { setAviso({ tono: 'ok', texto: 'Lectura anulada' }); cargar(); }
  }

  if (error && !arqueo) return <Aviso tono="error" titulo="No pude abrir el arqueo">{error}</Aviso>;
  if (!arqueo) return <Cargando />;
  const cerrado = arqueo.estado !== 'abierto' && arqueo.estado !== 'en_revision';
  const soloReconteo = arqueo.estado === 'en_revision';
  const pendientes = cola.filter((c) => c.intentos < 99);
  const rechazadas = cola.filter((c) => c.intentos >= 99);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-lg font-semibold leading-snug text-tinta">{arqueo.nombre}</p>
          <p className="text-xs text-tinta/60">{arqueo.sucursal}{arqueo.ciego ? ' · conteo ciego' : ''}</p>
        </div>
        <button type="button" onClick={() => setCambiandoLugar(true)}
          className={unir('max-w-full rounded-full border border-marca bg-marca-suave px-3 py-1.5 text-left text-sm font-semibold text-marca-hondo', FOCO)}>
          Lugar: {lugar || 'elegilo'}
        </button>
      </div>

      {cerrado && <Aviso tono="atencion">Este arqueo ya está {arqueo.estado}. No se cargan más lecturas.</Aviso>}
      {soloReconteo && <Aviso tono="atencion" titulo="Solo reconteos">Gerencia está revisando. Contá de nuevo los productos de la pestaña «Recontar».</Aviso>}
      {!!pendientes.length && <Aviso tono="info">{pendientes.length} {pendientes.length === 1 ? 'lectura guardada' : 'lecturas guardadas'} en el celular, se mandan cuando haya señal.</Aviso>}
      {!!rechazadas.length && (
        <Aviso tono="error" titulo="Lecturas que no se cargaron">
          {rechazadas.map((r) => `${r.nombre} (${r.cantidad}): ${r.error}`).join(' · ')}
          <button type="button" className="ml-2 underline" onClick={() => { const q = cola.filter((c) => c.intentos < 99); guardado.escribir(claveCola, q); setCola(q); }}>Entendido</button>
        </Aviso>
      )}

      <div className="flex flex-wrap gap-2">
        <Chip activo={vista === 'contar'} onClick={() => setVista('contar')}>Contar</Chip>
        <Chip activo={vista === 'recontar'} cuenta={arqueo.aRecontar.length || undefined} onClick={() => setVista('recontar')}>Recontar</Chip>
        <Chip activo={vista === 'mias'} onClick={() => { setVista('mias'); cargar(); }}>Mis lecturas</Chip>
      </div>

      {vista === 'contar' && !cerrado && (
        <>
          <Tarjeta>
            <form onSubmit={(e) => { e.preventDefault(); identificar(texto); }} className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Pasá el lector o escribí el nombre" aria-label="Producto" enterKeyHint="search" />
              </div>
              <Boton type="button" variante="secundario" onClick={() => setCamara(true)} aria-label="Escanear con la cámara">Cámara</Boton>
            </form>
            <label className="mt-3 flex items-start gap-2 text-sm text-tinta">
              <input type="checkbox" checked={rapido} onChange={(e) => setRapido(e.target.checked)} className="mt-0.5 size-4 accent-marca" />
              <span><b>Escaneo rápido</b>: cada lectura suma 1, sin escribir la cantidad.</span>
            </label>
            {buscando && <p className="mt-2 text-sm text-tinta/60">Buscando…</p>}
            {aviso && <p className={unir('mt-2 text-sm font-semibold', aviso.tono === 'ok' ? 'text-ok' : aviso.tono === 'error' ? 'text-marca-hondo' : 'text-atencion')}>{aviso.texto}</p>}
          </Tarjeta>

          {opciones.length > 1 && (
            <Tarjeta>
              <p className="mb-2 text-sm text-tinta/70">¿Cuál es?</p>
              <div className="space-y-2">
                {opciones.map((o) => (
                  <button key={o.sku} type="button" onClick={() => { setOpciones([]); setProducto({ ...o, codigo: null }); setCantidad(''); setTimeout(() => cantRef.current?.focus(), 50); }}
                    className={unir('flex w-full items-center gap-3 rounded-xl border border-black/10 p-2 text-left hover:bg-crema-claro', FOCO)}>
                    {o.foto ? <img src={o.foto} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="size-12 shrink-0 rounded-lg bg-crema-hondo" />}
                    <span className="min-w-0 flex-1 break-words text-sm text-tinta">{o.nombre}<span className="block text-xs text-tinta/60">{o.sku}</span></span>
                  </button>
                ))}
              </div>
            </Tarjeta>
          )}

          {producto && (
            <Tarjeta className="border-2 border-marca">
              <div className="flex items-start gap-3">
                {producto.foto ? <img src={producto.foto} alt="" className="size-20 shrink-0 rounded-xl object-cover" /> : <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-crema-hondo text-xs text-tinta/60">sin foto</span>}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-semibold leading-snug text-tinta">{producto.nombre}</p>
                  <p className="text-xs text-tinta/60">{producto.sku}{producto.unidadesPack > 1 ? ` · caja de ${producto.unidadesPack}` : ''}</p>
                  {producto.reconteo && <p className="mt-1 text-sm font-semibold text-atencion">Reconteo: contá de nuevo TODO lo que hay, en todos los lugares.</p>}
                  {!producto.activo && <p className="mt-1 text-xs text-marca-hondo">Figura dado de baja: contalo igual si está.</p>}
                  {producto.yaContadoPorMi > 0 && <p className="mt-1 text-xs text-tinta/70">Ya contaste {producto.yaContadoPorMi} (en este arqueo). Esto se suma.</p>}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" aria-label="Uno menos" onClick={() => setCantidad((c) => String(Math.max(0, (Number(c) || 0) - 1)))} className={unir('grid size-12 shrink-0 place-items-center rounded-full border border-black/15 text-2xl', FOCO)}>−</button>
                <input ref={cantRef} value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } }}
                  inputMode={producto.porPeso ? 'decimal' : 'numeric'} aria-label="Cantidad" placeholder="0"
                  className={unir('importe h-14 min-w-0 flex-1 rounded-xl border border-black/15 bg-crema-claro text-center text-3xl font-bold text-tinta', FOCO)} />
                <button type="button" aria-label="Uno más" onClick={() => setCantidad((c) => String((Number(c) || 0) + 1))} className={unir('grid size-12 shrink-0 place-items-center rounded-full border border-black/15 text-2xl', FOCO)}>+</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {producto.unidadesPack > 1 && (
                  <Chip onClick={() => setCantidad((c) => String((Number(c) || 0) + producto.unidadesPack))}>+ 1 caja ({producto.unidadesPack})</Chip>
                )}
                {producto.porPeso && <span className="text-xs text-tinta/60">En kilos (ej. 1,250)</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Boton variante="secundario" onClick={() => { setProducto(null); setCantidad(''); }}>Cancelar</Boton>
                <Boton onClick={guardar}>Guardar</Boton>
              </div>
            </Tarjeta>
          )}

          <button type="button" onClick={() => setNoEncontrado(texto.trim() || '')} className="text-sm text-tinta/70 underline">
            Tengo un producto que el sistema no reconoce
          </button>
        </>
      )}

      {vista === 'recontar' && (
        arqueo.aRecontar.length === 0 ? <Aviso tono="ok">No hay nada para recontar.</Aviso> : (
          <div className="space-y-2">
            <p className="text-sm text-tinta/70">Estos dieron distinto. Contalos de nuevo, todo lo que haya en todos los lugares.</p>
            {arqueo.aRecontar.map((r) => (
              <button key={r.sku} type="button" onClick={() => { setVista('contar'); identificar(r.sku); }}
                className={unir('flex w-full items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left', FOCO)}>
                {r.foto ? <img src={r.foto} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="size-12 shrink-0 rounded-lg bg-crema-hondo" />}
                <span className="min-w-0 flex-1 break-words text-sm font-semibold text-tinta">{r.nombre}<span className="block text-xs font-normal text-tinta/60">{r.sku} · tocá para contarlo</span></span>
              </button>
            ))}
          </div>
        )
      )}

      {vista === 'mias' && (
        <div className="space-y-2">
          {arqueo.misLecturas.length === 0 && <p className="text-sm text-tinta/60">Todavía no cargaste nada en este arqueo.</p>}
          {arqueo.misLecturas.map((l) => (
            <div key={l.id} className={unir('flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3', l.anulada && 'opacity-50')}>
              <div className="min-w-0 flex-1">
                <p className={unir('break-words text-sm font-semibold text-tinta', l.anulada && 'line-through')}>{l.cantidad} · {l.nombre}</p>
                <p className="text-xs text-tinta/60">{l.ubicacion ?? 'sin lugar'} · {hora(l.creadoEn)}{l.reconteo ? ' · reconteo' : ''}{l.anulada ? ' · anulada' : ''}</p>
              </div>
              {!l.anulada && !cerrado && <Boton variante="fantasma" tamano="chico" onClick={() => anular(l.id)}>Anular</Boton>}
            </div>
          ))}
        </div>
      )}

      <div className="pt-2"><BotonLink href="/arqueo" variante="fantasma" tamano="chico">← Volver a los arqueos</BotonLink></div>

      {cambiandoLugar && <ElegirLugar actual={lugar} usados={arqueo.lugares} onElegir={(l) => { setLugar(l); guardado.escribir(claveLugar, l); setCambiandoLugar(false); }} onCerrar={() => setCambiandoLugar(false)} />}
      {camara && <Camara onCodigo={(c) => { setCamara(false); identificar(c); }} onCerrar={() => setCamara(false)} />}
      {dialogo}
      {noEncontrado != null && <NoEncontrado id={id} codigo={noEncontrado} lugar={lugar} onListo={(m) => { setNoEncontrado(null); if (m) setAviso({ tono: 'ok', texto: m }); }} />}
    </div>
  );
}

function ElegirLugar({ actual, usados, onElegir, onCerrar }: { actual: string; usados: string[]; onElegir: (l: string) => void; onCerrar: () => void }) {
  const [nuevo, setNuevo] = useState('');
  const base = ['Góndola 1', 'Góndola 2', 'Góndola 3', 'Heladera', 'Depósito', 'Vinoteca', 'Mostrador'];
  const todos = Array.from(new Set([...usados, ...base]));
  return (
    <Modal abierto onCerrar={onCerrar} titulo="¿Dónde estás contando?" ancho="chico"
      pie={<Boton onClick={() => nuevo.trim() && onElegir(nuevo.trim())} disabled={!nuevo.trim()}>Usar este lugar</Boton>}>
      <div className="space-y-3">
        <p className="text-sm text-tinta/70">Todo lo que cuentes queda anotado en ese lugar hasta que lo cambies. El mismo producto en dos lugares se suma solo.</p>
        <div className="flex flex-wrap gap-2">
          {todos.map((l) => <Chip key={l} activo={l === actual} onClick={() => onElegir(l)}>{l}</Chip>)}
        </div>
        <Entrada value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Otro: Góndola 7, Exhibidor entrada…" maxLength={60} aria-label="Otro lugar"
          onKeyDown={(e) => { if (e.key === 'Enter' && nuevo.trim()) onElegir(nuevo.trim()); }} />
      </div>
    </Modal>
  );
}

// Cámara del celular: usa el lector de códigos que trae el navegador (Chrome en
// Android). Donde no existe (iPhone), se avisa y se usa el lector o el nombre.
function Camara({ onCodigo, onCerrar }: { onCodigo: (c: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let flujo: MediaStream | null = null; let vivo = true; let t: any;
    const Detector = (globalThis as any).BarcodeDetector;
    if (!Detector) { setError('Este celular no lee códigos con la cámara desde el navegador (pasa en iPhone). Usá el lector de mano o escribí el nombre.'); return; }
    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current) return;
        video.current.srcObject = flujo; await video.current.play();
        const det = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
        const mirar = async () => {
          if (!vivo || !video.current) return;
          try {
            const r = await det.detect(video.current);
            const c = r?.[0]?.rawValue;
            if (c) { vibrar(60); onCodigo(String(c)); return; }
          } catch { /* cuadro sin código */ }
          t = setTimeout(mirar, 180);
        };
        mirar();
      } catch {
        setError('No pude abrir la cámara. Fijate que el navegador tenga permiso de cámara para esta página.');
      }
    })();
    return () => { vivo = false; clearTimeout(t); flujo?.getTracks().forEach((x) => x.stop()); };
  }, [onCodigo]);
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Apuntá al código de barras" ancho="chico" pie={<Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>}>
      {error ? <Aviso tono="atencion">{error}</Aviso> : (
        <div className="relative overflow-hidden rounded-xl bg-tinta">
          <video ref={video} playsInline muted className="aspect-[3/4] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-marca" />
        </div>
      )}
    </Modal>
  );
}

function NoEncontrado({ id, codigo, lugar, onListo }: { id: string; codigo: string; lugar: string; onListo: (m?: string) => void }) {
  const [cod, setCod] = useState(codigo);
  const [desc, setDesc] = useState('');
  const [cant, setCant] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    setError(null);
    const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruta: `${id}/no-encontrado`, codigo: cod || '(sin código)', descripcion: desc, cantidad: cant ? Number(cant) : null, ubicacion: lugar }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j?.message ?? 'No pude anotarlo'); return; }
    onListo('Anotado para revisar. Seguí contando.');
  }
  return (
    <Modal abierto onCerrar={() => onListo()} titulo="Producto que el sistema no reconoce" ancho="chico"
      pie={<><Boton variante="secundario" onClick={() => onListo()}>Cancelar</Boton><Boton onClick={guardar} disabled={!desc.trim() && !cod.trim()}>Anotar</Boton></>}>
      <div className="space-y-3">
        <p className="text-sm text-tinta/70">Lo anotamos y gerencia lo resuelve al revisar (lo vincula o lo da de alta).</p>
        <Entrada value={cod} onChange={(e) => setCod(e.target.value)} placeholder="Código de barras" inputMode="numeric" aria-label="Código" />
        <Entrada value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Qué es (ej.: Alfajor Havanna 70% x6)" aria-label="Descripción" maxLength={120} />
        <Entrada value={cant} onChange={(e) => setCant(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="Cantidad" inputMode="numeric" aria-label="Cantidad" />
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}
