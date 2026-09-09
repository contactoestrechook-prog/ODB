'use client';

import { useCallback, useEffect, useState } from 'react';

// La cola de "Esto está mal": lo que el equipo marcó desde las pantallas, con la
// clasificación de la IA y el contexto adjunto. El dueño lo resuelve o descarta;
// quien reportó recibe el aviso en su campanita.
const cuando = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TIPO: Record<string, string> = { sistema: 'Sistema', dato: 'Dato', duda: 'Duda' };

export function ReportesWorkspace({ puedeResolver }: { puedeResolver: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [filtro, setFiltro] = useState<'pendientes' | 'todos'>('pendientes');
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try { const r = await fetch(`/api/reportes?estado=${filtro === 'pendientes' ? 'pendientes' : ''}`, { cache: 'no-store' }); setItems(r.ok ? await r.json() : []); }
    catch { setItems([]); }
    setCargando(false);
  }, [filtro]);
  useEffect(() => { cargar(); }, [cargar]);

  const resolver = async (id: string, estado: 'resuelto' | 'descartado' | 'en_curso') => {
    const r = await fetch('/api/reportes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'resolver', id, respuesta, estado }) });
    if (r.ok) { setRespuesta(''); setAbierto(null); cargar(); }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['pendientes', 'todos'] as const).map((f) => (
          <button key={f} onClick={() => setFiltro(f)} className={'rounded-full px-3 py-1 text-xs font-semibold ' + (filtro === f ? 'bg-black text-white' : 'border border-black/15 bg-white text-black/70')}>{f === 'pendientes' ? 'Pendientes' : 'Todos'}</button>
        ))}
        <span className="ml-auto text-xs text-black/45">{cargando ? 'Cargando…' : `${items.length} reporte${items.length === 1 ? '' : 's'}`}</span>
      </div>
      {!cargando && items.length === 0 && <p className="rounded-xl border border-dashed border-black/15 bg-white p-6 text-center text-sm text-black/50">Nada pendiente. Cuando alguien toque "Esto está mal", aparece acá.</p>}
      <div className="grid gap-3">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl border border-black/10 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-black/50">
              <span className={'rounded-full px-2 py-0.5 font-semibold ' + (it.tipo === 'sistema' ? 'bg-[#B82D25]/10 text-[#932A1F]' : it.tipo === 'dato' ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-black/60')}>{TIPO[it.tipo] ?? it.tipo ?? '—'}</span>
              <span>{it.pantalla || 'Panel'}</span><span>·</span><span>{it.autor?.nombre ?? '?'}</span><span>·</span><span>{cuando(it.creado_en)}</span>
              <span className="ml-auto uppercase tracking-wide">{it.estado}</span>
            </div>
            <p className="mt-2 text-sm text-black">«{it.mensaje}»</p>
            {it.clasificacion?.resumen && <p className="mt-1 text-sm text-black/65"><b>IA:</b> {it.clasificacion.resumen}</p>}
            {Array.isArray(it.clasificacion?.pasos) && it.clasificacion.pasos.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-black/60">{it.clasificacion.pasos.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
            )}
            {it.respuesta_ia && <p className="mt-1 text-xs text-black/45">Le respondió: {it.respuesta_ia}</p>}
            {it.respuesta && <p className="mt-1 text-xs text-emerald-800">Cierre: {it.respuesta}{it.resolvio?.nombre ? ` · ${it.resolvio.nombre}` : ''}</p>}
            <details className="mt-2 text-xs text-black/50"><summary className="cursor-pointer">Contexto adjunto</summary>
              <p className="mt-1 break-all">{it.url}</p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-[11px]">{String(it.contexto?.texto ?? '').slice(0, 2500)}</pre>
            </details>
            {puedeResolver && ['nuevo', 'en_curso'].includes(it.estado) && (
              abierto === it.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Qué se hizo (le llega a quien reportó)" className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => resolver(it.id, 'resuelto')} className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white">Resuelto</button>
                    <button onClick={() => resolver(it.id, 'en_curso')} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs">En curso</button>
                    <button onClick={() => resolver(it.id, 'descartado')} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs text-black/60">Descartar</button>
                    <button onClick={() => setAbierto(null)} className="ml-auto text-xs text-black/45 underline">Cancelar</button>
                  </div>
                </div>
              ) : <button onClick={() => { setAbierto(it.id); setRespuesta(''); }} className="mt-3 rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold">Resolver</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
