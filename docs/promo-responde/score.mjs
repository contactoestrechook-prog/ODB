// Banda sonora sintetizada por código · serie RESPONDE
// node score.mjs a|b|c  →  mix-a.wav / mix-b.wav / mix-c.wav
// Estética: cine — suspenso con desenlace (drone + latido + braams + resolución mayor)
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { heartBeats, FLAT } = createRequire(import.meta.url)('./latidos.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = (process.argv[2] || 'a').toLowerCase();
const DURS = { a: 45.8, b: 43.2, c: 43.6, d: 24.6, e: 32.9, f: 33.6, g: 47.9, h: 47.2, i: 46.2, j: 51.0, k: 39.0, n: 53.8 };
const SR = 44100, DUR = DURS[VIDEO], N = Math.round(SR * DUR);
const L = new Float64Array(N), R = new Float64Array(N);

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const iv = (t, a, b) => clamp01((t - a) / (b - a));
const EinOutCubic = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const EinQuad = x => x * x, EoutCubic = x => 1 - Math.pow(1 - x, 3);
let seed = 987654;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const panLR = p => { const th = (p + 1) * Math.PI / 4; return [Math.cos(th), Math.sin(th)]; };

/* ------- primitivas ------- */
function sweep(t0, dur, f0, f1, gain, { pan = 0, curve = 3, click = 0 } = {}) {
  const [pl, pr] = panLR(pan); const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
  let ph = 0;
  for (let i = n0; i < n1; i++) {
    const p = (i - n0) / (n1 - n0);
    const f = f0 * Math.pow(f1 / f0, p);
    ph += 2 * Math.PI * f / SR;
    const env = Math.pow(1 - p, curve);
    let s = Math.sin(ph) * env * gain;
    if (click && p < .004) s += (rnd() * 2 - 1) * click * (1 - p / .004);
    L[i] += s * pl; R[i] += s * pr;
  }
}
function noise(t0, dur, gain, { pan = 0, lp0 = 800, lp1 = 4000, attack = .3 } = {}) {
  const [pl, pr] = panLR(pan); const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
  let y = 0;
  for (let i = n0; i < n1; i++) {
    const p = (i - n0) / (n1 - n0);
    const env = p < attack ? p / attack : 1 - (p - attack) / (1 - attack);
    const fc = lp0 * Math.pow(lp1 / lp0, p);
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    y += a * ((rnd() * 2 - 1) - y);
    const s = y * env * env * gain * 2.2;
    L[i] += s * pl; R[i] += s * pr;
  }
}
function ding(t0, base, gain, { dur = 1.1, pan = 0 } = {}) {
  const parts = [[1, 1], [2.76, .4], [5.4, .16]];
  const [pl, pr] = panLR(pan); const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
  for (let i = n0; i < n1; i++) {
    const tt = (i - n0) / SR, p = (i - n0) / (n1 - n0);
    let s = 0;
    for (const [m, g] of parts) s += Math.sin(2 * Math.PI * base * m * tt + m) * g;
    s *= Math.exp(-4.2 * p) * gain * (1 - Math.exp(-tt * 900));
    L[i] += s * pl; R[i] += s * pr;
  }
}
/* braam/pad de "cuerdas": suma de armónicos tipo saw con detune y filtro que abre */
function braam(t0, freqs, dur, gain, { attack = .35, bright = 6, pan = 0, decay = 2.2 } = {}) {
  const [pl, pr] = panLR(pan); const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
  const dets = freqs.flatMap(f => [f, f * 1.007, f * 0.994]);
  const phs = dets.map(() => rnd() * 6.28);
  for (let i = n0; i < n1; i++) {
    const tt = (i - n0) / SR, p = (i - n0) / (n1 - n0);
    const env = p < attack ? Math.pow(p / attack, 1.6) : Math.pow(1 - (p - attack) / (1 - attack), decay);
    const nh = 1 + bright * Math.min(1, p / attack);
    let s = 0;
    for (let k = 0; k < dets.length; k++) {
      const f = dets[k];
      for (let h = 1; h <= nh; h++) s += Math.sin(2 * Math.PI * f * h * tt + phs[k] * h) / (h * 1.4);
    }
    s = s / (dets.length * 2.2) * env * gain;
    L[i] += s * pl * .96; R[i] += s * pr;
  }
}
/* pad sostenido con respiración */
function pad(t0, t1, freqs, gain, { att = 1.4, rel = 1.6, breathe = .18 } = {}) {
  const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor(t1 * SR));
  const dets = freqs.flatMap(f => [f, f * 1.004]);
  const phs = dets.map(() => rnd() * 6.28);
  for (let i = n0; i < n1; i++) {
    const t = i / SR;
    const env = Math.min(iv(t, t0, t0 + att), 1 - EinQuad(iv(t, t1 - rel, t1)));
    let s = 0;
    for (let k = 0; k < dets.length; k++) s += Math.sin(2 * Math.PI * dets[k] * t + phs[k]) * (1 + .1 * Math.sin(t * .7 + k));
    s = s / dets.length * env * gain * (1 + breathe * Math.sin(t * .5));
    L[i] += s * .93; R[i] += s;
  }
}
const kick = (t, g = 1, f0 = 150) => sweep(t, .14, f0, 46, .32 * g, { curve: 2.8 });
const heart = (t, g = 1) => { kick(t, .85 * g, 120); kick(t + .29, .55 * g, 105); };
const tick = (t, g = 1, pan = 0, f = 1500) => sweep(t, .05, f, f * .6, .12 * g, { pan, curve: 2.5, click: .1 * g });
const key = (t, g = 1) => sweep(t, .03, 2100 + rnd() * 900, 1300, .06 * g, { pan: (rnd() - .5) * .7, curve: 2.2, click: .05 });
const pop = (t, g = 1, pan = 0) => sweep(t, .09, 850, 300, .16 * g, { pan, curve: 2, click: .04 });
const whoosh = (t, d = .45, g = 1, pan = 0) => noise(t, d, .3 * g, { pan, lp0: 4200, lp1: 380, attack: .3 });
const rise = (t, d, g = 1) => noise(t, d, .13 * g, { lp0: 320, lp1: 3600, attack: .86 });
const boom = (t, g = 1) => { sweep(t, 1.0, 64, 33, .34 * g, { curve: 2 }); noise(t, .3, .1 * g, { lp0: 900, lp1: 150, attack: .04 }); };
const pluck = (t, f, g = 1, pan = 0) => { sweep(t, .9, f, f, .001, {}); const [pl, pr] = panLR(pan); const n0 = Math.floor(t * SR), n1 = Math.min(N, n0 + Math.floor(.9 * SR)); for (let i = n0; i < n1; i++) { const tt = (i - n0) / SR; const s = (Math.sin(2 * Math.PI * f * tt) + .38 * Math.sin(4 * Math.PI * f * tt) + .12 * Math.sin(6 * Math.PI * f * tt)) * Math.exp(-3.4 * tt) * .2 * g * (1 - Math.exp(-tt * 700)); L[i] += s * pl; R[i] += s * pr; } };
function teletype(t0, t1, g = 1) { for (let t = t0; t < t1; t += 1 / 30) if (rnd() < .42) sweep(t, .012, 2400 + rnd() * 1400, 2000, .045 * g, { pan: (rnd() - .5) * .8, curve: 1.5, click: .06 }); }

/* ------- notas ------- */
const A1 = 55, E2 = 82.4, A2 = 110, C3 = 130.8, D2 = 73.4, F2 = 87.3, G2 = 98, E3 = 164.8, F3 = 174.6, G3 = 196, A3 = 220, B3 = 246.9, C4 = 261.6, E4 = 329.6, C2 = 65.4;

/* ============ VIDEO A · suspenso → desenlace ============ */
function scoreA() {
  /* S1 — dread: drone + latido + reloj */
  pad(0.1, 11.5, [A1, A1 * 1.003, E2], .085, { att: 2.2, rel: .4 });
  for (let s = 1; s <= 6; s++) tick(s - 0.0, .8, s % 2 ? .3 : -.3, s % 2 ? 1500 : 1230); // tic/toc
  for (let t = 0.6; t < 6.2; t += 1.55) heart(t, .75);
  pad(3.5, 11.5, [A2, C3, E3], .05, { att: 2.5, rel: .5 });
  pop(0.95, .7, .2);                                  // label
  pop(1.55, .8, -.3); pop(2.55, .8, .3); pop(3.45, .8, -.2);  // burbujas
  tick(4.05, 1.1, 0, 900);                            // "sin responder"
  sweep(4.62, .12, 210, 110, .1, { curve: 2 }); sweep(5.47, .12, 210, 110, .1, { curve: 2 }); // titulares
  /* whip A + pila */
  whoosh(6.42, .5, 1.1);
  const DROPS = []; { let acc = 7.0; const ivs = [0, .42, .35, .29, .24, .2, .165, .14]; for (let i = 0; i < 8; i++) { acc += ivs[i]; DROPS.push(acc); } }
  DROPS.forEach((t, i) => { tick(t, .85 + i * .05, i % 2 ? .4 : -.4); if (i > 3) kick(t, .3); });
  rise(7.0, 2.3, 1);
  for (let t = 6.9; t < 9.2; t += .3875) kick(t, .38);   // pulso acelerando la tensión
  /* slam 67% en papel */
  boom(9.42, .9); braam(9.44, [D2, A2, F3], 2.0, .30, { attack: .12, bright: 7, decay: 1.6 });
  noise(9.42, .25, .18, { lp0: 5000, lp1: 500, attack: .05 });
  sweep(9.95, .1, 230, 130, .09, { curve: 2 });        // stagger palabras
  /* succión → silencio → REVEAL */
  noise(11.28, .45, .26, { lp0: 500, lp1: 5600, attack: .8 });
  boom(11.78, 1);
  braam(11.8, [A1, E2, A2], 2.6, .34, { attack: .3, bright: 7, decay: 1.9 });
  ding(11.85, 1046, .13, { dur: 1.6 });
  teletype(11.95, 13.3, 1);                            // decode del wordmark
  pad(12.2, 16.7, [A2, C3, E3, B3], .075, { att: 1.6, rel: .6 });
  sweep(13.38, .5, 90, 40, .22, { curve: 2 });          // logo aterriza
  pop(14.15, .8, .1); pop(14.6, .6, -.1);
  /* whip C + sección pulso (cómo funciona) */
  whoosh(16.52, .5, 1);
  noise(17.0, .5, .12, { lp0: 300, lp1: 2400, attack: .5 });  // teléfono sube
  for (let t = 17.1; t < 33.7; t += .625) kick(t, t < 21.7 ? .42 : .5);    // 96 bpm
  for (let t = 17.4125; t < 33.7; t += 1.25) tick(t, .3, .5, 2600);        // hat suave
  pad(17.0, 25.9, [A1, E2], .06, { att: 1.2, rel: 1 });
  pad(25.9, 33.9, [F2, C3], .06, { att: 1.2, rel: .8 });
  teletype(17.62, 18.15, .8);                          // label 01
  pop(18.0, .9, -.2);                                  // msg in
  teletype(19.38, 19.9, .8);
  for (let i = 0; i < 4; i++) pop(19.85 + i * .3, .7, i % 2 ? .5 : -.5);   // chips
  for (let t = 19.5; t < 21.6; t += .21) if (rnd() < .6) key(t, .5);        // typing dots
  teletype(21.78, 22.3, .8);
  { /* typewriter con rampa (espejo de twCount) */
    const L1 = 156;
    const c = t => { if (t < 21.9) return 0; if (t < 22.7) return Math.round(EinOutCubic(iv(t, 21.9, 22.7)) * 12); if (t < 24.6) return 12 + Math.round(EinQuad(iv(t, 22.7, 24.6)) * (L1 - 52)); return (L1 - 40) + Math.round(EoutCubic(iv(t, 24.6, 25.7)) * 40); };
    let last = 0;
    for (let t = 21.9; t < 25.7; t += 1 / 240) { const n = c(t); if (n >= last + 2) { key(t, n > 12 && n < L1 - 40 ? .8 : 1); last = n; } }
  }
  noise(22.7, 1.9, .05, { lp0: 900, lp1: 3200, attack: .5 });
  pop(26.2, .9, -.2);                                   // dale reservá
  ding(27.15, 1318, .16, { dur: 1.1 }); pop(27.1, .8);  // listo reservado
  teletype(28.18, 28.7, .8);
  [28.4, 29.3, 30.2, 31.0].forEach((t, i) => { whoosh(t, .3, .7, .5); pop(t + .12, .75, .3); });
  teletype(31.72, 32.25, .8);
  pluck(31.95, A3, 1, -.3); pluck(32.17, C4, 1, 0); pluck(32.39, E4, 1.1, .3);   // niveles
  /* whip D → DESENLACE mayor */
  whoosh(33.92, .5, 1.1);
  boom(34.38, .8);
  braam(34.4, [F2, C3, F3, A3], 2.4, .26, { attack: .3, bright: 5, decay: 1.8 });
  { /* cuenta regresiva 23→0: ratchet con tono descendente */
    let lastIdx = 23;
    for (let t = 34.7; t <= 36.52; t += 1 / 500) {
      const val = 23 * (1 - EinOutCubic(iv(t, 34.7, 36.5)));
      const idx = Math.ceil(val - 1e-9);
      if (idx < lastIdx) { tick(t, .55 + (23 - idx) * .012, (idx % 2 ? .3 : -.3), 1900 - (23 - idx) * 52); lastIdx = idx; }
    }
  }
  rise(35.3, 1.2, .8);
  boom(36.62, 1); braam(36.64, [C2, G2, E3, G3, C4], 3.0, .34, { attack: .22, bright: 6, decay: 2 });
  ding(36.7, 1046, .2, { dur: 1.8 }); ding(36.78, 1568, .12, { dur: 1.4 });
  sweep(36.95, .12, 240, 130, .1, { curve: 2 });        // h1
  pluck(37.75, C4, 1.2, 0);                             // "Nunca más."
  pad(36.7, 40.0, [C3, E3, G3], .08, { att: .8, rel: .8 });
  /* whip E + CTA cálido */
  whoosh(39.62, .45, 1);
  boom(40.1, .7);
  pad(40.1, 45.6, [C2, G2, E3, C4 * 1.0], .1, { att: 1.2, rel: 2.2, breathe: .22 });
  for (let t = 40.3; t < 44.8; t += .6) kick(t, .22);
  pop(41.65, 1, 0); ding(41.95, 1318, .1, { dur: 1.2 });
  pop(42.25, .6, .2);
  ding(44.2, 2093, .06, { dur: 1.6, pan: .2 });
}

