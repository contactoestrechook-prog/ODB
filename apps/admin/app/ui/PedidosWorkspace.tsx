'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { numero, pesos as pesosFmt } from '../lib/formato';
import {
  cantidadLegible, codigoDe, entregaDe, ESTADOS, haceCuanto, linkWhatsapp, origenDe, pideMedioAlEntregar, siguientePaso, sinTomar,
  telefonoLegible, type PedidoCola,
} from '../lib/pedidos';
import { BotonMicrofono } from './BotonMicrofono';
import {
  AreaTexto, Aviso, Boton, Cargando, Chips, Entrada, Etiqueta, FOCO, IconoCerrar, Modal, Pestanas, PlacaRoja, TablaResponsiva, Tarjeta, unir,
  useConfirmar, Vacio,
} from './kit';

const pesos = (n: any) => pesosFmt(Number(n) || 0);
// Precio unitario de un renglón interpretado del WhatsApp: el análisis
// (apps/api/src/pedidos › analizarWhatsApp) manda el `precio` vigente de cada
// renglón y la Placa roja muestra "2 × $1.500", el subtotal y el total.
type RenglonWa = { cantidad?: unknown; precio?: unknown };
const precioDe = (it: RenglonWa | null | undefined): number | null => {
  const n = Number(it?.precio);
  return it?.precio != null && it.precio !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

// El filtro de arriba: por dónde entró (6/10/2026; antes mezclaba canal y origen).
const FILTROS = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'bot', etiqueta: 'WhatsApp (bot)' },
  { valor: 'panel', etiqueta: 'Cargados a mano' },
  { valor: 'web', etiqueta: 'Tienda web' },
  { valor: 'app', etiqueta: 'App' },
  { valor: 'pedidosya', etiqueta: 'PedidosYa' },
  { valor: 'tiendanube', etiqueta: 'Tiendanube' },
];
const origenClave = (p: PedidoCola) => {
  const o = String(p.origen ?? p.canal);
  return o === 'whatsapp' ? 'panel' : o;
};

const MEDIOS = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
];

// "mar 6/10 · 09:54" (toLocaleString daba "mar 6-10, 09:54")
const ZONA = 'America/Argentina/Buenos_Aires';
function cuandoFue(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: ZONA }).replace(/[.,]/g, '');
  const [a, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d).split('-').map(Number);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
  return `${dia} ${dd}/${m}${a !== new Date().getFullYear() ? `/${a}` : ''} · ${hora}`;
}

type LineaHistorial = { cuando: string; que: string; quien: string | null; tono: 'neutro' | 'ok' | 'atencion' | 'error' | 'info'; reconstruido?: boolean };

