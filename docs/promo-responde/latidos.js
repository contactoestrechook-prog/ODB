/* ==================================================================
   LATIDOS · fuente única de verdad del pulso del video G.
   La usan la composición (ECG en pantalla) y el score (audio),
   así el latido que se ve y el que se escucha son el mismo.
   Cada latido lleva su duración `d`: al apagarse se ESTIRA (cámara
   lenta) y el audio baja de tono con la misma proporción.
   ================================================================== */
function heartBeats() {
  const B = [];
  let t, iv, a, d;
  /* ACTO 1 · vivo, 70 lpm */
  t = 0.30; while (t < 9.35) { B.push({ t, a: 1.0, d: 0.42 }); t += 0.86; }
  /* ACTO 2 · pánico: la casilla explota */
  t = 9.52; iv = 0.60;
  while (t < 16.85) { B.push({ t, a: 1.14, d: 0.36 }); t += iv; iv = Math.max(0.40, iv - 0.022); }
  /* ACTO 3 · se apaga: más lento, más débil y cada vez más ESTIRADO */
  t = 17.05; iv = 0.62; a = 1.0; d = 0.45;
  while (t < 28.65) { B.push({ t, a: Math.max(0.10, a), d }); t += iv; iv += 0.085; a -= 0.075; d += 0.05; }
  /* 28.70 → 33.20 · LÍNEA PLANA (sin latidos) */
  /* ACTO 4 · reanimación: vuelve y se hace fuerte */
  B.push({ t: 33.30, a: 1.90, d: 0.50 });
  B.push({ t: 34.35, a: 0.90, d: 0.46 });
  B.push({ t: 35.20, a: 1.10, d: 0.44 });
  t = 36.00; while (t < 47.8) { B.push({ t, a: 1.20, d: 0.42 }); t += 0.78; }
  return B;
}
const FLAT = { a: 28.70, b: 33.20 };   /* ventana de línea plana */

/* velocidad de barrido del ECG: se arrastra mientras el corazón se apaga
   y vuelve de golpe con la reanimación → lectura de cámara lenta */
function ecgSpeedAt(t) {
  const F = 265, S = 88;
  if (t < 25.5) return F;
  if (t < 29.4) return F + (S - F) * ((t - 25.5) / 3.9);
  if (t < 33.28) return S;
  if (t < 34.0) return S + (F - S) * ((t - 33.28) / 0.72);
  return F;
}

/* forma PQRST normalizada: u ∈ [0,1] recorre un latido */
function pqrst(u) {
  if (u < 0 || u > 1) return 0;
  let y = 0.09 * Math.exp(-Math.pow((u - 0.11) / 0.055, 2));      // P
  if (u > 0.24 && u < 0.38) {                                      // QRS
    const p = (u - 0.24) / 0.14;
    if (p < 0.28) y += -0.16 * (p / 0.28);
    else if (p < 0.52) y += -0.16 + 1.16 * ((p - 0.28) / 0.24);
    else if (p < 0.72) y += 1.00 - 1.32 * ((p - 0.52) / 0.20);
    else y += -0.32 + 0.32 * ((p - 0.72) / 0.28);
  }
  y += 0.20 * Math.exp(-Math.pow((u - 0.60) / 0.09, 2));           // T
  return y;
}

if (typeof module !== 'undefined') module.exports = { heartBeats, pqrst, FLAT, ecgSpeedAt };
