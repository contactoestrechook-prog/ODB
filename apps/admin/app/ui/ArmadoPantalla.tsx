'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Entrada, Modal, unir, useConfirmar } from './kit';
import { numero } from '../lib/formato';

// EL ARMADO A PANTALLA COMPLETA (Leandro, 5/11/2026: «una vez que tienen el
// pedido se les abre en casi toda la pantalla; a medida que escanean se va
// sumando y va quedando el resto, todo con un contador de tiempo; lo que no
// tiene código de barras se toca y se pone manual»).
//
// La cámara queda abierta arriba y lee sola, uno atrás del otro. También anda
// el lector de mano (escribe el código y un Enter). Lo que falta va primero;
// lo que ya está en el carro baja. Tocar un producto abre la carga manual.

export type ItemArmado = { productoId: string; sku: string | null; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null };
export type CargaArmado = { id: number; productoId: string; cantidad: number; creadoEn: string };
export type PedidoArmado = {
  id: string; codigo: string; cliente: string | null; notas: string | null; sucursal: string | null;
  asignadoEn: string; cargas: CargaArmado[]; items: ItemArmado[];
};

type Mensaje = { tono: 'ok' | 'error'; texto: string; vez: number };

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
// el mismo código no se vuelve a contar hasta que pasa esto (la cámara lo ve muchas veces por segundo)
const ESPERA_MISMO_CODIGO_MS = 1600;
// iPhone no trae lector de códigos en el navegador: se carga uno (44 KB) solo ahí
const RESPALDO_LECTOR = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/dist/iife/polyfill.js';

function vibrar(patron: number | number[]) {
  try { navigator.vibrate?.(patron); } catch { /* sin vibración */ }
}

/** Un pitido corto (bien) o grave (mal), sin archivos de audio. */
function pitido(bien: boolean) {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    const ctx: AudioContext = (pitido as any).ctx ??= new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = bien ? 1320 : 220;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (bien ? 0.12 : 0.35));
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (bien ? 0.12 : 0.35));
  } catch { /* sin audio */ }
}

async function lectorDeCodigos(): Promise<any | null> {
  const w = globalThis as any;
  if (!w.BarcodeDetector) {
    await new Promise<void>((ok) => {
      const s = document.createElement('script');
      s.src = RESPALDO_LECTOR;
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => ok();
      document.head.appendChild(s);
    });
  }
  if (!w.BarcodeDetector) return null;
  try { return new w.BarcodeDetector({ formats: FORMATOS }); } catch { return new w.BarcodeDetector(); }
}

