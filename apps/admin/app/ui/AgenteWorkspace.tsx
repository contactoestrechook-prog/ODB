'use client';

import { useState } from 'react';

const fechaHora = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const ESTADO: Record<string, { label: string; chip: string }> = {
  pendiente: { label: 'Pendiente', chip: 'bg-black/10 text-black/60' },
  procesando: { label: 'Procesando', chip: 'bg-sky-100 text-sky-900' },
  completada: { label: 'Completada', chip: 'bg-emerald-100 text-emerald-900' },
  escalada: { label: 'Escalada', chip: 'bg-amber-100 text-amber-900' },
  error: { label: 'Error', chip: 'bg-[#B82D25]/10 text-[#932A1F]' },
};

export function AgenteWorkspace({ resumenInicial, tareasIniciales }: { resumenInicial: any; tareasIniciales: any[] }) {
  const [resumen, setResumen] = useState(resumenInicial ?? {});
  const [tareas, setTareas] = useState<any[]>(tareasIniciales ?? []);
  const [desc, setDesc] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<any | null>(null);
  const [auditoria, setAuditoria] = useState<any[]>([]);

  const recargar = async () => {
    const [r, t] = await Promise.all([
      fetch('/api/agente?recurso=resumen').then((x) => x.json()),
      fetch('/api/agente?recurso=tareas').then((x) => x.json()),
    ]);
    setResumen(r); setTareas(Array.isArray(t) ? t : []);
  };

  const post = async (body: any, label: string) => {
    setOcupado(label); setAviso(null);
    try {
      const r = await fetch('/api/agente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      if (body.accion === 'encolar') { setDesc(''); setAviso('Tarea encolada.'); }
      if (body.accion === 'procesar') setAviso(`Procesadas ${r.procesadas ?? 0} tareas.`);
      if (body.accion === 'barrido') setAviso(`Barrido: ${r.encoladas ?? 0} tareas encoladas.`);
      if (body.accion === 'enriquecer') setAviso(`Enriquecidos ${r.aplicados ?? 0} productos · ${r.escalados ?? 0} a revisión (de ${r.procesados ?? 0}).`);
      if (body.accion === 'fotos') setAviso(`Fotos: ${r.subidos ?? 0} subidas · ${r.rechazadas_calidad ?? 0} rechazadas por calidad · ${r.sin_resultado ?? 0} sin resultado (de ${r.procesados ?? 0}).`);
      if (body.accion === 'ejecutar') setAviso(`Tarea ${r.estado ?? ''}${r.escalado ? ' · ' + r.escalado : ''}.`);
      await recargar();
    } catch { setAviso('No se pudo ejecutar la acción.'); }
    finally { setOcupado(null); }
  };

  const verAuditoria = async (t: any) => {
    setAbierta(t);
    const a = await fetch(`/api/agente?auditoria=${t.id}`).then((x) => x.json());
    setAuditoria(Array.isArray(a) ? a : []);
  };

  const KPIS = [
    { label: 'Pendientes', valor: resumen.pendientes ?? 0 },
    { label: 'Escaladas a humano', valor: resumen.escaladas ?? 0, alerta: (resumen.escaladas ?? 0) > 0 },
    { label: 'Completadas', valor: resumen.completadas ?? 0 },
    { label: 'Con error', valor: resumen.errores ?? 0, alerta: (resumen.errores ?? 0) > 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS.map((k) => (
          <div key={k.label} className="rounded-xl bg-white p-4 border border-black/[0.04]">
            <p className={`text-2xl font-semibold ${k.alerta ? 'text-[#B82D25]' : 'text-black'}`}>{k.valor}</p>
            <p className="text-[11px] text-black/45 mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* encolar + acciones */}
      <section className="rounded-xl bg-white p-4 border border-black/[0.04] space-y-3">
        <p className="text-sm font-medium text-black">Darle una tarea al agente</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder='Ej: "Cargá Vino Trapiche Reserva Malbec 750ml a $4.500, categoría Vinos Tintos"'
            className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm" />
          <button onClick={() => desc.trim() && post({ accion: 'encolar', descripcion: desc }, 'encolar')} disabled={!!ocupado || !desc.trim()}
            className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-[#9e251e]">Encolar</button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => post({ accion: 'procesar', limite: 5 }, 'procesar')} disabled={!!ocupado}
            className="rounded-lg bg-black text-white text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-black/80">
            {ocupado === 'procesar' ? 'Procesando…' : 'Procesar pendientes'}
          </button>
          <button onClick={() => post({ accion: 'barrido', limite: 10 }, 'barrido')} disabled={!!ocupado}
            className="rounded-lg bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-black/5">
            {ocupado === 'barrido' ? 'Barriendo…' : 'Barrido de mantenimiento'}
          </button>
          <button onClick={() => post({ accion: 'enriquecer', limite: 50 }, 'enriquecer')} disabled={!!ocupado}
            className="rounded-lg bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-black/5">
            {ocupado === 'enriquecer' ? 'Enriqueciendo…' : 'Enriquecer catálogo (50)'}
          </button>
          <button onClick={() => post({ accion: 'fotos', limite: 60 }, 'fotos')} disabled={!!ocupado}
            className="rounded-lg bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-black/5">
            {ocupado === 'fotos' ? 'Buscando fotos…' : 'Buscar fotos por código de barra (60)'}
          </button>
          {aviso && <span className="text-sm text-black/55 self-center">{aviso}</span>}
        </div>
        <p className="text-[11px] text-black/40">El agente actúa solo en lo de bajo riesgo y escala a un humano cuando duda. Cada acción queda auditada. Las fotos salen de Open Food Facts (base pública, gratuita, por código de barra) y pasan un control de calidad con IA antes de subirse (rechaza fotos con gente, fondo de la calle o mala composición) — cubre ~30% del catálogo antes del filtro, más en marcas grandes. El resto necesita foto manual o pack del proveedor.</p>
      </section>

      {/* tareas */}
      <section className="rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-black/10 text-sm font-medium text-black">Tareas ({tareas.length})</div>
        {tareas.length === 0 && <p className="px-4 py-8 text-center text-black/40 text-sm">No hay tareas. Encolá una o corré el barrido.</p>}
        {tareas.map((t) => (
          <div key={t.id} className="px-4 py-3 border-b border-black/5 last:border-0 flex items-start gap-3">
            <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 shrink-0 mt-0.5 ${ESTADO[t.estado]?.chip ?? ''}`}>{ESTADO[t.estado]?.label ?? t.estado}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-black">{t.descripcion}</p>
              <p className="text-[11px] text-black/40 mt-0.5">
                #{t.id} · {t.tipo} · {fechaHora(t.creado_en)}
                {t.resultado && <span className="text-black/55"> · {t.resultado}</span>}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => verAuditoria(t)} className="text-xs rounded-md text-black/50 px-2 py-1 hover:bg-black/5">Auditoría</button>
              {t.estado === 'pendiente' && <button onClick={() => post({ accion: 'ejecutar', id: t.id }, 'ejecutar')} disabled={!!ocupado} className="text-xs rounded-md bg-sky-50 text-sky-800 px-2 py-1 hover:bg-sky-100">Ejecutar</button>}
              {t.estado === 'escalada' && <button onClick={() => post({ accion: 'resolver', id: t.id }, 'resolver')} disabled={!!ocupado} className="text-xs rounded-md bg-amber-50 text-amber-800 px-2 py-1 hover:bg-amber-100">Resolver</button>}
            </div>
          </div>
        ))}
      </section>

      {/* modal auditoría */}
      {abierta && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setAbierta(null)}>
          <div className="bg-[#F7F4EE] rounded-2xl w-full max-w-xl my-12 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
              <h2 className="font-semibold text-black text-sm">Auditoría · tarea #{abierta.id}</h2>
              <button onClick={() => setAbierta(null)} className="text-black/40 hover:text-black text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-2">
              <p className="text-sm text-black/70">{abierta.descripcion}</p>
              {auditoria.length === 0 && <p className="text-sm text-black/40">Sin acciones registradas.</p>}
              {auditoria.map((a) => (
                <div key={a.id} className="rounded-lg bg-white border border-black/10 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-black">{a.herramienta}</span>
                    <span className={`text-[10px] ${a.ok ? 'text-emerald-700' : 'text-[#B82D25]'}`}>{a.ok ? 'ok' : 'error'}</span>
                  </div>
                  <pre className="text-[10px] text-black/50 mt-1 whitespace-pre-wrap break-words">{JSON.stringify(a.argumentos)} → {JSON.stringify(a.resultado)}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
