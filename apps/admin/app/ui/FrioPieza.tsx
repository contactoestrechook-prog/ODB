'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Frío · la pieza (Leandro, 3/11/2026: «un módulo gráfico muy potente»).
// Cada equipo es una columna: arriba la temperatura de ahora, grande; abajo una
// banda de luz donde el tiempo baja hacia el pasado (arriba es ahora). El color
// de cada renglón es la temperatura sobre la herradura del perfil Ultra (índigo
// → cian dentro del rango, blanco en el borde, salmón → rojo → rosa pasado,
// violeta demasiado frío), y la línea blanca es la curva: su lugar en la banda
// es la temperatura entre el mínimo y el máximo del rango (las dos rayas finas).
// Al pasar el mouse (o tocar), una regla cruza todos los equipos a la misma hora.
// Sin verde ni amarillo (regla de Leandro: nunca azul con amarillo).

type Equipo = { idequipo: string; codigo: string; nombre: string; minimo: number; maximo: number; demora_min: number; sucursal?: { nombre: string } | null };
type Punto = [number, number, number, number]; // minuto epoch, promedio, mínima, máxima
type Lector = { token: boolean; ultimaConsulta: string | null; ultimoError: string | null; historia: string; diasPendientes: number };
type Datos = { ahora: string; horas: number; paso: number; equipos: Equipo[]; serie: Record<string, Punto[]>; ultimas?: Record<string, { medido_en: string; temperatura: number }>; lector: Lector };
type Episodio = { tipo: 'calor' | 'frio' | 'mudo'; ini: number; fin: number; pico: number | null; abierto: boolean };

const C = {
  negro: '#0A0A0E', blanco: '#FFFFFF', gris: '#8A8B90', linea: '#2A2B30',
  cian: '#6BF8F4', cianLuz: '#C4FCFA', celeste: '#59A8F3', azul: '#2B5CF0', indigo: '#0E16D8', violeta: '#5B137E', lila: '#C9A6FF',
  rosa: '#FF2E88', rojo: '#FF2A3D', rojoNaranja: '#FF5A1F', salmon: '#FFAC8F',
};
const VENTANAS = [
  { horas: 6, rotulo: '6 H' },
  { horas: 24, rotulo: '24 H' },
  { horas: 168, rotulo: '7 DÍAS' },
  { horas: 720, rotulo: '30 DÍAS' },
];
const MUDO_MIN = 6; // sin medición hace más de 6 minutos: sin señal
const EJE = 46;

// La herradura como luz continua: cada décima de grado tiene su color (p = lugar
// dentro del rango: 0 el mínimo, 1 el máximo).
const PARADAS: [number, string][] = [
  [-0.6, C.violeta], [0, C.indigo], [0.3, C.azul], [0.55, C.celeste], [0.82, C.cian], [1, C.cianLuz],
  [1.12, C.blanco], [1.5, C.salmon], [2.2, C.rojoNaranja], [3.2, C.rojo], [4.5, C.rosa],
];
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PARADAS_RGB = PARADAS.map(([p, h]) => [p, rgb(h)] as const);
function color(t: number, e: Equipo) {
  const p = (t - e.minimo) / (e.maximo - e.minimo);
  if (p <= PARADAS_RGB[0][0]) return C.violeta;
  for (let k = 1; k < PARADAS_RGB.length; k++) {
    const [p1, c1] = PARADAS_RGB[k];
    if (p <= p1) {
      const [p0, c0] = PARADAS_RGB[k - 1], f = (p - p0) / (p1 - p0);
      return `rgb(${c0.map((v, i) => Math.round(v + (c1[i] - v) * f)).join(',')})`;
    }
  }
  return C.rosa;
}
const estadoDe = (t: number | null, e: Equipo) => (t == null ? 'mudo' : t < e.minimo ? 'frio' : t > e.maximo ? 'calor' : 'ok');
const grados = (t: number | null | undefined, dec = 1) => (t == null ? '—' : t.toFixed(dec).replace('.', ',').replace('-', '−') + ' °C');
const numero = (t: number, dec = 1) => t.toFixed(dec).replace('.', ',').replace('-', '−');
const hhmm = (min: number) => new Date(min * 60000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
const diaTxt = (min: number) => new Date(min * 60000).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
const diaCorto = (min: number) => new Date(min * 60000).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
const horaAR =(min: number) => Number(new Date(min * 60000).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })) % 24;
const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