function reloj(desde: string, ahora: number) {
  const s = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function ArmadoPantalla({ p, ahora, onVolver, onCambio, enviar }: {
  p: PedidoArmado;
  ahora: number;
  onVolver: () => void;
  onCambio: () => Promise<void>;
  enviar: (cuerpo: Record<string, unknown>) => Promise<any>;
}) {
  const [items, setItems] = useState(p.items);
  const [cargas, setCargas] = useState(p.cargas);
  const [msg, setMsg] = useState<Mensaje | null>(null);
  const [manual, setManual] = useState<ItemArmado | null>(null);
  const [verCarro, setVerCarro] = useState(false);
  const [terminando, setTerminando] = useState(false);
  const [camara, setCamara] = useState(true);
  const [codigo, setCodigo] = useState('');
  const { confirmar, dialogo } = useConfirmar();
  const lector = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);

  // lo que llega del servidor manda (otro aparato, el refresco de cada 8 s)
  useEffect(() => { setItems(p.items); setCargas(p.cargas); }, [p.items, p.cargas]);

  const faltan = items.filter((i) => i.enCarro < i.cantidad);
  const listos = items.filter((i) => i.enCarro >= i.cantidad);
  const unidadesTotal = items.reduce((a, i) => a + i.cantidad, 0);
  const unidadesCarro = items.reduce((a, i) => a + Math.min(i.enCarro, i.cantidad), 0);

  const avisar = useCallback((tono: Mensaje['tono'], texto: string) => {
    setMsg({ tono, texto, vez: Date.now() });
    pitido(tono === 'ok');
    vibrar(tono === 'ok' ? 60 : [120, 80, 120]);
  }, []);

  /** Suma al carro. Antes de ir al servidor ya se ve (y si falla, vuelve atrás). */
  const sumar = useCallback(async (datos: { codigo?: string; productoId?: string; cantidad: number }) => {
    if (ocupado.current) return;
    let item = datos.productoId ? items.find((i) => i.productoId === datos.productoId) : undefined;
    if (item && item.enCarro >= item.cantidad) { avisar('error', `Ya tenés todo: ${item.nombre}`); return; }
    ocupado.current = true;
    if (item) setItems((xs) => xs.map((x) => (x.productoId === item!.productoId ? { ...x, enCarro: x.enCarro + datos.cantidad } : x)));
    try {
      const r = await enviar({ accion: 'carro', pedidoId: p.id, ...datos });
      item = items.find((i) => i.productoId === r.productoId);
      if (!datos.productoId && item) {
        if (item.enCarro >= item.cantidad) {
          // escaneó de más: se saca la carga recién hecha
          await enviar({ accion: 'sacar', pedidoId: p.id, cargaId: r.id }).catch(() => null);
          avisar('error', `Ya tenés todo: ${item.nombre}`);
          return;
        }
        setItems((xs) => xs.map((x) => (x.productoId === r.productoId ? { ...x, enCarro: x.enCarro + r.cantidad } : x)));
      }
      setCargas((cs) => [...cs, { id: r.id, productoId: r.productoId, cantidad: r.cantidad, creadoEn: r.creadoEn ?? new Date().toISOString() }]);
      const resto = item ? Math.max(item.cantidad - item.enCarro - r.cantidad, 0) : 0;
      avisar('ok', item ? `${item.nombre} · ${resto > 0 ? `faltan ${numero(resto, 2)}` : 'completo'}` : 'Sumado');
      onCambio();
    } catch (e: any) {
      if (datos.productoId) setItems((xs) => xs.map((x) => (x.productoId === datos.productoId ? { ...x, enCarro: x.enCarro - datos.cantidad } : x)));
      avisar('error', e.message === 'Ese producto no está en el pedido' ? 'Ese producto NO es de este pedido' : e.message);
    } finally {
      ocupado.current = false;
    }
  }, [items, enviar, p.id, avisar, onCambio]);

  const sumarRef = useRef(sumar);
  sumarRef.current = sumar;

  async function deshacer(item: ItemArmado) {
    const ultima = [...cargas].reverse().find((c) => c.productoId === item.productoId);
    if (!ultima) return;
    try {
      await enviar({ accion: 'sacar', pedidoId: p.id, cargaId: ultima.id });
      setItems((xs) => xs.map((x) => (x.productoId === item.productoId ? { ...x, enCarro: Math.max(x.enCarro - ultima.cantidad, 0) } : x)));
      setCargas((cs) => cs.filter((c) => c.id !== ultima.id));
      onCambio();
    } catch (e: any) { avisar('error', e.message); }
  }

  async function terminar() {
    if (faltan.length && !(await confirmar({
      titulo: `Faltan ${faltan.length} producto${faltan.length === 1 ? '' : 's'}`,
      texto: `${faltan.map((i) => i.nombre).slice(0, 4).join(', ')}${faltan.length > 4 ? '…' : ''}. Si no hay, avisale a la caja. ¿Lo das por terminado igual?`,
      textoConfirmar: 'Terminar igual',
    }))) return;
    setTerminando(true);
    try { await enviar({ accion: 'terminar', pedidoId: p.id }); await onCambio(); onVolver(); }
    catch (e: any) { avisar('error', e.message); setTerminando(false); }
  }

  // el lector de mano escribe en el campo y manda Enter: que el foco vuelva solo
  useEffect(() => {
    if (manual) return;
    const t = setInterval(() => {
      const activo = document.activeElement;
      if (!activo || activo === document.body) lector.current?.focus({ preventScroll: true });
    }, 1200);
    return () => clearInterval(t);
  }, [manual]);

  const cerrado = !!manual || terminando;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-crema" role="dialog" aria-modal="true" aria-label={`Armando el pedido ${p.codigo}`}>
      {dialogo}
      {/* arriba: el pedido y el reloj */}
      <header className="flex items-center gap-3 bg-tinta px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onVolver} className="-ml-1 rounded-full px-2 py-1 text-sm text-white/80 hover:bg-white/10" aria-label="Volver a la lista">←</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold leading-tight">{p.codigo}</p>
          <p className="truncate text-xs text-white/70">{p.cliente ?? 'Cliente sin nombre'}</p>
        </div>
        <p className="importe text-4xl font-bold tabular-nums leading-none" aria-label="Tiempo desde que te lo asignaron">{reloj(p.asignadoEn, ahora)}</p>
      </header>

      {/* avance */}
      <div className="bg-white px-4 py-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-tinta">{faltan.length ? `Faltan ${faltan.length} producto${faltan.length === 1 ? '' : 's'}` : 'Está todo en el carro'}</span>
          <span className="importe text-tinta/60">{numero(unidadesCarro, 2)} / {numero(unidadesTotal, 2)} unidades</span>
        </div>
        <div className="mt-1.5 h-2.5 rounded-full bg-crema">
          <div className="h-2.5 rounded-full bg-ok transition-all duration-300" style={{ width: `${unidadesTotal ? (unidadesCarro / unidadesTotal) * 100 : 0}%` }} />
        </div>
      </div>

      {/* la cámara (y el campo para el lector de mano) */}
      <div className="bg-white px-4 pb-3">
        {camara && <Camara pausada={cerrado} onCodigo={(c) => sumarRef.current({ codigo: c, cantidad: 1 })} onError={() => setCamara(false)} />}
        <form onSubmit={(e) => { e.preventDefault(); const c = codigo.trim(); if (c) { setCodigo(''); sumar({ codigo: c, cantidad: 1 }); } }} className="mt-2 flex gap-2">
          <Entrada ref={lector} inputMode="none" value={codigo} onChange={(e) => setCodigo(e.target.value)} aria-label="Código de barras (lector de mano)" placeholder="Lector de mano" className="flex-1" />
          <Boton type="button" variante="secundario" onClick={() => setCamara((c) => !c)}>{camara ? 'Sin cámara' : 'Cámara'}</Boton>
        </form>
        {msg && (
          <p key={msg.vez} role="status" className={unir('mt-2 rounded-lg px-3 py-2 text-sm font-semibold', msg.tono === 'ok' ? 'bg-ok text-white' : 'bg-marca text-white')}>
            {msg.texto}
          </p>
        )}
      </div>

      {/* lo que falta (tocar = carga manual) y lo que ya está */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {p.notas && <p className="mb-3 whitespace-pre-wrap rounded-lg bg-atencion-suave px-3 py-2 text-sm text-tinta"><b>Nota:</b> {p.notas}</p>}
        <ul className="space-y-2">
          {faltan.map((i) => {
            const resto = i.cantidad - i.enCarro;
            return (
              <li key={i.productoId}>
                <button type="button" onClick={() => setManual(i)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm active:scale-[0.99]">
                  <span className="importe grid size-14 shrink-0 place-items-center rounded-xl bg-marca text-xl font-bold text-white">{numero(resto, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-tight text-tinta">{i.nombre}</span>
                    <span className="mt-1 block text-xs text-tinta/60">
                      {i.ubicacion ? <b className="font-semibold text-info">{i.ubicacion}</b> : 'Sin lugar cargado'}
                      {i.enCarro > 0 && ` · llevás ${numero(i.enCarro, 2)} de ${numero(i.cantidad, 2)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-tinta/50">Tocar si<br />no tiene código</span>
                </button>
              </li>
            );
          })}
        </ul>

        {listos.length > 0 && (
          <section className="mt-4">
            <button type="button" onClick={() => setVerCarro((v) => !v)} className="w-full text-left text-sm font-semibold text-tinta/70">
              En el carro ({listos.length}) {verCarro ? '▴' : '▾'}
            </button>
            {verCarro && (
              <ul className="mt-2 space-y-1.5">
                {listos.map((i) => (
                  <li key={i.productoId} className="flex items-center gap-3 rounded-xl bg-ok-suave/70 px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm text-tinta">{numero(i.enCarro, 2)} × {i.nombre}</span>
                    <Boton tamano="chico" variante="fantasma" onClick={() => deshacer(i)}>Deshacer</Boton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <Boton variante={faltan.length ? 'secundario' : 'ok'} anchoCompleto onClick={terminar} cargando={terminando}>
          {faltan.length ? `Terminé (faltan ${faltan.length})` : 'Terminé: está todo en el carro'}
        </Boton>
      </div>

      {manual && <CargaManual item={manual} onCerrar={() => setManual(null)} onSumar={(c) => { const it = manual; setManual(null); sumar({ productoId: it.productoId, cantidad: c }); }} />}
    </div>
  );
}

/** Lo que no tiene código: se toca y se pone la cantidad a mano. */
function CargaManual({ item, onCerrar, onSumar }: { item: ItemArmado; onCerrar: () => void; onSumar: (cantidad: number) => void }) {
  const resto = Math.max(item.cantidad - item.enCarro, 0);
  const [valor, setValor] = useState(numero(resto, 3).replace(/\./g, ''));
  const cantidad = Number(valor.replace(',', '.'));
  const valida = Number.isFinite(cantidad) && cantidad > 0 && cantidad <= resto + 1e-9;
  const entero = Number.isInteger(resto);
  return (
    <Modal abierto onCerrar={onCerrar} ancho="chico" titulo={item.nombre} descripcion={`Faltan ${numero(resto, 2)}${item.ubicacion ? ` · ${item.ubicacion}` : ''}`}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={() => onSumar(cantidad)} disabled={!valida}>Al carro</Boton>
      </>}>
      <div className="flex items-center gap-3">
        {entero && <Boton variante="secundario" onClick={() => setValor(String(Math.max(1, (cantidad || 1) - 1)))} aria-label="Uno menos">−</Boton>}
        <Entrada autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Cantidad" className="importe flex-1 text-center text-2xl font-bold" />
        {entero && <Boton variante="secundario" onClick={() => setValor(String(Math.min(resto, (cantidad || 0) + 1)))} aria-label="Uno más">+</Boton>}
      </div>
      {!valida && valor !== '' && <Aviso tono="atencion" className="mt-3">Poné una cantidad entre 0 y {numero(resto, 2)}.</Aviso>}
    </Modal>
  );
}

/** La cámara siempre abierta, leyendo códigos uno atrás del otro. */
function Camara({ pausada, onCodigo, onError }: { pausada: boolean; onCodigo: (c: string) => void; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'sin-lector' | 'sin-permiso'>('abriendo');
  const pausadaRef = useRef(pausada);
  pausadaRef.current = pausada;
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    let t: any;
    const ultimo = { codigo: '', cuando: 0 };
    (async () => {
      const det = await lectorDeCodigos();
      if (!vivo) return;
      if (!det) { setEstado('sin-lector'); return; }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (!vivo || !video.current) { flujo.getTracks().forEach((x) => x.stop()); return; }
        video.current.srcObject = flujo;
        await video.current.play();
        setEstado('leyendo');
        const mirar = async () => {
          if (!vivo || !video.current) return;
          if (!pausadaRef.current && video.current.readyState >= 2) {
            try {
              const r = await det.detect(video.current);
              const c = r?.[0]?.rawValue ? String(r[0].rawValue) : '';
              const ahora = Date.now();
              if (c && (c !== ultimo.codigo || ahora - ultimo.cuando > ESPERA_MISMO_CODIGO_MS)) {
                ultimo.codigo = c;
                ultimo.cuando = ahora;
                onCodigoRef.current(c);
              } else if (c) ultimo.cuando = ahora; // sigue apuntando al mismo: no cuenta de nuevo
            } catch { /* cuadro sin código */ }
          }
          t = setTimeout(mirar, 160);
        };
        mirar();
      } catch {
        if (vivo) setEstado('sin-permiso');
      }
    })();
    return () => { vivo = false; clearTimeout(t); flujo?.getTracks().forEach((x) => x.stop()); };
  }, []);

  if (estado === 'sin-lector' || estado === 'sin-permiso') {
    return (
      <Aviso tono="atencion" accion={<Boton tamano="chico" variante="secundario" onClick={onError}>Cerrar</Boton>}>
        {estado === 'sin-permiso'
          ? 'No pude abrir la cámara: dale permiso de cámara a esta página en el navegador.'
          : 'Este celular no puede leer códigos con la cámara. Usá el lector de mano o tocá cada producto.'}
      </Aviso>
    );
  }
  return (
    <div className="relative h-[24dvh] min-h-36 overflow-hidden rounded-xl bg-tinta">
      <video ref={video} playsInline muted className="size-full object-cover" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-marca shadow-[0_0_12px_rgba(184,45,37,0.9)]" />
      <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-xs font-medium text-white/80">
        {estado === 'abriendo' ? 'Abriendo la cámara…' : pausada ? 'En pausa' : 'Apuntá al código'}
      </p>
    </div>
  );
}
