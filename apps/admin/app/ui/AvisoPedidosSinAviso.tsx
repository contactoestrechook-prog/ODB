'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

// REGLA (Leandro, 3/10/2026): toda confirmación de pedido sale al teléfono de
// administración. Si el aviso de un pedido no salió en 3 minutos, o salió y
// WhatsApp no confirma que llegó en 15, esta franja roja aparece arriba de
// TODAS las pantallas. Se saca con "Ya avisé al local" (queda quién y cuándo).
// También avisa si el WhatsApp de la casa está desconectado o si no se pudo
// verificar: nunca queda vacía en silencio.
type Problema = { avisoId: string; pedidoId: string | null; tipo: string; codigo: string; problema: 'no_salio' | 'no_llego'; minutos: number; motivo: string | null };
type Respuesta = { problemas?: Problema[]; whatsapp?: string | null; error?: string };

const NOMBRE: Record<string, string> = { pedido_nuevo: 'del pedido', pedido_cancelado: 'de la baja del pedido', pedido_pagado: 'del pago del pedido', pedido_sin_cargar: 'del pedido sin cargar del' };

export function AvisoPedidosSinAviso() {
  const [estado, setEstado] = useState<Respuesta>({});
  const [fallas, setFallas] = useState(0);

  const mirar = useCallback(async () => {
    try {
      const r = await fetch('/api/avisos-pedidos', { cache: 'no-store' });
      const j: Respuesta = r.ok ? await r.json() : { error: 'el panel no contesta' };
      setEstado(j);
      setFallas((n) => (j.error ? n + 1 : 0));
    } catch {
      setFallas((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    mirar();
    const t = setInterval(mirar, 30_000);
    return () => clearInterval(t);
  }, [mirar]);

  async function yaAvise(id: string) {
    setEstado((e) => ({ ...e, problemas: (e.problemas ?? []).filter((p) => p.avisoId !== id) }));
    await fetch('/api/avisos-pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
    mirar();
  }

  const problemas = estado.problemas ?? [];
  const whatsappCaido = !!estado.whatsapp && estado.whatsapp !== 'WORKING';
  const sinVerificar = fallas >= 2;
  if (!problemas.length && !whatsappCaido && !sinVerificar) return null;
  return (
    <div role="alert" className="sticky top-0 z-[60] w-full bg-marca px-4 py-3 text-white shadow-md" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-2">
        {whatsappCaido && (
          <p className="min-w-0 break-words text-sm leading-snug">
            <span className="font-bold">El WhatsApp de la casa está desconectado ({estado.whatsapp}).</span> Los avisos de pedidos a administración no pueden salir hasta reconectarlo.
          </p>
        )}
        {sinVerificar && (
          <p className="min-w-0 break-words text-sm leading-snug">
            <span className="font-bold">No se pudo verificar si los avisos de pedidos salieron</span> ({estado.error ?? 'sin conexión'}). Revisá Pedidos.
          </p>
        )}
        {problemas.slice(0, 3).map((p) => (
          <div key={p.avisoId} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5">
            <p className="min-w-0 flex-1 basis-56 break-words text-sm leading-snug">
              <span className="font-bold">
                El aviso {NOMBRE[p.tipo] ?? 'del pedido'} {p.codigo} {p.problema === 'no_salio' ? 'NO SALIÓ a administración' : 'no le llegó a administración'}
              </span>{' '}
              (hace {p.minutos} min). Avisen al local por otro medio.
              {p.motivo ? <span className="block text-white/80">{p.motivo}</span> : null}
            </p>
            <button onClick={() => yaAvise(p.avisoId)} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-marca hover:bg-white/90">
              Ya avisé al local
            </button>
          </div>
        ))}
        {problemas.length > 3 && <p className="text-sm text-white/90">Y {problemas.length - 3} aviso(s) más.</p>}
        <Link href="/pedidos" className="self-start rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Ver pedidos</Link>
      </div>
    </div>
  );
}
