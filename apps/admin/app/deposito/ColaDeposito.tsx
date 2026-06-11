'use client';

import { useCallback, useEffect, useState } from 'react';

type Pedido = {
  id: string;
  estado: string;
  origen: string;
  total: number;
  qr_retiro: string | null;
  minutos: number;
  sucursal: { nombre: string } | null;
  cliente: { dni: string; tipo: string } | null;
  items: { cantidad: number; producto: { nombre: string } | null }[];
};

const pesos = (n: number) => '$' + Math.round(Number(n)).toLocaleString('es-AR');

const ORIGEN_CHIP: Record<string, { label: string; clase: string }> = {
  pedidosya: { label: 'PedidosYa', clase: 'bg-[#B82D25] text-white' },
  web: { label: 'Web', clase: 'bg-black text-white' },
  pickup: { label: 'Pick-up', clase: 'bg-black text-white' },
  whatsapp: { label: 'WhatsApp', clase: 'bg-[#F0EBE2] text-black' },
  mostrador: { label: 'Mostrador', clase: 'bg-[#F0EBE2] text-black' },
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-medium text-black">Depósito · pedidos en curso</h1>
          <p className="text-xs text-black/50">
            Se actualiza solo cada 10 segundos · el stock queda reservado al entrar el pedido
          </p>
        </div>
        <button
          onClick={simular}
          disabled={ocupado === 'simular'}
          className="rounded-full border-2 border-[#B82D25] px-4 py-2 text-xs font-medium text-[#B82D25] hover:bg-[#B82D25] hover:text-white disabled:opacity-50"
        >
          {ocupado === 'simular' ? 'Llegando…' : 'Simular pedido de PedidosYa'}
        </button>
      </div>

      {aviso && (
        <p className="rounded-lg bg-white px-4 py-2.5 text-sm text-black">{aviso}</p>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {COLUMNAS.map((col) => {
          const enColumna = pedidos.filter(
            (p) => p.estado === col.estado || (col.estado === 'recibido' && p.estado === 'pagado'),
          );
          return (
            <div key={col.estado} className="rounded-xl bg-white/60 p-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-sm font-medium text-black">{col.titulo}</h2>
                <span className="rounded-full bg-black px-2.5 py-0.5 text-xs font-medium text-white">
                  {enColumna.length}
                </span>
              </div>
              <div className="space-y-2">
                {enColumna.map((p) => {
                  const chip = ORIGEN_CHIP[p.origen] ?? ORIGEN_CHIP.web;
                  return (
                    <div key={p.id} className="rounded-xl bg-white p-3 border border-black/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.clase}`}>
                          {chip.label}
                        </span>
                        <span
                          className={
                            'text-xs font-medium ' +
                            (p.minutos > 20 ? 'text-[#932A1F]' : 'text-black/40')
                          }
                        >
                          hace {p.minutos} min
                        </span>
                      </div>
                      {p.qr_retiro && (
                        <p className="mt-1 text-xs text-black/40 font-mono">{p.qr_retiro}</p>
                      )}
                      <ul className="mt-2 text-sm text-black space-y-0.5">
                        {p.items.map((i, j) => (
                          <li key={j}>
                            {Math.round(Number(i.cantidad))}× {i.producto?.nombre ?? '—'}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-black">{pesos(p.total)}</span>
                        <span className="text-xs text-black/40">{p.sucursal?.nombre}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => avanzar(p, col.accion)}
                          disabled={ocupado === p.id}
                          className="flex-1 rounded-full bg-[#B82D25] py-2 text-xs font-medium text-white hover:bg-[#932A1F] disabled:opacity-50"
                        >
                          {ocupado === p.id ? '…' : col.botenLabel}
                        </button>
                        <button
                          onClick={() => avanzar(p, 'cancelado')}
                          disabled={ocupado === p.id}
                          className="rounded-full border border-black/15 px-3 py-2 text-xs text-black/60 hover:border-black"
                          title="Cancelar pedido (libera el stock)"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
                {enColumna.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-black/30">vacío</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
