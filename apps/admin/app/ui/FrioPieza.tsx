'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Frío · la pieza, versión 2 (Leandro, 3/11/2026: «se ve muy mal, necesito una
// pantalla gráfica a otro nivel; fijate las imágenes de la app y superalas»).
// La v1 dependía de la historia: con minutos de datos quedaba una trama vacía.
// Esta se sostiene desde la primera medición. Cada equipo es una franja (sin
// cajas, separadas por una raya):
//   - el termómetro de luz: la escala completa del equipo pintada con la
//     herradura del perfil Ultra (índigo → cian dentro del rango, blanco en el
//     borde, salmón → rojo → rosa pasado, violeta demasiado frío); el rango
//     encendido y lo de afuera apagado; el marcador se desliza hasta la
//     temperatura y respira;
//   - el número gigante con la tendencia de los últimos 10 minutos;
//   - la curva: la escala se ajusta a lo que hay (desde la primera medición si
//     la ventana es más larga), la banda del rango como luz, la línea con el
//     color de su temperatura y resplandor; lo fuera de rango se marca abajo;
//   - la regla: pasando el mouse (o tocando) se lee la misma hora en todos.
// Sin verde ni amarillo (nunca azul con amarillo). Movimiento continuo, sin saltos.

type Equipo = { idequipo: string; codigo: string; nombre: string; minimo: number; maximo: number; demora_min: number; sucursal?: { nombre: string } | null };
type Punto = [number, number, number, number]; // minuto epoch, promedio, mínima, máxima
type Lector = { token: boolean; ultimaConsulta: string | null; ultimoError: string | null; historia: string; diasPendientes: number };
type Datos = { ahora: string; horas: number; paso: number; equipos: Equipo[]; serie: Record<string, Punto[]>; ultimas?: Record<string, { medido_en: string; temperatura: number }>; lector: Lector };
type Episodio = { tipo: 'calor' | 'frio' | 'mudo'; ini: number; fin: number; pico: number | null; abierto: boolean };

const C = {
  negro: '#0A0A0E', blanco: '#FFFFFF', gris: '#8A8B90', grisOsc: '#4A4B52', linea: '#2A2B30',
  cian: '#6BF8F4', cianLuz: '#C4FCFA', celeste: '#59A8F3', azul: '#2B5CF0', indigo: '#0E16D8', violeta: '#7B2BD0', lila: '#C9A6FF',
  rosa: '#FF2E88', rojo: '#FF2A3D', rojoNaranja: '#FF5A1F', salmon: '#FFAC8F',
};
const VENTANAS = [
  { horas: 1, rotulo: '1 H' },
  { horas: 6, rotulo: '6 H' },
  { horas: 24, rotulo: '24 H' },
  { horas: 168, rotulo: '7 DÍAS' },
  { horas: 720, rotulo: '30 DÍAS' },
];
const MUDO_MIN = 6;
const MENOS_MOV = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── color: la herradura como luz continua (p = lugar dentro del rango) ──
const PARADAS: [number, string][] = [
  [-0.6, C.violeta], [0, C.indigo], [0.3, C.azul], [0.55, C.celeste], [0.82, C.cian], [1, C.cianLuz],
  [1.12, C.blanco], [1.5, C.salmon], [2.2, C.rojoNaranja], [3.2, C.rojo], [4.5, C.rosa],
];
const rgbDe = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PARADAS_RGB = PARADAS.map(([p, h]) => [p, rgbDe(h)] as const);
function rgbEn(p: number): number[] {
  if (p <= PARADAS_RGB[0][0]) return PARADAS_RGB[0][1];
  for (let k = 1; k < PARADAS_RGB.length; k++) {
    const [p1, c1] = PARADAS_RGB[k];
    if (p <= p1) { const [p0, c0] = PARADAS_RGB[k - 1], f = (p - p0) / (p1 - p0); return c0.map((v, i) => Math.round(v + (c1[i] - v) * f)); }
  }
  return PARADAS_RGB[PARADAS_RGB.length - 1][1];
}
const lugar = (t: number, e: Equipo) => (t - e.minimo) / (e.maximo - e.minimo);
const color = (t: number, e: Equipo, a = 1) => `rgba(${rgbEn(lugar(t, e)).join(',')},${a})`;

