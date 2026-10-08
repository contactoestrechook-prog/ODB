'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Boton } from './kit';
import { FOCO, unir } from './kit/clases';
import { Dictado } from './Dictado';

// ============================================================
// EL ASISTENTE DE LA FACTURA (8/10/2026). Pedido de Leandro: «que tengan un
// chat con IA; si algo está tomando mal la cuenta, que le pueda escribir ahí,
// que entienda la lógica y le modifique todo».
//
// Tres pestañas: el chat (la IA mira la tabla y el papel y corrige celdas),
// los cambios (quién cambió qué y cuándo, cada uno se puede deshacer) y las
// reglas del proveedor (lo que se le explicó una vez y vale para las próximas
// facturas). El chat no aplica nada por su cuenta: devuelve cambios y la
// pantalla de compras los aplica y los anota.
// ============================================================

export type CambioHecho = {
  id: string;
  quien: string; // 'IA' o el nombre de la persona
  cuando: string; // ISO
  renglon: number | null; // null = el pie
  campo: string;
  antes: unknown;
  despues: unknown;
  motivo: string;
  deshecho?: boolean;
};

type Mensaje = { rol: 'usuario' | 'ia'; texto: string; cambios?: string[] };
type Regla = { id: string; regla: string; creadaEn: string; autor: string | null };

const NOMBRE_CAMPO: Record<string, string> = {
  bultos: 'bultos', uxb: 'unidades por bulto', sueltas: 'sueltas', precio: 'precio unitario', desc: '% de descuento', iva: 'IVA',
  importe: 'importe', entraComo: 'cómo entra', noAplicar: 'descuento sin aplicar',
  neto: 'neto', percepcionIva: 'percepción IVA', percepcionIibb: 'percepción IIBB', impuestosInternos: 'impuestos internos', otros: 'otros', total: 'total',
};
const valorLegible = (v: unknown) => (v == null || v === '' ? 'vacío' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 3 }) : v === true ? 'sí' : v === false ? 'no' : String(v));
const ENTRA: Record<string, string> = { unidades: 'en unidades', cajas: 'en cajas', abiertas: 'abriendo la caja' };
const legible = (campo: string, v: unknown) => (campo === 'entraComo' ? (v == null ? 'por decidir' : ENTRA[String(v)] ?? String(v)) : valorLegible(v));
export const describirCambio = (c: Pick<CambioHecho, 'renglon' | 'campo' | 'antes' | 'despues'>) =>
  `${c.renglon == null ? 'Pie' : `Renglón ${c.renglon}`} · ${NOMBRE_CAMPO[c.campo] ?? c.campo}: ${legible(c.campo, c.antes)} → ${legible(c.campo, c.despues)}`;

const ERRORES: Record<number, string> = { 401: 'Se venció la sesión: volvé a entrar.', 403: 'Tu usuario no puede usar el asistente.' };

export type PropsAsistente = {
  lecturaId: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  comprobante: unknown;
  /** la tabla como la lee la IA (lib/tabla-factura → tablaParaIA) */
  tabla: () => unknown[];
  pie: unknown;
  controles: unknown;
  /** aplica lo que devolvió la IA; devuelve cuántos cambios aplicó y su descripción */
  onAplicar: (cambios: any[], cambiosPie: any[]) => { aplicados: string[] };
  cambios: CambioHecho[];
  onDeshacer: (c: CambioHecho) => void;
  sugerencias?: string[];
};