/* ============ VIDEO B · secretaria (relojería cálida) ============ */
function scoreB() {
  const D3 = 146.8, G4 = 392, B2 = 123.5, D4 = 293.7;
  const buzz = t => { for (let k = 0; k < 2; k++) { sweep(t + k * .34, .22, 172, 158, .1, { curve: 1.2 }); noise(t + k * .34, .2, .06, { lp0: 260, lp1: 200, attack: .15 }); } };
  /* hook oscuro */
  pad(0.1, 5.6, [D2, A2, F3], .07, { att: 1.8, rel: .4 });
  for (let s = 1; s <= 5; s++) tick(s, .7, s % 2 ? .3 : -.3, s % 2 ? 1500 : 1230);
  buzz(0.7); buzz(2.0);
  pop(1.4, .8, -.3); pop(2.4, .8, .2);
  sweep(3.2, .12, 210, 120, .1, { curve: 2 }); sweep(4.1, .12, 210, 120, .1, { curve: 2 });
  /* flip a papel + reveal */
  whoosh(5.22, .5, 1);
  boom(5.7, .6); ding(5.72, 784, .12, { dur: 1.4 });
  pluck(5.75, G2, 1.1); pluck(5.95, B3, 1); pluck(6.15, D4, 1); pluck(6.35, G4, 1.1, .2);
  teletype(6.2, 7.1, .8);
  sweep(6.6, .4, 120, 55, .22, { curve: 2 });   // MODO
  boom(7.0, .8); sweep(7.0, .45, 100, 45, .26, { curve: 2 });  // SECRETARIA
  ding(7.05, 1046, .12, { dur: 1.2 });
  whoosh(8.1, .35, .5, .2);
  /* groove relojería (100 bpm) */
  whoosh(10.42, .4, .8);
  noise(10.6, .5, .1, { lp0: 300, lp1: 2200, attack: .5 });
  const B0 = 10.75, B1 = 29.1, beat = .6;
  for (let t = B0, i = 0; t < B1; t += beat, i++) {
    kick(t, .3);
    pluck(t, i % 2 ? D3 : G2, .55, i % 2 ? .25 : -.25);
    tick(t + beat / 2, .4, i % 2 ? .5 : -.5, i % 2 ? 2600 : 2100);   // tic-toc
  }
  pad(11.0, 20.0, [G2, D3, B3], .05, { att: 1.5, rel: 1 });
  pad(20.0, 29.1, [C3, G3, E4 * 0 + 329.6], .05, { att: 1.2, rel: .8 });
  /* chat */
  teletype(11.07, 11.6, .8);
  pop(12.0, .9, -.2);
  teletype(12.77, 13.3, .8);
  for (let t = 12.9, i = 0; t < 15.2; t += .21) if (rnd() < .55) key(t, .5);
  [13.35, 13.6, 13.85].forEach((t, i) => { pop(t, .8, .5); tick(t + .05, .5, .5, 1900 + i * 150); });  // slots
  for (let i = 0; i < 3; i++) pop(13.0 + i * .3, .65, -.5);   // chips
  teletype(15.37, 15.9, .8);
  { const Lb = 89;
    const c = t => { if (t < 15.5) return 0; if (t < 16.2) return Math.round(EinOutCubic(iv(t, 15.5, 16.2)) * 10); if (t < 17.6) return 10 + Math.round(EinQuad(iv(t, 16.2, 17.6)) * (Lb - 40)); return (Lb - 30) + Math.round(EoutCubic(iv(t, 17.6, 18.5)) * 30); };
    let last = 0;
    for (let t = 15.5; t < 18.5; t += 1 / 240) { const n = c(t); if (n >= last + 2) { key(t, .85); last = n; } }
  }
  pop(19.05, .9, -.2);                       // jueves 16
  ding(20.45, 1318, .16, { dur: 1 }); tick(20.45, 1, 0, 900);   // RESERVADO
  teletype(19.87, 20.4, .8);
  pop(20.2, .8);
  ding(21.45, 1568, .14, { dur: 1.2 }); ding(21.52, 2093, .09, { dur: 1 });  // calendar card
  pluck(21.45, G3, 1, .2);
  /* time skip + recordatorio automático */
  whoosh(23.57, .3, .7, .3);
  teletype(23.77, 24.25, .7);
  pop(24.45, .85, .2); ding(24.55, 2093, .08, { dur: .9, pan: .3 }); ding(24.62, 2637, .06, { dur: .8, pan: -.2 });
  pop(25.85, .8, -.3); ding(26.1, 1568, .08, { dur: .8 });
  /* la agenda se llena */
  rise(26.8, 2.1, .9);
  const FILLS = [26.8, 27.02, 27.24, 27.46];
  FILLS.forEach((t, i) => { pop(t, .85, i % 2 ? .5 : -.5); pluck(t, [G3, A3, B3, D4][i], .9, i % 2 ? .3 : -.3); });
  { let lastIdx = 3;
    for (let t = 26.7; t <= 29.02; t += 1 / 500) {
      const val = 3 + 9 * EinOutCubic(iv(t, 26.7, 29.0));
      const idx = Math.floor(val + 1e-9);
      if (idx > lastIdx) { tick(t, .6 + (idx - 3) * .04, idx % 2 ? .35 : -.35, 1500 + (idx - 3) * 90); lastIdx = idx; }
    }
  }
  /* desenlace oscuro cálido */
  whoosh(29.17, .5, 1.1);
  boom(29.65, .9);
  braam(29.67, [G2, D3, B3, G3], 2.6, .3, { attack: .28, bright: 6, decay: 1.9 });
  ding(29.72, 1046, .15, { dur: 1.6 });
  sweep(30.1, .12, 230, 130, .1, { curve: 2 });
  braam(31.17, [D2 * 2, A2 * 2, F3 * 1.02 * 0 + 185], 1.6, .18, { attack: .2, bright: 5, decay: 1.6 });  // "sin llamadas"
  ding(31.2, 1318, .1, { dur: 1.2 });
  whoosh(32.0, .3, .4, .2);
  /* CTA */
  whoosh(34.22, .45, 1);
  boom(34.7, .7);
  pad(34.7, 43.0, [G2, D3, B3, D4], .1, { att: 1.2, rel: 2.2, breathe: .2 });
  for (let t = 34.9; t < 42.2; t += .6) kick(t, .2);
  pop(36.3, 1); ding(36.6, 1318, .1, { dur: 1.2 });
  pop(36.9, .6, .2);
  ding(41.6, 2093, .06, { dur: 1.6, pan: .2 });
}
/* ============ VIDEO C · vendedor (percusivo → triunfal) ============ */
function scoreC() {
  const E2c = 82.4, B2 = 123.5, G3c = 196, Gs2 = 103.8, Gs3 = 207.65, E3c = 164.8, E4c = 329.6, B4 = 493.9;
  const coin = (t, g = 1) => { ding(t, 2637, .12 * g, { dur: .5, pan: .2 }); ding(t + .06, 3520, .09 * g, { dur: .45, pan: -.15 }); ding(t + .11, 2093, .07 * g, { dur: .5, pan: .1 }); };
  /* hook */
  pad(0.1, 5.4, [E2c, B2, G3c], .075, { att: 1.8, rel: .4 });
  for (let s = 1; s <= 4; s++) tick(s, .7, s % 2 ? .3 : -.3, s % 2 ? 1500 : 1230);
  pop(1.7, .85, -.25);
  sweep(2.95, .12, 210, 120, .1, { curve: 2 }); sweep(3.85, .13, 200, 110, .12, { curve: 2 });
  /* reveal */
  whoosh(5.02, .5, 1.05);
  boom(5.7, .5);
  teletype(6.0, 6.9, .8);
  sweep(6.4, .4, 110, 50, .22, { curve: 2 });                       // EL QUE
  boom(6.92, 1); braam(6.94, [E2c, B2, E3c, G3c], 2.2, .34, { attack: .14, bright: 7, decay: 1.8 });  // VENDE
  ding(6.98, 1046, .12, { dur: 1.2 });
  whoosh(7.9, .35, .5, .2);
  /* groove 112 bpm */
  whoosh(9.92, .45, .9);
  noise(10.1, .5, .1, { lp0: 300, lp1: 2200, attack: .5 });
  const beat = 60 / 112, B0 = 10.35, B1 = 30.9;
  for (let t = B0, i = 0; t < B1; t += beat, i++) {
    kick(t, i % 4 === 0 ? .55 : .42);
    if (i % 2 === 1) pluck(t, i % 4 === 1 ? E2c : G2, .5, i % 4 === 1 ? -.2 : .2);
    tick(t + beat / 2, .32, i % 2 ? .5 : -.5, 2600);
  }
  pad(10.5, 21.0, [E2c, B2], .05, { att: 1.2, rel: .8 });
  /* chat */
  teletype(10.82, 11.35, .8);
  pop(11.25, .9, -.2);
  teletype(12.72, 13.25, .8);
  for (let t = 12.9; t < 14.5; t += .2) if (rnd() < .55) key(t, .5);
  for (let i = 0; i < 4; i++) pop(12.95 + i * .3, .68, i % 2 ? .5 : -.5);
  { const Lc = 117;
    const c = t => { if (t < 14.75) return 0; if (t < 15.45) return Math.round(EinOutCubic(iv(t, 14.75, 15.45)) * 10); if (t < 16.75) return 10 + Math.round(EinQuad(iv(t, 15.45, 16.75)) * (Lc - 40)); return (Lc - 30) + Math.round(EoutCubic(iv(t, 16.75, 17.6)) * 30); };
    let last = 0;
    for (let t = 14.75; t < 17.6; t += 1 / 240) { const n = c(t); if (n >= last + 2) { key(t, .85); last = n; } }
  }
  /* link de pago */
  teletype(17.92, 18.45, .8);
  rise(17.7, .5, .7);
  pop(18.2, 1.1); pluck(18.22, E4c, 1, .2); pluck(18.34, B4 * 0 + 493.9, .9, -.2);
  ding(18.4, 1568, .12, { dur: .9 });
  pop(19.75, .9, -.25);                                           // pagado!
  /* COBRA — el golpe del video */
  teletype(20.67, 21.1, .8);
  kick(21.05, 1.3, 200); noise(21.05, .2, .22, { lp0: 4000, lp1: 600, attack: .03 });   // cajón
  boom(21.12, 1);
  coin(21.15, 1.1); coin(21.42, .7);
  braam(21.18, [E2c, B2, Gs3, E4c], 2.8, .36, { attack: .2, bright: 6, decay: 2 });     // MAYOR triunfal
  ding(21.25, 1318, .18, { dur: 1.6 });
  pad(21.4, 30.9, [E2c, Gs2, B2], .06, { att: 1, rel: .8 });
  pop(23.55, .85); ding(23.8, 1568, .08, { dur: .8 });
  /* avisa al equipo */
  whoosh(25.07, .3, .7, .4);
  teletype(25.27, 25.8, .7);
  pop(25.65, .85, -.4); whoosh(25.65, .25, .4, -.5);
  pop(26.25, .85, .4); whoosh(26.25, .25, .4, .5);
  /* contador de plata */
  rise(27.5, 2.6, 1);
  for (let t = 27.55, i = 0; t < 30.28; t += 1 / 22, i++) {
    const p = iv(t, 27.5, 30.3);
    tick(t, .3 + p * .5, i % 2 ? .4 : -.4, 1300 + p * 1100);
  }
  for (let t = 27.5; t < 30.3; t += beat / 2) kick(t, .3);
  coin(29.0, .5);
  boom(30.5, .9); braam(30.52, [E2c, B2, Gs3, E4c], 2.0, .28, { attack: .18, bright: 6, decay: 1.8 });
  coin(30.55, 1);
  /* quote + tríada final */
  whoosh(30.97, .5, 1);
  pad(31.5, 35.6, [E2c, Gs2, B2, E3c], .085, { att: .9, rel: .8 });
  pop(31.9, .8, 0);
  tick(32.95, .8, 0, 1000);
  pluck(33.62, E3c, 1.1, -.3); kick(33.62, .7);
  pluck(33.78, Gs3, 1.1, 0); kick(33.78, .7);
  pluck(33.94, B2 * 2, 1.2, .3); kick(33.94, .85); ding(34.0, 1318, .1, { dur: 1 });
  /* CTA */
  whoosh(35.42, .45, 1);
  boom(35.9, .7);
  pad(35.9, 43.4, [E2c, B2, Gs3, E4c], .1, { att: 1.2, rel: 2.4, breathe: .2 });
  for (let t = 36.1; t < 42.6; t += .5357) kick(t, .22);
  pop(37.45, 1); ding(37.75, 1318, .1, { dur: 1.2 });
  pop(38.05, .6, .2);
  ding(42.0, 2093, .06, { dur: 1.6, pan: .2 });
}

