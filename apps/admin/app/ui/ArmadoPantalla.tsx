'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, Boton, Entrada, Modal, unir, useConfirmar } from './kit';
import { numero, pesos } from '../lib/formato';
import { cantidadDe, FaltaEnGondola, traerParecidos } from './FaltaEnGondola';

// EL ARMADO A PANTALLA COMPLETA (Leandro, 5/11/2026: «una vez que tienen el
// pedido se les abre en casi toda la pantalla; a medida que escanean se va
// sumando y va quedando el resto, todo con un contador de tiempo; lo que no
// tiene código de barras se toca y se pone manual»).
//
// La cámara queda abierta arriba y lee sola, uno atrás del otro. También anda
// el lector de mano (escribe el código y un Enter). Lo que falta va primero;
// lo que ya está en el carro baja. Un escaneo cuenta UNO; tocar un producto
// abre la cantidad (el total en el carro), que también sirve para corregir.

export type ItemArmado = { productoId: string; sku: string | null; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null; /** lo que el sistema dice que hay para este pedido (20/11/2026) */ hayEnSistema?: number | null; /** lo que aclaró el cliente: «limón» del Saphirus VARIOS (20/11/2026) */ aclaracion?: string | null; /** las variedades que se conocen del producto (20/11/2026) */ variedades?: string[] };
/** La aclaración del cliente, bien a la vista debajo del producto. */
const Aclaracion = ({ texto }: { texto?: string | null }) => (texto ? <span className="mt-0.5 block text-sm font-bold text-marca-hondo">Pidió: {texto}</span> : null);
export type CargaArmado = { id: number; productoId: string; cantidad: number; creadoEn: string };
/** Un «Tengo parecido» (20/11/2026): propuesto, consultado por WhatsApp y lo que contestó el cliente. */
export type CambioArmado = {
  id: string; productoId: string; falta: string; pide: number; hay: number; reemplazoId: string; reemplazo: string; cantidad: number; precio: number | null;
  faltaPorPeso?: boolean; reemplazoPorPeso?: boolean;
  estado: 'propuesto' | 'en_cola' | 'preguntado' | 'aceptado' | 'rechazado';
  consultadoEn: string | null; preguntadoEn: string | null; respondidoEn: string | null; porWhatsapp: boolean;
  error: string | null; ultimoError: string | null; otraRespuesta: string | null; otraRespuestaEn: string | null; cerradoEn: string | null;
  /** variedad (20/11/2026): el mismo producto en otra fragancia, sabor o color */
  tipo?: 'parecido' | 'variedad'; pedida?: string | null; variedades?: string[] | null; elegida?: string | null;
};
export type PedidoArmado = {
  id: string; codigo: string; canal?: string | null; cliente: string | null; notas: string | null; sucursal: string | null;
  asignadoEn: string; cargas: CargaArmado[]; items: ItemArmado[]; cambios?: CambioArmado[];
};
const ABIERTO = ['propuesto', 'en_cola', 'preguntado'];
/** «2 × Manteca x 100 gr», «Manteca x 100 gr», «250 g de Jamón». */
const conCantidad = (n: number, nombre: string, porPeso?: boolean) => porPeso ? `${cantidadDe(n, true)} de ${nombre}` : n === 1 ? nombre : `${numero(n, 2)} × ${nombre}`;

type Mensaje = { tono: 'ok' | 'error'; texto: string; vez: number };

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
// EL MISMO CÓDIGO NO SE CUENTA DOS VECES SOLO (Leandro, 19/11/2026: «pablo
// escanea queso adler y le salen 4 unidades y no una»). La cámara está siempre
// abierta: si el producto queda a la vista (en la mano, en el carro) lo pierde
// y lo vuelve a ver, y con cualquier espera (1,6 s, 0,9 s) lo contaba de nuevo.
// Ahora un escaneo cuenta UNO; para más del mismo, «+» o «Poner los N». Vuelve
// a contar ese código recién cuando se escaneó otro. Se guarda por pedido para
// que no se pierda al cerrar y volver a abrir el armado.
const CONTADOS = new Map<string, { codigo: string; avisado: number }>();
type Resultado = 'sumado' | 'completo' | 'rechazado' | 'falla' | 'ocupado';
const redondo = (n: number) => Math.round(n * 1000) / 1000;
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

/**
 * El lector de códigos. En iPhone es el de respaldo (barcode-detector + zxing-wasm,
 * que baja su motor de internet la primera vez). Con `reiniciar` se vuelve a
 * cargar de cero (20/11/2026, simulacro: a la hora de armar, en el iPhone de
 * prueba, fallaban la cámara en vivo Y la foto: el motor había quedado roto —sin
 * memoria o con la descarga cortada— y solo recargando la página volvía).
 */
async function lectorDeCodigos(reiniciar = false): Promise<any | null> {
  const w = globalThis as any;
  if (reiniciar && w.__odbLectorRespaldo) { try { delete w.BarcodeDetector; } catch { w.BarcodeDetector = undefined; } }
  if (!w.BarcodeDetector) {
    await new Promise<void>((ok) => {
      const s = document.createElement('script');
      // al reiniciar, otra dirección: el navegador lo vuelve a correr entero (motor nuevo)
      s.src = reiniciar ? `${RESPALDO_LECTOR}?r=${Date.now()}` : RESPALDO_LECTOR;
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => ok();
      document.head.appendChild(s);
    });
    if (w.BarcodeDetector) w.__odbLectorRespaldo = true;
  }
  if (!w.BarcodeDetector) return null;
  try { return new w.BarcodeDetector({ formats: FORMATOS }); } catch { return new w.BarcodeDetector(); }
}

