'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Frío · versión 3 (Leandro, 4/11/2026: «más chico todo, prolijo, estético, más
// info, editable, todo lo que nos permita la API, filtros por equipo»).
// Perfil Ultra compacto: la interfaz es negra y tipográfica, sin cajas; el color
// vive solo en la temperatura (índigo → cian dentro del rango, blanco en el
// borde, salmón → rojo → rosa pasado, violeta demasiado frío).
//   - una fila por equipo: código y número de QBIT, nombre, lugar, estado, la
//     temperatura de ahora con su rango, la curva chica y seis datos del período;
//   - al tocarla: la curva grande con la lectura punto por punto, las salidas de
//     rango, la planilla del mes para Bromatología y la ficha editable;
//   - filtros por equipo, por estado y por período.
// QBIT da solo número de equipo, hora y temperatura: todo lo demás lo calcula ODB.

type Equipo = {
  idequipo: string; codigo: string; nombre: string; minimo: number; maximo: number; demora_min: number; mudo_min: number;
  lugar: string | null; tipo: string | null; avisar: string | null; notas: string | null; sucursal?: { nombre: string } | null;
};
type Punto = [number, number, number, number]; // minuto epoch, promedio, mínima, máxima
type Lector = { token: boolean; ultimaConsulta: string | null; ultimoError: string | null; historia: string; diasPendientes: number };
type Datos = { ahora: string; horas: number; paso: number; equipos: Equipo[]; serie: Record<string, Punto[]>; ultimas?: Record<string, { medido_en: string; temperatura: number }>; lector: Lector };
type P = { t: number; v: number; mn: number; mx: number }; // t en ms
type Salida = { desde: number; hasta: number; pico: number; alto: boolean; sigue: boolean };
type Fila = { dia: string; mediciones: number; minima: number; maxima: number; promedio: number; fuera_de_rango: number };

const TZ = 'America/Argentina/Buenos_Aires';
const TIPOS: Record<string, { n: string; min: number; max: number }> = {
  congelados: { n: 'Congelados', min: -22, max: -15 }, refrigerados: { n: 'Refrigerados', min: 0, max: 4 },
  lacteos: { n: 'Lácteos', min: 2, max: 8 }, bebidas: { n: 'Bebidas', min: 2, max: 10 }, otro: { n: 'Otro', min: 0, max: 8 },
};
const PERIODOS = [{ h: 6, t: '6 h' }, { h: 24, t: '24 h' }, { h: 168, t: '7 días' }, { h: 720, t: '30 días' }];
const ESTADO = {
  ok: ['En rango', '#6BF8F4'], borde: ['Cerca del límite', '#F5F5F7'], alto: ['Pasado de temperatura', '#FF2A3D'],
  bajo: ['Demasiado frío', '#9B4DE0'], mudo: ['Sin datos', '#FFAC8F'],
} as const;
type Estado = keyof typeof ESTADO;