/* ============ VIDEO D · corto, serio, golpes grandes ============ */
function scoreD() {
  const E2d = 82.4, B2d = 123.5, Gs2d = 103.8, Gs3d = 207.65, E3d = 164.8, E4d = 329.6, B3d = 246.9;
  const coin = (t, g = 1) => { ding(t, 2637, .12 * g, { dur: .5, pan: .2 }); ding(t + .06, 3520, .09 * g, { dur: .45, pan: -.15 }); ding(t + .11, 2093, .07 * g, { dur: .5, pan: .1 }); };
  /* corte seco: sub-drop + aire cortado */
  const cut = (t, g = 1) => { noise(t - .12, .12, .1 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .55 * g); };
  /* colchón continuo: tensión que no afloja hasta el desenlace */
  pad(0.1, 13.2, [E2d, B2d], .085, { att: 1.2, rel: .3, breathe: .12 });
  pad(13.2, 18.3, [E2d, Gs2d, B2d], .075, { att: .8, rel: .3 });
  pad(18.3, 24.4, [E2d, Gs2d, B3d, E4d], .1, { att: .9, rel: 2.0, breathe: .2 });

  /* GOLPE 1 · el número */
  boom(0.12, 1.2); braam(0.14, [E2d, B2d, E3d], 2.2, .3, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.12, .28, .2, { lp0: 5200, lp1: 500, attack: .04 });
  { /* ratchet del contador (frena con outQuint) */
    let last = 0;
    for (let t = 0.25; t < 1.2; t += 1 / 200) {
      const p = 1 - Math.pow(1 - iv(t, 0.25, 1.15), 5);
      const step = Math.floor(p * 26);
      if (step > last) { tick(t, .35 + p * .5, step % 2 ? .3 : -.3, 1500 + p * 900); last = step; }
    }
  }
  coin(1.2, .8);
  teletype(1.37, 2.2, .85);
  for (let t = 1.6; t < 3.0; t += .78) heart(t, .6);

  /* GOLPE 2 · un domingo / 23:14 */
  cut(3.05, 1.1); braam(3.3, [E2d, B2d], 1.7, .2, { attack: .16, bright: 5, decay: 1.7 });
  tick(3.3, 1, 0, 1100);
  pluck(4.37, B3d, 1, .2); kick(4.37, .5);
  for (let t = 3.5; t < 6.1; t += .78) heart(t, .5);

  /* GOLPE 3 · vos dormías / él vendió */
  cut(6.15, 1.1);
  sweep(6.4, .5, 150, 60, .2, { curve: 2.4 });
  boom(7.47, 1.1); braam(7.49, [E2d, B2d, Gs3d], 2.0, .32, { attack: .12, bright: 7, decay: 1.7 });
  coin(7.55, .5);
  rise(8.3, .95, 1);

  /* GOLPE 4 · REVEAL */
  cut(9.25, 1.3);
  boom(9.3, 1.1);
  braam(9.32, [E2d, B2d, E3d, Gs3d], 3.0, .36, { attack: .3, bright: 7, decay: 2.0 });
  ding(9.38, 1046, .16, { dur: 1.8 });
  teletype(9.9, 11.0, 1);
  sweep(11.08, .55, 95, 42, .24, { curve: 2 });
  ding(11.12, 1568, .1, { dur: 1.3 });
  pop(11.55, .8);

  /* GOLPE 5 · cotiza / link / cobra */
  cut(13.15, 1);
  pop(13.35, 1);
  for (let t = 13.45; t < 14.6; t += .2) if (rnd() < .5) key(t, .45);
  teletype(13.35, 13.9, .7);
  pluck(13.35, E3d, .9, -.2);
  cut(14.85, .8); pop(14.9, 1.05); pluck(14.9, Gs3d, 1, .2); ding(14.98, 1568, .1, { dur: .9 });
  /* el cobro: el golpe más grande del video */
  cut(16.40, 1.4);
  kick(16.42, 1.4, 210); noise(16.42, .22, .26, { lp0: 4600, lp1: 600, attack: .03 });
  boom(16.45, 1.2);
  braam(16.47, [E2d, B2d, Gs3d, E4d], 2.6, .38, { attack: .18, bright: 6, decay: 1.9 });
  ding(16.52, 1318, .2, { dur: 1.7 });
  coin(16.5, 1.2); coin(16.85, .7);

  /* GOLPE 6 · atiende. cotiza. cobra. */
  cut(18.25, 1);
  [18.45, 18.71, 18.97].forEach((t, i) => { kick(t, .8); pluck(t, [E3d, Gs3d, B3d * 2][i], 1, (i - 1) * .3); });
  ding(19.4, 1568, .1, { dur: 1.2 });

  /* CTA */
  cut(20.45, 1.1);
  boom(20.5, .85);
  braam(20.52, [E2d, B2d, Gs3d, E4d], 2.4, .3, { attack: .22, bright: 6, decay: 2 });
  ding(20.7, 1046, .14, { dur: 1.6 });
  for (let t = 20.9; t < 23.6; t += .5357) kick(t, .24);
  pop(21.9, 1.1); ding(22.15, 1318, .12, { dur: 1.2 });
  pop(22.55, .6, .2);
  ding(23.3, 2093, .07, { dur: 1.4, pan: .2 });
}

/* ============ VIDEO E · SIN EXCUSAS (manifiesto) ============
   Reloj que no para + latido. Menor y tenso hasta el reveal,
   sello de goma en los dos carteles de papel, mayor al final.   */
