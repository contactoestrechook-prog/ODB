'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CrearPromocion } from './CrearPromocion';
import { TogglePromo } from './TogglePromo';

type Opcion = { id: string; nombre: string };
type Segmento = { segmento: string; etiqueta: string; clientes: number; ticketPromedio: number | null; ventasIdentificadas: number };

const pesos = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const SEG_LABEL: Record<string, string> = {
  nuevo: 'Nuevos', ocasional: 'Ocasionales', frecuente: 'Frecuentes', mayorista: 'Mayoristas', vip: 'VIP', '': 'Todos',
};
const ESTADO_ESTILO: Record<string, string> = {
  vigente: 'bg-[#B82D25] text-white', programado: 'bg-black text-white',
  vencido: 'bg-[#F0EBE2] text-black/50', inactivo: 'bg-[#F0EBE2] text-black/50',
};

const TABS = [
  ['sugeridas', '✨ Sugeridas por IA'],
  ['stock', '📦 Por stock'],
  ['contexto', '🎯 Por contexto'],
  ['vigentes', '📋 Vigentes y últimas'],
  ['rendimiento', '📈 Rendimiento'],
] as const;

type Propuesta = {
  nombre: string; motivo: string; segmento: string; alcance: string;
  sku?: string; categoria?: string; tipo: string; valor: number; diasVigencia: number; soloComunidad?: boolean;
};