// Los episodios: tramos fuera del rango que duraron la demora de la alarma
// (20 min en QBIT) o más, y los cortes de señal.
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

export function FrioPieza() {
  const [horas, setHoras] = useState(24);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [regla, setRegla] = useState<number | null>(null); // minuto bajo la regla
  const [reloj, setReloj] = useState('');
  const [bajando, setBajando] = useState(false);
  const zona = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const medida = useRef({ W: 0, H: 0 });

  const traer = useCallback(async (h: number) => {
    try {
      const r = await fetch(`/api/frio?horas=${h}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `La API respondió ${r.status}`);
      setDatos(j); setError(null);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);

  useEffect(() => { traer(horas); const id = setInterval(() => traer(horas), 60_000); return () => clearInterval(id); }, [horas, traer]);
  useEffect(() => {
    const tic = () => setReloj(new Date().toLocaleTimeString('es-AR', { hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }));
    tic(); const id = setInterval(tic, 1000); return () => clearInterval(id);
  }, []);

  const equipos = datos?.equipos ?? [];
  const ahoraMin = datos ? Math.floor(Date.parse(datos.ahora) / 60000) : 0;
  const paso = datos?.paso ?? 1;
  const ventana = (datos?.horas ?? horas) * 60;

  const porEquipo = useMemo(() => equipos.map((e) => {
    const pts = (datos?.serie?.[e.idequipo] ?? []).map((p) => p.map(Number) as Punto);
    const ult = datos?.ultimas?.[e.idequipo];
    const edad = ult ? Math.max(0, ahoraMin - Math.floor(Date.parse(ult.medido_en) / 60000)) : null;
    const actual = ult && edad != null && edad <= MUDO_MIN ? Number(ult.temperatura) : null;
    let enRango = 0; let suma = 0; let mn = Infinity; let mx = -Infinity;
    for (const [, prom, a, b] of pts) { if (prom >= e.minimo && prom <= e.maximo) enRango++; suma += prom; mn = Math.min(mn, a); mx = Math.max(mx, b); }
    return { e, pts, ult, edad, actual, estado: estadoDe(actual, e), eps: episodios(e, pts, paso), stats: pts.length ? { min: mn, max: mx, prom: suma / pts.length, enRango: enRango / pts.length } : null };
  }), [equipos, datos, ahoraMin, paso]);

  // ── la pieza ──
  const pintar = useCallback(() => {
    const cv = lienzo.current; if (!cv) return;
    const { W, H } = medida.current; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.negro; ctx.fillRect(0, 0, W, H);
    const n = porEquipo.length; if (!n || !H) return;
    const letra = getComputedStyle(cv).getPropertyValue('--letra-frio') || 'Arial';
    const ancho = (W - EJE) / n;
    const yDe = (min: number) => ((ahoraMin - min) / ventana) * H;

    // eje de horas
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    const cada = ventana <= 360 ? 60 : ventana <= 1440 ? 180 : ventana <= 10080 ? 1440 : 4320;
    for (let m = Math.floor(ahoraMin / 60) * 60; m > ahoraMin - ventana; m -= 60) {
      const h = horaAR(m);
      const esDia = h === 0;
      if (!esDia && (cada >= 1440 || (m / 60) % (cada / 60) !== 0)) continue;
      if (esDia && cada === 4320 && Math.round((ahoraMin - m) / 1440) % 3 !== 0) continue;
      const y = yDe(m);
      ctx.fillStyle = C.linea; ctx.fillRect(EJE - 8, Math.round(y), 6, 1);
      ctx.fillStyle = esDia ? C.blanco : C.gris; ctx.font = `700 ${esDia ? 9 : 10}px ${letra}`;
      ctx.fillText(esDia ? diaCorto(m) : String(h).padStart(2, '0'), EJE - 11, y);
    }
    ctx.fillStyle = C.blanco; ctx.font = `900 8px ${letra}`; ctx.fillText('YA', EJE - 11, 7);

    porEquipo.forEach(({ e, pts }, i) => {
      const x = Math.round(EJE + i * ancho) + 2, w = Math.round(EJE + (i + 1) * ancho) - x - 2;
      const r = e.maximo - e.minimo, lo = e.minimo - r * 0.45, hi = e.maximo + r * 0.45;
      const xDe = (t: number) => x + Math.max(0, Math.min(1, (t - lo) / (hi - lo))) * w;
      // sin datos: trama fina (sin señal)
      ctx.fillStyle = '#16161B'; ctx.fillRect(x, 0, w, H);
      ctx.fillStyle = C.linea; for (let yy = 0; yy < H; yy += 4) ctx.fillRect(x, yy, w, 1);
      // renglones de color: uno por píxel (o por tramo, si hay menos tramos que píxeles)
      const alto = Math.max(1, H / (ventana / paso));
      let prevT: number | null = null;
      for (const [t, prom] of pts) {
        const y = yDe(t); if (y < -alto || y > H) { prevT = t; continue; }
        const salto = prevT != null && t - prevT > Math.max(MUDO_MIN, paso * 2);
        const h = salto ? alto : prevT != null ? Math.max(alto, yDe(prevT) - y) : alto;
        ctx.fillStyle = color(prom, e); ctx.fillRect(x, Math.floor(y), w, Math.ceil(h) + 0.5);
        prevT = t;
      }
      // el rango: dos rayas finas negras sobre la luz
      ctx.fillStyle = 'rgba(10,10,14,.55)';
      ctx.fillRect(Math.round(xDe(e.minimo)), 0, 1, H); ctx.fillRect(Math.round(xDe(e.maximo)), 0, 1, H);
      // la dispersión de cada tramo (mínima → máxima) y la curva
      if (paso > 1) {
        ctx.fillStyle = 'rgba(10,10,14,.28)';
        for (const [t, , mn, mx] of pts) { const y = yDe(t); if (y >= 0 && y <= H) ctx.fillRect(xDe(mn), y, Math.max(1, xDe(mx) - xDe(mn)), Math.max(1, alto)); }
      }
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      for (const [col, dx] of [[C.negro, 0], [C.blanco, 0]] as const) {
        ctx.strokeStyle = col; ctx.lineWidth = col === C.negro ? 4.5 : 1.8; ctx.beginPath();
        let pt: number | null = null;
        for (const [t, prom] of pts) {
          const y = yDe(t), xx = xDe(prom) + dx;
          if (pt == null || t - pt > Math.max(MUDO_MIN, paso * 2)) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
          pt = t;
        }
        ctx.stroke();
      }
      if (sel === e.idequipo) { ctx.strokeStyle = C.negro; ctx.lineWidth = 6; ctx.strokeRect(x + 3, 3, w - 6, H - 6); ctx.strokeStyle = C.blanco; ctx.lineWidth = 2; ctx.strokeRect(x + 3, 3, w - 6, H - 6); }
    });

    // la regla: una hora, todos los equipos
    if (regla != null) {
      const y = Math.round(yDe(regla)) + 0.5;
      ctx.fillStyle = C.negro; ctx.fillRect(EJE, y - 2, W - EJE, 4);
      ctx.fillStyle = C.blanco; ctx.fillRect(EJE, y - 0.5, W - EJE, 1);
      ctx.fillStyle = C.blanco; ctx.fillRect(0, y - 9, EJE - 4, 18);
      ctx.fillStyle = C.negro; ctx.font = `900 9px ${letra}`; ctx.textAlign = 'right'; ctx.fillText(hhmm(regla), EJE - 7, y);
    }
  }, [porEquipo, ahoraMin, ventana, paso, sel, regla]);

  useEffect(() => {
    const z = zona.current, cv = lienzo.current; if (!z || !cv) return;
    const medir = () => {
      const r = z.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      medida.current = { W: Math.floor(r.width), H: Math.floor(r.height) };
      cv.width = medida.current.W * dpr; cv.height = medida.current.H * dpr;
      cv.style.width = `${medida.current.W}px`; cv.style.height = `${medida.current.H}px`;
      pintar();
    };
    const ro = new ResizeObserver(medir); ro.observe(z); medir();
    document.fonts?.ready.then(pintar);
    return () => ro.disconnect();
  }, [pintar]);

  const minutoEn = (clientY: number) => {
    const z = zona.current; if (!z) return null;
    const y = clientY - z.getBoundingClientRect().top;
    if (y < 0 || y > medida.current.H) return null;
    return Math.round(ahoraMin - (y / medida.current.H) * ventana);
  };
  const equipoEn = (clientX: number) => {
    const z = zona.current; if (!z || !porEquipo.length) return null;
    const x = clientX - z.getBoundingClientRect().left - EJE;
    const i = Math.floor(x / ((medida.current.W - EJE) / porEquipo.length));
    return porEquipo[i]?.e.idequipo ?? null;
  };
  const valorEn = (pts: Punto[], min: number) => {
    let mejor: Punto | null = null;
    for (const p of pts) { if (!mejor || Math.abs(p[0] - min) < Math.abs(mejor[0] - min)) mejor = p; }
    return mejor && Math.abs(mejor[0] - min) <= Math.max(MUDO_MIN, paso * 2) ? mejor : null;
  };

  async function bajarPlanilla(e: Equipo) {
    const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
    setBajando(true);
    try {
      const r = await fetch(`/api/frio?planilla=1&idequipo=${e.idequipo}&mes=${mes}`, { cache: 'no-store' });
      const filas: any[] = r.ok ? await r.json() : [];
      const n = (x: any) => (x == null ? '' : String(x).replace('.', ','));
      const csv = [
        `${e.codigo} · ${e.nombre};Rango ${n(e.minimo)} a ${n(e.maximo)} °C;Mes ${mes};Sensor QBIT ${e.idequipo}`,
        'Día;Mediciones;Mínima °C;Máxima °C;Promedio °C;Mediciones fuera de rango',
        ...filas.map((f) => [new Date(`${f.dia}T12:00:00`).toLocaleDateString('es-AR'), f.mediciones, n(f.minima), n(f.maxima), n(f.promedio), f.fuera_de_rango].join(';')),
      ].join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `frio-${e.codigo}-${mes}.csv`; a.click(); URL.revokeObjectURL(url);
    } finally { setBajando(false); }
  }

  const lector = datos?.lector;
  const elegido = porEquipo.find((x) => x.e.idequipo === sel) ?? null;
  const sinMediciones = datos && porEquipo.every((x) => !x.pts.length);
  const ultima = lector?.ultimaConsulta ? new Date(lector.ultimaConsulta).toLocaleTimeString('es-AR', { hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }) : null;

  return (
    <div className="fr">
      <style>{CSS}</style>
      <header className="fr-barra">
        <div className="fr-marca">→ FRÍO <small>QBIT</small></div>
        <div className="fr-sec"><b>{equipos.length || '—'}</b> equipos</div>
        <div className="fr-sec">{reloj}</div>
        <div className="fr-der" role="group" aria-label="Cuánto tiempo se ve">
          {VENTANAS.map((v) => (
            <button key={v.horas} type="button" className="fr-btn" aria-pressed={horas === v.horas} onClick={() => { setHoras(v.horas); setRegla(null); }}>{v.rotulo}</button>
          ))}
        </div>
      </header>

      <div className="fr-cabezas" style={{ gridTemplateColumns: `${EJE}px repeat(${Math.max(1, porEquipo.length)}, minmax(0,1fr))` }}>
        <span />
        {porEquipo.map(({ e, actual, estado, edad }) => (
          <button key={e.idequipo} type="button" className={`fr-cabeza ${estado}`} aria-pressed={sel === e.idequipo} onClick={() => setSel(sel === e.idequipo ? null : e.idequipo)}>
            <span className="fr-cod">{e.codigo} · {e.nombre}</span>
            <span className="fr-temp">{actual == null ? '— —' : numero(actual)}<i>°C</i></span>
            <span className="fr-est">
              {estado === 'ok' && 'EN RANGO'}
              {estado === 'calor' && 'FUERA DE RANGO'}
              {estado === 'frio' && 'DEMASIADO FRÍO'}
              {estado === 'mudo' && (edad == null ? 'SIN MEDICIONES' : `SIN SEÑAL HACE ${duracion(edad).toUpperCase()}`)}
              <em> · {numero(e.minimo, 0)} → {numero(e.maximo, 0)} °C</em>
            </span>
          </button>
        ))}
      </div>

      <div
        ref={zona}
        className="fr-zona"
        onPointerMove={(ev) => { if (ev.pointerType === 'mouse') setRegla(minutoEn(ev.clientY)); }}
        onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setRegla(null); }}
        onPointerDown={(ev) => { const m = minutoEn(ev.clientY); setRegla(m); if (ev.pointerType !== 'mouse') return; const id = equipoEn(ev.clientX); if (id) setSel(sel === id ? null : id); }}
      >
        <canvas ref={lienzo} aria-label="Temperatura de cada equipo: arriba es ahora y hacia abajo el pasado" />
        {(sinMediciones || error) && (
          <div className="fr-vacio">
            {error ? <>No pude traer las mediciones: {error}</> : lector && !lector.token
              ? <>Todavía no hay mediciones. El lector empieza solo cuando esté cargada la clave de QBIT en el servidor.</>
              : <>Esperando la primera medición de QBIT. Llega una por minuto.</>}
          </div>
        )}
      </div>

      <footer className="fr-pie">
        {regla != null && datos && (
          <div className="fr-linea">
            <span className="fr-c">{diaTxt(regla).toUpperCase()} {hhmm(regla)}</span>
            {porEquipo.map(({ e, pts }) => { const p = valorEn(pts, regla); return <span key={e.idequipo} className={p ? estadoDe(p[1], e) : 'mudo'}>{e.codigo} {p ? grados(p[1]) : 'sin señal'}</span>; })}
          </div>
        )}
        {elegido ? (
          <>
            <div className="fr-linea">
              <span className="fr-c">{elegido.e.codigo} · {elegido.e.nombre.toUpperCase()}</span>
              {elegido.stats ? <>
                <span>mín {grados(elegido.stats.min)}</span><span>máx {grados(elegido.stats.max)}</span><span>promedio {grados(elegido.stats.prom)}</span>
                <span>{Math.round(elegido.stats.enRango * 100)} % del tiempo en rango</span>
              </> : <span>sin mediciones en esta ventana</span>}
              <button type="button" onClick={() => bajarPlanilla(elegido.e)} disabled={bajando}>{bajando ? 'Bajando…' : '↓ Planilla del mes para Bromatología'}</button>
              <button type="button" onClick={() => setSel(null)}>← Todos</button>
            </div>
            <div className="fr-eps">
              {elegido.eps.length ? elegido.eps.slice(-8).reverse().map((x, k) => (
                <span key={k} className={x.tipo}>
                  <b>EP {String(elegido.eps.length - k).padStart(3, '0')}</b> · {diaTxt(x.ini)} {hhmm(x.ini)} → {x.abierto ? 'sigue' : hhmm(x.fin)} · {duracion(x.fin - x.ini + paso)} · {x.tipo === 'mudo' ? 'sin señal' : `${x.tipo === 'calor' ? 'máx' : 'mín'} ${grados(x.pico)}`}
                </span>
              )) : <span className="fr-fuente">Sin episodios fuera de rango en esta ventana (cuenta a partir de {elegido.e.demora_min} min, como la alarma de QBIT)</span>}
            </div>
          </>
        ) : (
          <div className="fr-linea">
            <span className="fr-c">AHORA</span>
            <span>{porEquipo.filter((x) => x.estado === 'ok').length} en rango</span>
            {(['calor', 'frio', 'mudo'] as const).map((s) => { const l = porEquipo.filter((x) => x.estado === s); return l.length ? (
              <span key={s} className={s}>{l.length} {s === 'calor' ? 'fuera de rango' : s === 'frio' ? 'demasiado frío' : 'sin señal'} · {l.map((x) => <button key={x.e.idequipo} type="button" onClick={() => setSel(x.e.idequipo)}>{x.e.codigo}</button>)}</span>
            ) : null; })}
          </div>
        )}
        <div className="fr-linea fr-fuente">
          <span>QBIT (Bitronic) · {ultima ? `última lectura ${ultima}` : lector?.token ? 'esperando la primera lectura' : 'sin clave de QBIT todavía'}
            {lector?.historia === 'completando' ? ` · trayendo la historia de 7 días (${lector.diasPendientes} días por traer)` : ''}
            {lector?.historia === 'no_habilitada' ? ' · QBIT no da la historia: se guarda desde que arrancó' : ''}
            {lector?.ultimoError ? ` · último error: ${lector.ultimoError}` : ''}</span>
          <span>{paso > 1 ? `cada renglón es el promedio de ${paso} minutos · ` : ''}pasá el mouse o tocá la pieza para ver todos a la misma hora · tocá un equipo para abrirlo</span>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.fr{--l:var(--letra-frio),Arial,sans-serif;flex:1;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:#0A0A0E;color:#fff;font-family:var(--l);font-size:12px;font-variant-numeric:tabular-nums}
.fr-barra{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 22px;padding:14px 16px 10px;border-bottom:1px solid #2A2B30}
.fr-marca{font-weight:900;font-size:clamp(18px,2.2vw,26px);letter-spacing:-.02em;white-space:nowrap}
.fr-marca small{font-weight:700;font-size:.5em;color:#8A8B90;letter-spacing:.14em;margin-left:10px;vertical-align:middle}
.fr-sec{font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A8B90;font-size:11px}.fr-sec b{color:#fff}
.fr-der{margin-left:auto;display:flex}
.fr-btn{appearance:none;border:1px solid #2A2B30;margin-left:-1px;background:#0A0A0E;color:#8A8B90;font:700 11px/1 var(--l);letter-spacing:.12em;padding:9px 12px;cursor:pointer;border-radius:0}
.fr-btn[aria-pressed="true"]{background:#fff;color:#0A0A0E;border-color:#fff}
.fr button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.fr-cabezas{display:grid;padding:0 0 0 0;border-bottom:1px solid #2A2B30}
.fr-cabeza{container-type:inline-size;appearance:none;background:none;border:0;border-left:1px solid #2A2B30;color:#fff;text-align:left;padding:12px 10px 10px;cursor:pointer;min-width:0;display:grid;gap:4px;font-family:var(--l)}
.fr-cabeza[aria-pressed="true"]{background:#fff;color:#0A0A0E}
.fr-cod{font-weight:700;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8A8B90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fr-cabeza[aria-pressed="true"] .fr-cod{color:#0A0A0E}
.fr-temp{font-weight:900;font-size:clamp(26px,19cqw,112px);line-height:.95;letter-spacing:-.04em;white-space:nowrap}
.fr-temp i{font-style:normal;font-weight:400;font-size:.3em;letter-spacing:0;margin-left:.2em;vertical-align:top}
.fr-est{font-weight:700;font-size:10px;letter-spacing:.12em}.fr-est em{font-style:normal;color:#8A8B90;font-weight:400;letter-spacing:.04em}
.fr-cabeza.calor .fr-temp,.fr-cabeza.calor .fr-est{color:#FF5A1F}
.fr-cabeza.frio .fr-temp,.fr-cabeza.frio .fr-est{color:#C9A6FF}
.fr-cabeza.mudo .fr-temp{color:transparent;background:repeating-linear-gradient(90deg,#fff 0 2px,#0A0A0E 2px 4px);-webkit-background-clip:text;background-clip:text}
.fr-cabeza[aria-pressed="true"] .fr-temp,.fr-cabeza[aria-pressed="true"] .fr-est{color:#0A0A0E}
.fr-zona{position:relative;min-height:0;overflow:hidden;cursor:crosshair;touch-action:pan-y}
.fr-zona canvas{position:absolute;inset:0;display:block}
.fr-vacio{position:absolute;left:${EJE + 16}px;right:16px;top:50%;transform:translateY(-50%);font-weight:700;font-size:clamp(13px,1.6vw,18px);line-height:1.4;letter-spacing:.02em;max-width:34em;background:#0A0A0E;padding:14px 16px;border-left:3px solid #fff}
.fr-pie{border-top:1px solid #2A2B30;padding:12px 16px 56px;display:grid;gap:6px;line-height:1.5;min-height:84px}
.fr-linea,.fr-eps{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:baseline}
.fr-c{font-weight:900;letter-spacing:.06em}
.fr-pie button{appearance:none;background:none;border:0;padding:0;color:#fff;font:700 12px var(--l);cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.fr-pie .calor{color:#FF5A1F}.fr-pie .frio{color:#C9A6FF}.fr-pie .mudo{color:#8A8B90}
.fr-fuente{color:#8A8B90;font-size:11px;letter-spacing:.04em}
@media (max-width:640px){.fr-der{margin-left:0;width:100%}.fr-btn{flex:1;padding:9px 4px;font-size:10px}.fr-cabeza{padding:10px 6px 8px}.fr-est em{display:none}.fr-pie{font-size:11px}}
`;