const estadoDe = (t: number | null, e: Equipo) => (t == null ? 'mudo' : t < e.minimo ? 'frio' : t > e.maximo ? 'calor' : 'ok');
const num = (t: number, dec = 1) => t.toFixed(dec).replace('.', ',').replace('-', '−');
const grados = (t: number | null | undefined, dec = 1) => (t == null ? '—' : `${num(t, dec)} °C`);
const TZ = 'America/Argentina/Buenos_Aires';
const hhmm = (min: number) => new Date(min * 60000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const diaTxt = (min: number) => new Date(min * 60000).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: TZ });
const diaCorto = (min: number) => new Date(min * 60000).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: TZ });
const minDelDia = (min: number) => { const d = new Date(min * 60000); const [h, m] = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).split(':').map(Number); return (h % 24) * 60 + m; };
const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

function episodios(e: Equipo, pts: Punto[], paso: number): Episodio[] {
  const out: Episodio[] = [];
  let cur: Episodio | null = null;
  let prevT: number | null = null;
  const cerrar = () => { if (cur && (cur.tipo === 'mudo' || cur.fin - cur.ini + paso >= e.demora_min)) out.push(cur); cur = null; };
  for (const [t, prom, mn, mx] of pts) {
    if (prevT != null && t - prevT > Math.max(MUDO_MIN, paso * 2)) { cerrar(); out.push({ tipo: 'mudo', ini: prevT + paso, fin: t - paso, pico: null, abierto: false }); }
    const s = estadoDe(prom, e);
    if (s === 'ok') cerrar();
    else if (cur && cur.tipo === s) { cur.fin = t; cur.pico = s === 'calor' ? Math.max(cur.pico ?? mx, mx) : Math.min(cur.pico ?? mn, mn); }
    else { cerrar(); cur = { tipo: s as 'calor' | 'frio', ini: t, fin: t, pico: s === 'calor' ? mx : mn, abierto: false }; }
    prevT = t;
  }
  if (cur) { (cur as Episodio).abierto = true; cerrar(); }
  return out;
}

// Un lienzo que se mide solo y se vuelve a pintar cuando cambia lo que dibuja
function useLienzo(pintar: (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => boolean | void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fn = useRef(pintar); fn.current = pintar;
  const tam = useRef({ W: 0, H: 0 });
  const raf = useRef(0);
  const pintarYa = useCallback((t: number) => {
    const cv = ref.current; if (!cv) return false;
    const ctx = cv.getContext('2d'); if (!ctx) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return !!fn.current(ctx, tam.current.W, tam.current.H, t);
  }, []);
  const cuadro = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame((t) => { if (pintarYa(t) && !MENOS_MOV) cuadro(); });
  }, [pintarYa]);
  useEffect(() => {
    const cv = ref.current; if (!cv?.parentElement) return;
    const ro = new ResizeObserver(([e]) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      tam.current = { W: Math.floor(e.contentRect.width), H: Math.floor(e.contentRect.height) };
      cv.width = tam.current.W * dpr; cv.height = tam.current.H * dpr;
      cv.style.width = `${tam.current.W}px`; cv.style.height = `${tam.current.H}px`;
      pintarYa(performance.now()); // en el mismo cuadro: cambiar el tamaño borra el lienzo
      cuadro();
    });
    ro.observe(cv.parentElement);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [cuadro, pintarYa]);
  useEffect(() => { cuadro(); });
  return ref;
}

type Fila = {
  e: Equipo; pts: Punto[]; actual: number | null; edad: number | null; estado: string; eps: Episodio[];
  tendencia: number | null; stats: { min: number; max: number; prom: number; enRango: number } | null;
};

