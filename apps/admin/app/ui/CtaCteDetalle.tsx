'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Entrada, Etiqueta, Modal } from './kit';
import { fecha, fechaHora, pesos } from '../lib/formato';

// Estado de cuenta de un cliente: saldo, sus movimientos, los resúmenes que
// recibió por WhatsApp, y ahí mismo el celular y si recibe el resumen.

type Datos = {
  cliente: { id: string; nombre: string; telefono: string | null; celularValido: boolean; saldo: number; limite: number; recibeResumen: boolean };
  movimientos: { id: number; concepto: string | null; debe: number; haber: number; creado_en: string }[];
  resumenes: { tanda: string; estado: string; saldo: number; motivo: string | null; enviado_en: string | null }[];
};

const ESTADO: Record<string, { texto: string; tono: 'ok' | 'atencion' | 'error' | 'neutro' }> = {
  enviado: { texto: 'Enviado', tono: 'ok' },
  pendiente: { texto: 'En camino', tono: 'atencion' },
  enviando: { texto: 'En camino', tono: 'atencion' },
  error: { texto: 'No salió', tono: 'error' },
  sin_telefono: { texto: 'Sin celular', tono: 'error' },
  omitido: { texto: 'Omitido', tono: 'neutro' },
};

export function CtaCteDetalle({ clienteId, onCerrar, onCambio }: { clienteId: string | null; onCerrar: () => void; onCambio: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState('');
  const [tel, setTel] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!clienteId) return;
    try {
      const r = await fetch(`/api/cta-cte/cliente/${clienteId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || 'No pude cargar la cuenta');
      setDatos(j); setTel(j.cliente.telefono ?? ''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Sin conexión'); }
  }, [clienteId]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const guardar = async (cambios: { telefono?: string; recibeResumen?: boolean }) => {
    if (guardando || !clienteId) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/cta-cte/cliente/${clienteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || 'No se pudo guardar');
      await cargar(); onCambio();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  };

  const c = datos?.cliente;
  return (
    <Modal abierto={!!clienteId} onCerrar={onCerrar} titulo={c?.nombre ?? 'Cuenta corriente'} descripcion={c ? `Debe ${pesos(c.saldo)}${c.limite > 0 ? ` · tope ${pesos(c.limite)}` : ''}` : undefined} ancho="ancho">
      {error && <Aviso tono="error" className="mb-3">{error}</Aviso>}
      {!datos ? <Cargando bloque /> : (
        <div className="space-y-5">
          {/* celular y resumen */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-tinta/70">Celular para el resumen</p>
              <div className="flex gap-2">
                <Entrada value={tel} onChange={(e) => setTel(e.target.value)} placeholder="11 2345-6789" inputMode="tel" aria-label="Celular"
                  onKeyDown={(e) => { if (e.key === 'Enter') guardar({ telefono: tel }); }} />
                <Boton tamano="chico" onClick={() => guardar({ telefono: tel })} disabled={guardando || tel === (c!.telefono ?? '')}>Guardar</Boton>
              </div>
              <p className={c!.celularValido ? 'mt-1 text-xs text-ok' : 'mt-1 text-xs text-marca-hondo'}>
                {c!.celularValido ? 'Sirve para WhatsApp.' : 'Así no le llega: código de área + número, sin el 15.'}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-tinta/70">Resumen cada 15 días</p>
              <div className="flex flex-wrap items-center gap-2">
                <Etiqueta tono={c!.recibeResumen ? 'ok' : 'neutro'} punto>{c!.recibeResumen ? 'Lo recibe' : 'Apagado para este cliente'}</Etiqueta>
                <Boton tamano="chico" variante="secundario" onClick={() => guardar({ recibeResumen: !c!.recibeResumen })} disabled={guardando}>
                  {c!.recibeResumen ? 'No mandarle' : 'Volver a mandarle'}
                </Boton>
              </div>
            </div>
          </div>

          {/* movimientos */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-tinta">Movimientos</h3>
            {datos.movimientos.length ? (
              <div className="divide-y divide-black/[0.06] rounded-xl border border-black/10">
                {datos.movimientos.map((m) => (
                  <div key={m.id} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="break-words text-tinta">{m.concepto || (m.debe > 0 ? 'Compra' : 'Pago')}</p>
                      <p className="text-xs text-tinta/60">{fechaHora(m.creado_en, { conAnio: true })}</p>
                    </div>
                    <p className={m.haber > 0 ? 'importe text-right font-semibold text-ok' : 'importe text-right font-semibold text-tinta'}>
                      {m.haber > 0 ? `− ${pesos(m.haber)}` : `+ ${pesos(m.debe)}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-tinta/60">No hay movimientos cargados: el saldo viene de la importación del sistema viejo.</p>
            )}
          </div>

          {/* resúmenes recibidos */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-tinta">Resúmenes por WhatsApp</h3>
            {datos.resumenes.length ? (
              <div className="flex flex-wrap gap-2">
                {datos.resumenes.map((r) => (
                  <span key={r.tanda} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-tinta/80" title={r.motivo ?? undefined}>
                    {fecha(r.tanda, 'corta')} · {pesos(r.saldo)}
                    <Etiqueta tono={ESTADO[r.estado]?.tono ?? 'neutro'}>{ESTADO[r.estado]?.texto ?? r.estado}</Etiqueta>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-tinta/60">Todavía no recibió ninguno.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
