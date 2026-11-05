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
//
// 5/11/2026 (La Serenísima: «no aprendió, tuvimos que poner todo otra vez»):
// la regla que sale de la charla se guarda sola (se avisa y se puede deshacer)
// y, al abrir una factura de un proveedor con reglas, se aplican solas.
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

type Mensaje = { rol: 'usuario' | 'ia'; texto: string; cambios?: string[]; noAplicados?: string[] };
type Regla = { id: string; regla: string; creadaEn: string; autor: string | null };

const NOMBRE_CAMPO: Record<string, string> = {
  bultos: 'bultos', uxb: 'unidades por bulto', sueltas: 'sueltas', precio: 'precio unitario', desc: '% de descuento', iva: 'IVA',
  importe: 'importe', entraComo: 'cómo entra', noAplicar: 'descuento sin aplicar', ingresa: 'ingresa al stock',
  llevaInternos: 'paga impuestos internos', impuestoInternoUnitario: 'impuesto interno por unidad', costoFinal: 'costo por unidad',
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
  onAplicar: (cambios: any[], cambiosPie: any[]) => { aplicados: string[]; noAplicados: string[] };
  cambios: CambioHecho[];
  onDeshacer: (c: CambioHecho) => void;
  sugerencias?: string[];
  /** leer la foto otra vez desde cero, con lo que la persona escribió en el chat */
  onReleer?: (aclaraciones: string) => void;
  releyendo?: boolean;
  /** la factura está recién leída, sin cambios de nadie: se le pasan las reglas del proveedor sin que nadie escriba */
  aplicarReglasSolo?: boolean;
};

