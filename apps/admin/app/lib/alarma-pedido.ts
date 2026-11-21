// LA ALARMA DE LOS PEDIDOS — REGLA CON CANDADO (Leandro, 21/11/2026: «necesito que
// todos los pop-ups de ODB de pedido hagan un ruido escandaloso en todas las
// máquinas, sin excepción, con candado esta regla»).
//
// Una sola alarma para TODOS los avisos de pedido (Llegó un pedido, Te toca armar,
// fiambrería, lo que pregunta quien arma, la pregunta de un cliente, el pedido sin
// aviso, el armado que se abre solo, la respuesta del cliente en el armado). Suena al
// MÁXIMO desde el primer toque — ya no arranca bajito ni crece con el tiempo (lo del
// 4/11 queda reemplazado) — y se repite cada ALARMA.entreToquesMs hasta que alguien
// atiende el aviso. No se puede bajar ni callar desde la pantalla.
//
// EL CANDADO: apps/api/src/pedidos/alarma-escandalosa.spec.ts. Si alguien baja el
// volumen, espacia los toques, agrega un aviso de pedido que no usa esta alarma o le
// pone una excepción (otra sucursal, otro rol, «Más tarde»), las pruebas fallan y no
// se publica. Cambiar la regla es decisión de Leandro, no de una sesión.
//
// El navegador no deja sonar nada hasta que la persona tocó algo en la página, salvo
// que Chrome se abra con --autoplay-policy=no-user-gesture-required (el acceso directo
// «ODB Pedidos» de las PC con impresora lo trae). Para eso está «Activá el sonido de
// los pedidos» (ui/AvisoSonidoApagado) en todas las pantallas de todas las máquinas.

/** Lo que el candado controla. No se toca sin que lo diga Leandro. */
export const ALARMA = {
  /** volumen de cada golpe: el máximo (1) desde el primer toque */
  volumen: 1,
  /** cuánto se empuja contra el compresor: más fuerte sin romper el sonido */
  empuje: 2.4,
  /** golpes por toque (mi, la, do# y vuelta a la) */
  golpesPorToque: 4,
  /** entre un toque y el siguiente, mientras el aviso espera */
  entreToquesMs: 2_000,
  /** los avisos que se ven en la pantalla en la que ya se está trabajando (el armado que se abre solo, la respuesta del cliente) suenan esta cantidad de toques seguidos */
  toquesAlLlegar: 4,
} as const;

let audio: AudioContext | null = null;
let salida: AudioNode | null = null;
const avisos = new Set<() => void>();

/** Crea el contexto de audio y lo despierta con el primer toque o tecla. */
export function prepararAudio() {
  if (typeof window === 'undefined') return;
  if (!audio) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
    audio.onstatechange = () => avisos.forEach((f) => f());
    // todo pasa por un compresor: se puede empujar arriba del máximo sin que se rompa,
    // y el oído lo siente bastante más fuerte que una campana suelta
    const comp = audio.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.12;
    comp.connect(audio.destination);
    const empuje = audio.createGain();
    empuje.gain.value = ALARMA.empuje;
    empuje.connect(comp);
    salida = empuje;
  }
  if (audio.state === 'suspended') audio.resume().catch(() => null);
}

/** ¿Puede sonar ya? false hasta el primer toque, si Chrome no se abrió con el acceso directo. */
export const audioActivo = () => audio?.state === 'running';

/** Para enterarse cuando el audio se despierta (o se duerme). */
export function alCambiarAudio(f: () => void): () => void {
  avisos.add(f);
  return () => { avisos.delete(f); };
}

// Un golpe: la nota en triangular (brillante), una cuadrada una octava arriba que la
// hace áspera (se oye por encima del ruido del local) y dos parciales de campana.
function golpe(ctx: AudioContext, destino: AudioNode, desde: number, frec: number) {
  const DURA = 0.55;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, desde);
  env.gain.exponentialRampToValueAtTime(ALARMA.volumen, desde + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, desde + DURA);
  env.connect(destino);
  const parciales: [number, number, OscillatorType][] = [[1, 0.6, 'triangle'], [2, 0.22, 'square'], [2.01, 0.2, 'sine'], [3.01, 0.1, 'sine']];
  for (const [multiplo, peso, tipo] of parciales) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frec * multiplo;
    g.gain.value = peso;
    osc.connect(g).connect(env);
    osc.start(desde);
    osc.stop(desde + DURA + 0.05);
  }
}

// mi, la, do#, la: sube y vuelve, se lee como «atención» y no como un teléfono
const NOTAS = [1318.5, 1760, 2217.5, 1760];

/** Un toque de la alarma, al máximo: cuatro golpes seguidos. */
export function sonarEscandalo() {
  if (!audio) prepararAudio();
  if (!audio || !salida) return;
  if (audio.state === 'suspended') audio.resume().catch(() => null);
  const t0 = audio.currentTime + 0.03;
  for (let i = 0; i < ALARMA.golpesPorToque; i++) golpe(audio, salida, t0 + i * 0.15, NOTAS[i % NOTAS.length]);
  try { navigator.vibrate?.([350, 120, 350]); } catch { /* sin vibración */ }
}

/** «Probar la alarma»: dos toques, como suena de verdad. */
export function probarAlarma() {
  prepararAudio();
  sonarEscandalo();
  setTimeout(sonarEscandalo, ALARMA.entreToquesMs);
}

// ---- Qué suena (piezas puras, con prueba en el candado) ----

type PedidoParaSonar = { id: string; estado: string; tomado_por?: string | null; creado_en: string };

/** Los de las últimas 48 h que se muestran: más viejos van con «Sin tomar» en Pedidos. */
export const VENTANA_AVISO_MS = 48 * 3600_000;

/**
 * «Llegó un pedido» suena por TODOS los pedidos sin tomar, en TODAS las máquinas: sin
 * mirar la sucursal ni el rol de quien está en esa máquina, sin «Más tarde» y sin tope
 * de horas dentro de la ventana. Se calla cuando alguien lo toma.
 */
export function pedidosQueSuenan<T extends PedidoParaSonar>(lista: T[], ahora = Date.now()): T[] {
  return lista.filter((p) => !p.tomado_por && ['recibido', 'pagado'].includes(p.estado) && ahora - Date.parse(p.creado_en) < VENTANA_AVISO_MS);
}
