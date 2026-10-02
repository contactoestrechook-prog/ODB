'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Etiqueta, FOCO, IconoCerrar, Monto, PlacaRoja, unir, type TonoEtiqueta } from '../ui/kit';
import { numero, pesos as formatoPesos } from '../lib/formato';

type Pedido = {
  id: string;
  estado: string;
  origen: string;
  programado?: boolean;
  entregaEtiqueta?: string | null;
  notas?: string | null;
  total: number;
  qr_retiro: string | null;
  minutos: number;
  sucursal: { nombre: string } | null;
  cliente: { dni: string; tipo: string } | null;
  // precio_unitario y sku ya venían en la cola (apps/api/src/pedidos › cola)
  items: { cantidad: number; precio_unitario?: number | string | null; producto: { nombre: string; sku?: string } | null }[];
};

const pesos = (n: number) => formatoPesos(n);

// La cantidad tal cual, hasta 2 decimales: un fiambre por peso puede ser
// 0,5 kg y antes, redondeada, se leía "1×" (2/10/2026).
const cantidadDe = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Vista breve de la tarjeta cerrada: los primeros tres productos en una línea.
function resumenItems(items: Pedido['items']): string {
  const primeros = items.slice(0, 3).map((i) => `${numero(cantidadDe(i.cantidad), 2)}× ${i.producto?.nombre ?? '—'}`);
  const resto = items.length - primeros.length;
  return primeros.join(' · ') + (resto > 0 ? ` +${resto} más` : '');
}

const ORIGEN_CHIP: Record<string, { label: string; tono: TonoEtiqueta }> = {
  pedidosya: { label: 'PedidosYa', tono: 'error' },
  web: { label: 'Web', tono: 'info' },
  pickup: { label: 'Pick-up', tono: 'info' },
  whatsapp: { label: 'WhatsApp', tono: 'ok' },
  mostrador: { label: 'Mostrador', tono: 'neutro' },
};

const COLUMNAS = [
  { estado: 'recibido', titulo: 'Recibidos', accion: 'en_preparacion', botenLabel: 'Empezar a preparar' },
  { estado: 'en_preparacion', titulo: 'En preparación', accion: 'listo', botenLabel: 'Marcar listo' },
  { estado: 'listo', titulo: 'Listos para retirar', accion: 'entregado', botenLabel: 'Entregar' },
];

