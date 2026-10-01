'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfigCliente } from './ConfigCliente';
import { fecha as fechaFmt, pesos as pesosFmt } from '../lib/formato';
import {
  AreaTexto,
  Aviso,
  Boton,
  Cargando,
  Entrada,
  Etiqueta,
  FOCO,
  FOCO_ADENTRO,
  IconoOk,
  Kpi,
  Pestanas,
  Selector,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  Vacio,
  unir,
  type TonoEtiqueta,
} from './kit';

const pesos = (n: any) => pesosFmt(Number(n) || 0);
const fecha = (iso: string) => fechaFmt(iso);

const TIPO_TONO: Record<string, TonoEtiqueta> = {
  vip: 'info', mayorista: 'info',
  frecuente: 'ok', ocasional: 'neutro', nuevo: 'neutro',
};

const TABS = [['todos', 'Todos'], ['segmentos', 'Segmentos'], ['comunidad', 'Comunidad ODB'], ['ctacte', 'Cuentas corrientes'], ['reactivacion', 'Reactivación'], ['difusiones', 'Difusiones WhatsApp']] as const;

export function ClientesWorkspace({ resumen, segmentos, ticketGeneral, cuentas }: {
  resumen: any; segmentos: any[]; ticketGeneral: number; cuentas: any[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState('todos');
  const [lista, setLista] = useState<any>(null);
  const [filtro, setFiltro] = useState('');
  const [buscar, setBuscar] = useState('');
  const [reactiv, setReactiv] = useState<any>(null);
  const cargarLista = (extra = '') => fetch(`/api/clientes?recurso=lista${extra}`).then((r) => r.json()).then(setLista);

  useEffect(() => {
    if ((tab === 'todos' || tab === 'comunidad') && lista === null) cargarLista(tab === 'comunidad' ? '&filtro=comunidad' : '');
    if (tab === 'reactivacion' && reactiv === null) fetch('/api/clientes?recurso=reactivacion&dias=60').then((r) => r.json()).then(setReactiv);
  }, [tab]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[['Clientes', resumen?.total ?? 0], ['Comunidad ODB', resumen?.comunidad ?? 0], ['Con cuenta cte.', resumen?.conCtaCte ?? 0], ['Opt-in WhatsApp', resumen?.optInMarketing ?? 0], ['Cumplen este mes', resumen?.cumpleMes ?? 0], ['Ticket prom.', pesos(ticketGeneral)]].map(([l, v]: any) => (
          <Kpi key={l} etiqueta={<span className="whitespace-normal">{l}</span>} valor={v} />
        ))}
      </div>

      <Pestanas
        etiquetaAccesible="Vistas de clientes"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {/* TODOS / COMUNIDAD */}
      {(tab === 'todos' || tab === 'comunidad') && (
        <div className="space-y-3">
          {tab === 'todos' && (
            <form onSubmit={(e) => { e.preventDefault(); setLista(null); cargarLista(`${filtro ? `&filtro=${filtro}` : ''}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`); }} className="flex flex-wrap gap-2">
              <Entrada type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="DNI o nombre…" aria-label="Buscar cliente por DNI o nombre" className="min-w-0 grow basis-48" />
              <Selector value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtro de clientes" className="flex-1 sm:flex-none">
                <option value="">Todos</option><option value="comunidad">Comunidad</option><option value="marketing">Con opt-in</option>
              </Selector>
              <Boton type="submit">Filtrar</Boton>
            </form>
          )}
          <ClienteTabla lista={lista} router={router} />
        </div>
      )}

      {/* SEGMENTOS */}
      {tab === 'segmentos' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {segmentos.map((s) => (
            <Kpi
              key={s.segmento}
              etiqueta={<span className="whitespace-normal">{s.etiqueta}</span>}
              valor={s.clientes}
              sub={<>clientes · ticket {s.ticketPromedio ? pesos(s.ticketPromedio) : '—'}</>}
            />
          ))}
        </div>
      )}

      {/* CUENTAS CORRIENTES */}
      {tab === 'ctacte' && (
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera titulo={`Clientes con cuenta corriente (${cuentas.length})`} />
          {cuentas.length === 0 ? <p className="px-4 py-8 text-center text-sm text-tinta/60">Sin movimientos de cuenta corriente.</p> : (
            <div className="divide-y divide-black/[0.06]">
              {cuentas.map((c) => (
                <Link key={c.cliente?.id} href={`/facturacion/cuentas/${c.cliente?.id}`} className={unir('flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}>
                  <div className="min-w-0 text-sm text-tinta"><p className="break-words font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p><p className="text-xs text-tinta/60">{c.cliente?.dni}</p></div>
                  <p className={unir('importe text-sm font-semibold', c.saldo > 0 ? 'text-marca-hondo' : 'text-ok')}>{c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}</p>
                </Link>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {/* REACTIVACIÓN */}
      {tab === 'reactivacion' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta relleno={false} className="overflow-hidden">
            <TarjetaCabecera titulo="Sin comprar hace +60 días" />
            {!reactiv ? <Cargando bloque /> : (reactiv.reactivar ?? []).length === 0 ? <p className="px-4 py-6 text-sm text-tinta/60">Todos compraron hace poco.</p> : (
              <div className="divide-y divide-black/[0.06]">
                {(reactiv.reactivar ?? []).slice(0, 30).map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 break-words text-tinta">{c.nombre ?? `DNI ${c.dni}`} <span className="text-xs text-tinta/60">{c.acepta_marketing ? '· opt-in' : ''}</span></span>
                    <span className="text-xs text-tinta/60">última: {fecha(c.ultimaCompra)}</span>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
          <Tarjeta relleno={false} className="h-fit overflow-hidden">
            <TarjetaCabecera titulo="Cumpleaños del mes" />
            {!reactiv ? <Cargando bloque /> : (reactiv.cumple ?? []).length === 0 ? <p className="px-4 py-6 text-sm text-tinta/60">Sin cumpleaños cargados este mes.</p> : (
              <div className="divide-y divide-black/[0.06]">
                {(reactiv.cumple ?? []).map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 break-words text-tinta">{c.nombre ?? `DNI ${c.dni}`}</span>
                    <span className="text-xs text-tinta/60">{fecha(c.fecha_nacimiento)}</span>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        </div>
      )}

      {/* DIFUSIONES */}
      {tab === 'difusiones' && <Difusiones segmentos={segmentos} />}
    </div>
  );
}

function ClienteTabla({ lista, router }: any) {
  const toggleOptIn = async (c: any) => {
    await fetch('/api/cliente-editar', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, aceptaMarketing: !c.acepta_marketing }) });
    router.refresh();
    window.location.reload();
  };
  if (!lista) return <Tarjeta><Cargando bloque /></Tarjeta>;
  return (
    <TablaResponsiva
      etiqueta="Clientes"
      filas={lista.items ?? []}
      claveFila="id"
      vacio={<Vacio titulo="Sin clientes con ese filtro." texto="Probá con otro nombre, DNI o filtro." />}
      pie={<span className="text-tinta/60">{lista.total ?? 0} clientes</span>}
      columnas={[
        {
          clave: 'cliente',
          titulo: 'Cliente',
          principal: true,
          celda: (c: any) => (
            <div className="min-w-0">
              <p className="break-words font-medium">{c.nombre ?? `DNI ${c.dni}`}</p>
              <p className="text-xs font-normal text-tinta/60">{c.dni}{c.verificado && ' · Comunidad'}</p>
            </div>
          ),
        },
        { clave: 'categoria', titulo: 'Categoría', celda: (c: any) => <Etiqueta tono={TIPO_TONO[c.tipo] ?? 'neutro'}>{c.tipo}</Etiqueta> },
        { clave: 'compras', titulo: 'Compras', importe: true, celda: (c: any) => c.compras },
        { clave: 'total', titulo: 'Total', importe: true, celda: (c: any) => <span className="font-medium">{pesos(c.totalGastado)}</span> },
        {
          clave: 'whatsapp',
          titulo: 'WhatsApp',
          alinear: 'centro',
          celda: (c: any) => (
            <button
              onClick={() => toggleOptIn(c)}
              title={c.telefono ?? 'sin teléfono'}
              aria-pressed={!!c.acepta_marketing}
              className={unir(
                'inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors',
                FOCO,
                c.acepta_marketing ? 'bg-ok-suave text-ok hover:brightness-95' : 'bg-crema-hondo/70 text-tinta/70 hover:bg-crema-hondo',
              )}
            >
              {c.acepta_marketing && <IconoOk className="size-4" />}
              {c.acepta_marketing ? 'opt-in' : 'sin opt-in'}
            </button>
          ),
        },
        { clave: 'acciones', titulo: '', acciones: true, celda: (c: any) => <ConfigCliente cliente={c} /> },
      ]}
    />
  );
}

function Difusiones({ segmentos }: { segmentos: any[] }) {
  const [segmento, setSegmento] = useState('');
  const [soloComunidad, setSoloComunidad] = useState(false);
  const [aud, setAud] = useState<any>(null);
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('Respondé BAJA para no recibir más mensajes.');
  const [contexto, setContexto] = useState('');
  const [hist, setHist] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [gen, setGen] = useState(false);

  const cargarAud = () => fetch(`/api/difusiones?recurso=audiencia&segmento=${segmento}&soloComunidad=${soloComunidad}`).then((r) => r.json()).then(setAud);
  useEffect(() => { cargarAud(); }, [segmento, soloComunidad]);
  useEffect(() => { fetch('/api/difusiones?recurso=listar').then((r) => r.json()).then((d) => setHist(Array.isArray(d) ? d : [])); }, []);

  const redactar = async () => {
    setGen(true);
    try { const r = await fetch('/api/difusiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'redactar', contexto }) }); const d = await r.json(); if (d.mensaje) setMensaje(d.mensaje); }
    finally { setGen(false); }
  };
  const crear = async () => {
    setAviso('');
    const r = await fetch('/api/difusiones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'crear', titulo, mensaje, segmento: segmento || undefined, soloComunidad }) });
    const d = await r.json();
    setAviso(d.aviso ?? d.message ?? 'Listo');
    if (r.ok) { setTitulo(''); fetch('/api/difusiones?recurso=listar').then((x) => x.json()).then((h) => setHist(Array.isArray(h) ? h : [])); }
  };

  return (
    <div className="space-y-4">
      <Aviso tono="info" titulo="Difusión responsable">
        Solo se envía a clientes que dieron <strong>opt-in</strong> y tienen teléfono, vía la API oficial de WhatsApp Business con plantilla aprobada y opción de baja. Así no te penaliza Meta.
      </Aviso>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* armar difusión */}
        <Tarjeta className="space-y-3">
          <h2 className="text-base font-semibold text-tinta">Nueva difusión</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <Selector value={segmento} onChange={(e) => setSegmento(e.target.value)} aria-label="Segmento">
              <option value="">Todos los opt-in</option>
              {segmentos.map((s) => <option key={s.segmento} value={s.segmento}>{s.etiqueta}</option>)}
            </Selector>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-sm text-tinta"><input type="checkbox" checked={soloComunidad} onChange={(e) => setSoloComunidad(e.target.checked)} className="size-4 accent-marca" /> Solo Comunidad</label>
          </div>

          {aud && (
            <div className="rounded-xl bg-crema-claro p-3 text-sm">
              <p className="text-tinta"><strong className="importe text-base">{aud.elegibles}</strong> clientes elegibles (opt-in + teléfono)</p>
              {aud.noContactables > 0 && <p className="mt-0.5 text-tinta/60">{aud.noContactables} con teléfono pero sin opt-in — no se les envía.</p>}
            </div>
          )}

          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título interno (ej: Finde largo)" aria-label="Título interno" />
          <div className="flex gap-2">
            <Entrada value={contexto} onChange={(e) => setContexto(e.target.value)} placeholder="Contexto para redactar con IA…" aria-label="Contexto para redactar con IA" className="min-w-0 flex-1" />
            <Boton variante="secundario" onClick={redactar} cargando={gen} className="shrink-0">Redactar</Boton>
          </div>
          <AreaTexto value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={5} aria-label="Mensaje" />
          {aviso && <Aviso tono="info">{aviso}</Aviso>}
          <Boton onClick={crear} disabled={!aud?.elegibles} anchoCompleto>
            {aud?.configurado ? `Enviar a ${aud?.elegibles ?? 0} clientes` : `Guardar difusión (${aud?.elegibles ?? 0} elegibles)`}
          </Boton>
        </Tarjeta>

        {/* historial */}
        <Tarjeta relleno={false} className="h-fit overflow-hidden">
          <TarjetaCabecera titulo="Difusiones anteriores" />
          {hist.length === 0 ? <p className="px-4 py-6 text-sm text-tinta/60">Todavía no enviaste difusiones.</p> : (
            <div className="divide-y divide-black/[0.06]">
              {hist.map((d) => (
                <div key={d.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-medium text-tinta">{d.titulo}</p>
                    <Etiqueta tono={d.estado === 'enviada' ? 'ok' : 'atencion'}>{d.estado}</Etiqueta>
                  </div>
                  <p className="mt-0.5 text-xs text-tinta/60">{d.audiencia} destinatarios · {fecha(d.creado_en)}</p>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
