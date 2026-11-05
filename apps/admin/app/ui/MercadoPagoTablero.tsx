'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Mercado Pago · versión 2 (Leandro, 5/11/2026: «mejoremos muchísimo el módulo,
// a otro nivel», «análisis mes a mes», «mejorá mucho toda la gráfica»).
// Mismo idioma que Frío (perfil Ultra compacto): negro y tipográfico, sin cajas;
// el color vive solo en los números y en las barras, uno por medio de pago:
// QR y dinero en cuenta cian, transferencia celeste, débito índigo, crédito
// rojo naranja (el que más comisión paga), prepaga violeta.
//   - Mes a mes: un año de cobros apilados por medio, la tabla con cada mes
//     (contra el anterior, por día, ticket, comisión, crédito) y, al tocar un
//     mes, sus días y sus medios; al tocar un día, sus pagos.
//   - La plata: lo que Mercado Pago liberó y va a liberar cada día.
//   - Cobros: los últimos días, la lista de pagos, traer pagos y el link de pago.
// Las transferencias que llegan a la cuenta (PSP_TRANSFER) no son ventas: van aparte.

type FilaMes = { mes: string; cuenta: string; tipo: string; transferencia: boolean; cobros: number; bruto: number; comision: number; neto: number; dias: number };
type FilaDia = { dia: string; cuenta: string; tipo: string; transferencia: boolean; cobros: number; bruto: number; comision: number; neto: number };
type FilaLib = { dia: string; cuenta: string; tipo: string; pagos: number; neto: number };
type Pago = {
  id: string; cuenta: string; estado: string; tipo: string | null; medio: string | null; origen?: string | null; cuotas: number; bruto: number; comision: number; neto: number;
  liberado: boolean; liberacion_en: string | null; aprobado_en: string | null; creado_en_mp?: string | null; descripcion: string | null; pagador?: string | null; venta_id?: string | null;
};
type Cuenta = '' | 'principal' | 'santa_ines';
type Vista = 'mes' | 'plata' | 'cobros';

const TZ = 'America/Argentina/Buenos_Aires';
const EMPRESAS: Record<string, { nombre: string; corto: string }> = {
  principal: { nombre: 'Sant Thomas · Chinvenguencha SRL', corto: 'Sant Thomas' },
  santa_ines: { nombre: 'Santa Inés · ODB SRL', corto: 'Santa Inés' },
};
const MEDIOS: { tipo: string; n: string; c: string }[] = [
  { tipo: 'account_money', n: 'QR y dinero en cuenta', c: '#6BF8F4' },
  { tipo: 'bank_transfer', n: 'Transferencia', c: '#59A8F3' },
  { tipo: 'debit_card', n: 'Débito', c: '#3B45F2' },
  { tipo: 'credit_card', n: 'Crédito', c: '#FF5A1F' },
  { tipo: 'prepaid_card', n: 'Prepaga', c: '#9B4DE0' },
  { tipo: 'otro', n: 'Otros', c: '#7E7F86' },
];
const medio = (t: string | null) => MEDIOS.find((m) => m.tipo === t) ?? { tipo: t ?? 'otro', n: t ?? 'Otros', c: '#7E7F86' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLargo = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const mesCorto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(2, 4)}`;

const pesos = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `$${Math.round(v).toLocaleString('es-AR')}`);
const num = (v: number) => Math.round(v).toLocaleString('es-AR');
const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const hoyAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const sumarDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasDelMes = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const diaTxt = (dia: string) => new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const horaTxt = (s: string | null | undefined) => (s ? new Date(s).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '—');

async function traer<T>(recurso: string, params: Record<string, string | number | undefined>): Promise<T> {
  const q = new URLSearchParams({ recurso });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const r = await fetch(`/api/mercadopago?${q}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? `Error ${r.status}`);
  return j as T;
}