export function ColaDeposito() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // qué pedidos se ven abiertos (como Placa roja) y cuáles en la vista breve;
  // sin tocar, se abren solos los que están "En preparación"
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/pedidos');
      if (res.ok) setPedidos(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 10_000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  async function avanzar(pedido: Pedido, estado: string) {
    setOcupado(pedido.id);
    setAviso(null);
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId: pedido.id, estado }),
    });
    const datos = await res.json();
    if (!res.ok) setAviso(datos.message ?? 'No se pudo avanzar el pedido');
    else if (estado === 'entregado' && datos.venta) {
      setAviso(`Pedido entregado: venta registrada por ${pesos(datos.venta.total)}`);
    }
    await cargar();
    setOcupado(null);
  }

  async function simular() {
    setOcupado('simular');
    setAviso(null);
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simular: true }),
    });
    const datos = await res.json();
    if (!res.ok) setAviso(datos.message ?? 'No se pudo simular');
    await cargar();
    setOcupado(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-tinta/60">
          Se actualiza solo cada 10 segundos · el stock queda reservado al entrar el pedido
        </p>
        <Boton
          variante="secundario"
          tamano="chico"
          onClick={simular}
          disabled={ocupado === 'simular'}
        >
          {ocupado === 'simular' ? 'Llegando…' : 'Simular pedido de PedidosYa'}
        </Boton>
      </div>

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNAS.map((col) => {
          const enColumna = pedidos
            .filter((p) => p.estado === col.estado || (col.estado === 'recibido' && p.estado === 'pagado'))
            // lo de HOY primero; lo programado para otro día al final, que no
            // apure a nadie ni se prepare antes de tiempo
            .sort((a, b) => Number(!!a.programado) - Number(!!b.programado));
          return (
            <section key={col.estado} className="min-w-0 rounded-2xl bg-crema-hondo/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold text-tinta">{col.titulo}</h2>
                <span className="importe rounded-full bg-white px-2 text-xs font-semibold leading-5 text-tinta/70">
                  {enColumna.length}
                </span>
              </div>
              <div className="space-y-2">
                {enColumna.map((p) => {
                  const chip = ORIGEN_CHIP[p.origen] ?? ORIGEN_CHIP.web;
                  // Placa roja (2/10/2026): "siempre que se detallen productos vamos
                  // a usar el paquete gráfico de pedidos". Entera es muy alta para un
                  // tablero de tres columnas, así que la tarjeta tiene dos vistas: la
                  // breve (los datos de siempre, los primeros tres productos en una
                  // línea y los botones) y la placa PEDIDO, que se abre sola en "En
                  // preparación", donde se arma el pedido y hace falta la lista
                  // completa. "Ver pedido" / "Ver menos" pasa de una a otra.
                  const abierto = abiertos[p.id] ?? col.estado === 'en_preparacion';
                  const alternar = (
                    <Boton
                      variante="fantasma"
                      tamano="chico"
                      aria-expanded={abierto}
                      onClick={() => setAbiertos((a) => ({ ...a, [p.id]: !abierto }))}
                      className={abierto ? 'mr-auto' : undefined}
                    >
                      {abierto ? 'Ver menos' : 'Ver pedido'}
                    </Boton>
                  );
                  const botones = (
                    <>
                      <Boton
                        onClick={() => avanzar(p, col.accion)}
                        disabled={ocupado === p.id}
                        className="flex-1"
                      >
                        {ocupado === p.id ? '…' : col.botenLabel}
                      </Boton>
                      <button
                        type="button"
                        onClick={() => avanzar(p, 'cancelado')}
                        disabled={ocupado === p.id}
                        className={unir(
                          'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-tinta/70 transition-colors hover:border-marca/50 hover:text-marca-hondo disabled:opacity-50 sm:size-10',
                          FOCO,
                        )}
                        title="Cancelar pedido (libera el stock)"
                        aria-label="Cancelar pedido (libera el stock)"
                      >
                        <IconoCerrar className="size-5" />
                      </button>
                    </>
                  );
                  const minutos = (
                    <span
                      className={
                        'shrink-0 text-xs font-medium ' +
                        (p.minutos > 20 ? 'text-marca-hondo' : 'text-tinta/60')
                      }
                    >
                      hace {p.minutos} min
                    </span>
                  );

                  if (abierto) {
                    return (
                      <PlacaRoja
                        key={p.id}
                        titulo="PEDIDO"
                        sub={[p.qr_retiro, chip.label].filter(Boolean).join(' · ')}
                        renglones={p.items.map((i, j) => {
                          const cantidad = cantidadDe(i.cantidad);
                          // el unitario con el que entró el pedido: "2 × $1.500" y el subtotal, como en la tarjeta del bot
                          const unitario = Number(i.precio_unitario);
                          const conPrecio = i.precio_unitario != null && i.precio_unitario !== '' && Number.isFinite(unitario);
                          return {
                            clave: String(j),
                            cantidad,
                            nombre: i.producto?.nombre ?? '—',
                            detalle: conPrecio ? `${numero(cantidad, 2)} × ${pesos(unitario)}` : undefined,
                            importe: conPrecio ? pesos(cantidad * unitario) : undefined,
                          };
                        })}
                        total={{ etiqueta: 'Total', valor: pesos(p.total) }}
                        recuadro={
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {minutos}
                              {p.entregaEtiqueta && (
                                <Etiqueta tono={p.programado ? 'neutro' : 'error'}>{p.entregaEtiqueta}</Etiqueta>
                              )}
                              {p.sucursal?.nombre && (
                                <span className="min-w-0 break-words text-xs text-tinta/60">{p.sucursal.nombre}</span>
                              )}
                            </div>
                            {p.notas && <p className="break-words text-xs italic text-tinta/70">{p.notas}</p>}
                          </div>
                        }
                        acciones={
                          <>
                            {alternar}
                            {botones}
                          </>
                        }
                      />
                    );
                  }

                  return (
                    <div key={p.id} className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-tarjeta">
                      <div className="flex items-center justify-between gap-2">
                        <Etiqueta tono={chip.tono}>
                          {chip.label}
                        </Etiqueta>
                        {minutos}
                      </div>
                      {p.entregaEtiqueta && (
                        <div className="mt-1">
                          <Etiqueta tono={p.programado ? 'neutro' : 'error'}>
                            {p.entregaEtiqueta}
                          </Etiqueta>
                        </div>
                      )}
                      {p.qr_retiro && (
                        <p className="mt-1 break-all font-mono text-xs text-tinta/60">{p.qr_retiro}</p>
                      )}
                      {p.notas && <p className="mt-1 break-words text-xs italic text-tinta/70">{p.notas}</p>}
                      <p className="mt-2 break-words text-sm leading-snug text-tinta">{resumenItems(p.items)}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <Monto valor={p.total} className="text-sm font-semibold text-tinta" />
                          <span className="min-w-0 truncate text-xs text-tinta/60">{p.sucursal?.nombre}</span>
                        </div>
                        {alternar}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {botones}
                      </div>
                    </div>
                  );
                })}
                {enColumna.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-tinta/60">vacío</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
