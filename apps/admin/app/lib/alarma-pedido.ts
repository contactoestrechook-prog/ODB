// LA ALARMA DEL PEDIDO NUEVO (Leandro, 4/11/2026: "agregarle un sonido muy
// potente"; y enseguida: "es muy teléfono: que al principio suene más bajo y a
// medida que pasa el tiempo vaya sonando más alto y con menos espacio").
// Es una campana (no un timbre de teléfono) que crece con lo que lleva el pedido
// sin tomar: al entrar, un toque bajo cada 12 segundos; a los 6 minutos, tres
// toques al máximo cada 2 segundos. La ventana «Llegó un pedido» la repite
// hasta que alguien toca «Lo tomo».
//
// El navegador no deja sonar nada hasta que la persona tocó algo en la página,
// salvo que Chrome se abra con --autoplay-policy=no-user-gesture-required (el
// acceso directo «ODB Pedidos» de las PC con impresora lo trae).

/** En cuánto llega al máximo, contado desde que entró el pedido. */
export const SUBE_EN_MS = 6 * 60_000;
const ESPERA_AL_ENTRAR_MS = 12_000;
const ESPERA_AL_MAXIMO_MS = 2_000;

let audio: AudioContext | null = null;
const avisos = new Set<() => void>();

/** Crea el contexto de audio y lo despierta con el primer toque o tecla. */
export function prepararAudio() {
  if (typeof window === 'undefined') return;
  if (!audio) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
    audio.onstatechange = () => avisos.forEach((f) => f());
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

/** 0 al entrar el pedido, 1 a los 6 minutos (y de ahí en más). */
export const nivelDe = (msSinTomar: number) => Math.min(1, Math.max(0, msSinTomar / SUBE_EN_MS));

/** Cuánto esperar hasta el próximo toque: de 12 s al entrar a 2 s al máximo. */
export const esperaDe = (nivel: number) => Math.round(ESPERA_AL_ENTRAR_MS - (ESPERA_AL_ENTRAR_MS - ESPERA_AL_MAXIMO_MS) * nivel);

// Un golpe de campana: la nota y dos parciales arriba, ataque seco y se apaga
// sola en casi un segundo. Arriba de la mitad, la nota base pasa a triangular:
// más brillante, se oye por encima del ruido del local.
function golpe(ctx: AudioContext, desde: number, frec: number, vol: number, brillante: boolean) {
  const DURA = 0.9;
  const salida = ctx.createGain();
  salida.gain.setValueAtTime(0.0001, desde);
  salida.gain.exponentialRampToValueAtTime(vol, desde + 0.006);
  salida.gain.exponentialRampToValueAtTime(0.0001, desde + DURA);
  salida.connect(ctx.destination);
  const parciales: [number, number, OscillatorType][] = [[1, 0.62, brillante ? 'triangle' : 'sine'], [2.01, 0.26, 'sine'], [3.01, 0.12, 'sine']];
  for (const [multiplo, peso, tipo] of parciales) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frec * multiplo;
    g.gain.value = peso;
    osc.connect(g).connect(salida);
    osc.start(desde);
    osc.stop(desde + DURA + 0.05);
  }
}

// mi, la, do#: sube, se lee como "atención" y no como un teléfono
const NOTAS = [1318.5, 1760, 2217.5];

/** Un toque de la alarma: con nivel 0, una campanada baja; con 1, tres al máximo. */
export function sonarAlarma(nivel = 1) {
  if (!audio) prepararAudio();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => null);
  const n = Math.min(1, Math.max(0, nivel));
  const vol = 0.12 + 0.83 * n;
  const golpes = 1 + Math.round(n * 2);
  const t0 = audio.currentTime + 0.03;
  for (let i = 0; i < golpes; i++) golpe(audio, t0 + i * 0.22, NOTAS[i], vol, n > 0.5);
}

/** «Probar la alarma»: cómo suena al entrar, a los 3 minutos y a los 6. */
export function probarAlarma() {
  prepararAudio();
  sonarAlarma(0);
  setTimeout(() => sonarAlarma(0.5), 1600);
  setTimeout(() => sonarAlarma(1), 3400);
}
