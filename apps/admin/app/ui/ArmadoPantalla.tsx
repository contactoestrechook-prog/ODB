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
  id: string; codigo: string; canal?: string | null; cliente: string | null; notas: string | null; sucursal: string | null;
  asignadoEn: string; cargas: CargaArmado[]; items: ItemArmado[];
};

type Mensaje = { tono: 'ok' | 'error'; texto: string; vez: number };

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
// el mismo código no se vuelve a contar hasta que pasa esto (la cámara lo ve muchas veces por segundo)
// (19/11/2026, «no lo deja poner 2 queso adler»: con 1,6 s el segundo paquete
// igual no entraba nunca, porque al cambiarlo el código casi no desaparece)
const ESPERA_MISMO_CODIGO_MS = 900;
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

export function ArmadoPantalla({ p, ahora, onVolver, onTerminado, onCambio, enviar }: {
  p: PedidoArmado;
  ahora: number;
  onVolver: () => void;
  /** Finalizado: con el texto de a dónde va (mesa de retiro o salida) */
  onTerminado: (texto: string) => void;
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
  // el último que se escaneó: si son varios (12 latas), se escanea UNO y se
  // completa con «Poner x 12» (Leandro, 19/11/2026: «cuando son 12 latas tiene
  // que poder poner x 12 armando el pedido y no escanear 12»)
  const [ultimo, setUltimo] = useState<string | null>(null);
  // la cámara volvió a ver el mismo código y no lo contó (puede ser otro igual)
  const [repetidoEn, setRepetidoEn] = useState(0);
  const { confirmar, dialogo } = useConfirmar();
  const lector = useRef<HTMLInputElement>(null);
  const campoFoto = useRef<HTMLInputElement>(null);
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  // al volver de la cámara del teléfono, la cámara en vivo se abre de nuevo
  const [vueltaCamara, setVueltaCamara] = useState(0);
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
        setUltimo(r.productoId);
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
      texto: `${faltan.map((i) => i.nombre).slice(0, 4).join(', ')}${faltan.length > 4 ? '…' : ''}. Si no hay, avisale a la caja. ¿Lo finalizás igual?`,
      textoConfirmar: 'Finalizar igual',
    }))) return;
    setTerminando(true);
    try {
      await enviar({ accion: 'terminar', pedidoId: p.id });
      vibrar([80, 60, 80]);
      onTerminado(`${p.codigo} finalizado en ${reloj(p.asignadoEn, Date.now())}. ${destino}.`);
      await onCambio();
    }
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

  async function leerFoto(archivo?: File | null) {
    if (!archivo) return;
    setLeyendoFoto(true);
    try {
      const c = await codigoDeFoto(archivo);
      if (c) await sumar({ codigo: c, cantidad: 1 });
      else avisar('error', 'No encontré el código en la foto. Sacala de más cerca, con luz y con el código derecho.');
    } catch { avisar('error', 'No pude leer la foto. Probá de nuevo.'); }
    finally {
      setLeyendoFoto(false);
      if (campoFoto.current) campoFoto.current.value = '';
      setVueltaCamara((n) => n + 1);
    }
  }

  const cerrado = !!manual || terminando || leyendoFoto;
  const porCompletar = ultimo ? items.find((i) => i.productoId === ultimo && i.enCarro < i.cantidad) ?? null : null;
  // dónde queda: lo que se retira va a la mesa de retiro; un envío, a la salida
  const destino = p.canal === 'domicilio' ? 'Dejalo listo para salir con el envío' : 'Dejalo en la mesa de retiro';
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
        {camara && <Camara key={vueltaCamara} pausada={cerrado} onCodigo={(c) => sumarRef.current({ codigo: c, cantidad: 1 })} onError={() => setCamara(false)} onFoto={() => campoFoto.current?.click()} onRepetido={() => setRepetidoEn(Date.now())} />}
        <input ref={campoFoto} type="file" accept="image/*" capture="environment" className="hidden" aria-hidden tabIndex={-1}
          onChange={(e) => leerFoto(e.target.files?.[0])} />
        {leyendoFoto && <p role="status" className="mt-2 rounded-lg bg-crema px-3 py-2 text-sm font-semibold text-tinta">Leyendo la foto…</p>}
        <form onSubmit={(e) => { e.preventDefault(); const c = codigo.trim(); if (c) { setCodigo(''); sumar({ codigo: c, cantidad: 1 }); } }} className="mt-2 flex gap-2">
          <Entrada ref={lector} inputMode="none" value={codigo} onChange={(e) => setCodigo(e.target.value)} aria-label="Código de barras (lector de mano)" placeholder="Lector de mano" className="flex-1" />
          {!camara && <Boton type="button" variante="secundario" onClick={() => campoFoto.current?.click()}>Foto</Boton>}
          <Boton type="button" variante="secundario" onClick={() => setCamara((c) => !c)}>{camara ? 'Sin cámara' : 'Cámara'}</Boton>
        </form>
        {msg && (
          <p key={msg.vez} role="status" className={unir('mt-2 rounded-lg px-3 py-2 text-sm font-semibold', msg.tono === 'ok' ? 'bg-ok text-white' : 'bg-marca text-white')}>
            {msg.texto}
          </p>
        )}
        {porCompletar && (() => {
          const resto = porCompletar.cantidad - porCompletar.enCarro;
          const repetido = ahora - repetidoEn < 3500;
          return (
            <div className={unir('mt-2 rounded-xl border bg-ok-suave px-3 py-2', repetido ? 'border-ok ring-2 ring-ok/30' : 'border-ok/25')}>
              <p className="text-sm leading-snug text-tinta">
                <b className="font-semibold">{porCompletar.nombre}</b> · llevás {numero(porCompletar.enCarro, 2)} de {numero(porCompletar.cantidad, 2)}
              </p>
              {repetido && <p className="mt-0.5 text-xs font-semibold text-ok">Ese código ya lo conté. Si es otro igual, tocá +1.</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {resto >= 1 && (
                  <Boton tamano="chico" variante={repetido ? 'ok' : 'secundario'} onClick={() => sumar({ productoId: porCompletar.productoId, cantidad: 1 })} aria-label={`Sumar uno más de ${porCompletar.nombre}`}>
                    +1
                  </Boton>
                )}
                {resto > 1 && (
                  <Boton tamano="chico" variante={repetido ? 'secundario' : 'ok'} onClick={() => sumar({ productoId: porCompletar.productoId, cantidad: resto })}>
                    Poner x {numero(porCompletar.cantidad, 2)}
                  </Boton>
                )}
                <Boton tamano="chico" variante="secundario" onClick={() => setManual(porCompletar)}>Otra cantidad</Boton>
              </div>
            </div>
          );
        })()}
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
                      {i.ubicacion ? <b className="font-semibold text-dato-3">{i.ubicacion}</b> : 'Sin lugar cargado'}
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
          {faltan.length ? `Finalizar (faltan ${faltan.length})` : p.canal === 'domicilio' ? 'Finalizar: listo para salir' : 'Finalizar: a la mesa de retiro'}
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
/** El código de una foto sacada con la cámara del teléfono (iPhone, 19/11/2026:
 *  «no lee el código desde iphone»: la cámara del navegador no enfoca de cerca;
 *  la del iPhone sí). Se achica a 2000 px para que el lector no tarde. */
async function codigoDeFoto(archivo: File): Promise<string | null> {
  const det = await lectorDeCodigos();
  if (!det) return null;
  let fuente: { ancho: number; alto: number; dibujar: (c: CanvasRenderingContext2D, w: number, h: number) => void; soltar: () => void };
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(archivo);
    fuente = { ancho: bmp.width, alto: bmp.height, dibujar: (c, w, h) => c.drawImage(bmp, 0, 0, w, h), soltar: () => bmp.close?.() };
  } else {
    const url = URL.createObjectURL(archivo);
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    fuente = { ancho: img.naturalWidth, alto: img.naturalHeight, dibujar: (c, w, h) => c.drawImage(img, 0, 0, w, h), soltar: () => URL.revokeObjectURL(url) };
  }
  const escala = Math.min(1, 2000 / Math.max(fuente.ancho, fuente.alto, 1));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(fuente.ancho * escala));
  lienzo.height = Math.max(1, Math.round(fuente.alto * escala));
  fuente.dibujar(lienzo.getContext('2d')!, lienzo.width, lienzo.height);
  fuente.soltar();
  const r = await det.detect(lienzo);
  return r?.[0]?.rawValue ? String(r[0].rawValue) : null;
}

