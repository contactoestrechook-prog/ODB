'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, Etiqueta, Monto, PlacaRoja, Tarjeta, useConfirmar } from './kit';
import { FOCO_ADENTRO, ROTULO, unir } from './kit/clases';
import { fechaHora, numero, pesos } from '../lib/formato';

// La cola de firmas. Antes estaba repartida en cinco pantallas y lo que nadie
// miraba se enteraba el proveedor antes que la dirección. Acá arriba va lo que
// más días lleva esperando, no lo más caro: lo que frena a alguien es lo
// urgente.

const ETIQUETA: Record<string, string> = {
  orden_compra: 'Orden de compra',
  orden_pago: 'Orden de pago',
  cobranza: 'Cobro a cuenta',
  cambio_factura: 'Cambio en factura',
  propuesta_costo: 'Cambio de costos',
  devolucion: 'Devolución en caja',
};
// El PDF que respalda la firma, cuando el tipo tiene uno
const PDF: Record<string, string> = { orden_compra: 'oc', orden_pago: 'op' };
const clave = (it: any) => `${it.tipo}-${it.id}`;

// En el escritorio la pantalla se parte en dos: la cola y el papel abierto. En
// el celular quedan las tarjetas de siempre. Se decide con el ancho real y no
// con clases, para no bajar el PDF en un teléfono que no lo va a mostrar.
function useEscritorio() {
  const [es, setEs] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)');
    const ver = () => setEs(m.matches);
    ver();
    m.addEventListener('change', ver);
    return () => m.removeEventListener('change', ver);
  }, []);
  return es;
}