export function PromosWorkspace({
  descuentos, segmentos, ticketGeneral, categorias, marcas,
}: {
  descuentos: any[]; segmentos: Segmento[]; ticketGeneral: number; categorias: Opcion[]; marcas: Opcion[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>('sugeridas');
  const [cargando, setCargando] = useState(false);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  const [candidatos, setCandidatos] = useState<any[] | null>(null);
  const [rendimiento, setRendimiento] = useState<any[] | null>(null);
  const [contexto, setContexto] = useState('');
  const [creadas, setCreadas] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState('');

  const valorTxt = (tipo: string, valor: number) =>
    tipo === 'porcentaje' ? `${valor}% off` : tipo === 'monto_fijo' ? `$${valor} menos` : `a $${valor}`;

  async function pedir(accion: 'sugerir' | 'contexto') {
    setCargando(true);
    setAviso('');
    setPropuestas(null);
    try {
      const res = await fetch('/api/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accion === 'contexto' ? { accion, contexto } : { accion }),
      });
      const d = await res.json();
      if (!res.ok) { setAviso(d.message ?? 'No se pudo generar'); return; }
      setPropuestas(d.promociones ?? []);
    } finally {
      setCargando(false);
    }
  }

  async function pedirGet(accion: 'segun-stock' | 'rendimiento') {
    setCargando(true);
    try {
      const res = await fetch(`/api/promos?accion=${accion}`);
      const d = await res.json();
      if (accion === 'segun-stock') setCandidatos(Array.isArray(d) ? d : []);
      else setRendimiento(Array.isArray(d) ? d : []);
    } finally {
      setCargando(false);
    }
  }

  function irA(t: string) {
    setTab(t);
    setAviso('');
    if (t === 'stock' && candidatos === null) pedirGet('segun-stock');
    if (t === 'rendimiento' && rendimiento === null) pedirGet('rendimiento');
  }

  async function crearDesde(p: Propuesta, clave: string) {
    const cat = p.alcance === 'categoria' ? categorias.find((c) => c.nombre.toLowerCase() === (p.categoria ?? '').toLowerCase()) : null;
    const body: any = {
      nombre: p.nombre,
      alcance: p.alcance,
      tipo: p.tipo,
      valor: p.valor,
      desde: new Date().toISOString(),
      hasta: new Date(Date.now() + (p.diasVigencia || 7) * 86400_000).toISOString(),
      segmento: p.segmento || undefined,
      soloComunidad: p.soloComunidad || false,
      categoriaId: cat?.id,
      sku: p.alcance === 'producto' ? p.sku : undefined,
    };
    const res = await fetch('/api/descuento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) {
      setCreadas((c) => ({ ...c, [clave]: true }));
      router.refresh();
    } else {
      setAviso((await res.json()).message ?? 'No se pudo crear');
    }
  }

  async function crearStock(c: any) {
    await crearDesde(
      { nombre: `Liquidación ${c.nombre} −${c.descuentoSugerido}%`, motivo: c.motivos.join(', '), segmento: '', alcance: 'producto', sku: c.sku, tipo: 'porcentaje', valor: c.descuentoSugerido, diasVigencia: 12 },
      'stock-' + c.sku,
    );
  }

  return (
    <div className="space-y-5">
      {/* cabecera: ticket por segmento + crear */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-black/60">
          Ticket promedio general: <strong className="text-black">{pesos(ticketGeneral)}</strong>
          <span className="text-xs text-black/40"> · el precio con descuento se aplica solo al segmento elegido</span>
        </p>
        <CrearPromocion categorias={categorias} marcas={marcas} segmentos={segmentos} ticketGeneral={ticketGeneral} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {segmentos.map((s) => {
          const alto = s.ticketPromedio != null && s.ticketPromedio >= ticketGeneral * 1.2;
          const bajo = s.ticketPromedio != null && s.ticketPromedio <= ticketGeneral * 0.8;
          return (
            <div key={s.segmento} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
              <p className="text-xs font-medium text-black">{s.etiqueta}</p>
              <p className="text-lg font-semibold text-black mt-1 leading-none">{pesos(s.ticketPromedio)}</p>
              <p className="text-[11px] text-black/40 mt-1">ticket prom · {s.clientes} cli.</p>
              {alto && <p className="text-[10px] text-emerald-700 mt-1 font-medium">↑ sobre el promedio</p>}
              {bajo && <p className="text-[10px] text-[#B82D25] mt-1 font-medium">↓ bajo el promedio</p>}
            </div>
          );
        })}
      </div>

      {/* pestañas */}
      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => irA(k)}
            className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${
              tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      {/* SUGERIDAS POR IA */}
      {tab === 'sugeridas' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-black">El estratega de promociones mira tu stock, vencimientos y el calendario</p>
              <p className="text-xs text-black/50 mt-0.5">y te propone promociones rentables, listas para crear con un click.</p>
            </div>
            <button onClick={() => pedir('sugerir')} disabled={cargando}
              className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50 whitespace-nowrap">
              {cargando ? 'Pensando…' : '✨ Sugerir promociones'}
            </button>
          </div>
          {propuestas?.map((p, i) => (
            <PropuestaCard key={i} p={p} valorTxt={valorTxt} creada={creadas['sug-' + i]} onCrear={() => crearDesde(p, 'sug-' + i)} />
          ))}
          {propuestas?.length === 0 && <p className="text-sm text-black/50 px-1">Sin propuestas ahora — probá de nuevo más tarde.</p>}
        </div>
      )}

      {/* POR STOCK */}
      {tab === 'stock' && (
        <div className="space-y-3">
          <p className="text-sm text-black/55 px-1">Productos con sobrestock, sin rotación o que vencen pronto, con margen que banca el descuento.</p>
          {cargando && <p className="text-sm text-black/40 px-1">Calculando…</p>}
          {(candidatos ?? []).map((c) => (
            <div key={c.sku} className="rounded-xl bg-white p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-black">{c.nombre}</p>
                <p className="text-xs text-black/50 mt-0.5">
                  {c.motivos.join(' · ')} · stock {Math.round(c.stock)} · margen {c.margenPct}% · ${Number(c.capital).toLocaleString('es-AR')} inmovilizados
                </p>
              </div>
              <div className="text-right whitespace-nowrap">
                <p className="text-[#932A1F] font-medium text-sm">−{c.descuentoSugerido}% sugerido</p>
                {creadas['stock-' + c.sku] ? (
                  <span className="text-xs text-emerald-700">✓ creada</span>
                ) : (
                  <button onClick={() => crearStock(c)} className="text-xs font-medium text-[#B82D25] hover:underline">Crear promo →</button>
                )}
              </div>
            </div>
          ))}
          {candidatos?.length === 0 && <p className="text-sm text-black/50 px-1">Nada que liquidar ahora: el stock está sano.</p>}
        </div>
      )}

      {/* POR CONTEXTO */}
      {tab === 'contexto' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white p-5">
            <p className="font-medium text-black">Promociones temáticas para un momento</p>
            <p className="text-xs text-black/50 mt-0.5 mb-3">Contale el contexto y arma combos con lo que tenés en stock.</p>
            <div className="flex gap-2">
              <input
                value={contexto}
                onChange={(e) => setContexto(e.target.value)}
                placeholder="Ej: partido de Argentina el sábado · Día del Padre · ola de calor"
                className="flex-1 rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <button onClick={() => pedir('contexto')} disabled={cargando || !contexto.trim()}
                className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50 whitespace-nowrap">
                {cargando ? 'Armando…' : 'Generar'}
              </button>
            </div>
          </div>
          {propuestas?.map((p, i) => (
            <PropuestaCard key={i} p={p} valorTxt={valorTxt} creada={creadas['sug-' + i]} onCrear={() => crearDesde(p, 'sug-' + i)} />
          ))}
        </div>
      )}

      {/* VIGENTES */}
      {tab === 'vigentes' && (
        <div className="rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Promoción</th>
                <th className="px-4 py-2 font-medium">Beneficio</th>
                <th className="px-4 py-2 font-medium">Vigencia</th>
                <th className="px-4 py-2 font-medium text-right">Estado</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {descuentos.map((d) => (
                <tr key={d.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{d.nombre}</p>
                    <p className="text-xs text-black/50">
                      {[d.solo_comunidad && '🔒 Comunidad', d.segmento && `solo ${SEG_LABEL[d.segmento] ?? d.segmento}`, d.medio_pago && `con ${d.medio_pago}`].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-medium text-[#932A1F]">{valorTxt(d.tipo, Math.round(d.valor))}</td>
                  <td className="px-4 py-3 text-black/70">{fecha(d.desde)} → {fecha(d.hasta)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_ESTILO[d.estado]}`}>{d.estado}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.estado !== 'vencido' && <TogglePromo id={d.id} activo={d.estado !== 'inactivo'} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RENDIMIENTO */}
      {tab === 'rendimiento' && (
        <div className="space-y-3">
          <p className="text-sm text-black/55 px-1">Cuánto se movió el alcance de cada promoción durante su vigencia (ordenado por facturación).</p>
          {cargando && <p className="text-sm text-black/40 px-1">Midiendo…</p>}
          {(rendimiento ?? []).map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-black">{r.nombre}</p>
                <p className="text-xs text-black/50 mt-0.5">
                  {valorTxt(r.tipo, Math.round(r.valor))} · {r.segmento ? `solo ${SEG_LABEL[r.segmento] ?? r.segmento}` : 'todos'} · {fecha(r.desde)} → {fecha(r.hasta)}
                </p>
              </div>
              <div className="text-right whitespace-nowrap">
                <p className="font-semibold text-black">{pesos(r.facturado)}</p>
                <p className="text-xs text-black/45">{r.unidades.toLocaleString('es-AR')} u. en la ventana</p>
              </div>
            </div>
          ))}
          {rendimiento?.length === 0 && <p className="text-sm text-black/50 px-1">Todavía no hay promociones con ventas medibles.</p>}
        </div>
      )}
    </div>
  );
}

function PropuestaCard({ p, valorTxt, creada, onCrear }: { p: Propuesta; valorTxt: (t: string, v: number) => string; creada?: boolean; onCrear: () => void }) {
  const objetivo = p.alcance === 'producto' ? p.sku : p.alcance === 'categoria' ? p.categoria : 'toda la tienda';
  return (
    <div className="rounded-xl bg-white p-4 flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-black">{p.nombre}</p>
          <span className="text-[11px] rounded-full bg-black text-white px-2 py-0.5">{SEG_LABEL[p.segmento] ?? p.segmento}</span>
          {p.soloComunidad && <span className="text-[11px] rounded-full bg-[#B82D25]/10 text-[#932A1F] px-2 py-0.5">🔒 Comunidad</span>}
        </div>
        <p className="text-xs text-black/55 mt-1">{p.motivo}</p>
        <p className="text-xs text-black/40 mt-1">{valorTxt(p.tipo, p.valor)} · {objetivo} · {p.diasVigencia} días</p>
      </div>
      {creada ? (
        <span className="text-xs text-emerald-700 whitespace-nowrap">✓ creada</span>
      ) : (
        <button onClick={onCrear} className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-4 py-2 hover:bg-[#932A1F] whitespace-nowrap">
          Crear
        </button>
      )}
    </div>
  );
}
