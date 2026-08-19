'use client';

import { useEffect, useState } from 'react';

// La campanita: avisos internos que el sistema le deja a cada persona. Hoy los
// genera el bot de WhatsApp ("escribió tal proveedor ofreciendo esto", "consulta
// de pago"), pero cualquier módulo puede dejar una alerta acá.
type Alerta = { id: string; tipo: string; titulo: string; detalle: string | null; referencia: any; creada_en: string };

const ICONO: Record<string, string> = { proveedor_ofrece: '🚚', pago: '💸', derivacion: '🟡', nota_bot: '📝', bot_caido: '🔴', cambio_factura: '🧾' };
const hace = (v: string) => {
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

export function CampanaAlertas() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch('/api/novedades?que=alertas', { cache: 'no-store' });
        if (r.ok && vivo) setAlertas(await r.json());
      } catch { /* sin red */ }
    };
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  async function leida(a: Alerta) {
    setAlertas((xs) => xs.filter((x) => x.id !== a.id));
    await fetch('/api/novedades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, que: 'alerta' }) }).catch(() => null);
  }

  return (
    <div className="relative">
      <button onClick={() => setAbierta((v) => !v)} title="Avisos" aria-label="Avisos"
        className="relative rounded-lg px-2 py-1 text-lg leading-none text-white/70 hover:text-white">
        🔔
        {alertas.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#E14A3C] px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {alertas.length > 9 ? '9+' : alertas.length}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl bg-white text-black shadow-2xl ring-1 ring-black/10">
          <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
            <p className="text-sm font-semibold">Avisos</p>
            <button onClick={() => setAbierta(false)} className="text-xs text-black/45">cerrar</button>
          </div>
          {alertas.length === 0 && <p className="px-4 py-8 text-center text-sm text-black/45">Nada pendiente.</p>}
          <div className="max-h-[60vh] overflow-y-auto">
            {alertas.map((a) => (
              <div key={a.id} className="border-b border-black/5 px-3 py-2.5 last:border-0">
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none">{ICONO[a.tipo] ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{a.titulo}</p>
                    {a.detalle && <p className="mt-0.5 whitespace-pre-wrap text-xs text-black/65">{a.detalle}</p>}
                    <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                      <span className="text-black/40">{hace(a.creada_en)}</span>
                      {a.referencia?.telefono && (
                        <a href={`/whatsapp`} className="text-[#B82D25] underline">Abrir la charla</a>
                      )}
                      <button onClick={() => leida(a)} className="text-black/45 underline">Listo</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