export function Aprobaciones({ puedeFirmar }: { puedeFirmar: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const { confirmar, pedirTexto, dialogo } = useConfirmar();
  const escritorio = useEscritorio();
  const [filtro, setFiltro] = useState('todo');
  const [elegida, setElegida] = useState<string | null>(null);

  const tipos = useMemo(() => {
    const n: Record<string, number> = {};
    for (const it of items) n[it.tipo] = (n[it.tipo] ?? 0) + 1;
    return Object.entries(n);
  }, [items]);
  const filtroVivo = filtro !== 'todo' && tipos.some(([t]) => t === filtro) ? filtro : 'todo';
  const visibles = filtroVivo === 'todo' ? items : items.filter((it) => it.tipo === filtroVivo);
  // siempre hay un papel abierto: al firmar uno, queda abierto el que sigue
  const abierta = visibles.find((it) => clave(it) === elegida) ?? visibles[0] ?? null;
  const total = items.reduce((s, it) => s + (it.monto ?? 0), 0);
  const masVieja = items.reduce((m, it) => Math.max(m, it.dias ?? 0), 0);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/aprobaciones');
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude consultar la API'); return; }
      setItems(d.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // la cola cambia sola: alguien carga un cobro o una OC mientras esto está abierto
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  const resolver = async (it: any, decision: 'aprobar' | 'rechazar') => {
    if (trabajando) return;
    let motivo: string | undefined;
    if (decision === 'rechazar') {
      const m = await pedirTexto({
        titulo: `Rechazar: ${ETIQUETA[it.tipo] ?? it.tipo}`,
        texto: it.titulo,
        campo: { etiqueta: `Motivo del rechazo (le llega a ${it.pidio ?? 'quien lo pidió'}):`, multilinea: true },
        variante: 'peligro',
        textoConfirmar: 'Rechazar',
      });
      if (m === null) return;
      motivo = m;
    } else if (it.monto != null && it.monto > 0) {
      // firmar plata sin releer el monto es cómo se firma lo que no se quiso firmar
      const ok = await confirmar({
        titulo: '¿Confirmás la aprobación?',
        texto: (
          <>
            <p>{ETIQUETA[it.tipo]}: {it.titulo}</p>
            <p className="mt-2">
              Monto: <span className="importe font-semibold text-tinta">{pesos(it.monto ?? 0)}</span>
            </p>
          </>
        ),
        variante: 'ok',
        textoConfirmar: 'Aprobar',
      });
      if (!ok) return;
    }
    setTrabajando(it.id);
    setAviso('');
    try {
      const r = await fetch('/api/aprobaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: it.tipo, id: it.id, decision, motivo }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No se pudo resolver'); return; }
      // una orden de compra firmada sale sola al proveedor por WhatsApp: se dice
      // si llegó o por qué no (la firma vale igual)
      const envio = d?.envio as { enviado?: boolean; mensaje?: string } | undefined;
      setError(envio && !envio.enviado ? `${ETIQUETA[it.tipo]} aprobada, pero ${String(envio.mensaje ?? '').replace(/^El pedido/, 'el pedido')}` : '');
      setAviso(decision === 'aprobar' ? `${ETIQUETA[it.tipo]} aprobada.${envio?.enviado ? ` ${envio.mensaje}` : ''}` : `${ETIQUETA[it.tipo]} rechazada.`);
      // el que sigue en la cola queda abierto, para firmar uno atrás del otro
      const i = visibles.findIndex((x) => clave(x) === clave(it));
      const sigue = visibles[i + 1] ?? visibles[i - 1];
      setElegida(sigue ? clave(sigue) : null);
      setItems((xs) => xs.filter((x) => !(x.id === it.id && x.tipo === it.tipo)));
    } finally {
      setTrabajando(null);
    }
  };

  const botones = (it: any) =>
    puedeFirmar ? (
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <Boton variante="ok" onClick={() => resolver(it, 'aprobar')} disabled={trabajando === it.id} cargando={trabajando === it.id}>
          Aprobar
        </Boton>
        <Boton variante="peligro" onClick={() => resolver(it, 'rechazar')} disabled={trabajando === it.id}>
          Rechazar
        </Boton>
      </div>
    ) : (
      <span className="text-xs text-tinta/60">espera la firma del dueño</span>
    );

  // El resumen de la cola: cuántas, cuánta plata y hace cuánto espera la más vieja.
  const resumen = items.length > 0 && (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-3 sm:gap-x-10">
        <div>
          <dt className={ROTULO}>Esperan tu firma</dt>
          <dd className="importe mt-1 text-2xl font-bold tracking-tight text-tinta sm:text-3xl lg:text-4xl">{items.length}</dd>
        </div>
        {total > 0 && (
          <div>
            <dt className={ROTULO}>Suman</dt>
            <dd className="mt-1"><Monto valor={total} className="text-2xl font-bold tracking-tight text-tinta sm:text-3xl lg:text-4xl" /></dd>
          </div>
        )}
        <div>
          <dt className={ROTULO}>La más vieja</dt>
          <dd className={unir('mt-1 text-base font-semibold sm:text-xl lg:text-2xl', masVieja >= 2 ? 'text-marca-hondo' : 'text-tinta')}>
            {masVieja === 0 ? 'de hoy' : masVieja === 1 ? 'de ayer' : `hace ${masVieja} días`}
          </dd>
        </div>
      </dl>
      {tipos.length > 1 && (
        <Chips
          etiquetaAccesible="Tipo de aprobación"
          desplazable={!escritorio}
          className="max-w-full"
          valor={filtroVivo}
          onCambiar={setFiltro}
          opciones={[
            { valor: 'todo', etiqueta: 'Todo', cuenta: items.length },
            ...tipos.map(([t, n]) => ({ valor: t, etiqueta: ETIQUETA[t] ?? t, cuenta: n })),
          ]}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {cargando && <Cargando />}

      {!cargando && items.length === 0 && !error && (
        <Aviso tono="ok">No queda nada esperando firma.</Aviso>
      )}

      {resumen}

      {/* Escritorio: la cola a la izquierda y el papel abierto a la derecha */}
      {escritorio && abierta && (
        <div className="grid grid-cols-[minmax(21rem,2fr)_minmax(0,3fr)] items-start gap-6">
          <Tarjeta relleno={false} className="overflow-hidden">
            <ul className="divide-y divide-black/[0.06]">
              {visibles.map((it) => {
                const activa = clave(it) === clave(abierta);
                return (
                  <li key={clave(it)}>
                    <button
                      type="button"
                      aria-current={activa ? 'true' : undefined}
                      onClick={() => setElegida(clave(it))}
                      className={unir(
                        'relative flex w-full items-start gap-4 px-5 py-4 text-left transition-colors',
                        activa ? 'bg-crema-claro' : 'hover:bg-crema-claro/60',
                        FOCO_ADENTRO,
                      )}
                    >
                      {activa && <span className="absolute inset-y-0 left-0 w-1 bg-marca" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={ROTULO}>{ETIQUETA[it.tipo] ?? it.tipo}</span>
                          {it.dias >= 2 && <Etiqueta tono="error">hace {it.dias} días</Etiqueta>}
                        </span>
                        <span className="mt-1 block break-words text-sm font-semibold leading-snug text-tinta">{it.titulo}</span>
                        <span className="mt-1 block text-xs text-tinta/60">
                          {it.pidio ? `${it.pidio} · ` : ''}{fechaHora(it.cuando)}
                        </span>
                      </span>
                      {it.monto != null && <Monto valor={it.monto} className="shrink-0 pt-5 text-base font-semibold text-tinta" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Tarjeta>

          <Tarjeta relleno={false} className="sticky top-6 flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-6 py-5">
              <div className="min-w-0 flex-1 basis-80">
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta tono="neutro">{ETIQUETA[abierta.tipo] ?? abierta.tipo}</Etiqueta>
                  {abierta.dias >= 2 && <Etiqueta tono="error">esperando hace {abierta.dias} días</Etiqueta>}
                </div>
                <h2 className="mt-2 break-words text-xl font-bold leading-snug text-tinta">{abierta.titulo}</h2>
                <p className="mt-1 text-sm text-tinta/60">
                  {abierta.pidio ? `Pidió ${abierta.pidio} · ` : ''}{fechaHora(abierta.cuando)}
                </p>
                <p className="mt-2 max-w-prose break-words text-sm text-tinta/70">{abierta.detalle}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                {abierta.monto != null && <Monto valor={abierta.monto} className="text-3xl font-bold tracking-tight text-tinta" />}
                {botones(abierta)}
              </div>
            </div>

            {PDF[abierta.tipo] && (
              <div className="flex min-h-0 flex-1 flex-col border-t border-black/[0.06] bg-crema-claro">
                <div className="flex items-center justify-between gap-3 px-6 py-2">
                  <p className={ROTULO}>El documento</p>
                  <a href={`/api/documento?tipo=${PDF[abierta.tipo]}&id=${abierta.id}`} target="_blank" rel="noreferrer"
                    className="text-xs font-medium text-marca-hondo underline underline-offset-2">
                    abrir aparte
                  </a>
                </div>
                <iframe
                  key={clave(abierta)}
                  title={`Documento de ${abierta.titulo}`}
                  src={`/api/documento?tipo=${PDF[abierta.tipo]}&id=${abierta.id}#toolbar=0&navpanes=0&view=FitH`}
                  className="h-[calc(100dvh-31rem)] min-h-[26rem] w-full border-0 bg-white"
                />
              </div>
            )}

            {abierta.tipo === 'devolucion' && (abierta.productos ?? []).length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-black/[0.06]">
                <ul className="divide-y divide-black/[0.06]">
                  {(abierta.productos as { nombre: string; cantidad: number; precio: number }[]).map((p, n) => (
                    <li key={`${n}-${p.nombre}`} className="flex items-baseline justify-between gap-4 px-6 py-3">
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium text-tinta">{p.nombre}</span>
                        <span className="importe text-xs text-tinta/60">{numero(p.cantidad, 3)} × {pesos(p.precio)}</span>
                      </span>
                      <Monto valor={p.cantidad * p.precio} className="shrink-0 text-sm font-semibold text-tinta" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Tarjeta>
        </div>
      )}

      {/* Celular: una tarjeta por firma */}
      {!escritorio && visibles.length > 0 && (
        <div className="space-y-3">
          {visibles.map((it) => {
            const firma = botones(it);

            // La devolución en caja detalla productos: va en la Placa roja, el
            // paquete gráfico de pedidos y listas de precios (2/10/2026, pedido
            // de Leandro). Antes era una línea "2× Fernet, 1× Coca" y no se veía
            // qué costaba cada renglón. Un pedido viejo sin detalle sigue en tarjeta.
            const productos = (it.tipo === 'devolucion' ? it.productos ?? [] : []) as { nombre: string; cantidad: number; precio: number }[];
            if (productos.length > 0) {
              return (
                <PlacaRoja
                  key={`${it.tipo}-${it.id}`}
                  titulo="Devolución"
                  sub={`${it.pidio ? `Pidió ${it.pidio} · ` : ''}${fechaHora(it.cuando)}`}
                  renglones={productos.map((p, n) => ({
                    clave: `${n}-${p.nombre}`,
                    cantidad: p.cantidad,
                    nombre: p.nombre,
                    detalle: `${numero(p.cantidad, 3)} × ${pesos(p.precio)}`,
                    importe: pesos(p.cantidad * p.precio),
                  }))}
                  total={{ etiqueta: 'A devolver', valor: pesos(it.monto ?? 0) }}
                  recuadro={
                    <div className="space-y-2">
                      {it.dias >= 2 && <Etiqueta tono="error">esperando hace {it.dias} días</Etiqueta>}
                      <p className="break-words text-tinta/70">{it.detalle}</p>
                    </div>
                  }
                  acciones={firma}
                />
              );
            }

            return (
              <Tarjeta key={`${it.tipo}-${it.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Etiqueta tono="neutro">{ETIQUETA[it.tipo] ?? it.tipo}</Etiqueta>
                      {it.dias >= 2 && <Etiqueta tono="error">esperando hace {it.dias} días</Etiqueta>}
                    </div>
                    <p className="mt-2 break-words text-base font-semibold text-tinta sm:text-sm">{it.titulo}</p>
                    <p className="mt-0.5 break-words text-xs text-tinta/60">
                      {it.detalle}
                      {it.pidio && ` · pidió ${it.pidio}`}
                      {` · ${fechaHora(it.cuando)}`}
                    </p>
                    {PDF[it.tipo] && (
                      <a href={`/api/documento?tipo=${PDF[it.tipo]}&id=${it.id}`} target="_blank" rel="noreferrer"
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-marca-hondo underline underline-offset-2 sm:min-h-0 sm:text-xs">
                        ver el documento antes de firmar
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    {it.monto != null && <Monto valor={it.monto} className="text-xl font-semibold text-tinta" />}
                    {firma}
                  </div>
                </div>
              </Tarjeta>
            );
          })}
        </div>
      )}
      {dialogo}
    </div>
  );
}