function scoreE() {
  const D2e = 73.4, A2e = 110, F3e = 174.6, D3e = 146.8, A3e = 220, Bb2 = 116.5,
        Fs2 = 92.5, D4e = 293.7, A4e = 440, Bb3 = 233.1;
  const cut = (t, g = 1) => { noise(t - .12, .12, .1 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .5 * g); };
  /* sello de goma: golpe seco de madera + aire */
  const stamp = (t, g = 1) => {
    sweep(t, .1, 420, 90, .34 * g, { curve: 2.6, click: .3 * g });
    noise(t, .16, .2 * g, { lp0: 5000, lp1: 400, attack: .02 });
    sweep(t + .01, .5, 120, 44, .3 * g, { curve: 2.2 });
  };
  /* tajo de la tachadura */
  const slash = (t, g = 1, pan = 0) => noise(t, .17, .26 * g, { pan, lp0: 6000, lp1: 900, attack: .06 });

  /* colchón: tensión que no afloja hasta el reveal */
  pad(0.1, 14.3, [D2e, A2e], .085, { att: 1.4, rel: .3, breathe: .1 });
  pad(14.3, 23.4, [D2e, Bb2, F3e], .08, { att: .7, rel: .3 });
  pad(23.5, 32.7, [D2e, A2e, D3e, A3e], .1, { att: 1.0, rel: 2.2, breathe: .2 });
  /* el reloj: nunca para hasta que aparece RESPONDE */
  for (let t = 0.55, i = 0; t < 23.4; t += .5, i++) tick(t, i % 2 ? .3 : .42, i % 2 ? .35 : -.35, i % 2 ? 1230 : 1520);
  for (let t = 1.2; t < 11.1; t += 1.55) heart(t, .55);

  /* 800 */
  boom(0.1, 1.25); braam(0.12, [D2e, A2e, F3e], 2.3, .32, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.1, .3, .22, { lp0: 5200, lp1: 500, attack: .04 });
  { let last = 0;
    for (let t = 0.22; t < 1.2; t += 1 / 200) {
      const p = 1 - Math.pow(1 - iv(t, .22, 1.15), 5);
      const s = Math.floor(p * 30);
      if (s > last) { tick(t, .3 + p * .55, s % 2 ? .3 : -.3, 1400 + p * 1000); last = s; }
    }
  }
  teletype(1.32, 2.05, .85);
  pop(2.1, .7, .15);

  /* y el lunes volvés a pagar publicidad */
  cut(3.15, 1); pop(3.42, .8); pluck(4.55, D3e, .9, .2); kick(4.55, .55);
  /* pagás para que te escriban / NO CONTESTÁS */
  cut(6.05, 1); pop(6.3, .6);
  boom(7.1, 1.15); braam(7.12, [D2e, A2e, F3e], 2.0, .34, { attack: .1, bright: 7, decay: 1.7 });
  noise(7.1, .2, .16, { lp0: 4500, lp1: 500, attack: .04 });
  /* es una decisión */
  cut(8.65, .9); pop(8.9, .6);
  boom(9.82, 1); braam(9.84, [D2e, Bb2, F3e], 1.9, .28, { attack: .12, bright: 6, decay: 1.7 });

  /* excusas: metrónomo + tajo */
  cut(11.15, .8);
  [11.30, 12.37, 13.44].forEach((t, i) => {
    if (i) cut(t, .7);
    pop(t + .02, .9, i % 2 ? .3 : -.3);
    slash(t + .36, 1, i % 2 ? .45 : -.45);
    kick(t + .38, .7);
  });
  rise(13.5, .82, .9);

  /* SELLO · EN 2026 NO HAY EXCUSAS */
  stamp(14.36, 1.2);
  braam(14.4, [D2e, A2e, D3e], 2.4, .3, { attack: .16, bright: 6, decay: 1.9 });
  ding(14.45, 1046, .12, { dur: 1.4 });
  stamp(15.27, 1.35);
  braam(15.3, [D2e, Bb2, F3e, A3e], 2.2, .32, { attack: .1, bright: 7, decay: 1.8 });

  /* nadie piensa que estás ocupado / NO TE IMPORTAN */
  cut(17.05, 1); pop(17.32, .6);
  pop(18.25, .8);
  boom(19.06, 1.2); braam(19.08, [D2e, A2e, F3e, D4e], 2.4, .36, { attack: .1, bright: 7, decay: 1.8 });
  noise(19.06, .22, .18, { lp0: 5000, lp1: 500, attack: .04 });

  /* SELLO · COMO CONTESTÁS ES COMO TRABAJÁS */
  stamp(20.47, 1.2);
  braam(20.5, [D2e, A2e, D3e], 2.0, .28, { attack: .14, bright: 6, decay: 1.8 });
  stamp(21.58, 1.4);
  braam(21.6, [D2e, Bb2, F3e, Bb3], 2.4, .34, { attack: .1, bright: 7, decay: 1.9 });
  ding(21.66, 1318, .14, { dur: 1.5 });
  rise(22.5, .9, .9);

  /* REVEAL — acá el reloj se calla y todo pasa a mayor */
  cut(23.45, 1.3);
  boom(23.5, 1.1);
  braam(23.52, [D2e, A2e, D3e, A3e], 3.2, .36, { attack: .3, bright: 7, decay: 2.0 });
  ding(23.6, 1174, .16, { dur: 1.9 });
  teletype(24.05, 25.15, 1);
  sweep(25.22, .55, 95, 42, .24, { curve: 2 });
  ding(25.26, 1760, .1, { dur: 1.3 });
  pop(25.7, .8);

  /* ni un mensaje más sin responder */
  cut(26.75, .9); pop(27.0, .7);
  pluck(27.85, A3e, 1, -.2); kick(27.85, .6); ding(27.95, 1174, .1, { dur: 1.2 });

  /* CTA */
  cut(29.05, 1.1);
  boom(29.1, .85);
  braam(29.12, [D2e, A2e, D4e, A4e], 2.6, .3, { attack: .22, bright: 6, decay: 2 });
  ding(29.3, 1174, .14, { dur: 1.6 });
  for (let t = 29.5; t < 32.0; t += .5357) kick(t, .24);
  pop(30.5, 1.1); ding(30.75, 1480, .12, { dur: 1.2 });
  pop(31.15, .6, .2);
  ding(31.9, 2349, .07, { dur: 1.3, pan: .2 });
}

/* ============ VIDEO F · MANIFIESTO v2 ============
   El reloj corre todo el video (tensión) y se apaga en el reveal.
   Sellos de goma en las placas de papel, braams en cada acusación.  */
function scoreF() {
  const D2f = 73.4, A2f = 110, Bb2f = 116.5, D3f = 146.8, F3f = 174.6, A3f = 220,
        Bb3f = 233.1, D4f = 293.7, A4f = 440;
  const cut = (t, g = 1) => { noise(t - .12, .12, .1 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .5 * g); };
  const stamp = (t, g = 1) => {
    sweep(t, .1, 420, 90, .34 * g, { curve: 2.6, click: .3 * g });
    noise(t, .16, .2 * g, { lp0: 5000, lp1: 400, attack: .02 });
    sweep(t + .01, .5, 120, 44, .3 * g, { curve: 2.2 });
  };
  const slash = (t, g = 1, pan = 0) => noise(t, .17, .26 * g, { pan, lp0: 6000, lp1: 900, attack: .06 });

  /* colchón + reloj que no para hasta el reveal */
  pad(0.1, 17.2, [D2f, A2f], .085, { att: 1.3, rel: .3, breathe: .1 });
  pad(17.2, 26.0, [D2f, Bb2f, F3f], .08, { att: .7, rel: .3 });
  pad(26.1, 33.4, [D2f, A2f, D3f, A3f], .1, { att: 1.0, rel: 2.2, breathe: .2 });
  for (let t = 0.5, i = 0; t < 26.0; t += .5, i++) tick(t, i % 2 ? .28 : .4, i % 2 ? .35 : -.35, i % 2 ? 1230 : 1520);
  for (let t = 1.0; t < 13.8; t += 1.6) heart(t, .5);

  /* 01 · LO VISTE. */
  boom(0.1, 1.2); braam(0.12, [D2f, A2f, F3f], 2.0, .3, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.1, .3, .2, { lp0: 5200, lp1: 500, attack: .04 });
  tick(0.64, 1.1, .2, 2200); tick(0.72, .9, -.2, 2600);          /* los dos ✓✓ */
  /* 02 · NO CONTESTASTE. */
  cut(2.15, 1); pop(2.36, .8, -.3);
  boom(2.9, 1.05); braam(2.92, [D2f, A2f, Bb3f], 1.8, .3, { attack: .1, bright: 6, decay: 1.7 });
  /* 03 · placa dorada: YA LE COMPRÓ A OTRO */
  cut(4.2, 1.3);
  stamp(4.3, 1.3);
  braam(4.33, [D2f, Bb2f, F3f, Bb3f], 2.6, .36, { attack: .12, bright: 7, decay: 1.9 });
  pop(4.66, .9); pop(5.2, 1);
  ding(5.22, 1174, .12, { dur: 1.3 });
  /* 04 · 800 */
  cut(6.6, 1);
  { let last = 0;
    for (let t = 6.78; t < 7.72; t += 1 / 200) {
      const p = 1 - Math.pow(1 - iv(t, 6.78, 7.7), 5);
      const s = Math.floor(p * 28);
      if (s > last) { tick(t, .3 + p * .5, s % 2 ? .3 : -.3, 1400 + p * 950); last = s; }
    }
  }
  boom(6.78, .8); pop(7.4, .7, -.4);
  /* 05 · publicidad */
  cut(8.9, .9); pop(9.3, .8); pluck(9.72, D3f, .9, .2);
  /* 06 · ES UNA DECISIÓN */
  cut(11.3, .95); pop(11.5, .6);
  boom(12.2, 1.1); braam(12.22, [D2f, Bb2f, F3f], 2.0, .32, { attack: .1, bright: 7, decay: 1.7 });
  /* 07 · excusas */
  cut(13.9, .85);
  [14.02, 15.05, 16.08].forEach((t, i) => {
    if (i) cut(t, .65);
    pop(t + .02, .85, i % 2 ? .35 : -.35);
    slash(t + .4, 1, i % 2 ? .45 : -.45);
    kick(t + .42, .7);
  });
  rise(16.3, .85, .9);
  /* 08 · SELLO 2026 */
  stamp(17.26, 1.2);
  braam(17.3, [D2f, A2f, D3f], 2.2, .28, { attack: .16, bright: 6, decay: 1.9 });
  stamp(17.97, 1.4);
  braam(18.0, [D2f, Bb2f, F3f, A3f], 2.2, .32, { attack: .1, bright: 7, decay: 1.8 });
  ding(18.05, 1046, .12, { dur: 1.4 });
  /* 09 · NO TE IMPORTAN */
  cut(19.9, 1); pop(20.12, .6); pop(20.9, .8);
  boom(21.62, 1.2); braam(21.64, [D2f, A2f, F3f, D4f], 2.4, .36, { attack: .1, bright: 7, decay: 1.8 });
  noise(21.62, .22, .18, { lp0: 5000, lp1: 500, attack: .04 });
  /* 10 · SELLO trabajás */
  stamp(23.16, 1.2);
  braam(23.2, [D2f, A2f, D3f], 1.9, .26, { attack: .14, bright: 6, decay: 1.8 });
  stamp(24.08, 1.4);
  braam(24.1, [D2f, Bb2f, F3f, Bb3f], 2.3, .34, { attack: .1, bright: 7, decay: 1.9 });
  ding(24.15, 1318, .14, { dur: 1.5 });
  rise(25.1, .85, .9);
  /* 11 · REVEAL — el reloj se apaga */
  cut(26.0, 1.3);
  boom(26.05, 1.1);
  braam(26.07, [D2f, A2f, D3f, A3f], 3.2, .36, { attack: .3, bright: 7, decay: 2.0 });
  ding(26.15, 1174, .16, { dur: 1.9 });
  teletype(26.6, 27.65, 1);
  sweep(27.72, .55, 95, 42, .24, { curve: 2 });
  ding(27.76, 1760, .1, { dur: 1.3 });
  pop(28.15, .8);
  /* 12 · cierre */
  cut(29.2, 1.05);
  boom(29.25, .85);
  braam(29.27, [D2f, A2f, D4f, A4f], 2.6, .3, { attack: .22, bright: 6, decay: 2 });
  ding(29.45, 1174, .14, { dur: 1.6 });
  for (let t = 29.6; t < 32.6; t += .5357) kick(t, .24);
  pop(30.9, 1.1); ding(31.15, 1480, .12, { dur: 1.2 });
  pop(31.6, .6, .2);
  ding(32.4, 2349, .07, { dur: 1.2, pan: .2 });
}

/* ============ VIDEO G · PARO CARDÍACO ============
   El latido ES la música. Late · taquicardia · se apaga ·
   LÍNEA PLANA (silencio + tono) · reanimación en crescendo.        */