export function AsistenteFactura({ lecturaId, proveedorId, proveedorNombre, comprobante, tabla, pie, controles, onAplicar, cambios, onDeshacer, sugerencias = [] }: PropsAsistente) {
  const [vista, setVista] = useState<'chat' | 'cambios' | 'reglas'>('chat');
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // las reglas con el proveedor al que pertenecen: si se cambia el proveedor no se ven las del anterior
  const [reglasDe, setReglasDe] = useState<{ pid: string | null; lista: Regla[] }>({ pid: null, lista: [] });
  const reglas = proveedorId && reglasDe.pid === proveedorId ? reglasDe.lista : [];
  const [propuesta, setPropuesta] = useState<string | null>(null);
  const [guardandoRegla, setGuardandoRegla] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  const cargarReglas = useCallback(async () => {
    if (!proveedorId) return;
    try {
      const r = await fetch(`/api/entrada-foto?reglas=${encodeURIComponent(proveedorId)}`, { cache: 'no-store' });
      if (r.ok) { const lista = await r.json(); setReglasDe({ pid: proveedorId, lista: Array.isArray(lista) ? lista : [] }); }
    } catch { /* sin red: quedan las que había */ }
  }, [proveedorId]);
  useEffect(() => { cargarReglas(); }, [cargarReglas]);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'nearest' }); }, [mensajes, pensando]);
  useEffect(() => {
    if (!pensando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pensando]);

  async function enviar(frase?: string) {
    const t = (frase ?? texto).trim();
    if (!t || pensando) return;
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: t }];
    setMensajes(nuevos);
    setTexto('');
    setError(null);
    setPropuesta(null);
    setSegundos(0);
    setPensando(true);
    try {
      const r = await fetch('/api/entrada-foto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'chat', id: lecturaId ?? 'sin-lectura', proveedorId, proveedor: proveedorNombre, comprobante,
          tabla: tabla(), pie, controles,
          mensajes: nuevos.map((m) => ({ rol: m.rol, texto: m.texto })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(ERRORES[r.status] ?? d?.message ?? 'El asistente no pudo contestar. Probá de nuevo.');
      const { aplicados } = onAplicar(d.cambios ?? [], d.cambiosPie ?? []);
      setMensajes((xs) => [...xs, { rol: 'ia', texto: String(d.respuesta ?? 'Listo.'), cambios: aplicados }]);
      if (d.reglaProveedor && proveedorId) setPropuesta(String(d.reglaProveedor));
    } catch (e: any) {
      setError(e?.message ?? 'El asistente no pudo contestar. Probá de nuevo.');
      // el mensaje vuelve a la caja para no tener que escribirlo de nuevo
      setMensajes((xs) => xs.slice(0, -1));
      setTexto(t);
    } finally {
      setPensando(false);
    }
  }

  async function guardarRegla(regla: string) {
    if (!proveedorId) return;
    setGuardandoRegla(true);
    try {
      const r = await fetch('/api/entrada-foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'regla', proveedorId, regla }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? 'No se pudo guardar la regla');
      setPropuesta(null);
      await cargarReglas();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar la regla');
    } finally {
      setGuardandoRegla(false);
    }
  }

  async function quitarRegla(id: string) {
    await fetch('/api/entrada-foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'quitarRegla', id }) }).catch(() => null);
    await cargarReglas();
  }

  const vigentes = cambios.filter((c) => !c.deshecho).length;
  const pestana = (id: typeof vista, rotulo: string, extra?: number) => (
    <button
      type="button" role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
      className={unir('min-h-9 rounded-full px-3 text-sm font-medium', vista === id ? 'bg-tinta text-white' : 'text-tinta/70 hover:bg-crema-claro', FOCO)}
    >
      {rotulo}{extra ? <span className={unir('ml-1.5 rounded-full px-1.5 text-xs', vista === id ? 'bg-white/20' : 'bg-crema-hondo')}>{extra}</span> : null}
    </button>
  );

  return (
    <section aria-label="Asistente de la factura" className="rounded-2xl border border-black/[0.06] bg-white">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-black/[0.06] p-2">
        {pestana('chat', 'Preguntale a la IA')}
        {pestana('cambios', 'Cambios', vigentes)}
        {pestana('reglas', proveedorNombre ? `Reglas de ${proveedorNombre.split(' ')[0]}` : 'Reglas del proveedor', reglas.length)}
      </div>

      {vista === 'chat' && (
        <div className="space-y-3 p-3">
          <div className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
            {!mensajes.length && (
              <p className="text-sm text-tinta/70">
                Si algo está mal leído o una cuenta no te da, escribilo como se lo dirías a un compañero. La IA mira el papel y la tabla, corrige las celdas y te dice qué cambió. Todo queda en «Cambios» y se puede deshacer.
              </p>
            )}
            {mensajes.map((m, k) => (
              <div key={k} className={unir('max-w-[92%] rounded-2xl px-3 py-2 text-sm', m.rol === 'usuario' ? 'ml-auto bg-tinta text-white' : 'bg-info-suave text-tinta')}>
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                {m.cambios?.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-info">{m.cambios.map((c, j) => <li key={j}>{c}</li>)}</ul>
                ) : null}
              </div>
            ))}
            {pensando && <p className="text-sm text-tinta/60">Mirando la factura… {segundos > 3 ? `${segundos} s` : ''}</p>}
            <div ref={fin} />
          </div>

          {propuesta && (
            <div className="rounded-xl bg-atencion-suave p-3 text-sm text-atencion">
              <p className="font-semibold">¿La guardo para las próximas facturas de {proveedorNombre ?? 'este proveedor'}?</p>
              <p className="mt-1 text-tinta">{propuesta}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Boton tamano="chico" onClick={() => guardarRegla(propuesta)} disabled={guardandoRegla}>{guardandoRegla ? 'Guardando…' : 'Guardar la regla'}</Boton>
                <Boton tamano="chico" variante="secundario" onClick={() => setPropuesta(null)}>No</Boton>
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded-xl bg-marca-suave p-3 text-sm text-marca-hondo">{error}</p>}

          {!mensajes.length && sugerencias.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sugerencias.map((s) => (
                <button key={s} type="button" onClick={() => enviar(s)} disabled={pensando}
                  className={unir('min-h-9 rounded-full border border-dashed border-info px-3 text-left text-xs text-info hover:bg-info-suave', FOCO)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <textarea
              value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              placeholder="Ej.: el renglón 3 tiene 5% de descuento · las tiritas vienen 12 por bulto · ¿por qué no cierra el IVA?"
              aria-label="Mensaje para la IA"
              className={unir('w-full rounded-xl border border-black/15 bg-crema-claro px-3 py-2 text-sm text-tinta', FOCO)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Boton tamano="chico" onClick={() => enviar()} disabled={pensando || !texto.trim()}>{pensando ? 'Pensando…' : 'Enviar'}</Boton>
              <Dictado onTexto={(t) => setTexto((v) => (v ? v + ' ' : '') + t)} />
            </div>
          </div>
        </div>
      )}

      {vista === 'cambios' && (
        <div className="space-y-2 p-3">
          {!cambios.length && <p className="text-sm text-tinta/70">Todavía no hay cambios. Cada cambio, tuyo o de la IA, queda acá con la hora y se puede deshacer. Al registrar la factura queda guardado quién cambió qué.</p>}
          {cambios.map((c) => (
            <div key={c.id} className={unir('grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-xl bg-crema-claro px-3 py-2 text-sm', c.deshecho && 'opacity-60')}>
              <span className={unir('font-semibold', c.quien === 'IA' ? 'text-info' : 'text-tinta')}>{c.quien}</span>
              <div className="min-w-0">
                <p className="break-words text-tinta">{describirCambio(c)}</p>
                {c.motivo && <p className="break-words text-xs text-tinta/70">{c.motivo}</p>}
                <p className="text-xs text-tinta/60">{new Date(c.cuando).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}{c.deshecho ? ' · deshecho' : ''}</p>
              </div>
              {!c.deshecho && <Boton tamano="chico" variante="secundario" onClick={() => onDeshacer(c)}>Deshacer</Boton>}
            </div>
          ))}
        </div>
      )}

      {vista === 'reglas' && (
        <div className="space-y-2 p-3">
          <p className="text-sm text-tinta/70">Lo que se le explicó a la IA sobre {proveedorNombre ?? 'este proveedor'} y vale para sus próximas facturas. Se agregan desde el chat.</p>
          {!proveedorId && <p className="text-sm text-atencion">Elegí el proveedor para ver sus reglas.</p>}
          {reglas.map((r) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl bg-crema-claro px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="break-words text-tinta">{r.regla}</p>
                <p className="text-xs text-tinta/60">{r.autor ?? 'Alguien del equipo'} · {new Date(r.creadaEn).toLocaleDateString('es-AR')}</p>
              </div>
              <Boton tamano="chico" variante="fantasma" onClick={() => quitarRegla(r.id)}>Quitar</Boton>
            </div>
          ))}
          {proveedorId && !reglas.length && <p className="text-sm text-tinta/60">Todavía no hay reglas para este proveedor.</p>}
        </div>
      )}
    </section>
  );
}