// ── el termómetro de luz ──
function Termometro({ f, letra }: { f: Fila; letra: string }) {
  const { e, actual, stats } = f;
  const r = e.maximo - e.minimo, lo = e.minimo - r * 0.55, hi = e.maximo + r * 0.55;
  const mostrado = useRef<number | null>(null);
  const ref = useLienzo((ctx, W, H, t) => {
    ctx.clearRect(0, 0, W, H);
    if (!H) return;
    const top = 14, bot = H - 14, alto = bot - top;
    const yDe = (v: number) => bot - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * alto;
    const x = 20, w = 18;
    // la escala: cada píxel con su color; fuera del rango, apagado
    for (let y = top; y < bot; y++) {
      const v = lo + ((bot - y) / alto) * (hi - lo);
      const dentro = v >= e.minimo && v <= e.maximo;
      ctx.fillStyle = color(v, e, dentro ? 1 : 0.28);
      ctx.fillRect(x, y, w, 1);
    }
    // bordes del rango
    ctx.font = `700 10px ${letra}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const v of [e.maximo, e.minimo]) {
      const y = Math.round(yDe(v)) + 0.5;
      ctx.fillStyle = C.blanco; ctx.fillRect(x - 6, y - 0.5, w + 12, 1);
      ctx.fillText(`${num(v, 0)}°`, x + w + 10, y);
    }
    // mínima y máxima de la ventana: dos marcas finas
    if (stats) {
      ctx.fillStyle = C.gris;
      for (const v of [stats.min, stats.max]) { const y = Math.round(yDe(v)); ctx.fillRect(x - 4, y, 3, 1); }
    }
    // el marcador: se desliza hasta la temperatura y respira
    if (actual == null) { mostrado.current = null; return; }
    const prev = mostrado.current ?? actual;
    const v = Math.abs(actual - prev) < 0.005 || MENOS_MOV ? actual : prev + (actual - prev) * 0.12;
    mostrado.current = v;
    const y = yDe(v);
    const pulso = MENOS_MOV ? 0.6 : 0.5 + 0.5 * Math.sin(t / 700);
    const g = ctx.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, 34);
    g.addColorStop(0, color(v, e, 0.55 + pulso * 0.3)); g.addColorStop(1, color(v, e, 0));
    ctx.fillStyle = g; ctx.fillRect(x - 30, y - 34, w + 60, 68);
    ctx.fillStyle = C.negro; ctx.fillRect(x - 9, y - 3, w + 18, 6);
    ctx.fillStyle = C.blanco; ctx.fillRect(x - 8, y - 1.5, w + 16, 3);
    ctx.beginPath(); ctx.moveTo(x + w + 9, y); ctx.lineTo(x + w + 15, y - 5); ctx.lineTo(x + w + 15, y + 5); ctx.closePath(); ctx.fill();
    return true; // sigue respirando
  });
  return <div className="fr-termo"><canvas ref={ref} aria-hidden="true" /></div>;
}

// ── la curva ──
function Curva({ f, desde, hasta, paso, regla, setRegla, letra }: { f: Fila; desde: number; hasta: number; paso: number; regla: number | null; setRegla: (m: number | null) => void; letra: string }) {
  const { e, pts } = f;
  const geo = useRef({ izq: 44, der: 12, top: 16, bot: 30, W: 0, H: 0 });
  const ref = useLienzo((ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    if (!W || !H) return;
    const izq = 44, der = 12, top = 16, bot = H - 30;
    geo.current = { izq, der, top, bot: 30, W, H };
    const anchoT = Math.max(1, hasta - desde);
    const xDe = (m: number) => izq + ((m - desde) / anchoT) * (W - izq - der);
    // escala vertical: ajustada a lo medido (así se ve el movimiento), con un
    // mínimo de 3 °C de alto; los bordes del rango entran si quedan cerca
    let lo = Infinity, hi = -Infinity;
    for (const [, , mn, mx] of pts) { if (mn < lo) lo = mn; if (mx > hi) hi = mx; }
    if (!Number.isFinite(lo)) { lo = e.minimo; hi = e.maximo; }
    const alto0 = Math.max(3, hi - lo);
    if (e.maximo > hi && e.maximo - hi < alto0 * 0.6) hi = e.maximo;
    if (e.minimo < lo && lo - e.minimo < alto0 * 0.6) lo = e.minimo;
    const falta = Math.max(0, 3 - (hi - lo)) / 2; lo -= falta; hi += falta;
    const aire = (hi - lo) * 0.16; lo -= aire; hi += aire;
    const yDe = (v: number) => bot - ((v - lo) / (hi - lo)) * (bot - top);

    // el fondo: la temperatura de cada altura, como luz muy tenue; fuera del rango, más viva
    for (let y = top; y < bot; y += 2) {
      const v = hi - ((y - top) / (bot - top)) * (hi - lo);
      ctx.fillStyle = color(v, e, v > e.maximo || v < e.minimo ? 0.16 : 0.06);
      ctx.fillRect(izq, y, W - izq - der, 2);
    }
    // los bordes del rango, si entran
    ctx.font = `900 9px ${letra}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    for (const [v, txt] of [[e.maximo, 'MÁX'], [e.minimo, 'MÍN']] as const) {
      if (v < lo || v > hi) continue;
      const y = Math.round(yDe(v)) + 0.5;
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(izq, y); ctx.lineTo(W - der, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(`${txt} ${num(v, 0)}°`, W - der - 2, y - 3);
    }

    // eje de grados
    ctx.font = `700 10px ${letra}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    const pasoG = [0.5, 1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 6) ?? 20;
    for (let v = Math.ceil(lo / pasoG) * pasoG; v <= hi; v += pasoG) {
      const y = Math.round(yDe(v)) + 0.5;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(izq, y, W - izq - der, 1);
      ctx.fillStyle = C.gris; ctx.fillText(`${num(v, pasoG < 1 ? 1 : 0)}°`, izq - 8, y);
    }
    // eje de horas
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const marcas = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080].find((s) => anchoT / s <= Math.max(3, Math.floor((W - izq) / 90))) ?? 10080;
    const primera = Math.ceil(desde / marcas) * marcas;
    for (let m = primera; m <= hasta; m += marcas) {
      const md = marcas >= 1440 ? m - (minDelDia(m)) : m; // en días: a la medianoche argentina
      const x = Math.round(xDe(md)) + 0.5; if (x < izq || x > W - der) continue;
      ctx.fillStyle = C.linea; ctx.fillRect(x, bot + 2, 1, 5);
      ctx.fillStyle = C.gris; ctx.fillText(marcas >= 1440 ? diaCorto(md) : hhmm(md), x, bot + 10);
    }
    if (!pts.length) return;

    // fuera de rango: una raya de color abajo
    for (const [t, prom] of pts) {
      const s = estadoDe(prom, e); if (s === 'ok') continue;
      ctx.fillStyle = s === 'calor' ? C.rojoNaranja : C.lila;
      ctx.fillRect(xDe(t), bot - 3, Math.max(1.5, xDe(t + paso) - xDe(t)), 3);
    }
    // la dispersión de cada tramo (cuando promedia)
    if (paso > 1) {
      for (const [t, , mn, mx] of pts) { ctx.fillStyle = color((mn + mx) / 2, e, 0.18); ctx.fillRect(xDe(t), yDe(mx), Math.max(1, xDe(t + paso) - xDe(t)), Math.max(1, yDe(mn) - yDe(mx))); }
    }
    // la curva: el trazo toma el color de su temperatura, con resplandor
    const gl = ctx.createLinearGradient(0, top, 0, bot);
    for (let k = 0; k <= 12; k++) { const v = hi - (k / 12) * (hi - lo); gl.addColorStop(k / 12, color(v, e)); }
    const trazo = () => {
      ctx.beginPath(); let pt: number | null = null;
      for (const [t, prom] of pts) {
        const x = xDe(t), y = yDe(prom);
        if (pt == null || t - pt > Math.max(MUDO_MIN, paso * 2)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        pt = t;
      }
    };
    // relleno hacia abajo, muy tenue
    const ga = ctx.createLinearGradient(0, top, 0, bot);
    ga.addColorStop(0, 'rgba(255,255,255,.10)'); ga.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); trazo(); const ult = pts[pts.length - 1];
    ctx.lineTo(xDe(ult[0]), bot); ctx.lineTo(xDe(pts[0][0]), bot); ctx.closePath(); ctx.fillStyle = ga; ctx.fill(); ctx.restore();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.save(); ctx.shadowColor = color(ult[1], e, 0.9); ctx.shadowBlur = 14; ctx.strokeStyle = gl; ctx.lineWidth = 3; trazo(); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; trazo(); ctx.stroke();
    // la punta: la última medición
    if (f.actual != null) {
      const x = xDe(ult[0]), y = yDe(ult[1]);
      ctx.fillStyle = color(ult[1], e, 0.35); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.blanco; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // la regla
    if (regla != null && regla >= desde && regla <= hasta) {
      const x = Math.round(xDe(regla)) + 0.5;
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x, top - 6, 1, bot - top + 6);
      let mejor: Punto | null = null;
      for (const p of pts) if (!mejor || Math.abs(p[0] - regla) < Math.abs(mejor[0] - regla)) mejor = p;
      if (mejor && Math.abs(mejor[0] - regla) <= Math.max(MUDO_MIN, paso * 2)) {
        const y = yDe(mejor[1]), txt = grados(mejor[1]);
        ctx.fillStyle = C.blanco; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.font = `900 12px ${letra}`; const tw = ctx.measureText(txt).width + 14;
        const bx = Math.min(W - der - tw, x + 10), by = Math.max(top, y - 26);
        ctx.fillStyle = C.blanco; ctx.fillRect(bx, by, tw, 20);
        ctx.fillStyle = C.negro; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 7, by + 10.5);
      }
    }
  });
  const minutoEn = (clientX: number, el: HTMLElement) => {
    const { izq, der, W } = geo.current; const x = clientX - el.getBoundingClientRect().left;
    if (x < izq || x > W - der) return null;
    return Math.round(desde + ((x - izq) / (W - izq - der)) * (hasta - desde));
  };
  return (
    <div className="fr-curva"
      onPointerMove={(ev) => setRegla(minutoEn(ev.clientX, ev.currentTarget))}
      onPointerDown={(ev) => setRegla(minutoEn(ev.clientX, ev.currentTarget))}
      onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setRegla(null); }}>
      <canvas ref={ref} aria-label={`Curva de temperatura de ${e.nombre}`} />
    </div>
  );
}

export function FrioPieza() {
  const [horas, setHoras] = useState(6);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [regla, setRegla] = useState<number | null>(null);
  const [reloj, setReloj] = useState('');
  const [ahoraSeg, setAhoraSeg] = useState(() => Date.now());
  const [bajando, setBajando] = useState(false);
  const [letra, setLetra] = useState('Arial');
  const raiz = useRef<HTMLDivElement>(null);

  const traer = useCallback(async (h: number) => {
    try {
      const r = await fetch(`/api/frio?horas=${h}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `La API respondió ${r.status}`);
      setDatos(j); setError(null);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { traer(horas); const id = setInterval(() => traer(horas), 30_000); return () => clearInterval(id); }, [horas, traer]);
  useEffect(() => {
    const tic = () => { setReloj(new Date().toLocaleTimeString('es-AR', { hour12: false, timeZone: TZ })); setAhoraSeg(Date.now()); };
    tic(); const id = setInterval(tic, 1000); return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const l = raiz.current ? getComputedStyle(raiz.current).getPropertyValue('--letra-frio').trim() : '';
    if (l) { setLetra(l); document.fonts?.ready.then(() => setLetra(`${l}, Arial`)); }
  }, []);

  const equipos = datos?.equipos ?? [];
  const ahoraMin = datos ? Math.floor(Date.parse(datos.ahora) / 60000) : 0;
  const paso = datos?.paso ?? 1;
  const ventana = (datos?.horas ?? horas) * 60;

  const filas: Fila[] = useMemo(() => equipos.map((e) => {
    const pts = (datos?.serie?.[e.idequipo] ?? []).map((p) => p.map(Number) as Punto);
    const ult = datos?.ultimas?.[e.idequipo];
    const edad = ult ? Math.max(0, ahoraMin - Math.floor(Date.parse(ult.medido_en) / 60000)) : null;
    const actual = ult && edad != null && edad <= MUDO_MIN ? Number(ult.temperatura) : null;
    let enRango = 0, suma = 0, mn = Infinity, mx = -Infinity;
    for (const [, prom, a, b] of pts) { if (prom >= e.minimo && prom <= e.maximo) enRango++; suma += prom; mn = Math.min(mn, a); mx = Math.max(mx, b); }
    // tendencia: contra la medición de hace ~10 minutos
    let tendencia: number | null = null;
    if (actual != null && pts.length > 1) {
      const ref = [...pts].reverse().find((p) => ahoraMin - p[0] >= 9);
      if (ref) tendencia = actual - ref[1];
    }
    return { e, pts, edad, actual, estado: estadoDe(actual, e), eps: episodios(e, pts, paso), tendencia,
      stats: pts.length ? { min: mn, max: mx, prom: suma / pts.length, enRango: enRango / pts.length } : null };
  }), [equipos, datos, ahoraMin, paso]);

  // la escala de tiempo: la ventana elegida, o desde la primera medición si hay menos
  const primera = Math.min(...filas.flatMap((f) => (f.pts.length ? [f.pts[0][0]] : [])), ahoraMin);
  const desde = Math.max(ahoraMin - ventana, Math.min(primera, ahoraMin - 20));
  const recortada = desde > ahoraMin - ventana + 1;

  async function bajarPlanilla(e: Equipo) {
    const mes = new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
    setBajando(true);
    try {
      const r = await fetch(`/api/frio?planilla=1&idequipo=${e.idequipo}&mes=${mes}`, { cache: 'no-store' });
      const filasP: any[] = r.ok ? await r.json() : [];
      const n = (x: any) => (x == null ? '' : String(x).replace('.', ','));
      const csv = [
        `${e.codigo} · ${e.nombre};Rango ${n(e.minimo)} a ${n(e.maximo)} °C;Mes ${mes};Sensor QBIT ${e.idequipo}`,
        'Día;Mediciones;Mínima °C;Máxima °C;Promedio °C;Mediciones fuera de rango',
        ...filasP.map((f) => [new Date(`${f.dia}T12:00:00`).toLocaleDateString('es-AR'), f.mediciones, n(f.minima), n(f.maxima), n(f.promedio), f.fuera_de_rango].join(';')),
      ].join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `frio-${e.codigo}-${mes}.csv`; a.click(); URL.revokeObjectURL(url);
    } finally { setBajando(false); }
  }

  const lector = datos?.lector;
  const segDesde = lector?.ultimaConsulta ? Math.max(0, Math.round((ahoraSeg - Date.parse(lector.ultimaConsulta)) / 1000)) : null;
  const enRango = filas.filter((f) => f.estado === 'ok').length;
  const elegido = filas.find((f) => f.e.idequipo === sel) ?? null;

  return (
    <div className="fr" ref={raiz}>
      <style>{CSS}</style>
      <header className="fr-barra">
        <div className="fr-marca">→ FRÍO</div>
        <div className="fr-sec"><b>{enRango}</b> de <b>{equipos.length || '—'}</b> en rango</div>
        <div className="fr-sec fr-vivo"><i className={segDesde != null && segDesde < 90 ? 'on' : ''} />{segDesde == null ? 'sin lecturas todavía' : `QBIT hace ${segDesde} s`}</div>
        <div className="fr-sec">{reloj}</div>
        <div className="fr-der" role="group" aria-label="Cuánto tiempo se ve">
          {VENTANAS.map((v) => (
            <button key={v.horas} type="button" className="fr-btn" aria-pressed={horas === v.horas} onClick={() => { setHoras(v.horas); setRegla(null); }}>{v.rotulo}</button>
          ))}
        </div>
      </header>

      <div className="fr-grilla" style={{ ['--n' as any]: Math.max(1, filas.length) }}>
        {filas.map((f) => (
          <section key={f.e.idequipo} className={`fr-eq ${f.estado}`} aria-current={sel === f.e.idequipo}
            style={{ ['--tono' as any]: f.actual == null ? 'rgba(138,139,144,.12)' : color(f.actual, f.e, f.estado === 'ok' ? 0.22 : 0.34) }}>
            <button type="button" className="fr-cab" onClick={() => setSel(sel === f.e.idequipo ? null : f.e.idequipo)} aria-pressed={sel === f.e.idequipo}>
              <span className="fr-cod">{f.e.codigo}</span>
              <span className="fr-nom">{f.e.nombre}</span>
            </button>
            <Termometro f={f} letra={letra} />
            <div className="fr-vivo2">
              <div className="fr-lectura">
                <div className="fr-temp">{f.actual == null ? '— —' : num(f.actual)}<i>°C</i></div>
                <div className="fr-est">
                  {f.estado === 'ok' && 'EN RANGO'}{f.estado === 'calor' && 'FUERA DE RANGO'}{f.estado === 'frio' && 'DEMASIADO FRÍO'}
                  {f.estado === 'mudo' && (f.edad == null ? 'SIN MEDICIONES' : `SIN SEÑAL HACE ${duracion(f.edad).toUpperCase()}`)}
                </div>
                <dl className="fr-datos">
                  <div><dt>10 min</dt><dd>{f.tendencia == null ? '—' : `${f.tendencia > 0.05 ? '↑' : f.tendencia < -0.05 ? '↓' : '→'} ${f.tendencia >= 0 ? '+' : ''}${num(f.tendencia)}°`}</dd></div>
                  <div><dt>mín</dt><dd>{f.stats ? `${num(f.stats.min)}°` : '—'}</dd></div>
                  <div><dt>máx</dt><dd>{f.stats ? `${num(f.stats.max)}°` : '—'}</dd></div>
                  <div><dt>en rango</dt><dd>{f.stats ? `${Math.round(f.stats.enRango * 100)} %` : '—'}</dd></div>
                </dl>
              </div>
            </div>
            <Curva f={f} desde={desde} hasta={ahoraMin} paso={paso} regla={regla} setRegla={setRegla} letra={letra} />
          </section>
        ))}
        {datos && !filas.length && <div className="fr-vacio">No hay equipos cargados.</div>}
        {error && <div className="fr-vacio">No pude traer las mediciones: {error}</div>}
      </div>

      <footer className="fr-pie">
        {elegido ? (
          <div className="fr-linea">
            <span className="fr-c">{elegido.e.codigo} · {elegido.e.nombre.toUpperCase()}</span>
            <span>rango {grados(elegido.e.minimo, 0)} → {grados(elegido.e.maximo, 0)}</span>
            {elegido.stats && <span>promedio {grados(elegido.stats.prom)}</span>}
            {elegido.eps.length ? elegido.eps.slice(-4).reverse().map((x, k) => (
              <span key={k} className={x.tipo}><b>EP {String(elegido.eps.length - k).padStart(3, '0')}</b> {diaTxt(x.ini)} {hhmm(x.ini)} → {x.abierto ? 'sigue' : hhmm(x.fin)} · {duracion(x.fin - x.ini + paso)}{x.tipo === 'mudo' ? ' sin señal' : ` · ${x.tipo === 'calor' ? 'máx' : 'mín'} ${grados(x.pico)}`}</span>
            )) : <span className="fr-fuente">sin episodios fuera de rango (cuentan desde {elegido.e.demora_min} min, como la alarma de QBIT)</span>}
            <button type="button" onClick={() => bajarPlanilla(elegido.e)} disabled={bajando}>{bajando ? 'Bajando…' : '↓ Planilla del mes para Bromatología'}</button>
            <button type="button" onClick={() => setSel(null)}>Cerrar</button>
          </div>
        ) : regla != null ? (
          <div className="fr-linea">
            <span className="fr-c">{diaTxt(regla).toUpperCase()} {hhmm(regla)}</span>
            {filas.map((f) => {
              let p: Punto | null = null; for (const q of f.pts) if (!p || Math.abs(q[0] - regla) < Math.abs(p[0] - regla)) p = q;
              const ok = p && Math.abs(p[0] - regla) <= Math.max(MUDO_MIN, paso * 2);
              return <span key={f.e.idequipo} className={ok ? estadoDe(p![1], f.e) : 'mudo'}>{f.e.codigo} {ok ? grados(p![1]) : 'sin dato'}</span>;
            })}
          </div>
        ) : (
          <div className="fr-linea fr-fuente">
            <span>Tocá el nombre de un equipo para ver sus episodios y bajar la planilla del mes · pasá el mouse por las curvas para leer la misma hora en todos</span>
          </div>
        )}
        <div className="fr-linea fr-fuente">
          <span>Sensores QBIT (Bitronic) · una lectura por minuto{paso > 1 ? ` · cada punto es el promedio de ${paso} minutos` : ''}</span>
          {recortada && <span>historia guardada desde {diaTxt(primera)} {hhmm(primera)}{lector?.historia === 'no_habilitada' ? ' (QBIT no da días anteriores)' : ''}</span>}
          {lector?.historia === 'completando' && <span>trayendo la historia: faltan {lector.diasPendientes} días</span>}
          {lector?.ultimoError && <span className="calor">último error de QBIT: {lector.ultimoError}</span>}
          {lector && !lector.token && <span className="calor">falta la clave de QBIT en el servidor</span>}
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.fr{--l:var(--letra-frio),Arial,sans-serif;flex:1;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#0A0A0E;color:#fff;font-family:var(--l);font-size:12px;font-variant-numeric:tabular-nums;overflow:hidden}
.fr-barra{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 24px;padding:16px 20px 12px;border-bottom:1px solid #2A2B30}
.fr-marca{font-weight:900;font-size:clamp(20px,2.2vw,28px);letter-spacing:-.02em;white-space:nowrap}
.fr-sec{font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8A8B90;font-size:11px}.fr-sec b{color:#fff}
.fr-vivo{display:inline-flex;align-items:center;gap:8px}
.fr-vivo i{width:8px;height:8px;border-radius:50%;background:#4A4B52;display:inline-block}
.fr-vivo i.on{background:#6BF8F4;box-shadow:0 0 0 0 rgba(107,248,244,.7);animation:fr-latido 2s ease-out infinite}
@keyframes fr-latido{0%{box-shadow:0 0 0 0 rgba(107,248,244,.6)}100%{box-shadow:0 0 0 12px rgba(107,248,244,0)}}
.fr-der{margin-left:auto;display:flex}
.fr-btn{appearance:none;border:1px solid #2A2B30;margin-left:-1px;background:#0A0A0E;color:#8A8B90;font:700 11px/1 var(--l);letter-spacing:.12em;padding:9px 12px;cursor:pointer;border-radius:0}
.fr-btn[aria-pressed="true"]{background:#fff;color:#0A0A0E;border-color:#fff}
.fr button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.fr-grilla{min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));grid-auto-rows:minmax(min(100%,520px),1fr);overflow:auto}
.fr-eq{position:relative;min-width:0;min-height:0;display:grid;grid-template-columns:78px minmax(0,1fr);grid-template-rows:auto auto minmax(150px,1fr);border-right:1px solid #2A2B30;border-bottom:1px solid #2A2B30;container-type:inline-size;
  background:radial-gradient(120% 55% at 18% 0%,var(--tono),transparent 70%);transition:background 1.5s linear}
.fr-eq::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:#2A2B30}
.fr-eq.ok::before{background:linear-gradient(90deg,#0E16D8,#2B5CF0,#59A8F3,#6BF8F4)}
.fr-eq.calor::before{background:linear-gradient(90deg,#FFAC8F,#FF5A1F,#FF2A3D,#FF2E88)}
.fr-eq.frio::before{background:linear-gradient(90deg,#7B2BD0,#C9A6FF)}
.fr-eq.mudo::before{background:repeating-linear-gradient(90deg,#fff 0 2px,#0A0A0E 2px 5px)}
.fr-cab{grid-column:1/-1;appearance:none;background:none;border:0;color:#fff;text-align:left;padding:18px 20px 6px;cursor:pointer;display:flex;gap:10px;align-items:baseline;min-width:0;font-family:var(--l)}
.fr-cod{font-weight:900;font-size:11px;letter-spacing:.1em;white-space:nowrap;flex:none}
.fr-nom{font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8A8B90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fr-cab:hover .fr-nom,.fr-cab[aria-pressed="true"] .fr-nom{color:#fff;text-decoration:underline;text-underline-offset:4px}
.fr-vivo2{grid-column:2;padding:8px 20px 18px 4px;min-height:clamp(170px,34cqw,260px);display:flex}
.fr-termo{grid-column:1;grid-row:2/4;position:relative}.fr-termo canvas,.fr-curva canvas{position:absolute;inset:0;display:block}
.fr-lectura{display:flex;flex-direction:column;justify-content:center;min-width:0}
.fr-temp{font-weight:900;font-size:clamp(48px,21cqw,150px);line-height:.9;letter-spacing:-.05em;white-space:nowrap}
.fr-temp i{font-style:normal;font-weight:400;font-size:.26em;letter-spacing:0;margin-left:.18em;vertical-align:top;color:#8A8B90}
.fr-est{font-weight:900;font-size:11px;letter-spacing:.16em;margin:10px 0 14px}
.fr-eq.calor .fr-temp,.fr-eq.calor .fr-est{color:#FF5A1F}
.fr-eq.frio .fr-temp,.fr-eq.frio .fr-est{color:#C9A6FF}
.fr-eq.mudo .fr-temp{color:transparent;background:repeating-linear-gradient(90deg,#fff 0 2px,#0A0A0E 2px 4px);-webkit-background-clip:text;background-clip:text}
.fr-datos{display:grid;grid-template-columns:repeat(4,auto);justify-content:start;gap:4px 22px;margin:0}
.fr-datos div{min-width:0}.fr-datos dt{font-weight:700;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#8A8B90}
.fr-datos dd{margin:2px 0 0;font-weight:700;font-size:14px;white-space:nowrap}
.fr-curva{grid-column:2;position:relative;min-height:150px;cursor:crosshair;touch-action:pan-y;border-top:1px solid #1A1B20}
.fr-vacio{padding:24px 20px;font-weight:700;font-size:15px;line-height:1.4}
.fr-pie{border-top:1px solid #2A2B30;padding:12px 20px 56px;display:grid;align-content:start;gap:6px;line-height:1.5;height:126px;overflow:hidden}
.fr-linea{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:baseline}
.fr-c{font-weight:900;letter-spacing:.06em}
.fr-pie button{appearance:none;background:none;border:0;padding:0;color:#fff;font:700 12px var(--l);cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.fr-pie .calor{color:#FF5A1F}.fr-pie .frio{color:#C9A6FF}.fr-pie .mudo{color:#8A8B90}
.fr-fuente{color:#8A8B90;font-size:11px;letter-spacing:.04em}
@media (max-width:640px){
  .fr-barra{padding:12px 16px 10px;gap:6px 14px}.fr-der{margin-left:0;width:100%}.fr-btn{flex:1;padding:9px 2px;font-size:10px}
  .fr-cab{padding:16px 16px 4px}.fr-eq{grid-template-columns:62px minmax(0,1fr)}.fr-vivo2{padding:4px 16px 12px 2px}
  .fr-datos{grid-template-columns:repeat(2,auto)}.fr-pie{padding:10px 16px 60px;font-size:11px;height:150px}
}
@media (prefers-reduced-motion:reduce){.fr-vivo i.on{animation:none}}
`;
