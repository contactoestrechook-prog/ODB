'use client';

import { useEffect, useState } from 'react';

// Indicador del bridge legacy → Supabase (módulo 2): última corrida y frescura.
export function SyncEstado() {
  const [d, setD] = useState<any>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    fetch('/api/sync-estado').then((r) => r.json()).then(setD).catch(() => {}).finally(() => setCargado(true));
  }, []);

  if (!cargado) return null;
  const u = d?.ultima ?? null;

  // minutos desde la última corrida
  const min = u ? Math.round((Date.now() - new Date(u.corrida_en).getTime()) / 60000) : null;
  const haceTxt = min == null ? '—' : min < 1 ? 'recién' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`;
  // verde si corrió OK hace < 30 min; ámbar si es vieja; rojo si falló o nunca corrió
  const estado = !u ? 'rojo' : !u.ok ? 'rojo' : min != null && min <= 30 ? 'verde' : 'ambar';
  const dot = estado === 'verde' ? 'bg-emerald-500' : estado === 'ambar' ? 'bg-amber-500' : 'bg-[#B82D25]';

  return (
    <div className="rounded-xl bg-white p-4 border border-black/[0.04] flex items-center gap-3">
      <span className={`w-2.5 h-2.5 rounded-full ${dot} shrink-0`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-black">Sincronización con el sistema viejo</p>
        <p className="text-[11px] text-black/45 mt-0.5">
          {!u ? 'Sin corridas todavía — instalá el bridge en la PC de ODB' : (
            <>
              {u.ok ? 'Última' : 'Con error'} {haceTxt} · {u.productos_leidos?.toLocaleString('es-AR')} productos
              {u.productos_actualizados > 0 ? ` · ${u.productos_actualizados} actualizados` : ' · sin cambios'}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
