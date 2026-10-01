'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Etiqueta, FOCO, IconoCerrar, Monto, unir, type TonoEtiqueta } from '../ui/kit';
import { pesos as formatoPesos } from '../lib/formato';

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
  items: { cantidad: number; producto: { nombre: string } | null }[];
};

const pesos = (n: number) => formatoPesos(n);

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
                  return (
                    <div key={p.id} className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-tarjeta">
                      <div className="flex items-center justify-between gap-2">
                        <Etiqueta tono={chip.tono}>
                          {chip.label}
                        </Etiqueta>
                        <span
                          className={
                            'shrink-0 text-xs font-medium ' +
                            (p.minutos > 20 ? 'text-marca-hondo' : 'text-tinta/60')
                          }
                        >
                          hace {p.minutos} min
                        </span>
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
                      <ul className="mt-2 space-y-0.5 text-sm text-tinta">
                        {p.items.map((i, j) => (
                          <li key={j} className="break-words">
                            {Math.round(Number(i.cantidad))}× {i.producto?.nombre ?? '—'}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Monto valor={p.total} className="text-sm font-semibold text-tinta" />
                        <span className="min-w-0 truncate text-xs text-tinta/60">{p.sucursal?.nombre}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
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