// PEDIDOS: quién lo recibió y quién hizo cada paso (Leandro, 6/10/2026: "llega
// un pedido, a quién le avisa, cómo lo recepciona, en dónde lo hace, en dónde
// nos quedan los datos de quién hizo cada cosa"). Cada tarjeta dice quién lo
// tiene ("Sin tomar" hasta que alguien toca "Lo tomo"), el detalle trae el
// historial completo con nombre y hora, y los terminados se pueden consultar.
export function PedidosWorkspace({ inicial, puedeSimular = false }: { inicial: PedidoCola[]; puedeSimular?: boolean }) {
  const [pedidos, setPedidos] = useState<PedidoCola[]>(inicial);
  const [vista, setVista] = useState<'curso' | 'terminados'>('curso');
  const [terminados, setTerminados] = useState<PedidoCola[] | null>(null);
  const [filtro, setFiltro] = useState('todos');
  const [aviso, setAviso] = useState('');
  const [wa, setWa] = useState(false);
  const [abierto, setAbierto] = useState<PedidoCola | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [entregando, setEntregando] = useState<PedidoCola | null>(null);
  const { confirmar, dialogo } = useConfirmar();
  const timer = useRef<any>(null);

  const recargar = useCallback(async () => {
    const r = await fetch('/api/pedidos', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) { const d = await r.json(); if (Array.isArray(d)) setPedidos(d); }
  }, []);
  const cargarTerminados = useCallback(async () => {
    const r = await fetch('/api/pedidos?vista=terminados&dias=7', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) { const d = await r.json(); if (Array.isArray(d)) { setTerminados(d); return d as PedidoCola[]; } }
    setTerminados((t) => t ?? []);
    return [] as PedidoCola[];
  }, []);
  useEffect(() => { timer.current = setInterval(recargar, 8000); return () => clearInterval(timer.current); }, [recargar]);
  useEffect(() => { if (vista === 'terminados') cargarTerminados(); }, [vista, cargarTerminados]);

  // ?pedido=<id>: el link del WhatsApp a administración y el "Ver" de la ventana emergente
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('pedido');
    if (!id) return;
    const enCurso = inicial.find((p) => p.id === id);
    if (enCurso) { setAbierto(enCurso); return; }
    cargarTerminados().then((lista) => {
      const t = lista.find((p) => p.id === id);
      if (t) { setVista('terminados'); setAbierto(t); } else setAviso('Ese pedido no está entre los activos ni entre los terminados de la última semana.');
    });
  }, [inicial, cargarTerminados]);

  // el pedido abierto se mantiene al día con la recarga
  useEffect(() => {
    if (!abierto) return;
    const fresco = pedidos.find((p) => p.id === abierto.id) ?? terminados?.find((p) => p.id === abierto.id);
    if (fresco && fresco !== abierto) setAbierto(fresco);
  }, [pedidos, terminados, abierto]);

  const post = async (body: any) => {
    setAviso('');
    const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!r) { setAviso('Sin conexión. Probá de nuevo.'); return null; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setAviso(d.message ?? 'No se pudo hacer el cambio.'); return null; }
    await recargar();
    if (vista === 'terminados' || body.estado === 'entregado' || body.estado === 'cancelado') cargarTerminados();
    return d;
  };

  async function tomar(p: PedidoCola) {
    setTrabajando(p.id);
    const d = await post({ accion: 'tomar', pedidoId: p.id });
    setTrabajando(null);
    if (d && d.tomado === false) setAviso(`Ese pedido ya lo tomó ${d.nombre ?? 'otra persona'}.`);
  }

  async function avanzar(p: PedidoCola, estado: string, medioPago?: string) {
    if (estado === 'entregado' && !medioPago && pideMedioAlEntregar(p)) { setEntregando(p); return; }
    setTrabajando(p.id);
    await post({ pedidoId: p.id, estado, medioPago });
    setTrabajando(null);
  }

  async function cancelar(p: PedidoCola) {
    const ok = await confirmar({
      titulo: `¿Cancelar el pedido ${codigoDe(p)}?`,
      texto: 'Se devuelve el stock reservado y le llega el aviso de la baja a administración. Queda a tu nombre en el historial.',
      variante: 'peligro',
      textoConfirmar: 'Cancelar el pedido',
      textoCancelar: 'Volver',
    });
    if (!ok) return;
    setTrabajando(p.id);
    await post({ pedidoId: p.id, estado: 'cancelado' });
    setTrabajando(null);
  }

  const visibles = filtro === 'todos' ? pedidos : pedidos.filter((p) => origenClave(p) === filtro);
  const cols = [
    { titulo: 'Nuevos', lista: visibles.filter((p) => ['recibido', 'pagado'].includes(p.estado)) },
    { titulo: 'En preparación', lista: visibles.filter((p) => p.estado === 'en_preparacion') },
    { titulo: 'Listos', lista: visibles.filter((p) => p.estado === 'listo') },
  ];
  const cuentaSinTomar = pedidos.filter(sinTomar).length;
  const porOrigen = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of pedidos) { const o = origenClave(p); m[o] = (m[o] ?? 0) + 1; }
    return m;
  }, [pedidos]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <div>
            <p className={unir('importe text-xl font-bold leading-none', cuentaSinTomar ? 'text-marca-hondo' : 'text-tinta')}>{cuentaSinTomar}</p>
            <p className="mt-1 text-xs text-tinta/60">Sin tomar</p>
          </div>
          <div><p className="importe text-xl font-bold leading-none text-tinta">{pedidos.length}</p><p className="mt-1 text-xs text-tinta/60">En curso</p></div>
          {Object.entries(porOrigen).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([o, n]) => (
            <div key={o}><p className="importe text-xl font-bold leading-none text-tinta">{n}</p><p className="mt-1 text-xs text-tinta/60">{origenDe({ origen: o, canal: o }).label}</p></div>
          ))}
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto">
          <Boton onClick={() => setWa(true)}>Pedido por WhatsApp</Boton>
          {puedeSimular && <Boton variante="secundario" onClick={() => post({ simular: true })}>Simular PedidosYa</Boton>}
        </div>
      </div>

      <Pestanas
        etiquetaAccesible="Qué pedidos ver"
        valor={vista}
        onCambiar={(v) => setVista(v as 'curso' | 'terminados')}
        opciones={[
          { valor: 'curso', etiqueta: 'En curso', cuenta: pedidos.length },
          { valor: 'terminados', etiqueta: 'Terminados (7 días)', cuenta: terminados?.length },
        ]}
      />

      {aviso && <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={() => setAviso('')}>Entendido</Boton>}>{aviso}</Aviso>}

      {vista === 'curso' ? (
        <>
          <Chips etiquetaAccesible="Por dónde entró" valor={filtro} onCambiar={setFiltro} desplazable opciones={FILTROS} />
          <div className="grid gap-4 md:grid-cols-3">
            {cols.map(({ titulo, lista }) => (
              <div key={titulo} className="min-w-0 space-y-2">
                <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-tinta/70">{titulo}<span className="importe text-xs font-medium text-tinta/60">{lista.length}</span></h2>
                {lista.length === 0 && <p className="rounded-2xl border border-dashed border-black/15 p-5 text-center text-xs text-tinta/60">Nada por acá</p>}
                {lista.map((p) => (
                  <TarjetaPedido
                    key={p.id}
                    p={p}
                    trabajando={trabajando === p.id}
                    onTomar={() => tomar(p)}
                    onAvanzar={(estado) => avanzar(p, estado)}
                    onAbrir={() => setAbierto(p)}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : terminados === null ? (
        <Cargando bloque texto="Buscando los terminados…" />
      ) : (
        <TablaResponsiva
          etiqueta="Pedidos terminados de la última semana"
          filas={terminados}
          claveFila="id"
          vacio={<Vacio titulo="No hay pedidos terminados esta semana" texto="Los entregados, en camino y cancelados de los últimos 7 días aparecen acá." />}
          columnas={[
            { clave: 'codigo', titulo: 'Pedido', principal: true, celda: (p) => <button type="button" onClick={() => setAbierto(p)} className={unir('importe text-left font-semibold text-tinta underline-offset-2 hover:underline', FOCO)}>{codigoDe(p)}</button> },
            { clave: 'estado', titulo: 'Estado', celda: (p) => <Etiqueta tono={ESTADOS[p.estado]?.tono ?? 'neutro'}>{ESTADOS[p.estado]?.label ?? p.estado}</Etiqueta> },
            { clave: 'origen', titulo: 'Entró por', celda: (p) => origenDe(p).label },
            { clave: 'cliente', titulo: 'Cliente', celda: (p) => p.clienteNombre || telefonoLegible(p.clienteTelefono) || '—' },
            { clave: 'tomo', titulo: 'Lo tomó', ocultarEnMovil: true, celda: (p) => p.tomadoPorNombre ?? '—' },
            { clave: 'fecha', titulo: 'Entró', ocultarEnMovil: true, celda: (p) => haceCuanto(p.creado_en) },
            { clave: 'total', titulo: 'Total', importe: true, celda: (p) => pesos(p.total) },
            { clave: 'acciones', titulo: '', acciones: true, celda: (p) => <Boton tamano="chico" variante="fantasma" onClick={() => setAbierto(p)}>Ver historial</Boton> },
          ]}
        />
      )}

      {abierto && (
        <DetallePedido
          p={abierto}
          trabajando={trabajando === abierto.id}
          onCerrar={() => {
            setAbierto(null);
            // que el link ?pedido= no lo vuelva a abrir al recargar
            if (window.location.search.includes('pedido=')) window.history.replaceState(null, '', '/pedidos');
          }}
          onTomar={() => tomar(abierto)}
          onAvanzar={(estado) => avanzar(abierto, estado)}
          onCancelar={() => cancelar(abierto)}
        />
      )}
      {entregando && (
        <ModalEntregar
          p={entregando}
          onCerrar={() => setEntregando(null)}
          onConfirmar={async (medio) => { const p = entregando; setEntregando(null); await avanzar(p, 'entregado', medio); }}
        />
      )}
      {wa && <ModalWhatsApp cerrar={() => setWa(false)} post={post} />}
      {dialogo}
    </div>
  );
}

// Quién lo tiene: lo primero que se mira en la tarjeta.
function Responsable({ p }: { p: PedidoCola }) {
  if (sinTomar(p)) return <Etiqueta tono="atencion" punto>Sin tomar</Etiqueta>;
  if (!p.tomadoPorNombre) return null;
  return <span className="min-w-0 truncate text-xs text-tinta/70">Lo tiene <b className="font-semibold text-tinta">{p.tomadoPorNombre}</b>{p.tomado_en ? ` · ${haceCuanto(p.tomado_en)}` : ''}</span>;
}

function TarjetaPedido({ p, trabajando, onTomar, onAvanzar, onAbrir }: {
  p: PedidoCola; trabajando: boolean; onTomar: () => void; onAvanzar: (estado: string) => void; onAbrir: () => void;
}) {
  const origen = origenDe(p);
  const sig = siguientePaso(p);
  const tel = telefonoLegible(p.clienteTelefono);
  const tarde = sinTomar(p) && (p.minutos ?? 0) >= 15;
  return (
    <Tarjeta className={unir(tarde && 'ring-2 ring-marca/40')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Etiqueta tono={origen.tono}>{origen.label}</Etiqueta>
          {p.pagado_en && <Etiqueta tono="ok">Pagado</Etiqueta>}
        </div>
        <span className={unir('importe shrink-0 text-xs', tarde ? 'font-semibold text-marca-hondo' : 'text-tinta/60')}>{haceCuanto(p.creado_en)}</span>
      </div>
      <button type="button" onClick={onAbrir} className={unir('mt-2 block w-full min-w-0 rounded-lg text-left', FOCO)}>
        <p className="importe text-sm font-semibold text-tinta">{codigoDe(p)}</p>
        <p className="mt-0.5 break-words text-sm text-tinta">{p.clienteNombre || (p.cliente?.dni ? `Cliente ${p.cliente.dni}` : 'Cliente sin nombre')}{tel && <span className="whitespace-nowrap text-tinta/70"> · {tel}</span>}</p>
        <p className="mt-0.5 break-words text-xs text-tinta/70">{entregaDe(p)}</p>
        <p className="mt-1.5 break-words text-sm leading-snug text-tinta/70">
          {(p.items ?? []).slice(0, 3).map((it) => `${cantidadLegible(it.cantidad)}× ${it.producto?.nombre ?? ''}`).join(' · ')}
          {(p.items ?? []).length > 3 && ` +${(p.items ?? []).length - 3}`}
        </p>
      </button>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <Responsable p={p} />
        <span className="importe shrink-0 text-sm font-semibold text-tinta">{pesos(p.total)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {sinTomar(p) ? (
          <>
            <Boton tamano="chico" onClick={onTomar} cargando={trabajando} className="flex-1">Lo tomo</Boton>
            {sig && <Boton tamano="chico" variante="secundario" onClick={() => onAvanzar(sig.estado)} disabled={trabajando} className="flex-1">{sig.label}</Boton>}
          </>
        ) : (
          sig && <Boton tamano="chico" onClick={() => onAvanzar(sig.estado)} cargando={trabajando} className="flex-1">{sig.label}</Boton>
        )}
        <Boton tamano="chico" variante="fantasma" onClick={onAbrir}>Detalle</Boton>
      </div>
    </Tarjeta>
  );
}

function DetallePedido({ p, trabajando, onCerrar, onTomar, onAvanzar, onCancelar }: {
  p: PedidoCola; trabajando: boolean; onCerrar: () => void; onTomar: () => void; onAvanzar: (estado: string) => void; onCancelar: () => void;
}) {
  const [historial, setHistorial] = useState<LineaHistorial[] | null>(null);
  const [error, setError] = useState(false);
  const origen = origenDe(p);
  const sig = siguientePaso(p);
  const tel = telefonoLegible(p.clienteTelefono);
  const wa = linkWhatsapp(p.clienteTelefono);
  const terminado = ['entregado', 'cancelado'].includes(p.estado);
  // la clave cambia con cada paso: el historial se vuelve a leer después de tocar un botón
  const clave = `${p.id}|${p.estado}|${p.tomado_por ?? ''}`;

  useEffect(() => {
    let vivo = true;
    setError(false);
    fetch(`/api/pedidos?historial=${encodeURIComponent(p.id)}`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (!vivo) return; if (r.ok && Array.isArray(d)) setHistorial(d); else setError(true); })
      .catch(() => vivo && setError(true));
    return () => { vivo = false; };
  }, [clave, p.id]);

  const items = p.items ?? [];
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Pedido ${codigoDe(p)}`}
      descripcion={`${origen.label} · ${ESTADOS[p.estado]?.label ?? p.estado} · entró ${haceCuanto(p.creado_en)}`}
      bloquearCierre={trabajando}
      pie={
        terminado ? (
          <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
        ) : (
          <>
            <Boton variante="peligro" onClick={onCancelar} disabled={trabajando}>Cancelar pedido</Boton>
            {sinTomar(p) && <Boton variante={sig ? 'secundario' : 'primario'} onClick={onTomar} cargando={trabajando}>Lo tomo</Boton>}
            {sig && <Boton onClick={() => onAvanzar(sig.estado)} cargando={trabajando && !sinTomar(p)} disabled={trabajando}>{sig.label}</Boton>}
          </>
        )
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <div className="min-w-0"><dt className="text-xs text-tinta/60">Cliente</dt><dd className="break-words text-tinta">{p.clienteNombre || (p.cliente?.dni ? `DNI ${p.cliente.dni}` : 'Sin nombre')}</dd></div>
          <div className="min-w-0">
            <dt className="text-xs text-tinta/60">WhatsApp</dt>
            <dd className="break-words text-tinta">{tel ? (wa ? <a href={wa} target="_blank" rel="noreferrer" className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>{tel}</a> : tel) : 'No lo dejó'}</dd>
          </div>
          <div className="col-span-2 min-w-0"><dt className="text-xs text-tinta/60">Entrega</dt><dd className="break-words text-tinta">{entregaDe(p)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-tinta/60">Pago</dt><dd className="text-tinta">{p.pagado_en ? 'Pagado por Mercado Pago' : String(p.qr_retiro ?? '').startsWith('PY-') ? 'Lo cobra PedidosYa' : 'A cobrar al entregar'}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-tinta/60">Quién lo tiene</dt><dd className="text-tinta">{p.tomadoPorNombre ?? (sinTomar(p) ? 'Nadie todavía' : '—')}</dd></div>
          {p.repartidorNombre && <div className="min-w-0"><dt className="text-xs text-tinta/60">Repartidor</dt><dd className="text-tinta">{p.repartidorNombre}</dd></div>}
          {p.notas?.trim() && <div className="col-span-2 min-w-0"><dt className="text-xs text-tinta/60">Notas</dt><dd className="whitespace-pre-wrap break-words text-tinta">{p.notas.trim()}</dd></div>}
        </dl>

        {items.length > 0 && (
          <PlacaRoja
            titulo="PEDIDO"
            sub={items.length === 1 ? '1 producto' : `${items.length} productos`}
            renglones={items.map((it, i) => {
              const cant = Number(it.cantidad) || 0;
              const unit = Number(it.precio_unitario);
              return {
                clave: String(i),
                cantidad: cant,
                nombre: it.producto?.nombre ?? 'Producto',
                detalle: Number.isFinite(unit) && unit > 0 ? `${cantidadLegible(cant)} × ${pesos(unit)}` : it.producto?.sku,
                importe: Number.isFinite(unit) && unit > 0 ? pesos(cant * unit) : undefined,
              };
            })}
            total={{ etiqueta: 'Total', valor: pesos(p.total) }}
          />
        )}

        <section aria-label="Historial del pedido">
          <h3 className="mb-2 text-sm font-semibold text-tinta">Quién hizo cada cosa</h3>
          {error ? (
            <Aviso tono="atencion">No pude traer el historial. Cerrá y volvé a abrir el pedido.</Aviso>
          ) : historial === null ? (
            <Cargando texto="Buscando el historial…" />
          ) : historial.length === 0 ? (
            <p className="text-sm text-tinta/60">Todavía no hay pasos registrados.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-black/[0.08] pl-4">
              {historial.map((h, i) => (
                <li key={i} className="relative min-w-0">
                  <span aria-hidden="true" className={unir('absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full ring-2 ring-white', h.tono === 'ok' ? 'bg-ok' : h.tono === 'error' ? 'bg-marca' : h.tono === 'atencion' ? 'bg-atencion' : h.tono === 'info' ? 'bg-info' : 'bg-tinta/40')} />
                  <p className="break-words text-sm text-tinta">
                    {h.que}
                    {h.quien && <> · <b className="font-semibold">{h.quien}</b></>}
                  </p>
                  <p className="text-xs text-tinta/60">
                    {cuandoFue(h.cuando)}
                    {h.reconstruido && ' · dato de antes del 6/10 (sin nombre)'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}

// Entregar sin elegir cómo pagó registraba la venta como "efectivo" siempre.
function ModalEntregar({ p, onCerrar, onConfirmar }: { p: PedidoCola; onCerrar: () => void; onConfirmar: (medio: string) => void }) {
  const [medio, setMedio] = useState('efectivo');
  return (
    <Modal
      abierto
      ancho="chico"
      onCerrar={onCerrar}
      titulo={`Entregar ${codigoDe(p)}`}
      descripcion={`Total ${pesos(p.total)}. ¿Cómo pagó?`}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Volver</Boton>
        <Boton variante="ok" onClick={() => onConfirmar(medio)}>Entregado y cobrado</Boton>
      </>}
    >
      <Chips etiquetaAccesible="Cómo pagó" valor={medio} onCambiar={setMedio} opciones={MEDIOS} />
      {medio === 'efectivo' && <p className="mt-3 text-sm text-tinta/70">El efectivo entra en la caja abierta de la sucursal. Si no hay caja abierta, el sistema te lo va a pedir.</p>}
    </Modal>
  );
}

function ModalWhatsApp({ cerrar, post }: { cerrar: () => void; post: (b: any) => Promise<any> }) {
  const [texto, setTexto] = useState('');
  const [analisis, setAnalisis] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');

  const analizar = async () => {
    if (!texto.trim()) return;
    setCargando(true); setAviso('');
    try {
      const r = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'waAnalizar', texto: texto.trim() }) });
      const d = await r.json();
      if (!r.ok) setAviso(d.message ?? 'Error'); else setAnalisis(d);
    } catch {
      setAviso('No se pudo conectar. Reintentá.');
    } finally {
      setCargando(false);
    }
  };
  const crear = async () => {
    setCargando(true);
    try {
      const items = (analisis.items ?? []).map((i: any) => ({ producto_id: i.producto_id, cantidad: i.cantidad }));
      const d = await post({ accion: 'waCrear', items, nombre: analisis.nombre, notas: analisis.notas });
      if (d) cerrar();
    } finally {
      setCargando(false);
    }
  };
  // el total de la placa, solo si todos los renglones tienen precio: uno sin precio lo dejaría corto
  const renglonesWa: RenglonWa[] = analisis?.items ?? [];
  const totalConPrecios = renglonesWa.length > 0 && renglonesWa.every((it) => precioDe(it) != null)
    ? renglonesWa.reduce((t, it) => t + (Number(it.cantidad) || 0) * (precioDe(it) ?? 0), 0)
    : null;

  return (
    <Modal
      abierto
      onCerrar={cerrar}
      titulo="Pedido por WhatsApp"
      descripcion="Pegá (o dictá) el mensaje del cliente. La IA arma el pedido y lo matchea con el catálogo."
      bloquearCierre={cargando}
      cerrarAlTocarAfuera={false}
      pie={
        !analisis ? (
          <>
            <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
            <Boton onClick={analizar} cargando={cargando} disabled={cargando || !texto.trim()}>{cargando ? 'Leyendo…' : 'Interpretar'}</Boton>
          </>
        ) : (
          <>
            <Boton variante="secundario" onClick={() => setAnalisis(null)}>Volver</Boton>
            <Boton onClick={crear} cargando={cargando} disabled={cargando || !analisis.items.length}>{cargando ? 'Creando…' : 'Crear pedido'}</Boton>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* dictado de corrido que suma a lo escrito (BotonMicrofono, 2/10/2026) */}
          <BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Dictar el pedido" />
          <span className="text-xs text-tinta/60">Dictalo o pegalo abajo</span>
        </div>
        <AreaTexto value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="ej: Hola! me mandás 6 quilmes litro, 2 coca de 2.25 y un fernet? Para Av. Mate 123, pago en efectivo" aria-label="Mensaje del cliente" />

        {analisis && (
          <div className="space-y-3">
            {analisis.items.length > 0 ? (
              // Lo reconocido como Placa roja RESUMEN (2/10/2026): el mismo paquete
              // gráfico de los pedidos del bot. La cantidad se sigue corrigiendo en
              // cada renglón y el círculo rojo la acompaña mientras se escribe.
              <PlacaRoja
                titulo="RESUMEN"
                sub={[
                  analisis.nombre ? `Cliente: ${analisis.nombre}` : null,
                  analisis.items.length === 1 ? '1 producto reconocido' : `${analisis.items.length} productos reconocidos`,
                ].filter(Boolean).join(' · ')}
                renglones={analisis.items.map((it: any, i: number) => {
                  const cantidad = Number(it.cantidad) || 0;
                  const unitario = precioDe(it);
                  return {
                    clave: String(i),
                    cantidad,
                    nombre: it.match,
                    detalle: [`pidió: ${it.pedido}`, unitario != null ? `${numero(cantidad, 2)} × ${pesos(unitario)}` : null].filter(Boolean).join(' · '),
                    importe: unitario != null ? pesos(cantidad * unitario) : undefined,
                    acciones: (
                      <div className="flex items-center gap-2">
                        <div className="w-24 shrink-0">
                          <Entrada type="number" inputMode="decimal" value={it.cantidad} onChange={(e) => setAnalisis((a: any) => ({ ...a, items: a.items.map((x: any, j: number) => j === i ? { ...x, cantidad: Number(e.target.value) } : x) }))} aria-label={`Cantidad de ${it.match}`} className="text-right" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setAnalisis((a: any) => ({ ...a, items: a.items.filter((_: any, j: number) => j !== i) }))}
                          aria-label={`Quitar ${it.match}`}
                          className={unir('ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-tinta/60 hover:bg-marca-suave hover:text-marca-hondo', FOCO)}
                        >
                          <IconoCerrar className="size-5" />
                        </button>
                      </div>
                    ),
                  };
                })}
                total={totalConPrecios != null ? { etiqueta: 'Total', valor: pesos(totalConPrecios) } : undefined}
                recuadro={analisis.notas ? <p className="break-words text-tinta/70"><b className="font-semibold text-tinta">Nota:</b> {analisis.notas}</p> : undefined}
              />
            ) : (
              <div className="space-y-2 rounded-xl border border-black/[0.06] bg-crema-claro p-3">
                {analisis.nombre && <p className="text-sm text-tinta"><b className="font-semibold">Cliente:</b> {analisis.nombre}</p>}
                <p className="text-xs text-tinta/60">0 productos reconocidos.</p>
                {analisis.notas && <p className="text-sm text-tinta/70"><b className="font-semibold">Nota:</b> {analisis.notas}</p>}
              </div>
            )}
            {analisis.sinMatch?.length > 0 && <Aviso tono="atencion">No encontré en el catálogo: {analisis.sinMatch.join(', ')}</Aviso>}
            {aviso && <Aviso tono="error">{aviso}</Aviso>}
          </div>
        )}
        {aviso && !analisis && <Aviso tono="error">{aviso}</Aviso>}
      </div>
    </Modal>
  );
}
