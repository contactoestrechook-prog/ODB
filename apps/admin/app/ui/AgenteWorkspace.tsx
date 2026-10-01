'use client';

import { useState } from 'react';
import { fechaHora as fechaHoraFmt } from '../lib/formato';
import { Aviso, Boton, Entrada, Etiqueta, Kpi, Modal, Tarjeta, TarjetaCabecera, type TonoEtiqueta } from './kit';

const fechaHora = (s: string) => fechaHoraFmt(s);

const ESTADO: Record<string, { label: string; tono: TonoEtiqueta }> = {
  pendiente: { label: 'Pendiente', tono: 'neutro' },
  procesando: { label: 'Procesando', tono: 'info' },
  completada: { label: 'Completada', tono: 'ok' },
  escalada: { label: 'Escalada', tono: 'atencion' },
  error: { label: 'Error', tono: 'error' },
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
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Kpi key={k.label} etiqueta={<span className="whitespace-normal">{k.label}</span>} valor={k.valor} tono={k.alerta ? 'error' : 'neutro'} />
        ))}
      </div>

      {/* encolar + acciones */}
      <Tarjeta className="space-y-3">
        <h2 className="text-base font-semibold text-tinta">Darle una tarea al agente</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Entrada value={desc} onChange={(e) => setDesc(e.target.value)} placeholder='Ej: "Cargá Vino Trapiche Reserva Malbec 750ml a $4.500, categoría Vinos Tintos"'
            aria-label="Tarea para el agente" className="min-w-0 flex-1" />
          <Boton onClick={() => desc.trim() && post({ accion: 'encolar', descripcion: desc }, 'encolar')} disabled={!!ocupado || !desc.trim()}
            cargando={ocupado === 'encolar'}>Encolar</Boton>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Boton variante="secundario" onClick={() => post({ accion: 'procesar', limite: 5 }, 'procesar')} disabled={!!ocupado} cargando={ocupado === 'procesar'}>
            {ocupado === 'procesar' ? 'Procesando…' : 'Procesar pendientes'}
          </Boton>
          <Boton variante="secundario" onClick={() => post({ accion: 'barrido', limite: 10 }, 'barrido')} disabled={!!ocupado} cargando={ocupado === 'barrido'}>
            {ocupado === 'barrido' ? 'Barriendo…' : 'Barrido de mantenimiento'}
          </Boton>
          <Boton variante="secundario" onClick={() => post({ accion: 'enriquecer', limite: 50 }, 'enriquecer')} disabled={!!ocupado} cargando={ocupado === 'enriquecer'}>
            {ocupado === 'enriquecer' ? 'Enriqueciendo…' : 'Enriquecer catálogo (50)'}
          </Boton>
          <Boton variante="secundario" onClick={() => post({ accion: 'fotos', limite: 60 }, 'fotos')} disabled={!!ocupado} cargando={ocupado === 'fotos'}>
            {ocupado === 'fotos' ? 'Buscando fotos…' : 'Buscar fotos por código de barra (60)'}
          </Boton>
        </div>
        {aviso && <Aviso tono="neutro">{aviso}</Aviso>}
        <p className="text-xs leading-relaxed text-tinta/60">El agente actúa solo en lo de bajo riesgo y escala a un humano cuando duda. Cada acción queda auditada. Las fotos salen de Open Food Facts (base pública, gratuita, por código de barra) y pasan un control de calidad con IA antes de subirse (rechaza fotos con gente, fondo de la calle o mala composición) — cubre ~30% del catálogo antes del filtro, más en marcas grandes. El resto necesita foto manual o pack del proveedor.</p>
      </Tarjeta>

      {/* tareas */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Tareas (${tareas.length})`} />
        {tareas.length === 0 && <p className="px-4 py-8 text-center text-sm text-tinta/60">No hay tareas. Encolá una o corré el barrido.</p>}
        <div className="divide-y divide-black/[0.06]">
          {tareas.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3 sm:px-5">
              <Etiqueta tono={ESTADO[t.estado]?.tono ?? 'neutro'} className="shrink-0 self-start sm:mt-0.5">{ESTADO[t.estado]?.label ?? t.estado}</Etiqueta>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-tinta">{t.descripcion}</p>
                <p className="mt-0.5 break-words text-xs text-tinta/60">
                  #{t.id} · {t.tipo} · {fechaHora(t.creado_en)}
                  {t.resultado && <span className="text-tinta/70"> · {t.resultado}</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Boton variante="fantasma" tamano="chico" onClick={() => verAuditoria(t)}>Auditoría</Boton>
                {t.estado === 'pendiente' && <Boton variante="secundario" tamano="chico" onClick={() => post({ accion: 'ejecutar', id: t.id }, 'ejecutar')} disabled={!!ocupado}>Ejecutar</Boton>}
                {t.estado === 'escalada' && <Boton variante="secundario" tamano="chico" onClick={() => post({ accion: 'resolver', id: t.id }, 'resolver')} disabled={!!ocupado}>Resolver</Boton>}
              </div>
            </div>
          ))}
        </div>
      </Tarjeta>

      {/* modal auditoría */}
      <Modal
        abierto={!!abierta}
        onCerrar={() => setAbierta(null)}
        titulo={`Auditoría · tarea #${abierta?.id ?? ''}`}
        descripcion={abierta?.descripcion}
        ancho="normal"
      >
        <div className="space-y-2">
          {auditoria.length === 0 && <p className="text-sm text-tinta/60">Sin acciones registradas.</p>}
          {auditoria.map((a) => (
            <div key={a.id} className="rounded-xl border border-black/[0.06] bg-crema-claro p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs text-tinta">{a.herramienta}</span>
                <Etiqueta tono={a.ok ? 'ok' : 'error'} className="shrink-0">{a.ok ? 'ok' : 'error'}</Etiqueta>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-tinta/70 [overflow-wrap:anywhere]">{JSON.stringify(a.argumentos)} → {JSON.stringify(a.resultado)}</pre>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
