'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from './BotonMicrofono';
import { NotaDePedido, type Armada, type EstadoNota, type Propuesta } from './NotaDePedido';
import { Aviso, Boton, BotonLink, CLASES_ENTRADA, Cargando, Chips, Entrada, Etiqueta, FOCO, PlacaRoja, Tarjeta, TarjetaCabecera, Vacio, unir, type DetallePlaca } from './kit';
import { fecha as fechaFmt, numero } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// "Qué comprar": la foto de lo que falta y el agente de abastecimiento.
// La alerta no es un número fijo: cruza ritmo de venta, stock y plazo de
// entrega del proveedor (ver apps/api/src/abastecimiento).
// detalle: los productos que el agente detalló, como Placa roja (el paquete gráfico de pedidos)
type Mensaje = { rol: 'usuario' | 'asistente'; texto: string; ordenes?: number[]; propuestas?: Propuesta[]; detalle?: DetallePlaca };
type Resumen = {
  porSucursal: Record<string, { sin_stock?: number; no_llega?: number; menos_de_12?: number }>;
  proveedoresUrgentes: { proveedor: string; urgentes: number; faltan: string[] }[];
  sinProveedor: number;
  ventasHasta: string | null;
  stockActualizado: string | null;
};

const fecha = (v?: string | null) => fechaFmt(v, 'completa');
const miles = (n?: number) => numero(n ?? 0);

// El agente no ve la pantalla. Al mensaje que se manda se le antepone cómo
// están ahora las notas que él propuso (lo tildado y lo corregido) y las órdenes
// que ya se armaron, para que no proponga ni arme dos veces.
type OrdenArmada = Armada & { proveedor: string; sucursal: string };
function contextoDeNotas(notas: EstadoNota[], ordenes: OrdenArmada[]): string {
  const lineas: string[] = [];
  for (const n of notas) {
    const t = n.items.filter((i) => i.tildado && i.cantidad > 0).map((i) => `${i.sku}×${i.cantidad}`);
    const sin = n.items.filter((i) => !(i.tildado && i.cantidad > 0)).map((i) => i.sku);
    if (!t.length && !sin.length) continue;
    lineas.push(`- Nota ${n.proveedor} · ${n.sucursal}: ${t.length ? `tildado ${t.join(', ')}` : 'nada tildado'}${sin.length ? `; sin tildar ${sin.join(', ')}` : ''}`);
  }
  for (const o of ordenes) {
    lineas.push(`- Orden #${o.numero ?? '?'} YA ARMADA (a aprobar) para ${o.proveedor} · ${o.sucursal}: ${(o.pedidos ?? []).map((p) => `${p.sku}×${p.cantidad}`).join(', ')}`);
  }
  return lineas.length ? `[Cómo está la pantalla ahora — es contexto, no lo repitas]\n${lineas.join('\n')}\n\n` : '';
}

const SUCURSALES = ['Saint Thomas', 'Santa Inés'];
const PROVEEDORES_VISIBLES = 6;

// Filtro de las notas por proveedor (pedido de Leandro, 2/10/2026: "que si
// quiere pedirle algo a alguno lo pueda buscar directamente").
type FiltroProveedor = 'todos' | 'urgentes' | 'faltan';
const FILTROS_PROVEEDOR: { valor: FiltroProveedor; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'urgentes', etiqueta: 'Con urgentes' },
  { valor: 'faltan', etiqueta: 'Les faltan datos' },
];
type ProveedorLista = { id: string; razon_social: string; cuit: string | null; productos: number };

const SUGERENCIAS = [
  '¿Qué vinos se me terminan antes de que lleguen?',
  '¿Qué está sin stock y se vende todos los días?',
  '¿A qué proveedores les falta cargar datos para poder comprarles?',
];