// ── barras apiladas en canvas: el color de cada medio, la que se toca se enciende ──
type Barra = { clave: string; etiqueta: string; partes: { valor: number; color: string }[]; apagada?: boolean };
function Barras({ barras, alto = 220, activa, onElegir, etiquetaCada = 1 }: { barras: Barra[]; alto?: number; activa?: string | null; onElegir?: (clave: string) => void; etiquetaCada?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sobre, setSobre] = useState<number | null>(null);
  const geo = useRef<{ x0: number; ancho: number } | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const pintar = () => {
      const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * d)); c.height = Math.max(1, Math.round(r.height * d));
      const x = c.getContext('2d'); if (!x) return;
      x.setTransform(d, 0, 0, d, 0, 0);
      const W = r.width, H = r.height, letra = getComputedStyle(c).fontFamily || 'Arial';
      x.clearRect(0, 0, W, H);
      const max = Math.max(1, ...barras.map((b) => b.partes.reduce((s, p) => s + p.valor, 0)));
      const pl = 0, pb = 20, pt = 6, n = Math.max(1, barras.length);
      const paso = (W - pl) / n, ancho = Math.max(2, Math.min(46, paso * 0.62));
      geo.current = { x0: pl, ancho: paso };
      // tres rayas de escala
      x.font = `9px ${letra}`; x.textAlign = 'left';
      for (const f of [0.5, 1]) {
        const y = Math.round(pt + (1 - f) * (H - pt - pb)) + 0.5;
        x.strokeStyle = '#202127'; x.lineWidth = 1; x.beginPath(); x.moveTo(pl, y); x.lineTo(W, y); x.stroke();
        x.fillStyle = '#4A4B52'; x.fillText(pesos(max * f), pl + 2, y - 4);
      }
      barras.forEach((b, i) => {
        const cx = pl + paso * i + paso / 2, x0 = cx - ancho / 2;
        const encendida = (activa == null || activa === b.clave) && !b.apagada;
        let y = H - pb;
        for (const p of b.partes) {
          const h = (p.valor / max) * (H - pt - pb);
          if (h <= 0) continue;
          x.globalAlpha = encendida ? (sobre === i ? 1 : 0.92) : 0.28;
          x.fillStyle = p.color; x.fillRect(x0, y - h, ancho, Math.max(1, h - 1));
          y -= h;
        }
        x.globalAlpha = 1;
        if (sobre === i) { x.strokeStyle = '#F5F5F7'; x.lineWidth = 1; x.strokeRect(x0 - 2.5, y - 2.5, ancho + 5, H - pb - y + 5); }
        if (i % etiquetaCada === 0 || activa === b.clave) {
          x.fillStyle = activa === b.clave ? '#F5F5F7' : '#7E7F86'; x.textAlign = 'center'; x.fillText(b.etiqueta, cx, H - 5);
        }
      });
    };
    pintar();
    const ro = new ResizeObserver(pintar); ro.observe(c);
    document.fonts?.ready.then(pintar);
    return () => ro.disconnect();
  }, [barras, activa, sobre]);
  const indice = (clientX: number) => {
    const c = ref.current, g = geo.current; if (!c || !g) return null;
    const i = Math.floor((clientX - c.getBoundingClientRect().left - g.x0) / g.ancho);
    return i >= 0 && i < barras.length ? i : null;
  };
  const b = sobre != null ? barras[sobre] : null;
  return (
    <div>
      <canvas
        ref={ref}
        className="barras"
        style={{ height: alto, cursor: onElegir ? 'pointer' : 'default' }}
        onPointerMove={(e) => setSobre(indice(e.clientX))}
        onPointerLeave={() => setSobre(null)}
        onClick={(e) => { const i = indice(e.clientX); if (i != null && onElegir) onElegir(barras[i].clave); }}
        aria-label="Gráfico de barras"
      />
      <div className="lectura">{b ? <><b>{b.etiqueta}</b><span>{pesos(b.partes.reduce((s, p) => s + p.valor, 0))}</span>{onElegir && <span className="gris">tocá para abrir</span>}</> : <span className="gris">Pasá el mouse o el dedo por las barras</span>}</div>
    </div>
  );
}

