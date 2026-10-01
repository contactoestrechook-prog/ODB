'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CrearPromocion } from './CrearPromocion';
import { TogglePromo } from './TogglePromo';
import { Aviso, Boton, Cargando, Entrada, Etiqueta, Kpi, Pestanas, TablaResponsiva, Tarjeta, Vacio, type TonoEtiqueta } from './kit';
import { fecha, pesos } from '../lib/formato';

type Opcion = { id: string; nombre: string };
type Segmento = { segmento: string; etiqueta: string; clientes: number; ticketPromedio: number | null; ventasIdentificadas: number };

const SEG_LABEL: Record<string, string> = {
  nuevo: 'Nuevos', ocasional: 'Ocasionales', frecuente: 'Frecuentes', mayorista: 'Mayoristas', vip: 'VIP', '': 'Todos',
};
// Vigente en verde (está corriendo), programada en celeste, el resto apagado.
// El rojo sólido de antes era para un dato normal y dejaba de avisar.
const ESTADO_TONO: Record<string, TonoEtiqueta> = {
  vigente: 'ok', programado: 'info',
  vencido: 'neutro', inactivo: 'neutro',
};

const TABS = [
  ['sugeridas', 'Sugeridas por IA'],
  ['stock', 'Por stock'],
  ['contexto', 'Por contexto'],
  ['vigentes', 'Vigentes y últimas'],
  ['rendimiento', 'Rendimiento'],
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
    <div className="space-y-4 sm:space-y-5">
      {/* cabecera: ticket por segmento + crear */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 text-sm text-tinta/70">
          Ticket promedio general: <strong className="importe text-tinta">{pesos(ticketGeneral)}</strong>
          <span className="text-xs text-tinta/60"> · el precio con descuento se aplica solo al segmento elegido</span>
        </p>
        <CrearPromocion categorias={categorias} marcas={marcas} segmentos={segmentos} ticketGeneral={ticketGeneral} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {segmentos.map((s) => {
          const alto = s.ticketPromedio != null && s.ticketPromedio >= ticketGeneral * 1.2;
          const bajo = s.ticketPromedio != null && s.ticketPromedio <= ticketGeneral * 0.8;
          return (
            <Kpi
              key={s.segmento}
              etiqueta={s.etiqueta}
              valor={pesos(s.ticketPromedio)}
              sub={
                <>
                  ticket prom · {s.clientes} cli.
                  {alto && <span className="mt-1 block font-semibold text-ok">↑ sobre el promedio</span>}
                  {bajo && <span className="mt-1 block font-semibold text-marca-hondo">↓ bajo el promedio</span>}
                </>
              }
            />
          );
        })}
      </div>

      {/* pestañas */}
      <Pestanas
        valor={tab}
        onCambiar={irA}
        etiquetaAccesible="Vistas de promociones"
        opciones={TABS.map(([k, label]) => ({ valor: k as string, etiqueta: label }))}
      />

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      {/* SUGERIDAS POR IA */}
      {tab === 'sugeridas' && (
        <div className="space-y-3">
          <Tarjeta className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-tinta">El estratega de promociones mira tu stock, vencimientos y el calendario</p>
              <p className="mt-0.5 text-sm text-tinta/60">y te propone promociones rentables, listas para crear con un click.</p>
            </div>
            <Boton onClick={() => pedir('sugerir')} disabled={cargando} className="w-full shrink-0 sm:w-auto">
              {cargando ? 'Pensando…' : 'Sugerir promociones'}
            </Boton>
          </Tarjeta>
          {propuestas?.map((p, i) => (
            <PropuestaCard key={i} p={p} valorTxt={valorTxt} creada={creadas['sug-' + i]} onCrear={() => crearDesde(p, 'sug-' + i)} />
          ))}
          {propuestas?.length === 0 && <p className="px-1 text-sm text-tinta/60">Sin propuestas ahora — probá de nuevo más tarde.</p>}
        </div>
      )}

      {/* POR STOCK */}
      {tab === 'stock' && (
        <div className="space-y-3">
          <p className="px-1 text-sm text-tinta/70">Productos con sobrestock, sin rotación o que vencen pronto, con margen que banca el descuento.</p>
          {cargando && <Cargando texto="Calculando…" className="px-1" />}
          {(candidatos ?? []).map((c) => (
            <Tarjeta key={c.sku} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-semibold text-tinta">{c.nombre}</p>
                <p className="mt-0.5 text-xs text-tinta/60">
                  {c.motivos.join(' · ')} · stock {Math.round(c.stock)} · margen {c.margenPct}% · <span className="importe">{pesos(c.capital)}</span> inmovilizados
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                <p className="text-sm font-semibold text-marca-hondo">−{c.descuentoSugerido}% sugerido</p>
                {creadas['stock-' + c.sku] ? (
                  <Etiqueta tono="ok">creada</Etiqueta>
                ) : (
                  <Boton variante="secundario" tamano="chico" onClick={() => crearStock(c)}>Crear promo</Boton>
                )}
              </div>
            </Tarjeta>
          ))}
          {candidatos?.length === 0 && <p className="px-1 text-sm text-tinta/60">Nada que liquidar ahora: el stock está sano.</p>}
        </div>
      )}

      {/* POR CONTEXTO */}
      {tab === 'contexto' && (
        <div className="space-y-3">
          <Tarjeta>
            <p className="font-semibold text-tinta">Promociones temáticas para un momento</p>
            <p className="mb-3 mt-0.5 text-sm text-tinta/60">Contale el contexto y arma combos con lo que tenés en stock.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Entrada
                value={contexto}
                onChange={(e) => setContexto(e.target.value)}
                placeholder="Ej: partido de Argentina el sábado · Día del Padre · ola de calor"
                aria-label="Contexto de la promoción"
                className="min-w-0 sm:flex-1"
              />
              <Boton onClick={() => pedir('contexto')} disabled={cargando || !contexto.trim()} className="shrink-0">
                {cargando ? 'Armando…' : 'Generar'}
              </Boton>
            </div>
          </Tarjeta>
          {propuestas?.map((p, i) => (
            <PropuestaCard key={i} p={p} valorTxt={valorTxt} creada={creadas['sug-' + i]} onCrear={() => crearDesde(p, 'sug-' + i)} />
          ))}
        </div>
      )}

      {/* VIGENTES */}
      {tab === 'vigentes' && (
        <TablaResponsiva
          etiqueta="Promociones vigentes y últimas"
          filas={descuentos}
          claveFila="id"
          vacio={<Vacio titulo="No hay promociones cargadas" texto="Creá una con “Nueva promoción” o desde las sugeridas." />}
          columnas={[
            {
              clave: 'promocion',
              titulo: 'Promoción',
              principal: true,
              celda: (d) => (
                <>
                  <p className="break-words font-medium">{d.nombre}</p>
                  <p className="text-xs font-normal text-tinta/60">
                    {[d.solo_comunidad && 'Comunidad', d.segmento && `solo ${SEG_LABEL[d.segmento] ?? d.segmento}`, d.medio_pago && `con ${d.medio_pago}`].filter(Boolean).join(' · ')}
                  </p>
                </>
              ),
            },
            {
              clave: 'beneficio',
              titulo: 'Beneficio',
              celda: (d) => <span className="font-semibold text-marca-hondo">{valorTxt(d.tipo, Math.round(d.valor))}</span>,
            },
            {
              clave: 'vigencia',
              titulo: 'Vigencia',
              celda: (d) => <span className="importe text-tinta/70">{fecha(d.desde)} → {fecha(d.hasta)}</span>,
            },
            {
              clave: 'estado',
              titulo: 'Estado',
              alinear: 'derecha',
              celda: (d) => <Etiqueta tono={ESTADO_TONO[d.estado] ?? 'neutro'}>{d.estado}</Etiqueta>,
            },
            {
              clave: 'acciones',
              titulo: '',
              acciones: true,
              celda: (d) => (d.estado !== 'vencido' ? <TogglePromo id={d.id} activo={d.estado !== 'inactivo'} /> : null),
            },
          ]}
        />
      )}

      {/* RENDIMIENTO */}
      {tab === 'rendimiento' && (
        <div className="space-y-3">
          <p className="px-1 text-sm text-tinta/70">Cuánto se movió el alcance de cada promoción durante su vigencia (ordenado por facturación).</p>
          {cargando && <Cargando texto="Midiendo…" className="px-1" />}
          {(rendimiento ?? []).map((r) => (
            <Tarjeta key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold text-tinta">{r.nombre}</p>
                <p className="mt-0.5 text-xs text-tinta/60">
                  {valorTxt(r.tipo, Math.round(r.valor))} · {r.segmento ? `solo ${SEG_LABEL[r.segmento] ?? r.segmento}` : 'todos'} · {fecha(r.desde)} → {fecha(r.hasta)}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline justify-between gap-3 sm:block sm:text-right">
                <p className="importe font-semibold text-tinta">{pesos(r.facturado)}</p>
                <p className="text-xs text-tinta/60">{r.unidades.toLocaleString('es-AR')} u. en la ventana</p>
              </div>
            </Tarjeta>
          ))}
          {rendimiento?.length === 0 && <p className="px-1 text-sm text-tinta/60">Todavía no hay promociones con ventas medibles.</p>}
        </div>
      )}
    </div>
  );
}

function PropuestaCard({ p, valorTxt, creada, onCrear }: { p: Propuesta; valorTxt: (t: string, v: number) => string; creada?: boolean; onCrear: () => void }) {
  const objetivo = p.alcance === 'producto' ? p.sku : p.alcance === 'categoria' ? p.categoria : 'toda la tienda';
  return (
    <Tarjeta className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 break-words font-semibold text-tinta">{p.nombre}</p>
          <Etiqueta>{SEG_LABEL[p.segmento] ?? p.segmento}</Etiqueta>
          {p.soloComunidad && <Etiqueta tono="info">Comunidad</Etiqueta>}
        </div>
        <p className="mt-1 text-sm text-tinta/70">{p.motivo}</p>
        <p className="mt-1 text-xs text-tinta/60">{valorTxt(p.tipo, p.valor)} · {objetivo} · {p.diasVigencia} días</p>
      </div>
      {creada ? (
        <Etiqueta tono="ok" className="self-start">creada</Etiqueta>
      ) : (
        <Boton tamano="chico" onClick={onCrear} className="self-start">
          Crear
        </Boton>
      )}
    </Tarjeta>
  );
}