export function AbastecimientoPanel() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  const [sucursal, setSucursal] = useState(SUCURSALES[0]);
  const [notas, setNotas] = useState<{ propuestas: Propuesta[]; sinProveedor: number } | null>(null);
  const [errorNotas, setErrorNotas] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [errorResumen, setErrorResumen] = useState(false);
  const [buscaProv, setBuscaProv] = useState('');
  const [filtroProv, setFiltroProv] = useState<FiltroProveedor>('todos');
  // todos los proveedores activos, para pedirle a uno que hoy no tiene nada
  // sugerido; se traen recién cuando se busca
  const [todosProv, setTodosProv] = useState<ProveedorLista[] | null>(null);
  // productos ya pedidos desde cualquier nota de esta pantalla ("sucursalId:sku")
  const [yaPedidos, setYaPedidos] = useState<Set<string>>(new Set());
  const ordenesRef = useRef<OrdenArmada[]>([]);
  const notasChat = useRef(new Map<string, EstadoNota>());
  const finRef = useRef<HTMLDivElement>(null);

  const alArmar = useCallback((o: OrdenArmada & { sucursalId: string }) => {
    ordenesRef.current = [...ordenesRef.current, o];
    setYaPedidos((s) => new Set([...s, ...(o.pedidos ?? []).map((p) => `${o.sucursalId}:${p.sku}`)]));
  }, []);

  useEffect(() => {
    fetch('/api/abastecimiento?que=resumen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? setResumen(j) : setErrorResumen(true)))
      .catch(() => setErrorResumen(true));
  }, []);
  const [recargar, setRecargar] = useState(0);
  useEffect(() => {
    // si se cambia de sucursal antes de que llegue la respuesta, la vieja se descarta
    let vigente = true;
    setNotas(null);
    setErrorNotas('');
    setVerTodas(false);
    fetch(`/api/abastecimiento?que=propuestas&sucursal=${encodeURIComponent(sucursal)}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.message ?? 'No pude armar lo sugerido');
        if (vigente) setNotas({ propuestas: j.propuestas ?? [], sinProveedor: j.sinProveedor ?? 0 });
      })
      .catch((e) => { if (vigente) setErrorNotas(e instanceof Error ? e.message : 'No pude armar lo sugerido'); });
    return () => { vigente = false; };
  }, [sucursal, recargar]);
  // al mandar un mensaje se baja hasta el final; no al abrir la pestaña
  useEffect(() => { if (mensajes.length) finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [mensajes, pensando]);

  useEffect(() => {
    if (!buscaProv.trim() || todosProv) return;
    fetch('/api/compras?recurso=proveedores-lista', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTodosProv(Array.isArray(d) ? d : []))
      .catch(() => setTodosProv([]));
  }, [buscaProv, todosProv]);

  const buscando = buscaProv.trim() !== '' || filtroProv !== 'todos';
  const notasFiltradas = notas
    ? filtrarPorBusqueda(
        notas.propuestas.filter((p) => filtroProv === 'todos' || (filtroProv === 'urgentes' ? p.urgentes > 0 : p.faltan.length > 0)),
        buscaProv,
        (p) => p.proveedor,
      )
    : [];
  const notasVisibles = buscando || verTodas ? notasFiltradas : notasFiltradas.slice(0, PROVEEDORES_VISIBLES);
  const conNota = new Set((notas?.propuestas ?? []).map((p) => p.proveedorId));
  const proveedoresDirectos = buscaProv.trim() && todosProv ? filtrarPorBusqueda(todosProv, buscaProv, (p) => `${p.razon_social} ${p.cuit ?? ''}`).slice(0, 8) : [];

  const ventasViejas = resumen?.ventasHasta ? Date.now() - new Date(resumen.ventasHasta).getTime() > 30 * 86400_000 : true;

  async function enviar(textoDirecto?: string) {
    const cuerpo = (textoDirecto ?? texto).trim();
    if (!cuerpo || pensando) return;
    const conversacion: Mensaje[] = [...mensajes, { rol: 'usuario', texto: cuerpo }];
    setMensajes(conversacion);
    setTexto('');
    setError('');
    setPensando(true);
    try {
      const r = await fetch('/api/abastecimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: conversacion.map((m, i) => ({
            rol: m.rol,
            texto: i === conversacion.length - 1 ? contextoDeNotas([...notasChat.current.values()], ordenesRef.current) + m.texto : m.texto,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'El agente no pudo contestar');
      setMensajes([...conversacion, { rol: 'asistente', texto: j.respuesta, ordenes: j.ordenes?.length ? j.ordenes : undefined, propuestas: j.propuestas?.length ? j.propuestas : undefined, detalle: j.detalle ?? undefined }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El agente no pudo contestar');
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {resumen
            ? Object.entries(resumen.porSucursal).map(([suc, a]) => (
                <div key={suc} className="min-w-0 rounded-xl border border-black/[0.06] bg-crema-claro px-3 py-2.5">
                  <p className="text-sm font-semibold text-tinta">{suc}</p>
                  <p className="mt-1 text-xs text-tinta/70">
                    <span className="importe font-semibold text-marca-hondo">{miles(a.sin_stock)}</span> sin stock ·{' '}
                    <span className="importe font-semibold text-marca-hondo">{miles(a.no_llega)}</span> no llegan a tiempo ·{' '}
                    <span className="importe font-semibold text-tinta">{miles(a.menos_de_12)}</span> con menos de 12
                  </p>
                </div>
              ))
            : errorResumen
              ? <p className="text-sm text-tinta/60">No pude calcular el resumen. Recargá la página para reintentar.</p>
              : <Cargando texto="Calculando…" />}
        </div>
        {resumen && (
          <p className="text-xs text-tinta/70">
            Stock al {fecha(resumen.stockActualizado)} · ritmo de venta con datos hasta {fecha(resumen.ventasHasta)}
            {ventasViejas && <span className="text-marca-hondo"> — dato viejo: las cantidades son orientativas hasta cargar el reporte de ventas reciente del sistema viejo</span>}
            {resumen.sinProveedor > 0 && <> · {miles(resumen.sinProveedor)} productos en alerta sin proveedor habitual</>}
          </p>
        )}
      </Tarjeta>

      <section aria-labelledby="sugerido" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
          <div className="min-w-0">
            <h2 id="sugerido" className="text-lg font-semibold text-tinta">Sugerido para comprar</h2>
            <p className="text-sm text-tinta/70">Una nota de pedido por proveedor. Tildá lo que vas a pedir y ajustá las cantidades.</p>
          </div>
          <Chips
            etiquetaAccesible="Sucursal"
            valor={sucursal}
            onCambiar={setSucursal}
            opciones={SUCURSALES.map((s) => ({ valor: s, etiqueta: s }))}
          />
        </div>

        <div className="space-y-2">
          <Entrada
            type="search"
            value={buscaProv}
            onChange={(e) => setBuscaProv(e.target.value)}
            placeholder="Buscar proveedor"
            aria-label="Buscar proveedor"
            autoComplete="off"
          />
          <Chips
            etiquetaAccesible="Filtrar proveedores"
            valor={filtroProv}
            onCambiar={setFiltroProv}
            opciones={FILTROS_PROVEEDOR.map((f) => ({
              ...f,
              cuenta: notas && f.valor !== 'todos'
                ? notas.propuestas.filter((p) => (f.valor === 'urgentes' ? p.urgentes > 0 : p.faltan.length > 0)).length
                : undefined,
            }))}
          />
        </div>

        {buscaProv.trim() !== '' && (
          <Tarjeta relleno={false} className="overflow-hidden">
            <TarjetaCabecera
              nivel={3}
              titulo="Pedirle directamente"
              sub="Abrí la lista del proveedor y armale el pedido con lo que quieras, aunque hoy no tenga nada sugerido."
            />
            {!todosProv ? (
              <div className="p-4"><Cargando texto="Buscando proveedores…" /></div>
            ) : proveedoresDirectos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-tinta/70 sm:px-5">No hay ningún proveedor activo que se llame «{buscaProv.trim()}».</p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {proveedoresDirectos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-tinta">{p.razon_social}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-tinta/60">
                        {p.productos ? `${miles(p.productos)} productos en su lista` : 'Sin lista cargada'}
                        {conNota.has(p.id) && <Etiqueta tono="info">tiene sugerido abajo</Etiqueta>}
                      </span>
                    </span>
                    <BotonLink
                      tamano="chico"
                      variante="secundario"
                      href={`/pedido-proveedor?proveedor=${encodeURIComponent(p.id)}&sucursal=${encodeURIComponent(sucursal)}`}
                    >
                      Pedirle algo
                    </BotonLink>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        )}

        {errorNotas && (
          <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={() => setRecargar((n) => n + 1)}>Reintentar</Boton>}>
            {errorNotas}
          </Aviso>
        )}
        {!notas && !errorNotas && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-tarjeta">
                <div className="h-[62px] bg-marca" />
                <div className="space-y-3 p-5">{[0, 1, 2].map((j) => <div key={j} className="h-9 rounded-xl bg-black/[0.04] motion-safe:animate-pulse" />)}</div>
              </div>
            ))}
          </div>
        )}
        {notas && notas.propuestas.length === 0 && (
          <Vacio
            titulo={`No hay nada para reponer en ${sucursal} con proveedor habitual.`}
            texto="Si te falta algo puntual, preguntale al agente acá abajo."
          />
        )}
        {notas && notas.propuestas.length > 0 && buscando && notasFiltradas.length === 0 && (
          <Vacio
            titulo="Ningún proveedor con algo sugerido coincide."
            texto={buscaProv.trim() ? 'Si querés pedirle igual, usá «Pedirle algo» arriba.' : 'Probá con otro filtro.'}
          />
        )}
        {notasVisibles.map((p) => (
          <NotaDePedido key={`${sucursal}:${p.clave}`} propuesta={p} yaPedidos={yaPedidos} onArmada={alArmar} />
        ))}
        {!buscando && notasFiltradas.length > PROVEEDORES_VISIBLES && !verTodas && (
          <Boton variante="secundario" anchoCompleto onClick={() => setVerTodas(true)}>
            Ver {notasFiltradas.length - PROVEEDORES_VISIBLES} proveedor{notasFiltradas.length - PROVEEDORES_VISIBLES === 1 ? '' : 'es'} más
          </Boton>
        )}
        {notas && notas.sinProveedor > 0 && (
          <p className="text-sm text-tinta/70">
            Hay {miles(notas.sinProveedor)} productos urgentes sin proveedor habitual: no entran en ninguna nota.{' '}
            <button onClick={() => enviar(`¿A quién le compro lo urgente que no tiene proveedor habitual en ${sucursal}?`)} className={unir('rounded-sm font-semibold text-marca-hondo underline underline-offset-2', FOCO)}>Preguntale al agente</button>.
          </p>
        )}
      </section>

      {error && <Aviso tono="error">{error}</Aviso>}

      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera
          titulo="Agente de compras"
          sub="Para algo puntual: un rubro, un producto o qué hacer con lo que no tiene proveedor. Lo que propone te llega como nota de pedido para tildar."
        />
        <div className="max-h-[70dvh] space-y-3 overflow-y-auto p-4 sm:p-5">
          {mensajes.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button key={s} onClick={() => enviar(s)} className={unir('min-h-11 rounded-2xl bg-crema px-3.5 py-2 text-left text-sm text-tinta/80 transition-colors hover:bg-crema-hondo hover:text-tinta', FOCO)}>{s}</button>
              ))}
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.rol === 'usuario' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.rol === 'usuario' ? 'bg-tinta text-crema' : 'bg-crema text-tinta'}`}>
                {m.texto}
                {m.ordenes && (
                  <a href="/aprobaciones" className={unir('mt-2 block rounded-sm text-xs font-semibold text-marca-hondo underline', FOCO)}>
                    {m.ordenes.length === 1 ? `Orden #${m.ordenes[0]}` : `Órdenes #${m.ordenes.join(', #')}`} creada{m.ordenes.length > 1 ? 's' : ''}: ver en Aprobaciones
                  </a>
                )}
              </div>
              {m.detalle && <PlacaRoja {...m.detalle} className="mt-2 w-full" />}
              {m.propuestas && (
                <div className="mt-2 w-full space-y-3">
                  {m.propuestas.map((p) => (
                    <NotaDePedido
                      key={`${i}:${p.clave}`}
                      propuesta={p}
                      yaPedidos={yaPedidos}
                      onArmada={alArmar}
                      onCambio={(e) => notasChat.current.set(`${i}:${p.clave}`, e)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {pensando && <Cargando texto="Revisando stock, ventas y proveedores…" />}
          <div ref={finRef} />
        </div>
        <div className="border-t border-black/[0.06] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              rows={2}
              placeholder="Preguntale qué falta, qué pedir o a quién…"
              aria-label="Mensaje para el agente de compras"
              className={unir(CLASES_ENTRADA, 'order-first basis-full resize-none sm:order-none sm:basis-0 sm:flex-1')}
            />
            <span className="sm:order-first"><BotonMicrofono onTexto={setTexto} titulo="Dictarle al agente" /></span>
            <Boton onClick={() => enviar()} disabled={pensando || !texto.trim()} className="ml-auto sm:ml-0">
              Enviar
            </Boton>
          </div>
        </div>
      </Tarjeta>
    </div>
  );
}