export function AsistenteFactura({ lecturaId, proveedorId, proveedorNombre, comprobante, tabla, pie, controles, onAplicar, cambios, onDeshacer, sugerencias = [], onReleer, releyendo = false, aplicarReglasSolo = false }: PropsAsistente) {
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
  // la regla que se acaba de aprender sola, para avisar y dejar deshacerla
  const [aprendida, setAprendida] = useState<{ id: string; regla: string } | null>(null);
  const [aplicandoReglas, setAplicandoReglas] = useState(false);
  const yaPasadas = useRef<Set<string>>(new Set());
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

  // LAS REGLAS SE APLICAN SOLAS: factura recién leída + proveedor con reglas →
  // un turno automático, una vez por factura. Lo que cambia queda en «Cambios»
  // como cualquier cambio de la IA y se puede deshacer.
  useEffect(() => {
    if (!aplicarReglasSolo || !lecturaId || !proveedorId || !reglas.length || pensando) return;
    const clave = `${lecturaId}:${proveedorId}`;
    if (yaPasadas.current.has(clave)) return;
    yaPasadas.current.add(clave);
    let vigente = true;
    // un respiro para que la tabla termine de armarse con lo que se leyó
    const t = setTimeout(async () => {
      const filas = tabla();
      if (!vigente || !filas.length) return;
      setAplicandoReglas(true);
      setSegundos(0);
      setPensando(true);
      try {
        const r = await fetch('/api/entrada-foto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'chat', automatico: true, id: lecturaId, proveedorId, proveedor: proveedorNombre, comprobante, tabla: filas, pie, controles, mensajes: [] }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.omitido || !vigente) return;
        const { aplicados, noAplicados } = onAplicar(d.cambios ?? [], d.cambiosPie ?? []);
        const cuantas = reglas.length === 1 ? 'la regla guardada' : `las ${reglas.length} reglas guardadas`;
        setMensajes((xs) => [...xs, { rol: 'ia', texto: `Apliqué ${cuantas} de ${proveedorNombre ?? 'este proveedor'}. ${String(d.respuesta ?? '')}`.trim(), cambios: aplicados, noAplicados }]);
      } catch { /* si falla, la factura queda como se leyó y las reglas siguen en su pestaña */ }
      finally { setPensando(false); setAplicandoReglas(false); }
    }, 900);
    return () => { vigente = false; clearTimeout(t); };
  }, [aplicarReglasSolo, lecturaId, proveedorId, reglas.length]); // eslint-disable-line react-hooks/exhaustive-deps
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
    setAprendida(null);
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
      const { aplicados, noAplicados } = onAplicar(d.cambios ?? [], d.cambiosPie ?? []);
      // lo que la IA propuso y no se pudo aplicar, a la vista (antes se perdía en silencio)
      const delServidor = (Array.isArray(d.descartados) ? d.descartados : [])
        .map((x: any) => `${x.renglon ? `Renglón ${x.renglon}` : 'Cambio'} · ${NOMBRE_CAMPO[x.campo] ?? x.campo}: ${x.porque}`);
      setMensajes((xs) => [...xs, { rol: 'ia', texto: String(d.respuesta ?? 'Listo.'), cambios: aplicados, noAplicados: [...delServidor, ...noAplicados] }]);
      if (d.reglaGuardada?.id) { setAprendida({ id: String(d.reglaGuardada.id), regla: String(d.reglaGuardada.regla ?? '') }); cargarReglas(); }
      // si no se pudo guardar sola, queda la propuesta con su botón
      else if (d.reglaProveedor && proveedorId && !reglas.some((x) => x.regla === d.reglaProveedor)) setPropuesta(String(d.reglaProveedor));
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
        {pestana('chat', 'Decile a la IA')}
        {pestana('cambios', 'Cambios', vigentes)}
        {pestana('reglas', proveedorNombre ? `Reglas de ${proveedorNombre.split(' ')[0]}` : 'Reglas del proveedor', reglas.length)}
      </div>

      {vista === 'chat' && (
        <div className="space-y-3 p-3">
          <div className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
            {!mensajes.length && (
              <p className="text-sm text-tinta/70">
                Decile qué está mal o qué hay que cambiar, como se lo dirías a un compañero: un descuento, cuántas trae el bulto, lo que no llegó, un precio. La IA lo cambia en la factura y te dice qué tocó. Todo queda en «Cambios» y se puede deshacer.
              </p>
            )}
            {mensajes.map((m, k) => (
              <div key={k} className={unir('max-w-[92%] rounded-2xl px-3 py-2 text-sm', m.rol === 'usuario' ? 'ml-auto bg-tinta text-white' : 'bg-info-suave text-tinta')}>
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                {m.cambios?.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-info">{m.cambios.map((c, j) => <li key={j}>{c}</li>)}</ul>
                ) : null}
                {m.noAplicados?.length ? (
                  <div className="mt-1.5 rounded-lg bg-atencion-suave px-2 py-1 text-xs text-atencion">
                    <p className="font-semibold">No se aplicó:</p>
                    <ul className="space-y-0.5">{m.noAplicados.map((c, j) => <li key={j}>{c}</li>)}</ul>
                  </div>
                ) : null}
              </div>
            ))}
            {pensando && <p className="text-sm text-tinta/60">{aplicandoReglas ? `Aplicando lo que ya se explicó de ${proveedorNombre ?? 'este proveedor'}…` : 'Mirando la factura…'} {segundos > 3 ? `${segundos} s` : ''}</p>}
            <div ref={fin} />
          </div>

          {aprendida && (
            <div className="rounded-xl bg-info-suave p-3 text-sm text-tinta">
              <p className="font-semibold text-info">Aprendido para las próximas facturas de {proveedorNombre ?? 'este proveedor'}</p>
              <p className="mt-1">{aprendida.regla}</p>
              <div className="mt-2">
                <Boton tamano="chico" variante="secundario" onClick={async () => { const id = aprendida.id; setAprendida(null); await quitarRegla(id); }}>No, no la guardes</Boton>
              </div>
            </div>
          )}
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
              aria-label="Mensaje para la IA"
              className={unir('w-full rounded-xl border border-black/15 bg-crema-claro px-3 py-2 text-sm text-tinta', FOCO)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Boton tamano="chico" onClick={() => enviar()} disabled={pensando || !texto.trim()}>{pensando ? 'Pensando…' : 'Enviar'}</Boton>
              <Dictado onTexto={(t) => setTexto((v) => (v ? v + ' ' : '') + t)} />
              {/* la lectura entera salió mal (columnas corridas, otra hoja): se lee de nuevo
                  con todo lo que la persona ya explicó acá. Pisa los cambios hechos. */}
              {onReleer && (
                <button
                  type="button" disabled={pensando || releyendo}
                  onClick={() => onReleer([...mensajes.filter((m) => m.rol === 'usuario').map((m) => m.texto), texto.trim()].filter(Boolean).join('\n'))}
                  className={unir('ml-auto min-h-9 rounded-full px-2 text-xs text-tinta/60 underline underline-offset-2 hover:text-tinta disabled:opacity-50', FOCO)}
                >
                  {releyendo ? 'Leyendo la foto…' : 'Leer la foto de nuevo'}
                </button>
              )}
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
          <p className="text-sm text-tinta/70">Lo que se le explicó a la IA sobre {proveedorNombre ?? 'este proveedor'}. Se guarda solo desde el chat y se aplica solo cada vez que entra una factura suya.</p>
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
