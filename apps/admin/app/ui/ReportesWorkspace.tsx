'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boton, Chips, Entrada, Etiqueta, Tarjeta, Vacio, type TonoEtiqueta } from './kit';
import { fechaHora } from '../lib/formato';

// La cola de "Esto está mal": lo que el equipo marcó desde las pantallas, con la
// clasificación de la IA y el contexto adjunto. El dueño lo resuelve o descarta;
// quien reportó recibe el aviso en su campanita.
const TIPO: Record<string, string> = { sistema: 'Sistema', dato: 'Dato', duda: 'Duda' };
const TONO_TIPO: Record<string, TonoEtiqueta> = { sistema: 'error', dato: 'atencion' };

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chips
          etiquetaAccesible="Qué reportes ver"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={(['pendientes', 'todos'] as const).map((f) => ({ valor: f, etiqueta: f === 'pendientes' ? 'Pendientes' : 'Todos' }))}
        />
        <span className="ml-auto text-sm text-tinta/60" role="status">{cargando ? 'Cargando…' : `${items.length} reporte${items.length === 1 ? '' : 's'}`}</span>
      </div>
      {!cargando && items.length === 0 && (
        <Vacio titulo="Nada pendiente." texto={'Cuando alguien toque "Esto está mal", aparece acá.'} />
      )}
      <div className="grid gap-3">
        {items.map((it) => (
          <Tarjeta key={it.id}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta/60">
              <Etiqueta tono={TONO_TIPO[it.tipo] ?? 'neutro'}>{TIPO[it.tipo] ?? it.tipo ?? '—'}</Etiqueta>
              <span className="min-w-0 break-words">{it.pantalla || 'Panel'}</span><span>·</span><span>{it.autor?.nombre ?? '?'}</span><span>·</span><span className="whitespace-nowrap">{fechaHora(it.creado_en)}</span>
              <span className="ml-auto font-semibold uppercase tracking-wide">{it.estado}</span>
            </div>
            <p className="mt-2 break-words text-sm text-tinta">«{it.mensaje}»</p>
            {it.clasificacion?.resumen && <p className="mt-1 text-sm text-tinta/70"><b>IA:</b> {it.clasificacion.resumen}</p>}
            {Array.isArray(it.clasificacion?.pasos) && it.clasificacion.pasos.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-tinta/70">{it.clasificacion.pasos.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
            )}
            {it.respuesta_ia && <p className="mt-1 text-xs text-tinta/60">Le respondió: {it.respuesta_ia}</p>}
            {it.respuesta && <p className="mt-1 text-xs text-ok">Cierre: {it.respuesta}{it.resolvio?.nombre ? ` · ${it.resolvio.nombre}` : ''}</p>}
            <details className="mt-2 text-xs text-tinta/60">
              <summary className="flex min-h-11 cursor-pointer items-center rounded-xl font-medium hover:text-tinta">Contexto adjunto</summary>
              <p className="mt-1 break-all">{it.url}</p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-crema-claro p-2 text-xs">{String(it.contexto?.texto ?? '').slice(0, 2500)}</pre>
            </details>
            {puedeResolver && ['nuevo', 'en_curso'].includes(it.estado) && (
              abierto === it.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <Entrada
                    value={respuesta}
                    onChange={(e) => setRespuesta(e.target.value)}
                    placeholder="Qué se hizo (le llega a quien reportó)"
                    aria-label="Qué se hizo"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Boton tamano="chico" onClick={() => resolver(it.id, 'resuelto')}>Resuelto</Boton>
                    <Boton tamano="chico" variante="secundario" onClick={() => resolver(it.id, 'en_curso')}>En curso</Boton>
                    <Boton tamano="chico" variante="secundario" onClick={() => resolver(it.id, 'descartado')}>Descartar</Boton>
                    <Boton tamano="chico" variante="fantasma" onClick={() => setAbierto(null)} className="ml-auto">Cancelar</Boton>
                  </div>
                </div>
              ) : (
                <Boton tamano="chico" variante="secundario" onClick={() => { setAbierto(it.id); setRespuesta(''); }} className="mt-3">
                  Resolver
                </Boton>
              )
            )}
          </Tarjeta>
        ))}
      </div>
    </div>
  );
}