const nf = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
const dur = (m: number) => (m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`);
const hora = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const fecha = (t: number) => new Date(t).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: TZ });
const mesHoy = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

function mix(a: string, b: string, k: number) {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const A = p(a), B = p(b), f = Math.max(0, Math.min(1, k));
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * f).toString(16).padStart(2, '0')).join('');
}
function color(e: Equipo, v: number | null) {
  if (v == null) return '#7E7F86';
  if (v > e.maximo) { const k = Math.min(1, (v - e.maximo) / 4); return k < 0.5 ? mix('#FFAC8F', '#FF2A3D', k * 2) : mix('#FF2A3D', '#FF2E88', (k - 0.5) * 2); }
  if (v < e.minimo) return '#9B4DE0';
  const k = (v - e.minimo) / (e.maximo - e.minimo);
  return k > 0.88 ? mix('#59A8F3', '#F5F5F7', (k - 0.88) / 0.12) : mix('#3B45F2', '#6BF8F4', k / 0.88);
}
function estadoDe(e: Equipo, v: number | null): Estado {
  if (v == null) return 'mudo';
  if (v > e.maximo) return 'alto';
  if (v < e.minimo) return 'bajo';
  const m = (e.maximo - e.minimo) * 0.12;
  return v > e.maximo - m || v < e.minimo + m ? 'borde' : 'ok';
}

// El punto de hace unos minutos (la serie viene cada 1 a 2 minutos, con huecos)
function haceMin(pts: P[], i: number, min: number) {
  let j = i;
  while (j > 0 && pts[i].t - pts[j - 1].t <= min * 60_000) j--;
  return pts[j];
}

function calcular(e: Equipo, pts: P[]) {
  if (!pts.length) return null;
  let mn = Infinity, mx = -Infinity, suma = 0, dentro = 0, minFuera = 0, ap = 0, subiendo = false;
  const salidas: Salida[] = [];
  let cur: Salida | null = null;
  pts.forEach((p, i) => {
    mn = Math.min(mn, p.mn); mx = Math.max(mx, p.mx); suma += p.v;
    const fuera = p.v > e.maximo || p.v < e.minimo;
    if (fuera) {
      if (i) minFuera += Math.min(10, (p.t - pts[i - 1].t) / 60_000);
      if (!cur) cur = { desde: p.t, hasta: p.t, pico: p.v, alto: p.v > e.maximo, sigue: false };
      else { cur.hasta = p.t; cur.pico = cur.alto ? Math.max(cur.pico, p.v) : Math.min(cur.pico, p.v); }
    } else {
      dentro++;
      if (cur) { salidas.push(cur); cur = null; }
    }
    // apertura de puerta: sube más de 1,5 °C en unos 6 minutos (cuenta una vez por subida)
    const sube = i > 0 && p.v - haceMin(pts, i, 6).v > 1.5;
    if (sube && !subiendo) ap++;
    subiendo = sube;
  });
  if (cur) { (cur as Salida).sigue = true; salidas.push(cur); }
  const largas = salidas.filter((s) => s.sigue || (s.hasta - s.desde) / 60_000 + 2 >= e.demora_min).reverse();
  const ult = pts.filter((p) => p.t >= pts[pts.length - 1].t - 30 * 60_000);
  const tend = ult.length > 1 ? (ult[ult.length - 1].v - ult[0].v) / ((ult[ult.length - 1].t - ult[0].t) / 3600_000 || 1) : 0;
  return { mn, mx, prom: suma / pts.length, enRango: (100 * dentro) / pts.length, minFuera, ap, salidas: largas, tend };
}

// ── dibujo ──
type Escala = { t0: number; t1: number; pl: number; W: number };
function dibujar(c: HTMLCanvasElement, e: Equipo, pts: P[], horas: number, grande: boolean, marca?: number): P | null {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
  const x = c.getContext('2d'); if (!x) return null;
  x.setTransform(d, 0, 0, d, 0, 0);
  const W = r.width, H = r.height, letra = getComputedStyle(c).fontFamily || 'Arial';
  x.clearRect(0, 0, W, H);
  if (!pts.length) { x.fillStyle = '#7E7F86'; x.font = `10px ${letra}`; x.fillText('sin mediciones en el período', 0, H / 2 + 3); (c as any)._esc = null; return null; }
  const t1 = pts[pts.length - 1].t, t0 = Math.min(pts[0].t, t1 - 60_000);
  let lo = e.minimo, hi = e.maximo;
  for (const p of pts) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  lo -= 1; hi += 1;
  const pl = grande ? 38 : 0, pb = grande ? 18 : 2, pt = grande ? 8 : 2;
  const X = (t: number) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl - 4), Y = (v: number) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
  (c as any)._esc = { t0, t1, pl, W } as Escala;
  x.fillStyle = 'rgba(245,245,247,.045)'; x.fillRect(pl, Y(e.maximo), W - pl, Y(e.minimo) - Y(e.maximo));
  x.setLineDash([2, 3]); x.strokeStyle = '#4A4B52'; x.lineWidth = 1;
  for (const v of [e.minimo, e.maximo]) { x.beginPath(); x.moveTo(pl, Math.round(Y(v)) + 0.5); x.lineTo(W, Math.round(Y(v)) + 0.5); x.stroke(); }
  x.setLineDash([]);
  if (grande) {
    x.font = `9px ${letra}`; x.textAlign = 'right'; x.fillStyle = '#7E7F86';
    for (const v of [e.maximo, e.minimo]) x.fillText(`${nf(v, 0)}°`, pl - 6, Y(v) + 3);
    x.textAlign = 'center';
    const paso = horas <= 6 ? 3600_000 : horas <= 24 ? 4 * 3600_000 : horas <= 168 ? 86400_000 : 5 * 86400_000;
    const off = 3 * 3600_000; // los cortes caen en horas argentinas
    for (let t = Math.ceil((t0 - off) / paso) * paso + off; t < t1; t += paso) {
      x.fillStyle = '#202127'; x.fillRect(Math.round(X(t)), pt, 1, H - pt - pb);
      x.fillStyle = '#7E7F86'; x.fillText(horas > 24 ? fecha(t) : hora(t), X(t), H - 4);
    }
  }
  x.lineWidth = grande ? 1.6 : 1.2; x.lineJoin = 'round'; x.lineCap = 'round';
  const salto = Math.max(1, Math.floor(pts.length / (W * 1.2)));
  for (let i = salto; i < pts.length; i += salto) {
    const a = pts[i - salto], b = pts[i];
    if (b.t - a.t > Math.max(15, salto * 10) * 60_000) continue; // sin datos: no se une
    x.strokeStyle = color(e, (a.v + b.v) / 2); x.beginPath(); x.moveTo(X(a.t), Y(a.v)); x.lineTo(X(b.t), Y(b.v)); x.stroke();
  }
  const u = pts[pts.length - 1];
  x.fillStyle = color(e, u.v); x.beginPath(); x.arc(X(u.t), Y(u.v), grande ? 3.5 : 2.5, 0, 7); x.fill();
  if (marca == null) return null;
  let p = pts[0];
  for (const q of pts) if (Math.abs(q.t - marca) < Math.abs(p.t - marca)) p = q;
  x.strokeStyle = '#F5F5F7'; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(X(p.t)) + 0.5, pt); x.lineTo(Math.round(X(p.t)) + 0.5, H - pb); x.stroke();
  x.fillStyle = color(e, p.v); x.beginPath(); x.arc(X(p.t), Y(p.v), 4, 0, 7); x.fill();
  return p;
}

function Curva({ e, pts, horas, grande, onLeer }: { e: Equipo; pts: P[]; horas: number; grande?: boolean; onLeer?: (p: P | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const pintar = () => dibujar(c, e, pts, horas, !!grande);
    pintar();
    const ro = new ResizeObserver(pintar); ro.observe(c);
    document.fonts?.ready.then(pintar);
    return () => ro.disconnect();
  }, [e, pts, horas, grande]);
  const leer = (clientX: number) => {
    const c = ref.current, k: Escala | null = (c as any)?._esc; if (!c || !k) return;
    const px = clientX - c.getBoundingClientRect().left;
    onLeer?.(dibujar(c, e, pts, horas, true, k.t0 + ((px - k.pl) / (k.W - k.pl - 4)) * (k.t1 - k.t0)));
  };
  return (
    <canvas
      ref={ref}
      className={grande ? 'grande' : 'mini'}
      aria-label={`Temperatura de ${e.nombre}`}
      onPointerMove={grande ? (ev) => leer(ev.clientX) : undefined}
      onTouchMove={grande ? (ev) => leer(ev.touches[0].clientX) : undefined}
      onPointerLeave={grande ? () => { if (ref.current) dibujar(ref.current, e, pts, horas, true); onLeer?.(null); } : undefined}
    />
  );
}

async function enviar(cuerpo: unknown) {
  const r = await fetch('/api/frio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error('Solo el dueño o un gerente puede cambiar los equipos.');
  if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(' ') : j?.message ?? `No se pudo guardar (${r.status}).`);
  return j;
}

function Ficha({ e, onGuardado, onQuitado }: { e: Equipo; onGuardado: () => void; onQuitado: () => void }) {
  const [ed, setEd] = useState(false);
  const [f, setF] = useState<Equipo>(() => ({ ...e }));
  const [msg, setMsg] = useState<string | null>(null);
  const [seguro, setSeguro] = useState(false);
  const [yendo, setYendo] = useState(false);
  useEffect(() => { if (!ed) setF({ ...e }); }, [e, ed]);
  const campo = (k: keyof Equipo) => ({
    value: (f[k] as string | number | null) ?? '', disabled: !ed,
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: ev.target.value }),
  });
  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null); setYendo(true);
    try {
      await enviar({ accion: 'editar', idequipo: e.idequipo, cambios: {
        nombre: f.nombre, lugar: f.lugar, tipo: f.tipo, minimo: f.minimo, maximo: f.maximo,
        demora_min: Number(f.demora_min), mudo_min: Number(f.mudo_min), avisar: f.avisar, notas: f.notas,
      } });
      setEd(false); onGuardado();
    } catch (err: any) { setMsg(err.message); } finally { setYendo(false); }
  };
  const quitar = async () => {
    if (!seguro) { setSeguro(true); return; }
    setYendo(true);
    try { await enviar({ accion: 'quitar', idequipo: e.idequipo }); onQuitado(); } catch (err: any) { setMsg(err.message); setYendo(false); }
  };
  return (
    <form className="ed" onSubmit={guardar}>
      <label className="ancho"><span className="et">Nombre</span><input {...campo('nombre')} required /></label>
      <label><span className="et">Lugar</span><input {...campo('lugar')} /></label>
      <label><span className="et">Tipo</span>
        <select value={f.tipo ?? ''} disabled={!ed} onChange={(ev) => { const t = TIPOS[ev.target.value]; setF({ ...f, tipo: ev.target.value || null, ...(t ? { minimo: t.min, maximo: t.max } : {}) }); }}>
          <option value="">—</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}
        </select>
      </label>
      <label><span className="et">Mínimo °C</span><input type="number" step="0.5" {...campo('minimo')} required /></label>
      <label><span className="et">Máximo °C</span><input type="number" step="0.5" {...campo('maximo')} required /></label>
      <label><span className="et">Cuenta como salida si sigue fuera (min)</span><input type="number" min={0} {...campo('demora_min')} /></label>
      <label><span className="et">Sin datos después de (min)</span><input type="number" min={2} {...campo('mudo_min')} /></label>
      <label className="ancho"><span className="et">A quién avisar por WhatsApp</span><input {...campo('avisar')} /></label>
      <label className="ancho"><span className="et">Notas</span><textarea {...campo('notas')} /></label>
      <div className="acciones">
        {ed ? (
          <>
            <button className="btn lleno" type="submit" disabled={yendo}>{yendo ? 'Guardando…' : 'Guardar'}</button>
            <button className="btn" type="button" onClick={() => { setEd(false); setMsg(null); setSeguro(false); }}>Cancelar</button>
            <button className="btn quitar" type="button" onClick={quitar} disabled={yendo}>{seguro ? '¿Seguro? Tocá de nuevo' : 'Quitar equipo'}</button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={() => setEd(true)}>Editar</button>
            <span className="vacio">Los avisos por WhatsApp todavía están apagados.</span>
          </>
        )}
        {msg && <span className="falta">{msg}</span>}
      </div>
    </form>
  );
}

function Planilla({ e }: { e: Equipo }) {
  const [mes, setMes] = useState(mesHoy);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  useEffect(() => {
    let vivo = true; setFilas(null);
    fetch(`/api/frio?planilla=1&idequipo=${e.idequipo}&mes=${mes}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : [])).then((j) => vivo && setFilas(Array.isArray(j) ? j : [])).catch(() => vivo && setFilas([]));
    return () => { vivo = false; };
  }, [e.idequipo, mes]);
  return (
    <div>
      <h3>Planilla para Bromatología <input className="mes" type="month" value={mes} max={mesHoy()} onChange={(ev) => ev.target.value && setMes(ev.target.value)} aria-label="Mes" /></h3>
      {filas == null ? <div className="vacio">Cargando…</div> : !filas.length ? <div className="vacio">Sin mediciones en ese mes.</div> : (
        <div className="tabla"><table>
          <thead><tr><th>Día</th><th className="n">Mín</th><th className="n">Máx</th><th className="n">Prom</th><th className="n">En rango</th></tr></thead>
          <tbody>{filas.map((d) => (
            <tr key={d.dia}>
              <td>{fecha(Date.parse(`${d.dia}T12:00:00-03:00`))}</td>
              <td className="n">{nf(Number(d.minima))}</td><td className="n">{nf(Number(d.maxima))}</td><td className="n">{nf(Number(d.promedio))}</td>
              <td className="n">{nf(100 * (1 - d.fuera_de_rango / Math.max(1, d.mediciones)), 0)} %</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

type Filtro = { eq: string; estado: 'todos' | 'fuera' | 'mudo' };

export function FrioPieza() {
  const [horas, setHoras] = useState(24);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>({ eq: 'todos', estado: 'todos' });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [lectura, setLectura] = useState<{ id: string; p: P } | null>(null);
  const [sumar, setSumar] = useState<{ id: string; nombre: string; msg: string | null } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const traer = useCallback(async (h: number) => {
    try {
      const r = await fetch(`/api/frio?horas=${h}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `Error ${r.status}`);
      setDatos(j); setError(null);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { traer(horas); const id = setInterval(() => traer(horas), 30_000); return () => clearInterval(id); }, [horas, traer]);
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 5_000); return () => clearInterval(id); }, []);
  // el período y el filtro de cada uno quedan en su navegador
  useEffect(() => { try { const g = JSON.parse(localStorage.getItem('odb-frio-vista') ?? 'null'); if (g?.horas) setHoras(g.horas); if (g?.filtro) setFiltro(g.filtro); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('odb-frio-vista', JSON.stringify({ horas, filtro })); } catch {} }, [horas, filtro]);

  const equipos = useMemo(() => (datos?.equipos ?? []).map((e) => {
    const eq: Equipo = { ...e, minimo: Number(e.minimo), maximo: Number(e.maximo), demora_min: Number(e.demora_min ?? 20), mudo_min: Number(e.mudo_min ?? 20) };
    const pts: P[] = (datos?.serie?.[e.idequipo] ?? []).map(([t, v, mn, mx]) => ({ t: t * 60_000, v: Number(v), mn: Number(mn), mx: Number(mx) }));
    const u = datos?.ultimas?.[e.idequipo];
    const ultima = u ? { t: Date.parse(u.medido_en), v: Number(u.temperatura) } : null;
    if (ultima && (!pts.length || ultima.t > pts[pts.length - 1].t)) pts.push({ t: ultima.t, v: ultima.v, mn: ultima.v, mx: ultima.v });
    return { e: eq, pts, ultima, st: calcular(eq, pts) };
  }), [datos]);
  const estadoEq = (x: (typeof equipos)[number]): Estado =>
    !x.ultima || (ahora - x.ultima.t) / 60_000 > x.e.mudo_min ? 'mudo' : estadoDe(x.e, x.ultima.v);

  const cuentas = { fuera: 0, mudo: 0 };
  equipos.forEach((x) => { const s = estadoEq(x); if (s === 'mudo') cuentas.mudo++; else if (s === 'alto' || s === 'bajo') cuentas.fuera++; });
  const visibles = equipos.filter((x) => {
    if (filtro.eq !== 'todos' && x.e.idequipo !== filtro.eq) return false;
    const s = estadoEq(x);
    return filtro.estado === 'fuera' ? s === 'alto' || s === 'bajo' : filtro.estado === 'mudo' ? s === 'mudo' : true;
  });
  const per = PERIODOS.find((p) => p.h === horas)?.t ?? `${horas} h`;
  const lector = datos?.lector;
  const segDesde = lector?.ultimaConsulta ? Math.max(0, Math.round((ahora - Date.parse(lector.ultimaConsulta)) / 1000)) : null;

  const sumarEquipo = async () => {
    if (!sumar) return;
    const id = sumar.id.trim();
    try { await enviar({ accion: 'sumar', idequipo: id, nombre: sumar.nombre }); setSumar(null); setAbierto(id); setFiltro({ eq: 'todos', estado: 'todos' }); traer(horas); }
    catch (err: any) { setSumar({ ...sumar, msg: err.message }); }
  };

  return (
    <div className="frio">
      <style>{CSS}</style>
      <header>
        <div className="fila1">
          <div className="marca">→ ODB · FRÍO<span>QBIT</span></div>
          <div className="cuentas">
            <button type="button" aria-pressed={filtro.estado === 'todos' && filtro.eq === 'todos'} onClick={() => setFiltro({ eq: 'todos', estado: 'todos' })}><b>{equipos.length}</b>equipos</button>
            <button type="button" className={cuentas.fuera ? 'mal' : ''} aria-pressed={filtro.estado === 'fuera'} onClick={() => setFiltro({ eq: 'todos', estado: 'fuera' })}><b>{cuentas.fuera}</b>fuera de rango</button>
            <button type="button" className={cuentas.mudo ? 'mudo' : ''} aria-pressed={filtro.estado === 'mudo'} onClick={() => setFiltro({ eq: 'todos', estado: 'mudo' })}><b>{cuentas.mudo}</b>sin datos</button>
          </div>
          <div className="consulta et">
            {!lector ? '—' : !lector.token ? <span className="falta">Falta la clave de QBIT en el servidor</span>
              : lector.ultimoError ? <span className="falta">QBIT: {lector.ultimoError}</span>
              : segDesde != null ? <>última consulta a QBIT <b>hace {segDesde < 90 ? `${segDesde} s` : dur(segDesde / 60)}</b> · una por minuto</> : 'esperando la primera consulta'}
          </div>
        </div>
        <div className="fila2">
          <div className="grupo" role="group" aria-label="Equipo">
            <span className="et">Equipo</span>
            <button type="button" className="chip" aria-pressed={filtro.eq === 'todos'} onClick={() => setFiltro({ eq: 'todos', estado: 'todos' })}>Todos</button>
            {equipos.map((x) => (
              <button key={x.e.idequipo} type="button" className="chip" aria-pressed={filtro.eq === x.e.idequipo}
                onClick={() => { setFiltro({ eq: x.e.idequipo, estado: 'todos' }); setAbierto(x.e.idequipo); }}>
                <i style={{ background: estadoEq(x) === 'mudo' ? '#FFAC8F' : color(x.e, x.ultima?.v ?? null) }} />
                {x.e.nombre.replace(/^(cámara|heladera)\s+/i, '')}
              </button>
            ))}
          </div>
          <div className="grupo" role="group" aria-label="Período">
            <span className="et">Período</span>
            {PERIODOS.map((p) => <button key={p.h} type="button" className="chip" aria-pressed={horas === p.h} onClick={() => setHoras(p.h)}>{p.t}</button>)}
          </div>
          <div className="grupo"><button type="button" className="chip" onClick={() => setSumar({ id: '', nombre: '', msg: null })}>＋ Sumar equipo</button></div>
        </div>
      </header>

      <main>
        {sumar && (
          <div className="sumar">
            <label><span className="et">N.º de equipo en QBIT</span><input inputMode="numeric" autoFocus value={sumar.id} onChange={(ev) => setSumar({ ...sumar, id: ev.target.value, msg: null })} /></label>
            <label className="largo"><span className="et">Nombre</span><input value={sumar.nombre} onChange={(ev) => setSumar({ ...sumar, nombre: ev.target.value })} /></label>
            <button className="btn lleno" type="button" onClick={sumarEquipo}>Sumar</button>
            <button className="btn" type="button" onClick={() => setSumar(null)}>Cancelar</button>
            {sumar.msg && <span className="falta">{sumar.msg}</span>}
          </div>
        )}
        {error && !datos && <p className="vacio pad">No se pudo leer Frío: {error}</p>}
        {!datos && !error && <p className="vacio pad">Cargando…</p>}
        {datos && !visibles.length && <p className="vacio pad">Ningún equipo con ese filtro.</p>}
        {visibles.map((x) => {
          const { e, pts, ultima, st } = x;
          const es = estadoEq(x), ab = abierto === e.idequipo;
          const v = ultima?.v ?? null;
          const lo = Math.min(e.minimo - 3, v ?? e.minimo), hi = Math.max(e.maximo + 3, v ?? e.maximo);
          const pos = (t: number) => `${(((t - lo) / (hi - lo)) * 100).toFixed(1)}%`;
          const hace = ultima ? Math.round((ahora - ultima.t) / 60_000) : null;
          const lec = lectura?.id === e.idequipo ? lectura.p : null;
          const abrir = () => setAbierto(ab ? null : e.idequipo);
          return (
            <section className="eq" key={e.idequipo}>
              <div className="cab" role="button" tabIndex={0} aria-expanded={ab} onClick={abrir}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } }}>
                <div>
                  <div className="cod">{e.codigo} · EQ <b>{e.idequipo}</b></div>
                  <div className="nom">{e.nombre}</div>
                  <div className="lug">{e.lugar || e.sucursal?.nombre || 'Sin lugar'} · {e.tipo ? TIPOS[e.tipo]?.n ?? e.tipo : 'Sin tipo'}</div>
                  <div className="estado" style={{ color: ESTADO[es][1] }}>● {ESTADO[es][0]}</div>
                </div>
                <div>
                  <div className={`temp ${es === 'alto' || es === 'bajo' ? 'fuera' : ''}`} style={{ color: color(e, v) }}>{nf(v)}<small>°C</small></div>
                  <div className="rango">
                    <span className="riel" />
                    <span className="ok" style={{ left: pos(e.minimo), width: `calc(${pos(e.maximo)} - ${pos(e.minimo)})` }} />
                    {v != null && <span className="pto" style={{ left: pos(Math.max(lo, Math.min(hi, v))) }} />}
                  </div>
                  <div className="et chico">{nf(e.minimo, 0)} a {nf(e.maximo, 0)} °C</div>
                </div>
                <Curva e={e} pts={pts} horas={horas} />
                <div className="datos">
                  <div><div className="et">Mín {per}</div><div className="v">{st ? `${nf(st.mn)} °C` : '—'}</div></div>
                  <div><div className="et">Máx {per}</div><div className="v">{st ? `${nf(st.mx)} °C` : '—'}</div></div>
                  <div><div className="et">Promedio</div><div className="v">{st ? `${nf(st.prom)} °C` : '—'}</div></div>
                  <div><div className="et">En rango</div><div className="v">{st ? `${nf(st.enRango, 0)} %` : '—'}</div></div>
                  <div><div className="et">Aperturas</div><div className="v">{st ? st.ap : '—'}</div></div>
                  <div><div className="et">Último dato</div><div className="v">{hace == null ? 'nunca' : hace < 1 ? 'recién' : `hace ${dur(hace)}`}</div></div>
                </div>
              </div>
              {ab && (
                <div className="det">
                  <div>
                    <Curva e={e} pts={pts} horas={horas} grande onLeer={(p) => setLectura(p ? { id: e.idequipo, p } : null)} />
                    <div className="lectura">
                      {lec ? (
                        <><span><b>{fecha(lec.t)} {hora(lec.t)}</b></span><span style={{ color: color(e, lec.v) }}><b>{nf(lec.v, 2)} °C</b></span>
                          {lec.mn !== lec.mx && <span>entre {nf(lec.mn)} y {nf(lec.mx)} °C en ese tramo</span>}<span>{ESTADO[estadoDe(e, lec.v)][0]}</span></>
                      ) : st ? (
                        <><span>Tendencia <b>{st.tend > 0 ? '+' : ''}{nf(st.tend)} °C por hora</b></span>
                          <span>Fuera de rango <b>{dur(st.minFuera)}</b> en {per}</span>
                          <span className="vacio">Pasá el mouse o el dedo por la curva para ver cada medición</span></>
                      ) : <span className="vacio">Todavía no llegó ninguna medición de este equipo.</span>}
                    </div>
                  </div>
                  <div className="columnas">
                    <div>
                      <h3>Salidas de rango · más de {e.demora_min} min · {per}</h3>
                      {st && st.salidas.length ? (
                        <div className="tabla"><table>
                          <thead><tr><th>Desde</th><th className="n">Duró</th><th className="n">Pico</th></tr></thead>
                          <tbody>{st.salidas.slice(0, 10).map((s) => (
                            <tr key={s.desde}><td>{fecha(s.desde)} {hora(s.desde)}</td><td className="n">{s.sigue ? 'sigue · ' : ''}{dur((s.hasta - s.desde) / 60_000 + 2)}</td>
                              <td className="n" style={{ color: color(e, s.pico) }}>{nf(s.pico)} °C</td></tr>
                          ))}</tbody>
                        </table>{st.salidas.length > 10 && <div className="vacio">y {st.salidas.length - 10} más</div>}</div>
                      ) : <div className="vacio">{st ? 'Ninguna en el período.' : 'Sin datos.'}</div>}
                    </div>
                    <Planilla e={e} />
                    <div><h3>Datos del equipo</h3><Ficha e={e} onGuardado={() => traer(horas)} onQuitado={() => { setAbierto(null); setFiltro({ eq: 'todos', estado: 'todos' }); traer(horas); }} /></div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <footer>
        <div><b>Qué da QBIT:</b> por cada equipo, la última medición (número, fecha y hora, temperatura), con una consulta cada 40 segundos como mínimo. ODB consulta una vez por minuto y guarda todo{lector?.historia === 'no_habilitada' ? '; el historial por fecha no está habilitado, así que la historia empieza el 3/11' : ''}.</div>
        <div><b>Lo que calcula ODB:</b> mínima, máxima, promedio, tiempo dentro del rango, salidas de rango, aperturas de puerta (subidas de más de 1,5 °C en unos 6 minutos), tendencia de la última media hora y la planilla del mes.</div>
      </footer>
    </div>
  );
}

const CSS = `
.frio{--negro:#09090D;--blanco:#F5F5F7;--gris:#7E7F86;--gris2:#4A4B52;--linea:#202127;--cian:#6BF8F4;--rojo:#FF2A3D;--salmon:#FFAC8F;--rosa:#FF2E88;
  flex:1;min-height:0;overflow-y:auto;background:var(--negro);color:var(--blanco);font:400 12px/1.45 var(--letra-frio),Arial,sans-serif;font-variant-numeric:tabular-nums;color-scheme:dark}
.frio *{box-sizing:border-box}
.frio header,.frio main,.frio footer{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.frio button,.frio input,.frio select,.frio textarea{font:inherit;color:inherit}
.frio button{cursor:pointer}
.frio canvas{font-family:var(--letra-frio),Arial,sans-serif}
.frio :focus-visible{outline:1px solid var(--blanco);outline-offset:2px}
.frio .et{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);font-weight:600}
.frio .et.chico{font-size:8.5px;margin-top:2px}
.frio header{position:sticky;top:0;z-index:5;background:var(--negro);border-bottom:1px solid var(--linea)}
.frio .fila1{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 22px;padding-block:14px 8px}
.frio .marca{font-weight:800;font-size:17px;letter-spacing:-.01em;white-space:nowrap}
.frio .marca span{color:var(--gris);font-weight:400;font-size:10px;letter-spacing:.16em;margin-left:8px}
.frio .cuentas{display:flex;flex-wrap:wrap;gap:4px 16px}
.frio .cuentas button{background:none;border:0;padding:0;font-size:11px;color:var(--gris)}
.frio .cuentas button b{color:var(--blanco);font-weight:600;margin-right:4px}
.frio .cuentas button.mal b{color:var(--rojo)} .frio .cuentas button.mudo b{color:var(--salmon)}
.frio .cuentas button[aria-pressed="true"]{color:var(--blanco);text-decoration:underline;text-underline-offset:4px}
.frio .consulta{margin-left:auto}
.frio .consulta b{color:var(--blanco);font-weight:600}
.frio .btn{background:none;border:1px solid var(--gris2);padding:7px 10px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.frio .btn:hover{border-color:var(--blanco)}
.frio .btn[disabled]{color:var(--gris2);border-color:var(--linea);cursor:default}
.frio .btn.lleno{background:var(--blanco);color:var(--negro);border-color:var(--blanco)}
.frio .fila2{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding-block:4px 12px}
.frio .grupo{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.frio .grupo .et{margin-right:6px}
.frio .chip{background:none;border:1px solid var(--linea);padding:6px 9px;font-size:10.5px;color:var(--gris);white-space:nowrap}
.frio .chip:hover{color:var(--blanco)}
.frio .chip[aria-pressed="true"]{border-color:var(--blanco);color:var(--blanco)}
.frio .chip i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px}
.frio main{padding-block:4px 20px}
.frio .pad{padding-block:24px}
.frio .eq{border-bottom:1px solid var(--linea)}
.frio .cab{display:grid;grid-template-columns:minmax(0,230px) 112px minmax(0,1fr) minmax(0,300px);gap:18px;align-items:center;padding-block:14px;cursor:pointer}
.frio .cab>*{min-width:0}
.frio .cod{font-size:9.5px;letter-spacing:.16em;color:var(--gris);font-weight:600}
.frio .cod b{color:var(--blanco);font-weight:600}
.frio .nom{font-weight:600;font-size:13px;margin-top:3px;text-wrap:balance}
.frio .lug{color:var(--gris);font-size:10.5px;margin-top:2px}
.frio .estado{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;margin-top:6px}
.frio .temp{font-weight:800;font-size:28px;letter-spacing:-.03em;line-height:1;white-space:nowrap}
.frio .temp small{font-size:11px;font-weight:400;letter-spacing:0;margin-left:2px}
.frio .temp.fuera{text-shadow:-1.5px 0 var(--rosa),1.5px 0 var(--cian)}
.frio .rango{margin-top:8px;position:relative;height:14px}
.frio .rango .riel{position:absolute;left:0;right:0;top:6px;height:1px;background:var(--gris2)}
.frio .rango .ok{position:absolute;top:5px;height:3px;background:var(--gris)}
.frio .rango .pto{position:absolute;top:2px;width:2px;height:10px;background:var(--blanco);transform:translateX(-1px)}
.frio canvas.mini{width:100%;height:46px;display:block}
.frio canvas.grande{width:100%;height:220px;display:block;cursor:crosshair;touch-action:pan-y}
.frio .datos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 12px}
.frio .datos>div{min-width:0}
.frio .datos .v{font-weight:600;font-size:12px;white-space:nowrap}
.frio .datos .et{font-size:8.5px}
.frio .det{padding-block:0 18px;display:grid;gap:18px}
.frio .lectura{display:flex;flex-wrap:wrap;gap:4px 18px;min-height:18px;margin-top:6px;font-size:11px}
.frio .lectura b{font-weight:600}
.frio .columnas{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr);gap:28px}
.frio .columnas>*{min-width:0}
.frio h3{margin:0 0 8px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);font-weight:600;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}
.frio h3 .mes{width:auto;font-size:10px;letter-spacing:0;text-transform:none;padding:0 0 2px}
.frio table{width:100%;border-collapse:collapse;font-size:11px}
.frio td,.frio th{padding:5px 0;border-bottom:1px solid var(--linea);text-align:left;font-weight:400;white-space:nowrap}
.frio td+td,.frio th+th{padding-left:10px}
.frio th{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gris);font-weight:600}
.frio .n{text-align:right}
.frio .tabla{overflow:auto;max-height:340px}
.frio .vacio{color:var(--gris);font-size:11px}
.frio .falta{font-size:10.5px;color:var(--salmon);letter-spacing:0;text-transform:none}
.frio form.ed{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.frio form.ed label{display:grid;gap:4px;min-width:0}
.frio form.ed .ancho{grid-column:1/-1}
.frio input,.frio select,.frio textarea{background:transparent;border:0;border-bottom:1px solid var(--gris2);padding:5px 0;font-size:12px;border-radius:0;width:100%;min-width:0}
.frio input:disabled,.frio select:disabled,.frio textarea:disabled{border-bottom-color:var(--linea);opacity:1;color:var(--blanco);-webkit-text-fill-color:var(--blanco)}
.frio select option{background:var(--negro)}
.frio input:focus,.frio select:focus,.frio textarea:focus{outline:none;border-bottom-color:var(--blanco)}
.frio textarea{resize:vertical;min-height:34px}
.frio .acciones{grid-column:1/-1;display:flex;gap:8px 12px;flex-wrap:wrap;margin-top:4px;align-items:center}
.frio .btn.quitar{margin-left:auto;color:var(--salmon);border-color:transparent}
.frio .sumar{padding-block:14px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:end;border-bottom:1px solid var(--linea)}
.frio .sumar label{display:grid;gap:4px;min-width:140px}
.frio .sumar .largo{flex:1}
.frio footer{border-top:1px solid var(--linea);padding-block:14px 28px;color:var(--gris);font-size:10.5px;display:grid;gap:6px;line-height:1.6}
.frio footer b{color:var(--blanco);font-weight:600}
@media (max-width:1100px){
  .frio .cab{grid-template-columns:minmax(0,1fr) auto;gap:10px 14px}
  .frio .cab canvas.mini,.frio .cab .datos{grid-column:1/-1}
  .frio .columnas{grid-template-columns:minmax(0,1fr);gap:22px}
  .frio .consulta{margin-left:0;width:100%}
}
@media (max-width:520px){
  .frio .temp{font-size:24px}
  .frio form.ed{grid-template-columns:minmax(0,1fr)}
  .frio canvas.grande{height:180px}
}
`;