/** El motivo de un error, corto, para mostrarlo (y saber qué pasó). */
const motivoDe = (e: any) => String(e?.message ?? e ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

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
  // falta en la góndola (19/11/2026): el que arma corrige el pedido
  const [falta, setFalta] = useState<ItemArmado | null>(null);
  // un código que el sistema no conoce (20/11/2026: el Saphirus de fragancia bebé):
  // quien arma dice cuál del pedido es y queda aprendido
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const desconocidoRef = useRef<string | null>(null);
  desconocidoRef.current = desconocido;
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
  const contado = useRef(CONTADOS.get(p.id) ?? { codigo: '', avisado: 0 });
  // códigos que no suman (producto completo, de otro pedido): no se insiste en cada cuadro
  const callados = useRef(new Map<string, number>());
  // qué producto es cada código, según lo que ya contestó el servidor
  const productoDe = useRef(new Map<string, string>());
  // el celular queda horas con el armado abierto y esta pantalla tapa el aviso
  // general: si se publicó una versión nueva, se avisa acá
  const [hayVersion, setHayVersion] = useState(false);
  useEffect(() => {
    let inicial: string | null = null;
    let vivo = true;
    const mirar = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = await r.json();
        if (!version || !vivo) return;
        if (inicial === null) inicial = version;
        else if (version !== inicial) setHayVersion(true);
      } catch { /* sin red: no molesta */ }
    };
    mirar();
    const t = setInterval(mirar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
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
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  // «Tengo parecido» (20/11/2026): lo propuesto, lo que espera al cliente y lo que contestó
  const cambios = useMemo(() => p.cambios ?? [], [p.cambios]);
  const cambioAbierto = new Map(cambios.filter((c) => ABIERTO.includes(c.estado)).map((c) => [c.productoId, c]));
  const propuestos = cambios.filter((c) => c.estado === 'propuesto');
  const esperando = cambios.filter((c) => c.estado === 'en_cola' || c.estado === 'preguntado');
  const [consultando, setConsultando] = useState(false);
  // el cliente no tiene WhatsApp: lo llama y anota lo que dijo en cada cambio
  const [sinWhatsapp, setSinWhatsapp] = useState(false);
  // cada respuesta del cliente se avisa (pitido y franja) apenas llega con el refresco
  const estadosVistos = useRef<Map<string, string> | null>(null);
  const otrasVistas = useRef(new Set<string>());
  useEffect(() => {
    const antes = estadosVistos.current;
    estadosVistos.current = new Map(cambios.map((c) => [c.id, c.estado]));
    if (!antes) return;
    const nuevas = cambios.filter((c) => (c.estado === 'aceptado' || c.estado === 'rechazado') && c.porWhatsapp && antes.get(c.id) && antes.get(c.id) !== c.estado);
    if (nuevas.length) {
      const c = nuevas[nuevas.length - 1];
      avisarRef.current('ok', c.estado === 'aceptado' ? `El cliente dijo SÍ: va ${conCantidad(c.cantidad, c.reemplazo, c.reemplazoPorPeso)}` : `El cliente dijo NO: ${c.falta} ${c.hay > 0 ? `queda en ${cantidadDe(c.hay, c.faltaPorPeso)}` : 'sale del pedido'}`);
    }
    // contestó otra cosa (preguntó algo): lo lee quien arma y anota lo que quiere
    for (const c of cambios) {
      if (!c.otraRespuestaEn || c.estado !== 'preguntado') continue;
      const clave = `${c.id}|${c.otraRespuestaEn}`;
      if (otrasVistas.current.has(clave)) continue;
      otrasVistas.current.add(clave);
      if (Date.now() - Date.parse(c.otraRespuestaEn) < 60_000) avisarRef.current('error', `El cliente escribió: «${c.otraRespuesta}». Leelo y anotá lo que quiere.`);
    }
  }, [cambios]);



  /** Suma al carro. Antes de ir al servidor ya se ve (y si falla, vuelve atrás). */
  const sumar = useCallback(async (datos: { codigo?: string; productoId?: string; cantidad: number; aprender?: boolean }): Promise<Resultado> => {
    if (ocupado.current) return 'ocupado';
    // con la pregunta del código desconocido abierta, la cámara no manda nada más
    if (desconocidoRef.current && datos.codigo && !datos.aprender) return 'ocupado';
    const conocido = datos.productoId ?? (datos.codigo ? productoDe.current.get(datos.codigo) : undefined);
    let item = conocido ? items.find((i) => i.productoId === conocido) : undefined;
    // ya está completo: ni se manda (antes se cargaba y se borraba, una y otra vez)
    if (item && item.enCarro >= item.cantidad) { setUltimo(item.productoId); avisar('error', `Ya tenés todo: ${item.nombre}`); return 'completo'; }
    ocupado.current = true;
    if (datos.productoId && item) setItems((xs) => xs.map((x) => (x.productoId === datos.productoId ? { ...x, enCarro: redondo(x.enCarro + datos.cantidad) } : x)));
    try {
      const r = await enviar({ accion: 'carro', pedidoId: p.id, ...datos });
      if (datos.codigo) productoDe.current.set(datos.codigo, r.productoId);
      item = items.find((i) => i.productoId === r.productoId);
      if (!datos.productoId && item) {
        if (item.enCarro >= item.cantidad) {
          // escaneó de más: se saca la carga recién hecha
          await enviar({ accion: 'sacar', pedidoId: p.id, cargaId: r.id }).catch(() => null);
          setUltimo(item.productoId);
          avisar('error', `Ya tenés todo: ${item.nombre}`);
          return 'completo';
        }
        setItems((xs) => xs.map((x) => (x.productoId === r.productoId ? { ...x, enCarro: redondo(x.enCarro + r.cantidad) } : x)));
      }
      // este código ya contó: la cámara no lo suma de nuevo aunque lo siga viendo
      if (datos.codigo) { contado.current = { codigo: datos.codigo, avisado: Date.now() }; CONTADOS.set(p.id, contado.current); }
      setUltimo(r.productoId);
      setCargas((cs) => [...cs, { id: r.id, productoId: r.productoId, cantidad: r.cantidad, creadoEn: r.creadoEn ?? new Date().toISOString() }]);
      const lleva = item ? redondo(item.enCarro + r.cantidad) : 0;
      avisar('ok', item ? `${item.nombre} · ${lleva >= item.cantidad ? 'completo' : `llevás ${numero(lleva, 2)} de ${numero(item.cantidad, 2)}`}` : 'Sumado');
      onCambio();
      return 'sumado';
    } catch (e: any) {
      if (datos.productoId) setItems((xs) => xs.map((x) => (x.productoId === datos.productoId ? { ...x, enCarro: redondo(x.enCarro - datos.cantidad) } : x)));
      // el sistema no conoce el código: que diga cuál del pedido es (queda aprendido)
      if (e?.datos?.codigo === 'CODIGO_DESCONOCIDO' && datos.codigo && !datos.aprender) {
        setDesconocido(String(e.datos.leido ?? datos.codigo));
        try { navigator.vibrate?.([120, 80, 120]); } catch { /* sin vibración */ }
        return 'rechazado';
      }
      const texto = String(e?.message ?? 'No pude hablar con el sistema');
      avisar('error', texto === 'Ese producto no está en el pedido' ? 'Ese producto NO es de este pedido' : texto);
      return /no está en el pedido|no está en el sistema/i.test(texto) ? 'rechazado' : 'falla';
    } finally {
      ocupado.current = false;
    }
  }, [items, enviar, p.id, avisar, onCambio]);

  const sumarRef = useRef(sumar);
  sumarRef.current = sumar;

  /** Lo que ve la cámara, cuadro por cuadro: decide si cuenta. */
  const alLeer = useCallback((c: string) => {
    const t = Date.now();
    if (c === contado.current.codigo) {
      // sigue viendo (o volvió a ver) el que ya contó: no suma, avisa cómo sumar otro igual
      if (t - contado.current.avisado > 2500) {
        contado.current.avisado = t;
        const prod = productoDe.current.get(c);
        if (prod) setUltimo(prod);
        setRepetidoEn(t);
      }
      return;
    }
    if ((callados.current.get(c) ?? 0) > t) return;
    sumarRef.current({ codigo: c, cantidad: 1 }).then((r) => {
      if (r === 'completo') callados.current.set(c, Date.now() + 15_000);
      else if (r === 'rechazado') callados.current.set(c, Date.now() + 5000);
      else if (r === 'falla') callados.current.set(c, Date.now() + 1500);
    });
  }, []);

  /** Deja EXACTAMENTE esa cantidad del producto en el carro: suma lo que falta o saca
   *  lo que sobra (19/11/2026: no había forma de bajar una cantidad mal cargada). */
  const fijar = useCallback(async (de: ItemArmado, pedido: number) => {
    const item = items.find((i) => i.productoId === de.productoId);
    if (!item) return;
    const total = redondo(Math.min(Math.max(pedido, 0), item.cantidad));
    const dif = redondo(total - item.enCarro);
    if (dif === 0) return;
    if (dif > 0) { await sumar({ productoId: item.productoId, cantidad: dif }); return; }
    if (ocupado.current) return;
    ocupado.current = true;
    try {
      // se sacan cargas desde la última; si una traía más de lo que sobra, se repone la diferencia
      let sobra = -dif;
      const sacadas: number[] = [];
      for (const c of cargas.filter((x) => x.productoId === item.productoId).reverse()) {
        if (sobra <= 0) break;
        await enviar({ accion: 'sacar', pedidoId: p.id, cargaId: c.id });
        sacadas.push(c.id);
        sobra = redondo(sobra - c.cantidad);
      }
      let repuesta: any = null;
      if (sobra < 0) repuesta = await enviar({ accion: 'carro', pedidoId: p.id, productoId: item.productoId, cantidad: redondo(-sobra) });
      setCargas((cs) => [
        ...cs.filter((c) => !sacadas.includes(c.id)),
        ...(repuesta ? [{ id: repuesta.id, productoId: repuesta.productoId, cantidad: repuesta.cantidad, creadoEn: repuesta.creadoEn ?? new Date().toISOString() }] : []),
      ]);
      setItems((xs) => xs.map((x) => (x.productoId === item.productoId ? { ...x, enCarro: total } : x)));
      setUltimo(item.productoId);
      avisar('ok', `${item.nombre} · ${total > 0 ? `llevás ${numero(total, 2)} de ${numero(item.cantidad, 2)}` : 'lo saqué del carro'}`);
    } catch (e: any) {
      avisar('error', String(e?.message ?? 'No pude cambiar la cantidad'));
    } finally {
      ocupado.current = false;
      onCambio();
    }
  }, [items, cargas, enviar, p.id, avisar, onCambio, sumar]);

  // Falta en la góndola (Leandro, 19/11/2026: «el que arma el pedido tiene que
  // poder modificar artículos por falta de stock»): queda lo que hay, sale del
  // pedido o va otro en su lugar. El total se corrige solo en el servidor.
  async function resolverFalta(it: ItemArmado, d: { hay: number; reemplazo: { id: string; nombre: string } | null; cantidad: number | null; variedades?: string[]; avisar?: boolean }) {
    const r = await enviar({
      accion: 'falta', pedidoId: p.id, productoId: it.productoId, hay: d.hay, reemplazoId: d.reemplazo?.id ?? null, cantidad: d.reemplazo ? d.cantidad : null,
      ...(d.variedades?.length ? { variedades: d.variedades, pedida: it.aclaracion ?? undefined } : {}), ...(d.avisar ? { avisar: true } : {}),
    });
    setFalta(null);
    // «Tengo parecido» y la otra variedad: quedan para consultar; el pedido todavía no cambia
    if (r?.propuesto) {
      avisar('ok', r.variedad
        ? `Guardado: ${it.nombre}${r.pedida ? ` (no hay ${r.pedida})` : ''} → ${(r.variedades ?? []).join(', ')}. Tocá «Consultar al cliente».`
        : `Guardado: ${it.nombre} → ${numero(Number(r.cantidad), 2)} × ${r.reemplazo}. Al terminar, consultale al cliente.`);
      await onCambio();
      return;
    }
    const partes = [d.hay > 0 ? `${it.nombre}: quedan ${numero(d.hay, 2)}` : `${it.nombre} salió del pedido`];
    // no había otra: se le avisó al cliente (o por qué no)
    if (d.avisar) partes.push(r?.avisado ? 'le avisé al cliente por WhatsApp' : String(r?.motivo ?? 'no le pude avisar: avisale vos'));
    if (r?.puso) partes.push(`va ${numero(r.puso.cantidad, 2)} × ${r.puso.nombre}`);
    if (r?.totalAntes != null && r?.total != null && Number(r.totalAntes) !== Number(r.total)) partes.push(`total ${pesos(r.totalAntes)} → ${pesos(r.total)}`);
    avisar('ok', partes.join(' · '));
    await onCambio();
    if (r?.pagado) {
      await confirmar({
        titulo: 'El pedido ya estaba pagado',
        texto: `Se pagó ${pesos(r.totalAntes)} y ahora el pedido es de ${pesos(r.total)}. Avisale a la caja para que arregle la diferencia con el cliente.`,
        textoConfirmar: 'Entendido',
      });
    }
  }

  /** «Consultar al cliente»: sale el WhatsApp del primer cambio; los demás, de a uno, con cada respuesta. */
  async function consultar() {
    setConsultando(true);
    try {
      const r = await enviar({ accion: 'consultar', pedidoId: p.id });
      if (r?.enviado) avisar('ok', `Le mandé la consulta por WhatsApp${r.cambios > 1 ? ` (de a uno, son ${r.cambios})` : ''}. Te aviso cuando conteste.`);
      // de noche queda en cola y sale a las 8: no es un error
      else if (!r?.motivo || /a las 8/.test(String(r.motivo))) avisar('ok', r?.motivo ?? 'Quedó en cola para mandarle la consulta.');
      else avisar('error', String(r.motivo));
      await onCambio();
    } catch (e: any) {
      const texto = String(e?.message ?? 'No pude mandar la consulta');
      if (/WhatsApp del cliente/.test(texto)) setSinWhatsapp(true);
      avisar('error', texto);
    }
    finally { setConsultando(false); }
  }

  /** Lo que le dijo el cliente por otro lado (lo llamó, vino al local). */
  async function anotar(c: CambioArmado, acepta: boolean, elegida?: string) {
    const variedad = c.tipo === 'variedad';
    const va = variedad ? `${c.falta} (${elegida ?? ''})` : conCantidad(c.cantidad, c.reemplazo, c.reemplazoPorPeso);
    if (!(await confirmar({
      titulo: variedad ? (acepta ? `¿El cliente eligió ${elegida}?` : '¿El cliente no quiere ninguna?') : acepta ? '¿El cliente dijo que SÍ?' : '¿El cliente dijo que NO?',
      texto: variedad
        ? acepta ? `Va ${c.falta} de ${elegida}${c.pedida ? ` en lugar de ${c.pedida}` : ''}.` : `${c.falta} sale del pedido.`
        : acepta ? `Entra ${va} en lugar de ${c.hay > 0 ? `lo que falta de ${c.falta} (queda en ${cantidadDe(c.hay, c.faltaPorPeso)})` : c.falta}.` : `${c.falta} ${c.hay > 0 ? `queda en ${cantidadDe(c.hay, c.faltaPorPeso)}` : 'sale del pedido'} y no va ${c.reemplazo}.`,
      textoConfirmar: variedad ? (acepta ? `Sí, eligió ${elegida}` : 'Sí, ninguna') : acepta ? 'Sí, dijo que sí' : 'Sí, dijo que no',
    }))) return;
    try {
      const r = await enviar({ accion: 'decidir-cambio', pedidoId: p.id, cambioId: c.id, acepta, ...(elegida ? { elegida } : {}) });
      avisar(r?.error ? 'error' : 'ok', r?.error ? `Anotado, pero no pude cambiar el pedido: ${r.error}` : acepta ? `Anotado: va ${va}` : variedad ? `Anotado: ${c.falta} sale del pedido` : `Anotado: no va ${c.reemplazo}`);
      await onCambio();
    } catch (e: any) { avisar('error', String(e?.message ?? 'No pude anotarlo')); }
  }

  async function quitar(c: CambioArmado) {
    try { await enviar({ accion: 'anular-cambio', pedidoId: p.id, cambioId: c.id }); avisar('ok', `Saqué el parecido de ${c.falta}`); await onCambio(); }
    catch (e: any) { avisar('error', String(e?.message ?? 'No pude sacarlo')); }
  }

  async function terminar() {
    if (faltan.length && !(await confirmar({
      titulo: `Faltan ${faltan.length} producto${faltan.length === 1 ? '' : 's'}`,
      texto: `${faltan.map((i) => i.nombre).slice(0, 4).join(', ')}${faltan.length > 4 ? '…' : ''}. Si no hay, tocá el producto y elegí «No hay en la góndola» (ahí podés ofrecer un parecido). ¿Lo finalizás igual?`,
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
    if (manual || falta) return;
    const t = setInterval(() => {
      const activo = document.activeElement;
      if (!activo || activo === document.body) lector.current?.focus({ preventScroll: true });
    }, 1200);
    return () => clearInterval(t);
  }, [manual, falta]);

  async function leerFoto(archivo?: File | null) {
    if (!archivo) return;
    setLeyendoFoto(true);
    try {
      const c = await codigoDeFoto(archivo);
      if (c) await sumar({ codigo: c, cantidad: 1 });
      else avisar('error', 'No encontré el código en la foto. Sacala de más cerca, con luz y con el código derecho.');
    } catch (e) {
      // con el motivo a la vista: si se repite, se sabe qué es (20/11/2026)
      avisar('error', `No pude leer la foto (${motivoDe(e) || 'sin detalle'}). Probá de nuevo o tocá «Recargar».`);
      console.warn('lector de códigos, foto:', e);
    }
    finally {
      setLeyendoFoto(false);
      if (campoFoto.current) campoFoto.current.value = '';
      setVueltaCamara((n) => n + 1);
    }
  }

  const cerrado = !!manual || terminando || leyendoFoto;
  // las sugerencias de «Tengo parecido» del producto que falta (una función estable: la ventanita las pide al abrir)
  const faltaId = falta?.productoId ?? null;
  const parecidosDeLaFalta = useMemo(() => (faltaId ? (faltan: number) => traerParecidos(p.id, faltaId, faltan) : undefined), [p.id, faltaId]);
  const enFranja = ultimo ? items.find((i) => i.productoId === ultimo) ?? null : null;
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

      {hayVersion && (
        <button type="button" onClick={() => window.location.reload()} className="bg-atencion-suave px-4 py-2 text-left text-sm font-semibold text-tinta">
          Hay una versión nueva del sistema · Tocá acá para actualizar (no perdés lo cargado)
        </button>
      )}

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
        {camara && <Camara key={vueltaCamara} pausada={cerrado} onCodigo={alLeer} onError={() => setCamara(false)} onFoto={() => campoFoto.current?.click()} />}
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
        {/* el último que se tocó: se corrige acá mismo, de a uno, o se completa */}
        {enFranja && (() => {
          const i = enFranja;
          const entero = Number.isInteger(i.cantidad) && Number.isInteger(i.enCarro);
          const resto = redondo(i.cantidad - i.enCarro);
          const completo = resto <= 0;
          const repetido = !completo && ahora - repetidoEn < 3500;
          return (
            <div className={unir('mt-2 rounded-xl border px-3 py-2', completo ? 'border-black/10 bg-crema-claro' : repetido ? 'border-ok bg-ok-suave ring-2 ring-ok/30' : 'border-ok/25 bg-ok-suave')}>
              <p className="truncate text-sm font-semibold text-tinta">{i.nombre}</p>
              <Aclaracion texto={i.aclaracion} />
              {repetido && <p className="mt-0.5 text-xs font-semibold text-ok">Ese ya lo conté. Si es otro igual, tocá +</p>}
              <div className="mt-1.5 flex items-center gap-2">
                {entero && (
                  <Boton tamano="chico" variante="secundario" className="min-w-11 text-lg leading-none" disabled={i.enCarro <= 0} onClick={() => fijar(i, i.enCarro - 1)} aria-label={`Sacar uno de ${i.nombre}`}>−</Boton>
                )}
                <button type="button" onClick={() => setManual(i)} aria-label={`Poner otra cantidad de ${i.nombre}`}
                  className="importe min-w-0 flex-1 rounded-lg px-1 py-1.5 text-center text-sm text-tinta underline decoration-dotted underline-offset-4">
                  llevás <b className="text-base">{numero(i.enCarro, 2)}</b> de {numero(i.cantidad, 2)}
                </button>
                {entero && !completo && (
                  <Boton tamano="chico" variante={repetido ? 'ok' : 'secundario'} className="min-w-11 text-lg leading-none" onClick={() => sumar({ productoId: i.productoId, cantidad: 1 })} aria-label={`Sumar uno de ${i.nombre}`}>+</Boton>
                )}
                {(resto > 1 || (!entero && !completo)) && (
                  <Boton tamano="chico" variante={repetido ? 'secundario' : 'ok'} onClick={() => fijar(i, i.cantidad)}>
                    {entero ? `Poner los ${numero(i.cantidad, 2)}` : `Poner ${numero(i.cantidad, 2)}`}
                  </Boton>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* lo que falta (tocar = carga manual) y lo que ya está */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {p.notas && <p className="mb-3 whitespace-pre-wrap rounded-lg bg-atencion-suave px-3 py-2 text-sm text-tinta"><b>Nota:</b> {p.notas}</p>}
        {cambios.length > 0 && <CambiosConElCliente cambios={cambios} ahora={ahora} aMano={sinWhatsapp} onAnotar={anotar} onQuitar={quitar} />}
        <ul className="space-y-2">
          {faltan.map((i) => {
            const resto = i.cantidad - i.enCarro;
            return (
              <li key={i.productoId}>
                <button type="button" onClick={() => setManual(i)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm active:scale-[0.99]">
                  <span className="importe grid size-14 shrink-0 place-items-center rounded-xl bg-marca text-xl font-bold text-white">{numero(resto, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-tight text-tinta">{i.nombre}</span>
                    <Aclaracion texto={i.aclaracion} />
                    <span className="mt-1 block text-xs text-tinta/60">
                      {i.ubicacion ? <b className="font-semibold text-dato-3">{i.ubicacion}</b> : 'Sin lugar cargado'}
                      {i.enCarro > 0 && ` · llevás ${numero(i.enCarro, 2)} de ${numero(i.cantidad, 2)}`}
                    </span>
                    {!cambioAbierto.get(i.productoId) && i.hayEnSistema != null && i.hayEnSistema < i.cantidad && (
                      <span className="mt-1 block text-xs font-semibold text-marca">
                        {i.hayEnSistema > 0 ? `El sistema dice que hay ${numero(i.hayEnSistema, 2)}` : 'El sistema dice que no hay'}: fijate y, si no está, «No hay»
                      </span>
                    )}
                    {cambioAbierto.get(i.productoId) && (() => {
                      const c = cambioAbierto.get(i.productoId)!;
                      return (
                        <span className="mt-1 block text-xs font-semibold text-dato-3">
                          Parecido: {conCantidad(c.cantidad, c.reemplazo, c.reemplazoPorPeso)} · {c.estado === 'propuesto' ? 'para consultar' : 'esperando al cliente'}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="shrink-0 text-xs text-tinta/50">Tocar para<br />poner cantidad</span>
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
                    <Boton tamano="chico" variante="fantasma" onClick={() => setManual(i)}>Cambiar</Boton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        {propuestos.length > 0 ? (
          <Boton anchoCompleto onClick={consultar} cargando={consultando}>
            Consultar al cliente {propuestos.length === 1 ? 'el cambio' : `los ${propuestos.length} cambios`}
          </Boton>
        ) : esperando.length > 0 ? (
          <Boton variante="secundario" anchoCompleto disabled>
            Esperando que el cliente conteste ({cambios.filter((c) => c.consultadoEn && !c.cerradoEn && !ABIERTO.includes(c.estado)).length} de {cambios.filter((c) => c.consultadoEn && !c.cerradoEn).length})
          </Boton>
        ) : (
          <Boton variante={faltan.length ? 'secundario' : 'ok'} anchoCompleto onClick={terminar} cargando={terminando}>
            {faltan.length ? `Finalizar (faltan ${faltan.length})` : p.canal === 'domicilio' ? 'Finalizar: listo para salir' : 'Finalizar: a la mesa de retiro'}
          </Boton>
        )}
      </div>

      {manual && <CantidadEnCarro item={items.find((i) => i.productoId === manual.productoId) ?? manual} onCerrar={() => setManual(null)} onFijar={(total) => { const it = manual; setManual(null); fijar(it, total); }}
        onFalta={() => { const it = items.find((i) => i.productoId === manual.productoId) ?? manual; setManual(null); setFalta(it); }} />}
      {falta && <FaltaEnGondola item={falta} onCerrar={() => setFalta(null)} onListo={(d) => resolverFalta(falta, d)} buscarParecidos={parecidosDeLaFalta} conCliente pedida={falta.aclaracion ?? null} sugerencias={falta.variedades ?? []} />}
      {desconocido && (
        <Modal abierto onCerrar={() => { callados.current.set(desconocido, Date.now() + 30_000); setDesconocido(null); }} ancho="chico" titulo="Ese código no está en el sistema"
          descripcion={`Leí ${desconocido}. Si es uno de estos, tocalo: va al carro y el código queda guardado para la próxima vez (y para la caja).`}
          pie={<Boton variante="secundario" onClick={() => { callados.current.set(desconocido, Date.now() + 30_000); setDesconocido(null); }}>No es ninguno</Boton>}>
          {faltan.length ? (
            <ul className="space-y-2">
              {faltan.map((i) => (
                <li key={i.productoId}>
                  <button type="button" className="w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-left active:bg-crema-claro"
                    onClick={async () => {
                      const codigo = desconocido;
                      setDesconocido(null);
                      const r = await sumar({ codigo, productoId: i.productoId, cantidad: 1, aprender: true });
                      if (r === 'sumado') avisar('ok', `Listo: ese código ahora es ${i.nombre}`);
                    }}>
                    <span className="block font-semibold leading-tight text-tinta">{i.nombre}</span>
                    <Aclaracion texto={i.aclaracion} />
                    <span className="mt-0.5 block text-xs text-tinta/60">Faltan {numero(redondo(i.cantidad - i.enCarro), 2)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-tinta/70">Ya está todo en el carro: ese producto no es de este pedido.</p>}
        </Modal>
      )}
    </div>
  );
}

/**
 * Los cambios con el cliente (20/11/2026): cada parecido con su estado. Lo que
 * espera respuesta se puede anotar a mano (el cliente llamó o vino al local);
 * lo propuesto se puede sacar antes de consultar. Lo contestado queda en verde.
 */
function CambiosConElCliente({ cambios, ahora, aMano, onAnotar, onQuitar }: {
  cambios: CambioArmado[]; ahora: number;
  /** sin WhatsApp del cliente: lo propuesto también se anota a mano */
  aMano: boolean;
  onAnotar: (c: CambioArmado, acepta: boolean, elegida?: string) => void; onQuitar: (c: CambioArmado) => void;
}) {
  const minutos = (desde: string | null) => desde ? Math.max(0, Math.floor((ahora - Date.parse(desde)) / 60_000)) : 0;
  const respondidos = cambios.filter((c) => c.estado === 'aceptado' || c.estado === 'rechazado');
  const hayPreguntado = cambios.some((c) => c.estado === 'preguntado');
  // de 22 a 8 no se le escribe a nadie (hora de Buenos Aires)
  const hora = Number(new Date(ahora).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })) % 24;
  const deNoche = hora >= 22 || hora < 8;
  const todosContestados = respondidos.length === cambios.length;
  return (
    <section className={unir('mb-3 rounded-2xl border p-3', todosContestados ? 'border-ok/30 bg-ok-suave/60' : 'border-dato-3/25 bg-white')}>
      <p className="text-sm font-bold text-tinta">
        {todosContestados ? (respondidos.some((c) => c.porWhatsapp) ? 'El cliente contestó los cambios' : 'Cambios anotados') : 'Cambios con el cliente'}
      </p>
      <ul className="mt-2 space-y-2">
        {cambios.map((c) => {
          const min = minutos(c.preguntadoEn);
          // NO HAY ESE SABOR; DE ESE HAY ESTOS (20/11/2026)
          if (c.tipo === 'variedad') {
            const opciones = c.variedades ?? [];
            const anotarCual = (c.estado === 'preguntado' || c.estado === 'en_cola' || (c.estado === 'propuesto' && aMano));
            return (
              <li key={c.id} className="rounded-xl bg-crema-claro/70 px-3 py-2">
                <p className="text-sm text-tinta">
                  {c.estado === 'aceptado' ? <b className="text-ok">✔ {String(c.elegida ?? '').toUpperCase()}</b> : c.estado === 'rechazado' ? <b className="text-marca">✖ NINGUNA</b> : null}
                  {c.estado === 'aceptado' || c.estado === 'rechazado' ? ' · ' : ''}
                  <span className="font-semibold">{c.falta}</span>
                  {c.pedida ? <> · no hay <b>{c.pedida}</b></> : null}
                  {c.estado !== 'aceptado' && c.estado !== 'rechazado' && <> → ¿{opciones.join(', ')}?</>}
                </p>
                <p className="mt-0.5 text-xs text-tinta/70">
                  {c.estado === 'propuesto' && 'Para consultar'}
                  {c.estado === 'en_cola' && (c.ultimoError ? `Todavía no salió: ${c.ultimoError}` : hayPreguntado ? 'Sale después de la respuesta anterior' : deNoche ? 'Le sale a las 8: de noche no se le escribe a nadie' : 'Saliendo por WhatsApp…')}
                  {c.estado === 'preguntado' && `Esperando que elija · le escribí hace ${min} min${min >= 10 ? '. Si no contesta, llamalo.' : ''}`}
                  {c.estado === 'aceptado' && `${c.porWhatsapp ? 'Lo eligió por WhatsApp' : 'Anotado a mano'}: armalo de ${c.elegida}.`}
                  {c.estado === 'rechazado' && 'No quiso ninguna: sale del pedido.'}
                </p>
                {c.error && <p className="mt-1 text-xs font-semibold text-marca">No pude anotarlo en el pedido: {c.error}. Avisale a la caja.</p>}
                {c.estado === 'preguntado' && c.otraRespuesta && (
                  <p className="mt-1 rounded-lg bg-atencion-suave px-2 py-1 text-xs text-tinta">Escribió: «{c.otraRespuesta}»</p>
                )}
                {anotarCual && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {opciones.map((v) => <Boton key={v} tamano="chico" variante="secundario" onClick={() => onAnotar(c, true, v)}>Eligió {v}</Boton>)}
                    <Boton tamano="chico" variante="secundario" onClick={() => onAnotar(c, false)}>Ninguna</Boton>
                  </div>
                )}
                {c.estado === 'propuesto' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Boton tamano="chico" variante="fantasma" onClick={() => onQuitar(c)}>Sacar la consulta</Boton>
                  </div>
                )}
              </li>
            );
          }
          const va = conCantidad(c.cantidad, c.reemplazo, c.reemplazoPorPeso);
          return (
            <li key={c.id} className="rounded-xl bg-crema-claro/70 px-3 py-2">
              <p className="text-sm text-tinta">
                {c.estado === 'aceptado' ? <b className="text-ok">✔ SÍ</b> : c.estado === 'rechazado' ? <b className="text-marca">✖ NO</b> : null}
                {c.estado === 'aceptado' || c.estado === 'rechazado' ? ' · ' : ''}
                <span className="font-semibold">{c.falta}</span> → {va}
                {c.precio != null && <span className="importe text-tinta/60"> ({pesos(c.cantidad * c.precio)})</span>}
              </p>
              <p className="mt-0.5 text-xs text-tinta/70">
                {c.estado === 'propuesto' && 'Para consultar'}
                {c.estado === 'en_cola' && (c.ultimoError ? `Todavía no salió: ${c.ultimoError}` : hayPreguntado ? 'Sale después de la respuesta anterior' : deNoche ? 'Le sale a las 8: de noche no se le escribe a nadie' : 'Saliendo por WhatsApp…')}
                {c.estado === 'preguntado' && `Esperando respuesta · le escribí hace ${min} min${min >= 10 ? '. Si no contesta, llamalo.' : ''}`}
                {c.estado === 'aceptado' && (c.porWhatsapp ? 'Lo aceptó por WhatsApp. Sumalo al carro.' : 'Anotado a mano. Sumalo al carro.')}
                {c.estado === 'rechazado' && (c.hay > 0 ? `No lo quiso: queda en ${cantidadDe(c.hay, c.faltaPorPeso)}.` : 'No lo quiso: sale del pedido.')}
              </p>
              {c.error && <p className="mt-1 text-xs font-semibold text-marca">No pude cambiar el pedido: {c.error}. Avisale a la caja.</p>}
              {c.estado === 'preguntado' && c.otraRespuesta && (
                <p className="mt-1 rounded-lg bg-atencion-suave px-2 py-1 text-xs text-tinta">Escribió: «{c.otraRespuesta}»</p>
              )}
              {(c.estado === 'preguntado' || c.estado === 'en_cola') && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Boton tamano="chico" variante="secundario" onClick={() => onAnotar(c, true)}>Me dijo que sí</Boton>
                  <Boton tamano="chico" variante="secundario" onClick={() => onAnotar(c, false)}>Me dijo que no</Boton>
                </div>
              )}
              {c.estado === 'propuesto' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {aMano && <Boton tamano="chico" variante="secundario" onClick={() => onAnotar(c, true)}>Me dijo que sí</Boton>}
                  {aMano && <Boton tamano="chico" variante="secundario" onClick={() => onAnotar(c, false)}>Me dijo que no</Boton>}
                  <Boton tamano="chico" variante="fantasma" onClick={() => onQuitar(c)}>Sacar el parecido</Boton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cuánto hay de ese producto en el carro, EN TOTAL (19/11/2026: antes el número
 *  era «cuánto sumar» y no había forma de bajar: con 3 cargados de más, quedaban).
 *  Sirve para lo que no tiene código y para corregir. */
function CantidadEnCarro({ item, onCerrar, onFijar, onFalta }: { item: ItemArmado; onCerrar: () => void; onFijar: (total: number) => void; onFalta: () => void }) {
  const entero = Number.isInteger(item.cantidad) && Number.isInteger(item.enCarro);
  const [valor, setValor] = useState(numero(item.cantidad, 3).replace(/\./g, ''));
  const total = Number(valor.replace(',', '.'));
  const valida = valor !== '' && Number.isFinite(total) && total >= 0 && total <= item.cantidad + 1e-9;
  const base = Number.isFinite(total) ? total : 0;
  return (
    <Modal abierto onCerrar={onCerrar} ancho="chico" titulo={item.nombre}
      descripcion={`Pide ${numero(item.cantidad, 2)}${item.enCarro > 0 ? ` · ahora llevás ${numero(item.enCarro, 2)}` : ''}${item.ubicacion ? ` · ${item.ubicacion}` : ''}`}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={() => onFijar(total)} disabled={!valida}>{valida && total === 0 ? 'Sacar del carro' : 'Guardar'}</Boton>
      </>}>
      <p className="mb-2 text-sm text-tinta/70">¿Cuánto va en el carro <b className="font-semibold text-tinta">en total</b>?</p>
      <div className="flex items-center gap-3">
        {entero && <Boton variante="secundario" onClick={() => setValor(String(Math.max(0, base - 1)))} aria-label="Uno menos">−</Boton>}
        <Entrada autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Cantidad en el carro, en total" className="importe flex-1 text-center text-2xl font-bold" />
        {entero && <Boton variante="secundario" onClick={() => setValor(String(Math.min(item.cantidad, base + 1)))} aria-label="Uno más">+</Boton>}
      </div>
      {!valida && valor !== '' && <Aviso tono="atencion" className="mt-3">Poné una cantidad entre 0 y {numero(item.cantidad, 2)}.</Aviso>}
      {item.enCarro < item.cantidad && (
        <Boton variante="secundario" anchoCompleto className="mt-4" onClick={onFalta}>No hay en la góndola (o hay menos)</Boton>
      )}
    </Modal>
  );
}

/** La cámara siempre abierta, leyendo códigos uno atrás del otro. */
/** El código de una foto sacada con la cámara del teléfono (iPhone, 19/11/2026:
 *  «no lee el código desde iphone»: la cámara del navegador no enfoca de cerca;
 *  la del iPhone sí). Se achica a 2000 px para que el lector no tarde. */
async function codigoDeFoto(archivo: File): Promise<string | null> {
  let det = await lectorDeCodigos();
  if (!det) throw new Error('no cargó el lector de códigos (¿sin internet?)');
  type Fuente = { ancho: number; alto: number; dibujar: (c: CanvasRenderingContext2D, w: number, h: number) => void; soltar: () => void };
  const conImagen = async (): Promise<Fuente> => {
    const url = URL.createObjectURL(archivo);
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('no pude abrir la foto')); i.src = url; });
    return { ancho: img.naturalWidth, alto: img.naturalHeight, dibujar: (c, w, h) => c.drawImage(img, 0, 0, w, h), soltar: () => URL.revokeObjectURL(url) };
  };
  let fuente: Fuente;
  // si la foto no se abre de una forma (HEIC del iPhone, por ejemplo), se prueba la otra
  try {
    if (typeof createImageBitmap !== 'function') throw new Error('sin createImageBitmap');
    const bmp = await createImageBitmap(archivo);
    fuente = { ancho: bmp.width, alto: bmp.height, dibujar: (c, w, h) => c.drawImage(bmp, 0, 0, w, h), soltar: () => bmp.close?.() };
  } catch { fuente = await conImagen(); }
  const escala = Math.min(1, 2000 / Math.max(fuente.ancho, fuente.alto, 1));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(fuente.ancho * escala));
  lienzo.height = Math.max(1, Math.round(fuente.alto * escala));
  fuente.dibujar(lienzo.getContext('2d')!, lienzo.width, lienzo.height);
  fuente.soltar();
  // si el lector falla, se reinicia una vez y se vuelve a probar (el motor pudo haber quedado roto)
  let r: any;
  try { r = await det.detect(lienzo); }
  catch {
    det = await lectorDeCodigos(true);
    if (!det) throw new Error('no cargó el lector de códigos (¿sin internet?)');
    r = await det.detect(lienzo);
  }
  return r?.[0]?.rawValue ? String(r[0].rawValue) : null;
}

function Camara({ pausada, onCodigo, onError, onFoto }: { pausada: boolean; onCodigo: (c: string) => void; onError: () => void; onFoto: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'sin-lector' | 'sin-permiso'>('abriendo');
  const [motivo, setMotivo] = useState('');
  const pausadaRef = useRef(pausada);
  pausadaRef.current = pausada;
  const onCodigoRef = useRef(onCodigo);
  onCodigoRef.current = onCodigo;

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    let t: any;
    (async () => {
      let det = await lectorDeCodigos();
      if (!vivo) return;
      if (!det) { setMotivo('no cargó el lector de códigos (¿sin internet?)'); setEstado('sin-lector'); return; }
      let reiniciado = false;
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
              // avisa cada lectura: si cuenta o no lo decide la pantalla (nunca dos veces el mismo)
              if (c) onCodigoRef.current(c);
              fallas = 0;
            } catch (e) {
              if (++fallas >= 25) {
                // antes de rendirse, el lector se vuelve a cargar de cero una vez (20/11/2026)
                const nuevo = !reiniciado ? await lectorDeCodigos(true).catch(() => null) : null;
                if (!vivo) return;
                if (nuevo) { det = nuevo; reiniciado = true; fallas = 0; }
                else { setMotivo(motivoDe(e)); console.warn('lector de códigos, cámara:', e); setEstado('sin-lector'); return; }
              }
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
        {/* recargar arranca el lector de cero (lo cargado en el carro no se pierde) */}
        {estado === 'sin-lector' && <Boton tamano="chico" variante="secundario" onClick={() => window.location.reload()}>Recargar</Boton>}
        <Boton tamano="chico" variante="secundario" onClick={onError}>Cerrar</Boton>
      </>}>
        {estado === 'sin-permiso'
          ? 'No pude abrir la cámara en vivo. Sacale una foto al código y lo leo de la foto, o dale permiso de cámara a esta página.'
          : <>El lector de códigos se trabó. Tocá <b>Recargar</b> (lo que está en el carro no se pierde) o sacale una foto al código.{motivo ? <span className="mt-1 block text-xs text-tinta/60">Motivo: {motivo}</span> : null}</>}
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
