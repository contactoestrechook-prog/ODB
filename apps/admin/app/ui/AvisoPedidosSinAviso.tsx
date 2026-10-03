'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// REGLA (Leandro, 3/10/2026): toda confirmación de pedido sale al teléfono de
// administración. Si el aviso de un pedido no salió en 3 minutos, o salió y
// WhatsApp no confirma que llegó en 15, esta franja roja aparece arriba de
// TODAS las pantallas hasta que se resuelva. No se puede cerrar: el pedido está
// para preparar y el local puede no saberlo.
type Problema = { pedidoId: string; codigo: string; problema: 'no_salio' | 'no_llego'; minutos: number; motivo: string | null };

export function AvisoPedidosSinAviso() {
  const [problemas, setProblemas] = useState<Problema[]>([]);

  useEffect(() => {
    let vivo = true;
    const mirar = async () => {
      try {
        const r = await fetch('/api/avisos-pedidos', { cache: 'no-store' });
        if (r.ok && vivo) setProblemas(((await r.json())?.problemas ?? []) as Problema[]);
      } catch { /* sin red: se vuelve a mirar */ }
    };
    mirar();
    const t = setInterval(mirar, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (!problemas.length) return null;
  return (
    <div role="alert" className="sticky top-0 z-[60] w-full bg-marca px-4 py-3 text-white shadow-md" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-1.5">
        {problemas.slice(0, 3).map((p) => (
          <p key={p.pedidoId} className="min-w-0 break-words text-sm leading-snug">
            <span className="font-bold">
              {p.problema === 'no_salio' ? `El aviso del pedido ${p.codigo} NO SALIÓ a administración` : `El aviso del pedido ${p.codigo} no le llegó a administración`}
            </span>{' '}
            (hace {p.minutos} min). Avisen al local por otro medio: el pedido está para preparar.
            {p.motivo ? <span className="block text-white/80">{p.motivo}</span> : null}
          </p>
        ))}
        {problemas.length > 3 && <p className="text-sm text-white/90">Y {problemas.length - 3} pedido(s) más.</p>}
        <Link href="/pedidos" className="self-start rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Ver pedidos</Link>
      </div>
    </div>
  );
}