function scoreG() {
  const D2g = 73.4, A2g = 110, Bb2g = 116.5, D3g = 146.8, F3g = 174.6, A3g = 220,
        Bb3g = 233.1, D4g = 293.7, F4g = 349.2, A4g = 440;
  const cut = (t, g = 1) => { noise(t - .12, .12, .09 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .45 * g); };
  const stamp = (t, g = 1) => {
    sweep(t, .1, 420, 90, .32 * g, { curve: 2.6, click: .28 * g });
    noise(t, .16, .18 * g, { lp0: 5000, lp1: 400, attack: .02 });
    sweep(t + .01, .5, 120, 44, .28 * g, { curve: 2.2 });
  };
  const slash = (t, g = 1, pan = 0) => noise(t, .17, .24 * g, { pan, lp0: 6000, lp1: 900, attack: .06 });

  /* --- el corazón: lub-dub con cuerpo, bien audible --- */
  /* sl = 1 normal · >1 = se estira y baja de tono (el corazón se apaga) */
  const lub = (t, a, sl = 1) => {
    const k = Math.pow(sl, .75);
    sweep(t, .34 * sl, 80 / k, 33 / k, .62 * a, { curve: 2.5, click: .06 * a });
    noise(t, .12 * sl, .07 * a, { lp0: 240 / k, lp1: 70, attack: .12 });
  };
  const dub = (t, a, sl = 1) => { const k = Math.pow(sl, .75); sweep(t, .26 * sl, 63 / k, 29 / k, .38 * a, { curve: 2.8 }); };
  /* --- el monitor: también se apaga --- */
  const beep = (t, a, sl = 1) => ding(t, 990 / Math.pow(sl, .55), .075 * a, { dur: .16 * sl, pan: .12 });
  /* --- tono sostenido (línea plana) --- */
  function tone(t0, t1, f, g, { att = .06, rel = .05 } = {}) {
    const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor(t1 * SR));
    for (let i = n0; i < n1; i++) {
      const tt = i / SR;
      const env = Math.min(iv(tt, t0, t0 + att), 1 - iv(tt, t1 - rel, t1));
      const s = (Math.sin(2 * Math.PI * f * tt) + .14 * Math.sin(4 * Math.PI * f * tt)) * env * g;
      L[i] += s * .96; R[i] += s;
    }
  }
  const pip = (t, g, pan) => { ding(t, 1760, .05 * g, { dur: .17, pan }); ding(t + .05, 2349, .035 * g, { dur: .14, pan }); };

  /* ================= el pulso ================= */
  const HB = heartBeats();
  HB.forEach(b => {
    const sl = (b.d || .42) / .42;
    lub(b.t, b.a, sl);
    dub(b.t + .30 * sl, b.a * .72, sl);
    beep(b.t + .085 * sl, Math.min(1, b.a) * .55, sl);
  });

  /* ================= LÍNEA PLANA ================= */
  tone(FLAT.a + .06, FLAT.b, 1000, .085, { att: .12, rel: .015 });
  noise(FLAT.a, .5, .12, { lp0: 900, lp1: 120, attack: .05 });   /* el aire que se va */
  sweep(FLAT.a, 1.4, 60, 28, .3, { curve: 2.2 });

  /* ================= colchón (se apaga en el paro) ================= */
  pad(0.1, 16.9, [D2g, A2g], .075, { att: 1.3, rel: .4, breathe: .1 });
  pad(16.9, 28.6, [D2g, Bb2g, F3g], .07, { att: .8, rel: 1.8 });
  /* 28.70 → 33.20 · nada: sólo el tono. El silencio ES el efecto. */
  pad(33.35, 40.3, [D2g, A2g, D3g], .075, { att: 1.4, rel: .5 });
  pad(40.40, 47.7, [D2g, A2g, D3g, A3g, F4g], .105, { att: 1.0, rel: 2.2, breathe: .2 });

  /* ================= golpes ================= */
  /* 01-03 */
  boom(0.12, 1.15); braam(0.14, [D2g, A2g, F3g], 2.0, .28, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.12, .3, .18, { lp0: 5200, lp1: 500, attack: .04 });
  tick(0.72, 1.0, .2, 2200); tick(0.80, .85, -.2, 2600);
  cut(3.10, .95); pop(3.36, .75, -.3);
  boom(4.03, 1.0); braam(4.05, [D2g, A2g, Bb3g], 1.9, .28, { attack: .1, bright: 6, decay: 1.7 });
  cut(6.10, 1.25); stamp(6.20, 1.25);
  braam(6.23, [D2g, Bb2g, F3g, Bb3g], 2.7, .34, { attack: .12, bright: 7, decay: 1.9 });
  pop(6.62, .85); pop(7.27, .95); ding(7.30, 1174, .1, { dur: 1.3 });

  /* 04 · LA CASILLA EXPLOTA */
  cut(9.40, 1);
  rise(9.75, 3.9, 1.1);
  noise(9.80, 3.9, .045, { lp0: 200, lp1: 900, attack: .8 });
  for (let i = 0; i < 7; i++) pip(9.83 + i * .16, .9, i % 2 ? .4 : -.4);
  { let t = 10.95, iv2 = .115;
    while (t < 13.72) { pip(t, .38 + (13.72 - t) * .06, (rnd() - .5) * 1.4); t += iv2; iv2 = Math.max(.03, iv2 * .93); } }
  for (let t = 10.0; t < 13.8; t += .28) kick(t, .3);
  boom(13.72, .9);

  /* 05 · publicidad */
  cut(13.90, .9); pop(14.35, .75); pluck(15.05, D3g, .85, .2);

  /* 07 · las cuatro excusas */
  cut(16.90, .8);
  [17.08, 18.28, 19.48, 20.68].forEach((t, i) => {
    if (i) cut(t, .6);
    pop(t + .02, .8, i % 2 ? .35 : -.35);
    slash(t + .40, 1 + i * .08, i % 2 ? .45 : -.45);
    kick(t + .42, .6 + i * .07);
  });

  /* 07b · NO ES SÓLO LA ECONOMÍA · TAMBIÉN ES CULPA TUYA */
  cut(22.10, 1); pop(22.36, .55);
  pop(23.12, .8);
  boom(23.94, 1.2); braam(23.96, [D2g, Bb2g, F3g, D4g], 2.4, .34, { attack: .1, bright: 7, decay: 1.8 });
  noise(23.94, .22, .17, { lp0: 5000, lp1: 500, attack: .04 });

  /* 08 · no te importan */
  cut(25.40, .95); pop(25.64, .55); pop(26.38, .75);
  boom(27.16, 1.15); braam(27.18, [D2g, A2g, F3g, D4g], 2.3, .32, { attack: .1, bright: 7, decay: 1.8 });
  noise(27.16, .22, .16, { lp0: 5000, lp1: 500, attack: .04 });

  /* 09 · EL PARO en cámara lenta: los carteles entran con el tono desnudo */
  cut(28.70, .8);
  pop(29.95, .42, -.2); pop(31.05, .42, .2);

  /* 10 · REANIMACIÓN */
  noise(33.16, .14, .32, { lp0: 6000, lp1: 1500, attack: .5 });
  boom(33.30, 1.55);
  noise(33.30, .32, .3, { lp0: 6000, lp1: 400, attack: .03 });
  braam(33.33, [D2g, A2g, D3g, A3g], 3.6, .38, { attack: .26, bright: 7, decay: 2.0 });
  ding(33.40, 1174, .18, { dur: 2.1 });
  teletype(33.80, 35.05, 1);
  sweep(35.12, .55, 95, 42, .24, { curve: 2 });
  ding(35.16, 1760, .1, { dur: 1.3 });
  pop(35.65, .8);

  /* 11 · la casilla se vacía */
  cut(37.10, .9);
  for (let i = 0; i < 7; i++) {
    const t = 37.62 + i * .13;
    ding(t, 1318 + i * 90, .075, { dur: .5, pan: (i % 2 ? .35 : -.35) });
    tick(t, .4, i % 2 ? .3 : -.3, 2400);
  }
  ding(38.75, 1760, .12, { dur: 1.4 }); ding(38.85, 2349, .08, { dur: 1.2, pan: .2 });
  pluck(39.20, A3g, 1, -.2); pluck(39.60, D4g, 1.05, .2);

  /* 12 · sello final */
  stamp(40.46, 1.2);
  braam(40.50, [D2g, A2g, D3g], 2.0, .26, { attack: .14, bright: 6, decay: 1.8 });
  stamp(41.50, 1.4);
  braam(41.52, [D2g, Bb2g, F3g, Bb3g], 2.4, .32, { attack: .1, bright: 7, decay: 1.9 });
  ding(41.57, 1318, .13, { dur: 1.5 });

  /* 13 · cierre */
  cut(43.70, 1.05); boom(43.76, .8);
  braam(43.78, [D2g, A2g, D4g, A4g], 2.8, .3, { attack: .22, bright: 6, decay: 2 });
  ding(43.98, 1174, .13, { dur: 1.6 });
  pop(45.50, 1.05); ding(45.75, 1480, .11, { dur: 1.2 });
  pop(46.25, .6, .2);
  ding(46.90, 2349, .07, { dur: 1.2, pan: .2 });
}

/* ============ VIDEO H · ONE SHOT · la línea de tiempo del sonido ============
   máquina de escribir → teléfono a disco → notificación de oficina →
   notificación de chat. Todo sintetizado (nada de tonos de marca).      */
function scoreH() {
  const D2h = 73.4, A2h = 110, Bb2h = 116.5, D3h = 146.8, F3h = 174.6, A3h = 220,
        Bb3h = 233.1, D4h = 293.7, F4h = 349.2, A4h = 440, G2h = 98, C3h = 130.8;

  /* --- 1· MÁQUINA DE ESCRIBIR --- */
  const typeKey = (t, g = 1) => {
    noise(t, .022, .55 * g, { lp0: 6500, lp1: 2200, attack: .04, pan: (rnd() - .5) * .5 });
    sweep(t, .055, 340 + rnd() * 90, 130, .17 * g, { curve: 3, click: .22 * g });
  };
  const carriage = (t, g = 1) => {
    ding(t, 1568, .13 * g, { dur: .55, pan: .2 });
    noise(t + .07, .26, .16 * g, { lp0: 3200, lp1: 500, attack: .12 });
    sweep(t + .30, .07, 260, 120, .16 * g, { curve: 2.5, click: .2 * g });
  };
  /* --- 2· TELÉFONO A DISCO: campanilla + pulsos del disco --- */
  function bellRing(t0, dur, g = 1) {
    const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
    for (let i = n0; i < n1; i++) {
      const tt = (i - n0) / SR;
      const trem = .5 + .5 * Math.sin(2 * Math.PI * 19.5 * tt);
      const env = Math.min(1, tt / .015) * (1 - iv(tt, dur - .06, dur));
      const s = (Math.sin(2 * Math.PI * 1040 * tt) + .82 * Math.sin(2 * Math.PI * 1285 * tt)
               + .30 * Math.sin(2 * Math.PI * 2410 * tt)) * trem * env * g * .085;
      L[i] += s * .95; R[i] += s;
    }
  }
  const dialPulse = (t, n, g = 1) => {
    for (let i = 0; i < n; i++) {
      const tt = t + i * .092;
      noise(tt, .018, .3 * g, { lp0: 5000, lp1: 1400, attack: .05, pan: -.2 });
      sweep(tt, .04, 300, 150, .12 * g, { curve: 3 });
    }
    noise(t + n * .092, .34, .12 * g, { lp0: 1800, lp1: 400, attack: .1, pan: -.15 });  /* el disco vuelve */
  };
  /* --- 3· NOTIFICACIÓN DE OFICINA: golpecito de madera + destello --- */
  const blipOffice = (t, g = 1, pan = 0) => {
    sweep(t, .09, 260, 150, .26 * g, { pan, curve: 3.2, click: .12 * g });
    ding(t + .015, 1396, .07 * g, { dur: .3, pan });
    ding(t + .015, 2093, .035 * g, { dur: .22, pan });
  };
  /* --- 4· NOTIFICACIÓN DE CHAT: dos notas que suben --- */
  const blipChat = (t, g = 1, pan = 0) => {
    ding(t, 1318, .085 * g, { dur: .30, pan });
    ding(t + .085, 1976, .075 * g, { dur: .34, pan });
  };

  /* --- colchón continuo: una sola respiración, sin cortes --- */
  pad(0.2, 9.0, [D2h, A2h], .06, { att: 2.2, rel: .6, breathe: .12 });
  pad(8.5, 21.0, [D2h, A2h, D3h], .07, { att: 2.0, rel: .8 });
  pad(20.5, 32.8, [D2h, Bb2h, F3h], .075, { att: 1.8, rel: .8 });
  pad(32.4, 36.2, [D2h, Bb2h, F3h, Bb3h], .10, { att: 1.2, rel: .8 });   /* el alejamiento */
  pad(36.0, 44.1, [D2h, A2h, F3h], .075, { att: 1.2, rel: .6 });
  pad(43.9, 47.0, [D2h, A2h, D3h, A3h, F4h], .105, { att: 1.0, rel: 1.8, breathe: .2 });
  noise(0.2, 46.6, .012, { lp0: 300, lp1: 320, attack: .5 });            /* aire de archivo */

  /* 1 · el tipeo (mismo ritmo que en pantalla) */
  const TXT = 'EL MUNDO CAMBIÓ.', T0 = .45, T1 = 3.20;
  for (let i = 1; i <= TXT.length; i++) {
    const t = T0 + (i / TXT.length) * (T1 - T0);
    if (TXT[i - 1] === ' ') { sweep(t, .05, 180, 90, .1, { curve: 3 }); continue; }
    typeKey(t, .95 + rnd() * .25);
  }
  carriage(3.35, 1.05);
  noise(5.15, .8, .11, { lp0: 2600, lp1: 500, attack: .25 });          /* la hoja se aleja */
  noise(6.9, .9, .09, { lp0: 400, lp1: 1800, attack: .6 });            /* la caída */

  /* 2 · 2016 · el teléfono que ya nadie atiende */
  boom(8.70, .55);
  bellRing(8.75, 1.15, 1.0);
  bellRing(10.30, 1.05, .85);
  dialPulse(11.35, 7, .8);

  /* paso por lo oscuro */
  whoosh(11.95, .75, 1.05);
  boom(12.20, .8);
  noise(12.15, .5, .14, { lp0: 900, lp1: 180, attack: .3 });

  /* 3 · 2019 / 2021 · la oficina digital */
  blipOffice(13.95, 1.0, -.3);
  blipOffice(15.05, .9, .35);
  blipOffice(16.20, .85, -.2);
  whoosh(16.85, .5, .6, .4);                                            /* roza un recorte */
  boom(18.55, .5);
  blipOffice(18.75, 1.0, .3);
  blipOffice(19.85, .9, -.35);
  blipOffice(20.95, .95, .2);

  /* paso por lo oscuro */
  whoosh(21.55, .75, 1.0);
  boom(21.80, .8);
  noise(21.75, .5, .14, { lp0: 900, lp1: 180, attack: .3 });

  /* 4 · 2023 / 2026 · el chat, y después el enjambre */
  blipChat(23.55, 1.0, -.3);
  blipChat(24.65, .95, .3);
  blipChat(25.75, .95, -.2);
  whoosh(26.55, .55, .65, -.4);
  boom(28.35, .6);
  { let t = 28.55, iv2 = .52;
    while (t < 32.9) { blipChat(t, .55 + (32.9 - t) * .07, (rnd() - .5) * 1.5); t += iv2; iv2 = Math.max(.13, iv2 * .87); } }

  /* 5 · se eleva: se ve la pared entera */
  rise(32.5, 3.2, 1.15);
  boom(33.05, .95);
  braam(33.10, [D2h, Bb2h, F3h, Bb3h], 3.6, .30, { attack: .5, bright: 6, decay: 2.0 });
  { let t = 33.2, iv2 = .1;
    while (t < 35.7) { (rnd() < .5 ? blipChat : blipOffice)(t, .30 * (1 - iv(t, 33.2, 35.7)), (rnd() - .5) * 1.6); t += iv2; iv2 *= 1.15; } }

  /* 6 · se zambulle en lo oscuro y cae el remate */
  whoosh(35.50, .8, 1.1);
  boom(35.85, .9);
  noise(35.80, .55, .15, { lp0: 900, lp1: 180, attack: .3 });
  boom(37.25, .95);
  braam(37.28, [D2h, A2h, F3h], 2.4, .32, { attack: .12, bright: 7, decay: 1.8 });
  noise(37.25, .24, .17, { lp0: 5000, lp1: 500, attack: .04 });
  boom(38.00, .8); braam(38.03, [D2h, Bb2h, D4h], 2.2, .28, { attack: .1, bright: 6, decay: 1.8 });
  pop(39.40, .8); pop(40.05, .9);
  boom(40.07, .78); braam(40.10, [D2h, A2h, F3h, D4h], 2.0, .26, { attack: .1, bright: 6, decay: 1.8 });
  pop(41.60, .7); pop(42.25, .85);
  boom(42.27, .8); braam(42.30, [D2h, Bb2h, F3h], 2.2, .28, { attack: .1, bright: 7, decay: 1.8 });

  /* 7 · RESPONDE: y el último mensaje SÍ se contesta */
  boom(43.95, 1.0);
  braam(43.98, [D2h, A2h, D3h, A3h], 3.2, .34, { attack: .3, bright: 7, decay: 2.0 });
  ding(44.05, 1174, .15, { dur: 1.9 });
  teletype(44.25, 45.35, 1);
  sweep(45.42, .55, 95, 42, .22, { curve: 2 });
  blipChat(45.95, .9, 0);                        /* llega un mensaje… */
  ding(46.25, 1760, .12, { dur: .8 });           /* …y lo contestan */
  ding(46.34, 2637, .07, { dur: .7, pan: .2 });
  pop(46.05, .9);
}

