'use client';

import { useCallback, useEffect, useState } from 'react';

// RESPONDE — UNA sola pantalla (1/10/2026). Leandro: "hay dos RESPONDE que no
// van, uno solo tiene las conversaciones reales; confunden". Es la app RESPONDE
// con la línea REAL de WhatsApp: contestar, pausar o devolver al bot, fotos,
// notas, programados y difusión. Antes esta página sumaba otra bandeja que
// mezclaba las charlas del simulador con las de clientes y un segundo
// simulador; probar el bot es "Probar el bot" (/bot) y las campañas por listas,
// "Difusiones" (/bandeja). Lo único que la app no tiene es apagar la línea
// entera, y va arriba: es una de las formas de frenar el bot.
export function RespondeWorkspace({ tokenResponde }: { tokenResponde?: string | null }) {
  const [linea, setLinea] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/responde?recurso=linea&linea=pedidos', { cache: 'no-store' });
      if (r.ok) setLinea(await r.json());
    } catch { /* sin red: mantiene lo que hay */ }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 15000); return () => clearInterval(t); }, [cargar]);

  async function botLinea(activo: boolean) {
    if (ocupado) return;
    if (!activo && !window.confirm('¿Pausar RESPONDE en TODAS las conversaciones? Nadie recibe respuesta automática hasta que lo vuelvas a encender.')) return;
    setOcupado(true);
    try {
      await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'botLinea', linea: 'pedidos', activo }) });
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  const pausada = linea?.bot_activo === false;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-black px-4 py-3 text-[#F0EBE2]">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#C9A96E] font-bold">Línea de WhatsApp</p>
          <p className="truncate text-sm font-bold">
            {linea?.numero_legible ?? '11 2281-2200'}
            {linea && (
              <span className={`ml-2 text-[11px] font-bold uppercase ${pausada ? 'text-amber-300' : 'text-emerald-400'}`}>
                {pausada ? '● Pausado en todas' : '● Atendiendo'}
              </span>
            )}
          </p>
        </div>
        <button onClick={() => botLinea(pausada)} disabled={ocupado || !linea}
          className="shrink-0 rounded-full border border-white/25 px-3 py-1 text-xs text-white/85 disabled:opacity-40">
          {pausada ? 'Encender en todas' : 'Pausar en todas'}
        </button>
      </div>
      <div className="rounded-xl overflow-hidden bg-white border border-black/10">
        {/* embed + token del tenant: entra derecho, sin pedir clave (el mismo
            camino que usa /whatsapp, la versión a pantalla completa) */}
        <iframe
          src={tokenResponde ? `/responde-app.html?embed=1&token=${encodeURIComponent(tokenResponde)}` : '/responde-app.html'}
          title="RESPONDE · MetoGroup"
          className="w-full border-0"
          style={{ height: 'calc(100vh - 210px)', minHeight: 520 }}
        />
      </div>
    </div>
  );
}