function Medios({ porTipo, total }: { porTipo: Map<string, { cobros: number; bruto: number; comision: number }>; total: number }) {
  const filas = MEDIOS.map((m) => ({ m, v: porTipo.get(m.tipo) })).filter((f) => f.v && f.v.bruto > 0);
  return (
    <div className="tabla"><table>
      <thead><tr><th>Medio</th><th className="n">Cobros</th><th className="n">Monto</th><th className="n">Del total</th><th className="n">Comisión</th><th className="n">Costo</th></tr></thead>
      <tbody>{filas.map(({ m, v }) => (
        <tr key={m.tipo}>
          <td><i className="punto" style={{ background: m.c }} />{m.n}</td>
          <td className="n">{num(v!.cobros)}</td><td className="n">{pesos(v!.bruto)}</td>
          <td className="n">{pct((100 * v!.bruto) / Math.max(1, total), 0)}</td>
          <td className="n">{pesos(v!.comision)}</td>
          <td className="n" style={{ color: v!.comision / v!.bruto > 0.03 ? '#FF5A1F' : undefined }}>{pct((100 * v!.comision) / Math.max(1, v!.bruto), 2)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ListaPagos({ pagos, cargando, conLiberacion }: { pagos: Pago[] | null; cargando?: boolean; conLiberacion?: boolean }) {
  if (cargando || pagos == null) return <p className="gris">Cargando…</p>;
  if (!pagos.length) return <p className="gris">Sin pagos.</p>;
  return (
    <div className="tabla alta"><table>
      <thead><tr><th>Hora</th><th>Medio</th><th>Empresa</th><th>Detalle</th><th className="n">Bruto</th><th className="n">Comisión</th><th className="n">Neto</th><th>{conLiberacion ? 'Se liberó' : 'Liberación'}</th><th>Venta</th></tr></thead>
      <tbody>{pagos.map((p) => {
        const m = medio(p.tipo);
        return (
          <tr key={p.id} className={p.estado !== 'approved' ? 'apagada' : ''}>
            <td>{horaTxt(p.aprobado_en ?? p.creado_en_mp)}</td>
            <td><i className="punto" style={{ background: m.c }} />{m.n}{p.cuotas > 1 ? ` · ${p.cuotas} cuotas` : ''}{p.origen === 'PSP_TRANSFER' ? ' · recibida' : ''}</td>
            <td>{EMPRESAS[p.cuenta]?.corto ?? p.cuenta}</td>
            <td className="corta" title={p.descripcion ?? ''}>{p.descripcion || p.pagador || `#${p.id}`}</td>
            <td className="n">{pesos(p.bruto)}</td><td className="n">{pesos(p.comision)}</td><td className="n">{pesos(p.neto)}</td>
            <td>{p.liberacion_en ? `${diaTxt(p.liberacion_en.slice(0, 10))}${p.liberado ? '' : ' · pendiente'}` : '—'}</td>
            <td>{p.venta_id ? 'vinculada' : '—'}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

// ═════════════════ Mes a mes ═════════════════
function MesAMes({ cuenta }: { cuenta: Cuenta }) {
  const [filas, setFilas] = useState<FilaMes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState<string | null>(null);
  const [dias, setDias] = useState<FilaDia[] | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);

  useEffect(() => {
    let vivo = true; setFilas(null); setError(null);
    traer<{ filas: FilaMes[] }>('mensual', { meses: 13, cuenta }).then((j) => vivo && setFilas(j.filas.map((f) => ({ ...f, bruto: +f.bruto, comision: +f.comision, neto: +f.neto })))).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [cuenta]);

  const meses = useMemo(() => {
    const m = new Map<string, { mes: string; cobros: number; bruto: number; comision: number; neto: number; dias: number; transf: number; transfN: number; porTipo: Map<string, { cobros: number; bruto: number; comision: number }> }>();
    for (const f of filas ?? []) {
      const a = m.get(f.mes) ?? { mes: f.mes, cobros: 0, bruto: 0, comision: 0, neto: 0, dias: 0, transf: 0, transfN: 0, porTipo: new Map() };
      a.dias = Math.max(a.dias, f.dias);
      if (f.transferencia) { a.transf += f.bruto; a.transfN += f.cobros; }
      else {
        a.cobros += f.cobros; a.bruto += f.bruto; a.comision += f.comision; a.neto += f.neto;
        const t = MEDIOS.some((x) => x.tipo === f.tipo) ? f.tipo : 'otro';
        const v = a.porTipo.get(t) ?? { cobros: 0, bruto: 0, comision: 0 };
        v.cobros += f.cobros; v.bruto += f.bruto; v.comision += f.comision; a.porTipo.set(t, v);
      }
      m.set(f.mes, a);
    }
    return [...m.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1));
  }, [filas]);

  useEffect(() => {
    if (!mes) { setDias(null); return; }
    let vivo = true; setDias(null); setDia(null);
    traer<{ filas: FilaDia[] }>('dias', { desde: `${mes}-01`, hasta: `${mes}-${String(diasDelMes(mes)).padStart(2, '0')}`, cuenta })
      .then((j) => vivo && setDias(j.filas.map((f) => ({ ...f, bruto: +f.bruto, comision: +f.comision, neto: +f.neto })))).catch(() => vivo && setDias([]));
    return () => { vivo = false; };
  }, [mes, cuenta]);

  useEffect(() => {
    if (!dia) { setPagos(null); return; }
    let vivo = true; setPagos(null);
    traer<Pago[]>('pagos-dia', { dia, cuenta }).then((j) => vivo && setPagos(j)).catch(() => vivo && setPagos([]));
    return () => { vivo = false; };
  }, [dia, cuenta]);

  if (error) return <p className="gris pad">No se pudo leer el mes a mes: {error}</p>;
  if (!filas) return <p className="gris pad">Cargando un año de cobros…</p>;
  if (!meses.length) return <p className="gris pad">Sin cobros en el período.</p>;

  const hoy = hoyAR(), mesHoy = hoy.slice(0, 7);
  const barras: Barra[] = meses.map((m) => ({
    clave: m.mes, etiqueta: mesCorto(m.mes),
    partes: MEDIOS.map((x) => ({ valor: m.porTipo.get(x.tipo)?.bruto ?? 0, color: x.c })),
  }));
  const completos = meses.filter((m) => m.mes !== mesHoy);
  const ultimo = completos[completos.length - 1];
  const anio = completos.slice(-12);
  const totAnio = anio.reduce((s, m) => s + m.bruto, 0), comAnio = anio.reduce((s, m) => s + m.comision, 0);
  const credAnio = anio.reduce((s, m) => s + (m.porTipo.get('credit_card')?.comision ?? 0), 0);
  const sel = meses.find((m) => m.mes === mes) ?? null;

  // días del mes elegido
  const porDia = new Map<string, { bruto: number; cobros: number; comision: number; partes: Map<string, number> }>();
  for (const f of dias ?? []) {
    if (f.transferencia) continue;
    const a = porDia.get(f.dia) ?? { bruto: 0, cobros: 0, comision: 0, partes: new Map() };
    a.bruto += f.bruto; a.cobros += f.cobros; a.comision += f.comision;
    const t = MEDIOS.some((x) => x.tipo === f.tipo) ? f.tipo : 'otro';
    a.partes.set(t, (a.partes.get(t) ?? 0) + f.bruto); porDia.set(f.dia, a);
  }
  const barrasDias: Barra[] = sel ? Array.from({ length: diasDelMes(sel.mes) }, (_, i) => {
    const d = `${sel.mes}-${String(i + 1).padStart(2, '0')}`, a = porDia.get(d);
    return { clave: d, etiqueta: String(i + 1), partes: MEDIOS.map((x) => ({ valor: a?.partes.get(x.tipo) ?? 0, color: x.c })), apagada: d > hoy };
  }) : [];
  const diasConDatos = [...porDia.keys()].length;

  return (
    <>
      <section className="cifras">
        <div><div className="et">Últimos 12 meses</div><div className="grande">{pesos(totAnio)}</div><div className="gris">{num(anio.reduce((s, m) => s + m.cobros, 0))} cobros · sin transferencias recibidas</div></div>
        <div><div className="et">Comisión de Mercado Pago</div><div className="grande calor">{pesos(comAnio)}</div><div className="gris">{pct((100 * comAnio) / Math.max(1, totAnio), 2)} de lo cobrado</div></div>
        <div><div className="et">De eso, por crédito</div><div className="grande calor">{pesos(credAnio)}</div><div className="gris">{pct((100 * credAnio) / Math.max(1, comAnio), 0)} de la comisión</div></div>
        {ultimo && <div><div className="et">{mesLargo(ultimo.mes)}</div><div className="grande">{pesos(ultimo.bruto)}</div><div className="gris">{pesos(ultimo.bruto / Math.max(1, ultimo.dias))} por día · ticket {pesos(ultimo.bruto / Math.max(1, ultimo.cobros))}</div></div>}
      </section>

      <section className="bloque">
        <div className="titulo"><h2>Cobros por mes</h2><div className="leyenda">{MEDIOS.slice(0, 5).map((m) => <span key={m.tipo}><i className="punto" style={{ background: m.c }} />{m.n}</span>)}</div></div>
        <Barras barras={barras} activa={mes} onElegir={(k) => setMes(k === mes ? null : k)} />
      </section>

      <section className="bloque">
        <div className="tabla"><table className="meses">
          <thead><tr>
            <th>Mes</th><th className="n">Días</th><th className="n">Cobros</th><th className="n">Cobrado</th><th className="n">Contra el anterior</th><th className="n">Por día</th><th className="n">Ticket</th>
            <th className="n">Comisión</th><th className="n">%</th><th className="n">Crédito</th><th className="n">Transferencias recibidas</th>
          </tr></thead>
          <tbody>{[...meses].reverse().map((m) => {
            const i = meses.indexOf(m), prev = meses[i - 1];
            const porDiaM = m.bruto / Math.max(1, m.dias), porDiaP = prev ? prev.bruto / Math.max(1, prev.dias) : null;
            const vs = porDiaP ? (100 * (porDiaM - porDiaP)) / porDiaP : null;
            const cred = m.porTipo.get('credit_card');
            const parcial = m.mes === mesHoy;
            return (
              <tr key={m.mes} className={`clic ${mes === m.mes ? 'activa' : ''}`} onClick={() => setMes(mes === m.mes ? null : m.mes)}>
                <td><b>{mesLargo(m.mes)}</b>{parcial && <span className="gris"> · en curso</span>}</td>
                <td className="n">{m.dias}{m.dias < diasDelMes(m.mes) && !parcial ? <span className="calor"> de {diasDelMes(m.mes)}</span> : ''}</td>
                <td className="n">{num(m.cobros)}</td>
                <td className="n"><b>{pesos(m.bruto)}</b></td>
                <td className="n" style={{ color: vs == null ? undefined : vs >= 0 ? '#6BF8F4' : '#FFAC8F' }}>{vs == null ? '—' : `${vs >= 0 ? '+' : ''}${pct(vs, 0)}`}</td>
                <td className="n">{pesos(porDiaM)}</td>
                <td className="n">{pesos(m.bruto / Math.max(1, m.cobros))}</td>
                <td className="n">{pesos(m.comision)}</td>
                <td className="n">{pct((100 * m.comision) / Math.max(1, m.bruto), 2)}</td>
                <td className="n">{pesos(cred?.bruto ?? 0)}</td>
                <td className="n gris">{m.transf ? `${pesos(m.transf)} · ${m.transfN}` : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="nota">«Contra el anterior» compara lo cobrado por día con datos, así un mes corto no parece peor. Los montos son pesos de cada mes, sin ajustar por inflación.</p>
      </section>

      {sel && (
        <section className="bloque abierto">
          <div className="titulo"><h2>{mesLargo(sel.mes)}</h2><button className="btn" type="button" onClick={() => setMes(null)}>Cerrar</button></div>
          <div className="cifras chicas">
            <div><div className="et">Cobrado</div><div className="medio">{pesos(sel.bruto)}</div></div>
            <div><div className="et">Neto para ODB</div><div className="medio">{pesos(sel.neto)}</div></div>
            <div><div className="et">Comisión</div><div className="medio calor">{pesos(sel.comision)}</div></div>
            <div><div className="et">Días con cobros</div><div className="medio">{dias ? diasConDatos : '—'}</div></div>
            <div><div className="et">Mejor día</div><div className="medio">{dias && porDia.size ? (() => { const [d, a] = [...porDia.entries()].sort((x, y) => y[1].bruto - x[1].bruto)[0]; return <>{diaTxt(d)} · {pesos(a.bruto)}</>; })() : '—'}</div></div>
          </div>
          <div className="dos">
            <div>
              <h3>Cada día</h3>
              {dias == null ? <p className="gris">Cargando…</p> : <Barras barras={barrasDias} alto={170} activa={dia} onElegir={(k) => setDia(k === dia ? null : k)} etiquetaCada={barrasDias.length > 20 ? 2 : 1} />}
            </div>
            <div><h3>Por medio de pago</h3><Medios porTipo={sel.porTipo} total={sel.bruto} /></div>
          </div>
          {dia && (
            <div className="sub">
              <div className="titulo"><h3>Pagos del {diaTxt(dia)}{pagos ? ` · ${pagos.length}` : ''}</h3><button className="btn" type="button" onClick={() => setDia(null)}>Cerrar</button></div>
              <ListaPagos pagos={pagos} />
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ═════════════════ La plata ═════════════════
function LaPlata({ cuenta }: { cuenta: Cuenta }) {
  const hoy = hoyAR();
  const [filas, setFilas] = useState<FilaLib[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const desde = sumarDias(hoy, -30), hasta = sumarDias(hoy, 45);

  useEffect(() => {
    let vivo = true; setFilas(null); setError(null);
    traer<{ filas: FilaLib[] }>('liberaciones', { desde, hasta, cuenta }).then((j) => vivo && setFilas(j.filas.map((f) => ({ ...f, neto: +f.neto })))).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [cuenta, desde, hasta]);
  useEffect(() => {
    if (!dia) { setPagos(null); return; }
    let vivo = true; setPagos(null);
    traer<Pago[]>('pagos-dia', { dia, cuenta, por: 'liberacion' }).then((j) => vivo && setPagos(j)).catch(() => vivo && setPagos([]));
    return () => { vivo = false; };
  }, [dia, cuenta]);

  if (error) return <p className="gris pad">No se pudo leer la plata: {error}</p>;
  if (!filas) return <p className="gris pad">Cargando…</p>;

  const porDia = new Map<string, { neto: number; pagos: number; partes: Map<string, number>; cuentas: Map<string, number> }>();
  for (const f of filas) {
    const a = porDia.get(f.dia) ?? { neto: 0, pagos: 0, partes: new Map(), cuentas: new Map() };
    a.neto += f.neto; a.pagos += f.pagos;
    const t = MEDIOS.some((x) => x.tipo === f.tipo) ? f.tipo : 'otro';
    a.partes.set(t, (a.partes.get(t) ?? 0) + f.neto); a.cuentas.set(f.cuenta, (a.cuentas.get(f.cuenta) ?? 0) + f.neto);
    porDia.set(f.dia, a);
  }
  const suma = (d0: string, d1: string) => [...porDia.entries()].filter(([d]) => d >= d0 && d <= d1).reduce((s, [, a]) => s + a.neto, 0);
  const liberado30 = suma(desde, sumarDias(hoy, -1)), hoyMonto = suma(hoy, hoy);
  const prox7 = suma(sumarDias(hoy, 1), sumarDias(hoy, 7)), prox = suma(sumarDias(hoy, 1), hasta);
  const ultimaFutura = [...porDia.keys()].filter((d) => d > hoy).sort().pop();
  const fin = ultimaFutura && ultimaFutura > sumarDias(hoy, 14) ? ultimaFutura : sumarDias(hoy, 14);
  const lista: string[] = []; for (let d = sumarDias(hoy, -21); d <= fin; d = sumarDias(d, 1)) lista.push(d);
  const barras: Barra[] = lista.map((d) => ({
    clave: d, etiqueta: d === hoy ? 'hoy' : String(Number(d.slice(8))),
    partes: MEDIOS.map((x) => ({ valor: porDia.get(d)?.partes.get(x.tipo) ?? 0, color: d > hoy ? x.c : '#4A4B52' })),
  }));
  const futuros = [...porDia.entries()].filter(([d]) => d >= hoy).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  return (
    <>
      <section className="cifras">
        <div><div className="et">Liberado últimos 30 días</div><div className="grande">{pesos(liberado30)}</div><div className="gris">ya disponible en Mercado Pago</div></div>
        <div><div className="et">Se libera hoy</div><div className="grande frio">{pesos(hoyMonto)}</div></div>
        <div><div className="et">Próximos 7 días</div><div className="grande frio">{pesos(prox7)}</div></div>
        <div><div className="et">Todo lo pendiente</div><div className="grande frio">{pesos(prox)}</div><div className="gris">{ultimaFutura ? `hasta el ${diaTxt(ultimaFutura)}` : 'nada pendiente'}</div></div>
      </section>
      <section className="bloque">
        <div className="titulo"><h2>Lo que libera Mercado Pago cada día</h2><div className="leyenda"><span><i className="punto" style={{ background: '#4A4B52' }} />ya liberado</span><span><i className="punto" style={{ background: '#6BF8F4' }} />por liberar, con el color del medio</span></div></div>
        <Barras barras={barras} activa={dia} onElegir={(k) => setDia(k === dia ? null : k)} etiquetaCada={2} />
      </section>
      <section className="bloque">
        <h3>Por liberar</h3>
        {futuros.length ? (
          <div className="tabla"><table>
            <thead><tr><th>Día</th><th className="n">Pagos</th><th className="n">Neto</th>{!cuenta && <><th className="n">Sant Thomas</th><th className="n">Santa Inés</th></>}<th className="n">De crédito</th></tr></thead>
            <tbody>{futuros.map(([d, a]) => (
              <tr key={d} className={`clic ${dia === d ? 'activa' : ''}`} onClick={() => setDia(dia === d ? null : d)}>
                <td><b>{d === hoy ? 'Hoy' : diaTxt(d)}</b></td><td className="n">{num(a.pagos)}</td><td className="n"><b>{pesos(a.neto)}</b></td>
                {!cuenta && <><td className="n">{pesos(a.cuentas.get('principal') ?? 0)}</td><td className="n">{pesos(a.cuentas.get('santa_ines') ?? 0)}</td></>}
                <td className="n">{pesos(a.partes.get('credit_card') ?? 0)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="gris">No hay plata pendiente de liberar.</p>}
        <p className="nota">Sale de la fecha de liberación y el neto de cada pago. Los retiros al banco y otros descuentos vienen en el reporte de liberaciones de Mercado Pago: es la próxima etapa.</p>
      </section>
      {dia && (
        <section className="bloque abierto">
          <div className="titulo"><h3>Se libera el {diaTxt(dia)}{pagos ? ` · ${pagos.length} pagos` : ''}</h3><button className="btn" type="button" onClick={() => setDia(null)}>Cerrar</button></div>
          <ListaPagos pagos={pagos} conLiberacion />
        </section>
      )}
    </>
  );
}

// ═════════════════ Cobros (lo de todos los días) ═════════════════
function Cobros({ cuenta }: { cuenta: Cuenta }) {
  const [dias, setDias] = useState(7);
  const [resumen, setResumen] = useState<any>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);
  const [link, setLink] = useState<{ abierto: boolean; monto: string; concepto: string; url?: string; copiado?: boolean }>({ abierto: false, monto: '', concepto: '' });

  const cargar = useCallback(async () => {
    setPagos(null);
    const [r, p] = await Promise.all([traer<any>('resumen', { dias, cuenta }).catch(() => null), traer<Pago[]>('pagos', { dias, cuenta }).catch(() => [])]);
    setResumen(r); setPagos(p);
  }, [dias, cuenta]);
  useEffect(() => { void cargar(); }, [cargar]);

  const importar = async () => {
    setYendo(true); setAviso(null);
    try {
      const r = await fetch('/api/mercadopago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'importar', dias: 30 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'Error');
      setAviso(`Listo: ${num(d.importados)} pagos revisados, ${num(d.vinculados)} vinculados a ventas.`);
      await cargar();
    } catch (e: any) { setAviso(e.message); } finally { setYendo(false); }
  };
  const crearLink = async (e: React.FormEvent) => {
    e.preventDefault(); setYendo(true); setAviso(null);
    try {
      const r = await fetch('/api/mercadopago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'link', monto: Number(link.monto), concepto: link.concepto }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'Error');
      setLink({ ...link, url: d.url, copiado: false });
    } catch (err: any) { setAviso(err.message); } finally { setYendo(false); }
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(link.url ?? ''); setLink({ ...link, copiado: true }); } catch {} };

  const serie: { fecha: string; principal: number; santa_ines: number }[] = resumen?.porDia ?? [];
  const barras: Barra[] = serie.map((d) => ({ clave: d.fecha, etiqueta: String(Number(d.fecha.slice(8))), partes: [{ valor: d.principal, color: '#6BF8F4' }, { valor: d.santa_ines, color: '#59A8F3' }] }));

  return (
    <>
      <section className="fila-acciones">
        <div className="grupo" role="group" aria-label="Período">
          {[[1, 'Hoy'], [7, 'Semana'], [15, 'Quincena'], [30, '30 días']].map(([d, t]) => (
            <button key={d} type="button" className="chip" aria-pressed={dias === d} onClick={() => setDias(d as number)}>{t}</button>
          ))}
        </div>
        <div className="grupo">
          <button className="btn" type="button" onClick={importar} disabled={yendo}>{yendo ? 'Trayendo…' : 'Traer pagos ahora'}</button>
          <button className="btn lleno" type="button" onClick={() => setLink({ abierto: !link.abierto, monto: '', concepto: '' })}>Link de pago</button>
        </div>
      </section>
      {aviso && <p className="aviso">{aviso}</p>}
      {link.abierto && (
        <form className="link" onSubmit={crearLink}>
          {!link.url ? (
            <>
              <label><span className="et">Monto</span><input inputMode="decimal" required value={link.monto} onChange={(e) => setLink({ ...link, monto: e.target.value })} /></label>
              <label className="largo"><span className="et">Concepto (lo ve el cliente)</span><input value={link.concepto} onChange={(e) => setLink({ ...link, concepto: e.target.value })} /></label>
              <button className="btn lleno" type="submit" disabled={yendo}>Generar</button>
              <span className="gris">Para cobrar a distancia. El pago entra solo al sistema.</span>
            </>
          ) : (
            <>
              <span>Link por <b>{pesos(Number(link.monto))}</b>{link.concepto ? ` · ${link.concepto}` : ''}</span>
              <span className="url">{link.url}</span>
              <button className="btn lleno" type="button" onClick={copiar}>{link.copiado ? 'Copiado' : 'Copiar link'}</button>
              <button className="btn" type="button" onClick={() => setLink({ abierto: false, monto: '', concepto: '' })}>Listo</button>
            </>
          )}
        </form>
      )}
      <section className="cifras">
        <div><div className="et">Cobrado</div><div className="grande">{pesos(resumen?.bruto)}</div><div className="gris">{num(resumen?.cobros ?? 0)} cobros</div></div>
        <div><div className="et">Comisión</div><div className="grande calor">{pesos(resumen?.comision)}</div><div className="gris">{resumen ? pct(resumen.comisionPromedioPct) : '—'} promedio</div></div>
        <div><div className="et">Neto</div><div className="grande">{pesos(resumen?.neto)}</div></div>
        <div><div className="et">Por liberar</div><div className="grande frio">{pesos(resumen?.porLiberar)}</div></div>
      </section>
      {dias > 1 && barras.length > 1 && (
        <section className="bloque">
          <div className="titulo"><h2>Cada día</h2>{!cuenta && <div className="leyenda"><span><i className="punto" style={{ background: '#6BF8F4' }} />Sant Thomas</span><span><i className="punto" style={{ background: '#59A8F3' }} />Santa Inés</span></div>}</div>
          <Barras barras={barras} alto={160} />
        </section>
      )}
      <section className="bloque">
        <h3>Pagos{pagos ? ` · ${pagos.length}` : ''}</h3>
        <ListaPagos pagos={pagos} />
      </section>
    </>
  );
}

export function MercadoPagoTablero() {
  const [vista, setVista] = useState<Vista>('mes');
  const [cuenta, setCuenta] = useState<Cuenta>('');
  useEffect(() => { try { const g = JSON.parse(localStorage.getItem('odb-mp-vista') ?? 'null'); if (g?.vista) setVista(g.vista); if (g?.cuenta !== undefined) setCuenta(g.cuenta); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('odb-mp-vista', JSON.stringify({ vista, cuenta })); } catch {} }, [vista, cuenta]);

  return (
    <div className="mp">
      <style>{CSS}</style>
      <header>
        <div className="fila1">
          <div className="marca">→ ODB · MERCADO PAGO</div>
          <nav className="vistas" aria-label="Vista">
            {([['mes', 'Mes a mes'], ['plata', 'La plata'], ['cobros', 'Cobros']] as [Vista, string][]).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={vista === v} onClick={() => setVista(v)}>{t}</button>
            ))}
          </nav>
          <div className="grupo" role="group" aria-label="Empresa">
            {([['', 'Las dos'], ['principal', 'Sant Thomas'], ['santa_ines', 'Santa Inés']] as [Cuenta, string][]).map(([c, t]) => (
              <button key={c || 'todas'} type="button" className="chip" aria-pressed={cuenta === c} onClick={() => setCuenta(c)}>{t}</button>
            ))}
          </div>
        </div>
      </header>
      <main>
        {vista === 'mes' && <MesAMes cuenta={cuenta} />}
        {vista === 'plata' && <LaPlata cuenta={cuenta} />}
        {vista === 'cobros' && <Cobros cuenta={cuenta} />}
      </main>
      <footer>
        <div><b>De dónde sale:</b> los pagos aprobados de las dos cuentas de Mercado Pago ({Object.values(EMPRESAS).map((e) => e.nombre).join(' y ')}), con la comisión, el neto y la fecha de liberación exactos de cada uno. Se traen solos cada 15 minutos; la historia arranca el 5/10/2025.</div>
        <div><b>Cobrado</b> no incluye las transferencias que llegan a la cuenta: no son ventas y van en su columna.</div>
      </footer>
    </div>
  );
}

const CSS = `
.mp{--negro:#09090D;--blanco:#F5F5F7;--gris:#7E7F86;--gris2:#4A4B52;--linea:#202127;--cian:#6BF8F4;--calor:#FF5A1F;--salmon:#FFAC8F;
  flex:1;min-height:0;overflow-y:auto;background:var(--negro);color:var(--blanco);font:400 12px/1.45 var(--letra-mp),Arial,sans-serif;font-variant-numeric:tabular-nums;color-scheme:dark}
.mp *{box-sizing:border-box}
.mp header,.mp main,.mp footer{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.mp button,.mp input{font:inherit;color:inherit}
.mp button{cursor:pointer}
.mp canvas{font-family:var(--letra-mp),Arial,sans-serif}
.mp :focus-visible{outline:1px solid var(--blanco);outline-offset:2px}
.mp .et{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);font-weight:600}
.mp .gris{color:var(--gris)}
.mp .calor{color:var(--calor)}
.mp .frio{color:var(--cian)}
.mp .pad{padding-block:28px}
.mp header{position:sticky;top:0;z-index:5;background:var(--negro);border-bottom:1px solid var(--linea)}
.mp .fila1{display:flex;flex-wrap:wrap;align-items:center;gap:10px 26px;padding-block:14px}
.mp .marca{font-weight:800;font-size:17px;letter-spacing:-.01em;white-space:nowrap}
.mp .vistas{display:flex;gap:18px}
.mp .vistas button{background:none;border:0;padding:4px 0;font-size:12px;font-weight:600;color:var(--gris);border-bottom:2px solid transparent}
.mp .vistas button[aria-pressed="true"]{color:var(--blanco);border-bottom-color:var(--blanco)}
.mp .grupo{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.mp .fila1 .grupo{margin-left:auto}
.mp .chip{background:none;border:1px solid var(--linea);padding:6px 9px;font-size:10.5px;color:var(--gris);white-space:nowrap}
.mp .chip:hover{color:var(--blanco)}
.mp .chip[aria-pressed="true"]{border-color:var(--blanco);color:var(--blanco)}
.mp .btn{background:none;border:1px solid var(--gris2);padding:7px 10px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.mp .btn:hover{border-color:var(--blanco)}
.mp .btn[disabled]{color:var(--gris2);border-color:var(--linea);cursor:default}
.mp .btn.lleno{background:var(--blanco);color:var(--negro);border-color:var(--blanco)}
.mp main{padding-block:6px 24px}
.mp .cifras{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 28px;padding-block:22px;border-bottom:1px solid var(--linea)}
.mp .cifras>div{min-width:0}
.mp .cifras .grande{font-weight:800;font-size:clamp(20px,2.3vw,30px);letter-spacing:-.03em;line-height:1.1;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mp .cifras .gris{font-size:10.5px;margin-top:4px}
.mp .cifras.chicas{grid-template-columns:repeat(5,minmax(0,1fr));padding-block:14px;border-bottom:0}
.mp .cifras .medio{font-weight:600;font-size:15px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mp .bloque{padding-block:18px;border-bottom:1px solid var(--linea)}
.mp .bloque.abierto{border-left:2px solid var(--blanco);padding-left:16px;margin-left:-18px}
.mp .titulo{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 18px;margin-bottom:10px}
.mp h2{margin:0;font-size:13px;font-weight:600}
.mp h3{margin:0 0 8px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);font-weight:600}
.mp .titulo h3{margin:0}
.mp .leyenda{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:10.5px;color:var(--gris)}
.mp .punto{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px}
.mp canvas.barras{width:100%;display:block;touch-action:pan-y}
.mp .lectura{display:flex;flex-wrap:wrap;gap:4px 16px;min-height:18px;margin-top:6px;font-size:11px}
.mp .lectura b{font-weight:600}
.mp .dos{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:28px;margin-top:6px}
.mp .dos>*{min-width:0}
.mp .sub{margin-top:18px}
.mp .tabla{overflow-x:auto}
.mp .tabla.alta{max-height:520px;overflow:auto}
.mp table{width:100%;border-collapse:collapse;font-size:11px}
.mp td,.mp th{padding:7px 0;border-bottom:1px solid var(--linea);text-align:left;font-weight:400;white-space:nowrap}
.mp td+td,.mp th+th{padding-left:14px}
.mp th{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gris);font-weight:600;position:sticky;top:0;background:var(--negro)}
.mp td b{font-weight:600}
.mp .n{text-align:right}
.mp td.corta{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.mp tr.clic{cursor:pointer}
.mp tr.clic:hover td{background:#111117}
.mp tr.activa td{background:#15151c}
.mp tr.apagada{opacity:.45}
.mp .nota{color:var(--gris);font-size:10.5px;margin:10px 0 0;max-width:80ch}
.mp .fila-acciones{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding-block:16px 0}
.mp .aviso{color:var(--cian);font-size:11px;margin:10px 0 0}
.mp form.link{display:flex;flex-wrap:wrap;align-items:end;gap:10px 14px;padding-block:14px;border-bottom:1px solid var(--linea)}
.mp form.link label{display:grid;gap:4px;min-width:140px}
.mp form.link .largo{flex:1}
.mp form.link .url{flex:1;min-width:0;word-break:break-all;color:var(--gris);font-size:10.5px}
.mp input{background:transparent;border:0;border-bottom:1px solid var(--gris2);padding:5px 0;font-size:13px;border-radius:0;width:100%;min-width:0}
.mp input:focus{outline:none;border-bottom-color:var(--blanco)}
.mp footer{border-top:1px solid var(--linea);padding-block:14px 28px;color:var(--gris);font-size:10.5px;display:grid;gap:6px;line-height:1.6}
.mp footer b{color:var(--blanco);font-weight:600}
@media (max-width:1100px){
  .mp .cifras{grid-template-columns:repeat(2,minmax(0,1fr))}
  .mp .cifras.chicas{grid-template-columns:repeat(2,minmax(0,1fr))}
  .mp .dos{grid-template-columns:minmax(0,1fr)}
  .mp .fila1 .grupo{margin-left:0}
}
@media (max-width:520px){
  .mp .bloque.abierto{margin-left:0;padding-left:10px}
}
`;