/* ============ VIDEO I · TERMINAL ============
   Misma línea de tiempo sonora (máquina de escribir → teléfono a disco →
   notificación de oficina → notificación de chat), ahora sobre un
   instrumento que mide. Sobre la línea recta suena SIEMPRE la misma
   nota: no cambia nada.                                              */
function scoreI() {
  const D2i = 73.4, A2i = 110, Bb2i = 116.5, D3i = 146.8, F3i = 174.6, A3i = 220,
        Bb3i = 233.1, D4i = 293.7, F4i = 349.2, A4i = 440;
  const typeKey = (t, g = 1) => {
    noise(t, .020, .50 * g, { lp0: 6500, lp1: 2400, attack: .04, pan: (rnd() - .5) * .5 });
    sweep(t, .05, 360 + rnd() * 90, 140, .15 * g, { curve: 3, click: .20 * g });
  };
  const carriage = (t, g = 1) => { ding(t, 1568, .12 * g, { dur: .5, pan: .2 }); noise(t + .07, .24, .14 * g, { lp0: 3200, lp1: 500, attack: .12 }); };
  function bellRing(t0, dur, g = 1) {
    const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
    for (let i = n0; i < n1; i++) {
      const tt = (i - n0) / SR;
      const trem = .5 + .5 * Math.sin(2 * Math.PI * 19.5 * tt);
      const env = Math.min(1, tt / .015) * (1 - iv(tt, dur - .06, dur));
      const v = (Math.sin(2 * Math.PI * 1040 * tt) + .82 * Math.sin(2 * Math.PI * 1285 * tt)
              + .30 * Math.sin(2 * Math.PI * 2410 * tt)) * trem * env * g * .075;
      L[i] += v * .95; R[i] += v;
    }
  }
  const blipOffice = (t, g = 1, pan = 0) => {
    sweep(t, .09, 260, 150, .24 * g, { pan, curve: 3.2, click: .11 * g });
    ding(t + .015, 1396, .065 * g, { dur: .3, pan });
  };
  const blipChat = (t, g = 1, pan = 0) => { ding(t, 1318, .08 * g, { dur: .30, pan }); ding(t + .085, 1976, .07 * g, { dur: .34, pan }); };
  const plot = (t, g = 1, pan = 0, f = 2200) => sweep(t, .035, f, f * .55, .07 * g, { pan, curve: 2.2, click: .05 * g });
  function tone(t0, t1, f, g, { att = .5, rel = .5 } = {}) {
    const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor(t1 * SR));
    for (let i = n0; i < n1; i++) {
      const tt = i / SR;
      const env = Math.min(iv(tt, t0, t0 + att), 1 - iv(tt, t1 - rel, t1));
      const v = (Math.sin(2 * Math.PI * f * tt) + .10 * Math.sin(4 * Math.PI * f * tt)) * env * g;
      L[i] += v * .96; R[i] += v;
    }
  }

  /* colchón continuo */
  pad(0.2, 14.0, [D2i, A2i], .062, { att: 2.0, rel: .6, breathe: .12 });
  pad(13.5, 24.6, [D2i, A2i, D3i], .07, { att: 1.8, rel: .8 });
  pad(24.2, 27.7, [D2i, Bb2i, F3i, Bb3i], .10, { att: 1.0, rel: .8 });
  pad(27.5, 33.7, [D2i, A2i], .055, { att: 1.6, rel: 1.2, breathe: .06 });   /* la recta: casi nada */
  pad(33.5, 43.2, [D2i, Bb2i, F3i], .075, { att: 1.2, rel: .8 });
  pad(43.0, 46.0, [D2i, A2i, D3i, A3i, F4i], .105, { att: 1.0, rel: 1.6, breathe: .2 });
  noise(0.2, 45.7, .011, { lp0: 300, lp1: 320, attack: .5 });

  /* 1 · el encabezado se tipea */
  const TXT = 'EL MUNDO CAMBIÓ.', T0 = .55, T1 = 3.60;
  for (let i = 1; i <= TXT.length; i++) {
    const t = T0 + (i / TXT.length) * (T1 - T0);
    if (TXT[i - 1] === ' ') { sweep(t, .05, 180, 90, .09, { curve: 3 }); continue; }
    typeKey(t, .95 + rnd() * .25);
  }
  carriage(3.72, 1.0);
  noise(5.15, .8, .10, { lp0: 2600, lp1: 500, attack: .25 });

  /* 2 · la curva se desploma · el teléfono de 2016 */
  boom(7.15, .6);
  bellRing(7.55, 1.05, .95);
  bellRing(9.05, .95, .70);
  { let t = 7.45; while (t < 12.85) { plot(t, .8, (rnd() - .5) * 1.2, 1900 + rnd() * 700); t += .105; } }
  [7.90, 9.90, 11.30].forEach((t, i) => ding(t, 1174 - i * 60, .085, { dur: .5, pan: i % 2 ? .3 : -.3 }));
  /* entra en zona crítica: alarma */
  ding(12.70, 880, .12, { dur: .9 }); boom(12.75, .75);
  noise(12.70, .24, .14, { lp0: 4200, lp1: 500, attack: .05 });
  ding(12.95, 660, .09, { dur: 1.0 });

  /* 3 · el canal se da vuelta */
  boom(14.95, .55);
  bellRing(15.15, .55, .38); bellRing(15.90, .45, .22);
  blipOffice(16.25, .9, -.3); blipOffice(16.80, .9, .35);
  blipChat(17.15, .95, -.2); blipChat(17.50, 1.0, .3);
  { let t = 15.2; while (t < 17.5) { plot(t, .55, (rnd() - .5) * 1.3, 2400 + rnd() * 600); t += .16; } }
  /* punto de cruce */
  ding(17.05, 784, .10, { dur: .8 });

  /* 4 · cuándo escriben: de noche, sueltos */
  boom(19.55, .5);
  { let t = 19.8; while (t < 22.0) { plot(t, .5, (rnd() - .5) * 1.4, 2600 + rnd() * 800); t += .1; } }
  blipChat(20.50, .7, .4); blipChat(21.30, .8, -.35); blipChat(22.00, .9, .2);

  /* 5 · se aleja: los tres juntos */
  rise(24.1, 2.5, 1.1);
  boom(24.65, .95);
  braam(24.70, [D2i, Bb2i, F3i, Bb3i], 3.0, .30, { attack: .45, bright: 6, decay: 2.0 });

  /* 6 · LA RECTA · la misma nota seis veces: no cambia nada */
  boom(27.55, .65);
  noise(27.55, .3, .12, { lp0: 3000, lp1: 400, attack: .1 });
  tone(27.70, 33.50, 220, .030, { att: 1.0, rel: 1.2 });
  [28.10, 29.10, 30.10, 31.10, 32.10, 33.10].forEach(t => {
    ding(t, 880, .078, { dur: .8 });          /* SIEMPRE la misma */
    plot(t, .5, 0, 1600);
  });

  /* 7 · el remate */
  boom(36.45, .95);
  braam(36.50, [D2i, A2i, F3i], 2.6, .32, { attack: .14, bright: 7, decay: 1.8 });
  noise(36.45, .24, .16, { lp0: 5000, lp1: 500, attack: .04 });
  boom(38.15, .85); braam(38.20, [D2i, Bb2i, D4i], 2.4, .30, { attack: .1, bright: 6, decay: 1.8 });
  pop(39.45, .75); pop(39.90, .8);

  /* 8 · RESPONDE · y el mensaje que sí se contesta */
  boom(43.15, 1.0);
  braam(43.20, [D2i, A2i, D3i, A3i], 3.0, .34, { attack: .3, bright: 7, decay: 2.0 });
  ding(43.28, 1174, .15, { dur: 1.8 });
  teletype(43.50, 44.65, 1);
  sweep(44.72, .55, 95, 42, .22, { curve: 2 });
  blipChat(45.15, .9, 0);
  ding(45.42, 1760, .12, { dur: .75 });
  ding(45.50, 2637, .07, { dur: .65, pan: .2 });
  pop(45.22, .85);
}