function Camara({ pausada, onCodigo, onError, onFoto, onRepetido }: { pausada: boolean; onCodigo: (c: string) => void; onError: () => void; onFoto: () => void; onRepetido?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'sin-lector' | 'sin-permiso'>('abriendo');
  const pausadaRef = useRef(pausada);
  pausadaRef.current = pausada;
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;
  const onRepetidoRef = useRef(onRepetido);
  onRepetidoRef.current = onRepetido;

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    let t: any;
    const ultimo = { codigo: '', cuando: 0, avisado: 0 };
    (async () => {
      const det = await lectorDeCodigos();
      if (!vivo) return;
      if (!det) { setEstado('sin-lector'); return; }
      try {
        // 1920: el iPhone no enfoca de cerca y hay que alejarlo; con 1280 un código
        // chico no se lee y con 1920 sí (medido el 19/11/2026: 0/4 contra 4/4)
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo || !video.current) { flujo.getTracks().forEach((x) => x.stop()); return; }
        // el iPhone pegado a la lata no enfoca: con 2x se lo tiene a un palmo y
        // el código se ve grande. Donde no se puede, no pasa nada.
        try {
          const pista = flujo.getVideoTracks()[0] as any;
          const cap = pista?.getCapabilities?.() ?? {};
          if (cap.zoom?.max >= 1.5) await pista.applyConstraints({ advanced: [{ zoom: Math.min(2, cap.zoom.max) }] });
          if (Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch { /* sin zoom ni foco */ }
        video.current.srcObject = flujo;
        await video.current.play();
        setEstado('leyendo');
        // si el lector falla en cada cuadro (no arrancó su motor), se avisa en vez
        // de quedar «Apuntá al código» para siempre
        let fallas = 0;
        // se lee SOLO lo que se ve en el recuadro (el video va con object-cover):
        // en el celular vertical es un tercio del cuadro, y lee el doble de rápido
        const lienzo = document.createElement('canvas');
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        const loVisible = (v: HTMLVideoElement): HTMLCanvasElement | HTMLVideoElement => {
          const vw = v.videoWidth, vh = v.videoHeight;
          const caja = v.getBoundingClientRect();
          if (!ctx || !vw || !vh || !caja.width || !caja.height) return v;
          const e = Math.max(caja.width / vw, caja.height / vh);
          const sw = Math.min(vw, caja.width / e), sh = Math.min(vh, caja.height / e);
          const k = Math.min(1, 1280 / Math.max(sw, sh));
          const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
          if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
          ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
          return lienzo;
        };
        const mirar = async () => {
          if (!vivo || !video.current) return;
          if (!pausadaRef.current && video.current.readyState >= 2) {
            try {
              const r = await det.detect(loVisible(video.current));
              const c = r?.[0]?.rawValue ? String(r[0].rawValue) : '';
              const ahora = Date.now();
              if (c && (c !== ultimo.codigo || ahora - ultimo.cuando > ESPERA_MISMO_CODIGO_MS)) {
                ultimo.codigo = c;
                ultimo.cuando = ahora;
                onCodigoRef.current(c);
              } else if (c) {
                // sigue apuntando al mismo: no cuenta de nuevo, pero avisa que ya lo contó
                ultimo.cuando = ahora;
                if (ahora - ultimo.avisado > 2500) { ultimo.avisado = ahora; onRepetidoRef.current?.(); }
              }
              fallas = 0;
            } catch {
              if (++fallas >= 25) { setEstado('sin-lector'); return; }
            }
          }
          t = setTimeout(mirar, 90);
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
      <Aviso tono="atencion" accion={<>
        <Boton tamano="chico" onClick={onFoto}>Sacar foto del código</Boton>
        <Boton tamano="chico" variante="secundario" onClick={onError}>Cerrar</Boton>
      </>}>
        {estado === 'sin-permiso'
          ? 'No pude abrir la cámara en vivo. Sacale una foto al código y lo leo de la foto, o dale permiso de cámara a esta página.'
          : 'La cámara en vivo no lee en este celular. Sacale una foto al código y lo leo de la foto.'}
      </Aviso>
    );
  }
  return (
    <div className="relative h-[24dvh] min-h-36 overflow-hidden rounded-xl bg-tinta">
      <video ref={video} playsInline muted className="size-full object-cover" />
      <div className="pointer-events-none absolute inset-x-5 inset-y-3 rounded-lg border-2 border-white/60" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-marca shadow-[0_0_12px_rgba(184,45,37,0.9)]" />
      <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-xs font-medium text-white/80">
        {estado === 'abriendo' ? 'Abriendo la cámara…' : pausada ? 'En pausa' : 'Apuntá al código a un palmo'}
      </p>
      <button type="button" onClick={onFoto} className="absolute right-2 top-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur active:scale-95">
        ¿No lee? Sacá foto
      </button>
    </div>
  );
}