/* ============ LA CENA · cuerdas clásicas ============
   Tenue casi todo el tiempo. En el silencio (25→34) se corta TODO:
   sólo el salón y el teléfono vibrando. Stinger seco en el latigazo
   y resolución en mayor al final.                                   */
function scoreJ() {
  const A1=55, E2j=82.4, A2j=110, B2j=123.5, C3j=130.8, D3j=146.8, E3j=164.8, F3j=174.6,
        G3j=196, A3j=220, C4j=261.6, D4j=293.7, E4j=329.6, G4j=392, F2j=87.3;

  /* --- cuerdas: ataque lento, vibrato, cálidas --- */
  function strings(t0, t1, freqs, gain, { att = 1.4, rel = 1.8, vib = 5.1, vdep = .0035, harm = 3 } = {}) {
    const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor(t1 * SR));
    const dets = freqs.flatMap(f => [f, f * 1.0035]);
    const phs = dets.map(() => rnd() * 6.28);
    for (let i = n0; i < n1; i++) {
      const tt = i / SR;
      const env = Math.min(1, iv(tt, t0, t0 + att)) * (1 - EinQuad(iv(tt, t1 - rel, t1)));
      if (env <= 0) continue;
      const vibr = 1 + vdep * Math.sin(2 * Math.PI * vib * tt);
      let v = 0;
      for (let k = 0; k < dets.length; k++) {
        const f = dets[k] * vibr;
        for (let h = 1; h <= harm; h++) v += Math.sin(2 * Math.PI * f * h * tt + phs[k] * h) / (h * h * 1.15);
      }
      v = v / dets.length * env * gain;
      L[i] += v * .94; R[i] += v;
    }
  }
  /* --- pizzicato / nota suelta --- */
  const pizz = (t, f, g = 1, pan = 0) => {
    const [pl, pr] = panLR(pan);
    const n0 = Math.max(0, Math.floor(t * SR)), n1 = Math.min(N, n0 + Math.floor(1.6 * SR));
    for (let i = n0; i < n1; i++) {
      const tt = (i - n0) / SR;
      const v = (Math.sin(2*Math.PI*f*tt) + .34*Math.sin(4*Math.PI*f*tt) + .14*Math.sin(6*Math.PI*f*tt))
              * Math.exp(-2.6 * tt) * .085 * g * (1 - Math.exp(-tt * 500));
      L[i] += v * pl; R[i] += v * pr;
    }
  };
  /* --- golpe seco de cuerdas --- */
  const stinger = (t, freqs, g = 1) => {
    const n0 = Math.max(0, Math.floor(t * SR)), n1 = Math.min(N, n0 + Math.floor(1.1 * SR));
    const dets = freqs.flatMap(f => [f, f * 1.006]);
    const phs = dets.map(() => rnd() * 6.28);
    for (let i = n0; i < n1; i++) {
      const tt = (i - n0) / SR;
      const env = Math.min(1, tt / .012) * Math.exp(-4.6 * tt);
      let v = 0;
      for (let k = 0; k < dets.length; k++)
        for (let h = 1; h <= 5; h++) v += Math.sin(2*Math.PI*dets[k]*h*tt + phs[k]*h) / (h * 1.3);
      v = v / dets.length * env * g * .16;
      L[i] += v * .95; R[i] += v;
    }
    noise(t, .1, .07 * g, { lp0: 3500, lp1: 900, attack: .03 });
  };
  /* --- el teléfono vibrando sobre la mesa --- */
  const vibrate = (t, g = 1) => {
    for (const off of [0, .42]) {
      const t0 = t + off, dur = .34;
      const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor((t0 + dur) * SR));
      for (let i = n0; i < n1; i++) {
        const tt = (i - n0) / SR;
        const env = Math.min(1, tt / .02) * (1 - iv(tt, dur - .05, dur));
        const am = .55 + .45 * Math.sin(2 * Math.PI * 47 * tt);
        const v = (Math.sin(2*Math.PI*103*tt) + .5*Math.sin(2*Math.PI*206*tt)) * am * env * .085 * g;
        L[i] += v * .9; R[i] += v;
      }
      noise(t0, dur, .035 * g, { lp0: 1400, lp1: 700, attack: .1, pan: .15 });   /* el traqueteo sobre la madera */
    }
  };
  /* --- salón: ambiente lejano --- */
  function room(t0, t1, g = 1) {
    noise(t0, t1 - t0, .020 * g, { lp0: 420, lp1: 460, attack: .4 });
    let t = t0 + 1.2;
    while (t < t1 - 1) {
      if (rnd() < .55) ding(t, 2200 + rnd() * 1800, .012 + rnd() * .01, { dur: .35, pan: (rnd() - .5) * 1.6 });
      t += .9 + rnd() * 1.8;
    }
  }

  /* ================= la cena ================= */
  room(0.1, 34.6, 1.0);
  room(43.4, 50.8, .7);

  /* 0 → 16 · cuerdas cálidas, casi imperceptibles */
  strings(0.4, 16.6, [A2j, E3j, A3j], .062, { att: 2.4, rel: 1.6 });
  strings(5.6, 16.6, [C4j, E4j], .030, { att: 2.6, rel: 1.6 });
  /* el motivo asoma… */
  [[2.2,A3j],[3.8,C4j],[5.4,E4j],[7.0,A3j]].forEach(([t,f],i)=> pizz(t, f, .8, (i%2?.25:-.25)));
  /* …y de acá al silencio NO PARA: ostinato que crece */
  { const OST=[A3j,C4j,E4j,C4j]; let t=8.2,k=0;
    while (t<15.9){ pizz(t, OST[k%4], .62+(t-8.2)*.035, (k%2?.22:-.22)); t+=.80; k++; } }

  /* 16 → 25 · se pone seria/enojada: mismo pulso, más oscuro, más hondo */
  strings(15.9, 24.9, [F2j, C3j, F3j], .078, { att: 1.4, rel: .9 });
  strings(19.0, 24.9, [A2j, C3j], .055, { att: 1.6, rel: .8 });
  { const OST=[F3j,A3j,C4j,A3j]; let t=16.1,k=0;
    while (t<24.35){ pizz(t, OST[k%4], .72+(t-16.1)*.055, (k%2?.26:-.26)); t+=.66; k++; } }
  pizz(24.55, F3j, 1.25, 0);                       /* la última nota antes del vacío */

  /* 25 → 34 · EL SILENCIO · sólo el salón y el teléfono */
  vibrate(26.2, 1.0);
  vibrate(29.0, .9);
  vibrate(32.4, 1.0);

  /* 34 · el latigazo */
  stinger(34.00, [A2j, E3j, A3j], 1.25);
  sweep(34.00, .9, 62, 31, .30, { curve: 2 });
  strings(34.15, 40.7, [A2j, E3j], .055, { att: .5, rel: .9 });
  stinger(35.55, [F2j, C3j, F3j], .85);
  stinger(36.90, [A2j, E3j, A3j], 1.05);
  stinger(38.15, [D3j, A3j, D4j], 1.30);           /* CONTRATÁ RESPONDE */
  noise(38.15, .2, .11, { lp0: 4200, lp1: 600, attack: .04 });
  sweep(38.15, .8, 66, 33, .22, { curve: 2 });

  /* 38,6 → 43,6 · los mensajes se contestan solos */
  strings(40.3, 44.4, [C3j, G3j, C4j], .062, { att: 1.0, rel: 1.0 });
  for (let k = 0; k < 5; k++) {
    const t = 40.95 + k * .48;
    ding(t, [1046,1174,1318,1568,1760][k], .085, { dur: .55, pan: (k%2?.3:-.3) });
    pizz(t, [C4j,D4j,E4j,G4j,C4j*2][k], .55, (k%2?.2:-.2));
  }

  /* 43,6 → 51 · resolución en mayor */
  strings(43.9, 50.9, [C3j, E3j, G3j, C4j], .085, { att: 1.6, rel: 2.4 });
  strings(46.6, 50.9, [E4j, G4j], .034, { att: 1.6, rel: 2.4 });
  pizz(44.6, G3j, .8, -.2);
  sweep(46.80, .7, 70, 36, .16, { curve: 2 });
  ding(47.15, 1046, .09, { dur: 1.6 });
  pizz(48.35, C4j, .85, .2); pizz(49.0, E4j, .8, -.15);
  ding(49.9, 2093, .05, { dur: 1.4, pan: .2 });
}

/* ============ VIDEO K · EL CONTROL ============
   Interrogatorio: pulso continuo que se hunde con cada ☒,
   pánico con la checklist en rojo, reveal, y los ✓ como
   campanitas ascendentes. Sin frenos hasta el freno.        */
function scoreK() {
  const D2k = 73.4, A2k = 110, Bb2k = 116.5, D3k = 146.8, F3k = 174.6, A3k = 220,
        Bb3k = 233.1, D4k = 293.7, F4k = 349.2, A4k = 440, G2k = 98, C3k = 130.8;
  const cut = (t, g = 1) => { noise(t - .12, .12, .09 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .45 * g); };
  const stamp = (t, g = 1) => {
    sweep(t, .1, 420, 90, .30 * g, { curve: 2.6, click: .26 * g });
    noise(t, .16, .17 * g, { lp0: 5000, lp1: 400, attack: .02 });
    sweep(t + .01, .5, 120, 44, .26 * g, { curve: 2.2 });
  };
  const xmark = (t, g = 1) => {                      /* la tachadura: dos trazos secos */
    noise(t, .09, .22 * g, { lp0: 5600, lp1: 1200, attack: .05, pan: -.2 });
    noise(t + .11, .09, .20 * g, { lp0: 5200, lp1: 1100, attack: .05, pan: .2 });
    sweep(t + .12, .4, 100, 46, .22 * g, { curve: 2.4 });
  };

  /* colchón + pulso continuo que NUNCA frena hasta el pánico */
  pad(0.1, 16.3, [D2k, A2k], .075, { att: 1.6, rel: .4, breathe: .1 });
  pad(16.3, 23.8, [D2k, Bb2k, F3k], .08, { att: .8, rel: .6 });
  pad(24.0, 31.3, [D2k, A2k, D3k], .075, { att: 1.2, rel: .5 });
  pad(31.5, 38.8, [D2k, A2k, D3k, A3k, F4k], .10, { att: 1.0, rel: 1.8, breathe: .2 });
  { /* ostinato del interrogatorio: crece y se aprieta hasta el corte */
    let t = 1.2, k = 0, ivv = .72;
    while (t < 22.4) {
      pluck(t, [A2k, D3k, F3k, D3k][k % 4], .5 + (t / 22.4) * .55, (k % 2 ? .22 : -.22));
      if (k % 2 === 0) kick(t, .26 + (t / 22.4) * .2);
      t += ivv; ivv = Math.max(.42, ivv - .008); k++;
    }
  }

  /* golpe 1 · la pregunta madre */
  boom(0.14, 1.1); braam(0.16, [D2k, A2k, F3k], 2.0, .28, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.14, .28, .17, { lp0: 5200, lp1: 500, attack: .04 });
  sweep(0.78, .5, 110, 48, .22, { curve: 2.2 });
  /* las tachaduras (una por casilla) */
  [2.30, 5.85, 8.75, 12.05, 15.75, 18.85, 22.05].forEach((t, i) => xmark(t, .85 + i * .05));
  /* cortes secos entre placas */
  [2.90, 6.40, 9.30, 12.60, 19.40].forEach(t => cut(t, .9));
  /* golpe 2 · ráfaga de preguntas */
  [3.08, 4.05, 5.02].forEach((t, i) => { pop(t + .02, .85, i % 2 ? .35 : -.35); tick(t + .02, .7, 0, 1700 + i * 150); });
  /* golpes 3-4 · las respuestas que duelen */
  sweep(7.78, .5, 130, 52, .22, { curve: 2.2 }); boom(7.80, .7);
  sweep(10.88, .5, 130, 52, .2, { curve: 2.2 }); boom(10.90, .65);
  /* golpe 5 · la lotería en papel */
  stamp(16.35, 1.25);
  braam(16.38, [D2k, Bb2k, F3k, Bb3k], 2.4, .32, { attack: .12, bright: 7, decay: 1.9 });
  sweep(17.58, .5, 120, 50, .2, { curve: 2.2 });
  /* golpe 7 · la pregunta del título */
  boom(19.65, 1.0); braam(19.67, [D2k, A2k, F3k, D4k], 2.2, .32, { attack: .1, bright: 7, decay: 1.8 });
  /* golpe 8 · PÁNICO: todo tachado */
  cut(22.60, 1.2);
  tone_k(22.75, 23.85, 196, .05);
  noise(22.6, 1.25, .05, { lp0: 300, lp1: 700, attack: .5 });
  /* golpe 9 · REVEAL */
  boom(23.95, 1.3);
  braam(23.98, [D2k, A2k, D3k, A3k], 3.2, .36, { attack: .28, bright: 7, decay: 2.0 });
  ding(24.05, 1174, .16, { dur: 1.9 });
  teletype(24.45, 25.50, 1);
  sweep(25.58, .5, 95, 42, .22, { curve: 2 });
  pop(26.0, .8);
  /* golpe 10 · los ✓ vuelven: campanitas ascendentes */
  const OKS = [0,1,2,3,4,5,6].map(i => 27.55 + i * .42);
  OKS.forEach((t, i) => { ding(t, 880 * Math.pow(2, i / 12 * 2), .09, { dur: .6, pan: (i % 2 ? .3 : -.3) }); tick(t, .5, 0, 2400); });
  [27.40, 28.55, 29.75].forEach((t, i) => pop(t + .02, .8, i % 2 ? .3 : -.3));
  pad(27.3, 31.3, [C3k, G3, C4], .05, { att: 1.0, rel: .8 });
  /* golpe 11 · recuperá el control */
  stamp(31.45, 1.35);
  braam(31.48, [D2k, A2k, D3k, F4k], 2.6, .34, { attack: .12, bright: 6, decay: 1.9 });
  ding(31.55, 1318, .13, { dur: 1.5 });
  /* golpe 12 · cierre */
  cut(34.40, 1.0); boom(34.46, .8);
  braam(34.48, [D2k, A2k, D4k, A4k], 2.6, .3, { attack: .22, bright: 6, decay: 2 });
  ding(34.66, 1174, .13, { dur: 1.6 });
  for (let t = 34.8; t < 38.2; t += .5357) kick(t, .22);
  pop(35.90, 1.0); ding(36.15, 1480, .11, { dur: 1.2 });
  pop(36.60, .6, .2);
  ding(37.60, 2349, .07, { dur: 1.2, pan: .2 });
}
/* VIDEO N · "EL MOSTRADOR": firma de la serie, 49.6 s.
   Nuevo golpe 6b: el problema real (empresa/márgenes/intermediarios)
   con tres caídas descendentes. Efectos al frente. */
function scoreN() {
  const D2k = 73.4, A2k = 110, Bb2k = 116.5, D3k = 146.8, F3k = 174.6, A3k = 220,
        Bb3k = 233.1, D4k = 293.7, F4k = 349.2, A4k = 440, G2k = 98, C3k = 130.8;
  const cut = (t, g = 1) => { noise(t - .12, .12, .12 * g, { lp0: 3000, lp1: 800, attack: .8 }); boom(t, .56 * g); };
  const stamp = (t, g = 1) => {
    sweep(t, .1, 420, 90, .38 * g, { curve: 2.6, click: .33 * g });
    noise(t, .16, .22 * g, { lp0: 5000, lp1: 400, attack: .02 });
    sweep(t + .01, .5, 120, 44, .32 * g, { curve: 2.2 });
  };
  const xmark = (t, g = 1) => {                      /* la hora que se come: dos trazos secos */
    noise(t, .09, .29 * g, { lp0: 5600, lp1: 1200, attack: .05, pan: -.2 });
    noise(t + .11, .09, .27 * g, { lp0: 5200, lp1: 1100, attack: .05, pan: .2 });
    sweep(t + .12, .4, 100, 46, .28 * g, { curve: 2.4 });
  };
  const caida = (t, i) => {                          /* la mala noticia: golpe que cae */
    boom(t, .85);
    sweep(t + .02, .55, 210 - i * 28, 50, .30, { curve: 2.2 });
    tick(t, .6, 0, 1100 - i * 180);
    noise(t, .12, .14, { lp0: 2400, lp1: 500, attack: .1, pan: (i % 2 ? .25 : -.25) });
  };

  pad(0.1, 19.2, [D2k, A2k], .068, { att: 1.6, rel: .4, breathe: .1 });
  pad(19.2, 32.6, [D2k, Bb2k, F3k], .072, { att: .8, rel: .6 });
  pad(32.8, 40.9, [D2k, A2k, D3k], .068, { att: 1.2, rel: .5 });
  pad(41.1, 53.6, [D2k, A2k, D3k, A3k, F4k], .095, { att: 1.0, rel: 1.8, breathe: .2 });
  { /* ostinato del día que se acelera hasta el pánico */
    let t = 1.2, k = 0, ivv = .74;
    while (t < 30.7) {
      pluck(t, [A2k, D3k, F3k, D3k][k % 4], .5 + (t / 30.7) * .55, (k % 2 ? .22 : -.22));
      if (k % 2 === 0) kick(t, .26 + (t / 30.7) * .2);
      t += ivv; ivv = Math.max(.42, ivv - .007); k++;
    }
  }

  /* golpe 1 · el sueño del dueño */
  boom(0.14, 1.2); braam(0.16, [D2k, A2k, F3k], 2.0, .31, { attack: .1, bright: 7, decay: 1.7 });
  noise(0.14, .28, .21, { lp0: 5200, lp1: 500, attack: .04 });
  sweep(0.88, .5, 110, 48, .27, { curve: 2.2 });
  /* las 8 horas que se come el día (doble mordida en el golpe 5; la última cae con el mundo achicándose) */
  [2.75, 6.90, 10.45, 14.15, 18.20, 18.65, 22.15, 27.00].forEach((t, i) => xmark(t, .92 + i * .045));
  /* cortes secos entre placas */
  [3.40, 7.60, 11.10, 14.90, 23.00, 27.60].forEach(t => cut(t, .95));
  /* golpe 2 · la ráfaga de lo de siempre */
  [3.58, 4.65, 5.72].forEach((t, i) => { pop(t + .02, 1.0, i % 2 ? .35 : -.35); tick(t + .02, .85, 0, 1700 + i * 150); });
  /* golpes 3-4 · las respuestas que duelen */
  sweep(9.33, .5, 130, 52, .27, { curve: 2.2 }); boom(9.35, .82);
  sweep(12.93, .5, 130, 52, .25, { curve: 2.2 }); boom(12.95, .76);
  /* golpe 5 · el día se fue */
  sweep(17.28, .5, 130, 52, .25, { curve: 2.2 }); boom(17.30, .7);
  /* golpe 6 · el empleado más caro, en papel */
  stamp(19.25, 1.45);
  braam(19.28, [D2k, Bb2k, F3k, Bb3k], 2.4, .35, { attack: .12, bright: 7, decay: 1.9 });
  sweep(20.63, .5, 120, 50, .24, { curve: 2.2 });
  /* golpe 6b · el problema real: tres caídas */
  tick(23.20, .7, 0, 1500);
  caida(23.90, 0); caida(25.00, 1); caida(26.10, 2);
  braam(26.12, [D2k, Bb2k, D3k], 1.6, .22, { attack: .15, bright: 6, decay: 1.4 });
  /* golpe 7 · la pregunta que duele */
  boom(28.05, 1.1); braam(28.07, [D2k, A2k, F3k, D4k], 2.2, .35, { attack: .1, bright: 7, decay: 1.8 });
  sweep(29.23, .5, 120, 50, .24, { curve: 2.2 });
  /* golpe 8 · PÁNICO: el día en cero */
  cut(31.20, 1.35);
  tone_k(31.35, 32.65, 196, .06);
  noise(31.2, 1.45, .06, { lp0: 300, lp1: 700, attack: .5 });
  /* golpe 9 · REVEAL */
  boom(32.75, 1.45);
  braam(32.78, [D2k, A2k, D3k, A3k], 3.2, .40, { attack: .28, bright: 7, decay: 2.0 });
  ding(32.85, 1174, .20, { dur: 1.9 });
  teletype(33.25, 34.35, 1.15);
  sweep(34.43, .5, 95, 42, .27, { curve: 2 });
  pop(34.85, .95);
  /* golpe 10 · las 8 horas vuelven en oro: campanitas ascendentes */
  const OKSn = [0,1,2,3,4,5,6,7].map(i => 36.55 + i * .42);
  OKSn.forEach((t, i) => { ding(t, 880 * Math.pow(2, i / 12 * 1.8), .115, { dur: .6, pan: (i % 2 ? .3 : -.3) }); tick(t, .65, 0, 2400); });
  [36.40, 37.75, 39.10].forEach((t, i) => pop(t + .02, .95, i % 2 ? .3 : -.3));
  pad(36.3, 40.9, [C3k, G3, C4], .05, { att: 1.0, rel: .8 });
  /* golpe 11 · volvé a ser el dueño */
  stamp(41.05, 1.55);
  braam(41.08, [D2k, A2k, D3k, F4k], 2.6, .37, { attack: .12, bright: 6, decay: 1.9 });
  ding(41.18, 1318, .16, { dur: 1.5 });
  /* golpe 12 · cierre */
  cut(44.50, 1.15); boom(44.56, .95);
  braam(44.58, [D2k, A2k, D4k, A4k], 2.6, .33, { attack: .22, bright: 6, decay: 2 });
  ding(44.76, 1174, .16, { dur: 1.6 });
  for (let t = 44.90, i = 0; t < 52.90; t += .5357, i++) kick(t, .24);
  pop(46.10, 1.15); ding(46.35, 1480, .14, { dur: 1.2 });
  pop(47.05, .8, .2);
  ding(48.00, 2349, .09, { dur: 1.2, pan: .2 });
  /* la estrella se queda: capa alta + destello + aterrizaje */
  pad(47.0, 53.5, [D3k, A3k, D4k, F4k], .045, { att: 2.0, rel: 2.2 });
  ding(49.40, 1760, .07, { dur: 1.4, pan: -.2 });
  noise(50.30, .35, .07, { lp0: 2200, lp1: 6500, attack: .3 });
  ding(50.42, 1975, .10, { dur: 1.3, pan: .15 });
  ding(52.30, 1174, .11, { dur: 2.2 });
}
/* tono sostenido corto para el pánico */
function tone_k(t0, t1, f, g) {
  const n0 = Math.max(0, Math.floor(t0 * SR)), n1 = Math.min(N, Math.floor(t1 * SR));
  for (let i = n0; i < n1; i++) {
    const tt = i / SR;
    const env = Math.min(iv(tt, t0, t0 + .15), 1 - iv(tt, t1 - .08, t1));
    const v = (Math.sin(2 * Math.PI * f * tt) + .12 * Math.sin(4 * Math.PI * f * tt)) * env * g;
    L[i] += v * .95; R[i] += v;
  }
}

({ a: scoreA, b: scoreB, c: scoreC, d: scoreD, e: scoreE, f: scoreF, g: scoreG, h: scoreH, i: scoreI, j: scoreJ, k: scoreK, n: scoreN })[VIDEO]();

/* ------- master ------- */
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = clamp01(t / .08) * (1 - EinQuad(iv(t, DUR - .7, DUR - .05)));
  L[i] = Math.tanh(L[i] * 1.22) * .92 * g;
  R[i] = Math.tanh(R[i] * 1.22) * .92 * g;
}
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = peak > 0 ? .89 / peak : 1;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
}
writeFileSync(join(HERE, `mix-${VIDEO}.wav`), buf);
console.log(`mix-${VIDEO}.wav listo · peak`, peak.toFixed(2));
