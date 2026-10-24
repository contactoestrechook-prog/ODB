'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Campo, Cargando, Entrada, Etiqueta, Modal, Selector, useConfirmar } from './kit';
import { fecha, fechaHora, pesos } from '../lib/formato';
import { CtaCteDatosCliente, DATOS_VACIOS, celularSirve, type DatosForm } from './CtaCteDatosCliente';
import { CtaCtePerfil } from './CtaCtePerfil';
import { DiasDeDeuda, type DiasDeuda, type PerfilCompras } from './CtaCteTarjeta';

// La ficha de una cuenta: los datos del cliente (todos editables en un solo
// formulario), el tope, si recibe el resumen, sus movimientos y los resúmenes
// que le llegaron por WhatsApp.

type Datos = {
  cliente: {
    id: string; nombre: string; telefono: string | null; celularValido: boolean; saldo: number; limite: number;
    habilitada: boolean; recibeResumen: boolean; tipo: 'cliente' | 'sponsor';
    datos: Omit<DatosForm, 'telefono'>;
  };
  perfil: PerfilCompras | null;
  deuda: DiasDeuda | null;
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

const formDe = (d: Datos): DatosForm => ({ ...DATOS_VACIOS, ...d.cliente.datos, telefono: d.cliente.telefono ?? '' });

export function CtaCteDetalle({ clienteId, esDueno = false, onCerrar, onCambio }: { clienteId: string | null; esDueno?: boolean; onCerrar: () => void; onCambio: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [form, setForm] = useState<DatosForm>(DATOS_VACIOS);
  const [tope, setTope] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const { confirmar, dialogo } = useConfirmar();
  // corregir el saldo (solo el dueño)
  const [ajMonto, setAjMonto] = useState('');
  const [ajSube, setAjSube] = useState(false);
  const [ajMotivo, setAjMotivo] = useState('');

  const cargar = useCallback(async () => {
    if (!clienteId) return;
    try {
      const r = await fetch(`/api/cta-cte/cliente/${clienteId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || 'No pude cargar la cuenta');
      setDatos(j); setForm(formDe(j)); setTope(j.cliente.limite > 0 ? String(j.cliente.limite) : ''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Sin conexión'); }
  }, [clienteId]);
  useEffect(() => { setDatos(null); setListo(''); cargar(); }, [cargar]);

  const guardar = async (cambios: Record<string, unknown>, aviso = 'Guardado.') => {
    if (guardando || !clienteId) return false;
    setGuardando(true); setListo('');
    try {
      const r = await fetch(`/api/cta-cte/cliente/${clienteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : j?.message || 'No se pudo guardar');
      setError(''); setListo(aviso);
      await cargar(); onCambio();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); return false; }
    finally { setGuardando(false); }
  };

  const c = datos?.cliente;
  const original = datos ? formDe(datos) : DATOS_VACIOS;
  const cambiados = (Object.keys(form) as (keyof DatosForm)[]).filter((k) => form[k].trim() !== original[k].trim());
  const topeCambio = !!c && (Number(tope) || 0) !== c.limite;
  const hayCambios = cambiados.length > 0 || topeCambio;
  const telMalo = !!form.telefono.trim() && !celularSirve(form.telefono);

  const guardarTodo = () => {
    const cambios: Record<string, unknown> = Object.fromEntries(cambiados.map((k) => [k, form[k].trim()]));
    if (topeCambio) cambios.limite = Number(tope) || 0;
    return guardar(cambios, 'Datos guardados.');
  };

  const ajustar = async () => {
    const monto = Number(ajMonto);
    if (!c || !monto || monto <= 0 || ajMotivo.trim().length < 4 || guardando) return;
    const firmado = ajSube ? monto : -monto;
    if (!(await confirmar({
      titulo: ajSube ? `¿Sumarle ${pesos(monto)} a la deuda?` : `¿Bajarle ${pesos(monto)} a la deuda?`,
      texto: `${c.nombre} pasa de deber ${pesos(c.saldo)} a ${pesos(c.saldo + firmado)}. Queda como movimiento: «Ajuste: ${ajMotivo.trim()}».`,
      textoConfirmar: 'Corregir el saldo', variante: 'primario',
    }))) return;
    setGuardando(true); setListo('');
    try {
      const r = await fetch(`/api/cta-cte/cliente/${c.id}/ajuste`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monto: firmado, motivo: ajMotivo.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : j?.message || 'No se pudo corregir');
      setAjMonto(''); setAjMotivo(''); setError(''); setListo('Saldo corregido.');
      await cargar(); onCambio();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo corregir'); }
    finally { setGuardando(false); }
  };

  const cerrarCuenta = async () => {
    if (!c || !(await confirmar({
      titulo: `¿Cerrar la cuenta corriente de ${c.nombre}?`,
      texto: 'Deja de poder comprar a cuenta y sale de este tablero. El cliente y su historia quedan guardados; se puede volver a abrir con «Sumar cuenta».',
      textoConfirmar: 'Cerrar cuenta', variante: 'peligro',
    }))) return;
    if (await guardar({ habilitada: false }, 'Cuenta cerrada.')) onCerrar();
  };

  return (
    <Modal
      abierto={!!clienteId}
      onCerrar={onCerrar}
      titulo={c?.nombre ?? 'Cuenta corriente'}
      descripcion={c ? `Debe ${pesos(c.saldo)}${c.limite > 0 ? ` · tope ${pesos(c.limite)}` : ' · sin tope'}` : undefined}
      ancho="ancho"
      bloquearCierre={guardando}
      cerrarAlTocarAfuera={!hayCambios}
      pie={c && <>
        <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cerrar</Boton>
        <Boton onClick={guardarTodo} disabled={guardando || !hayCambios || !form.nombre.trim() || telMalo}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Boton>
      </>}
    >
      {dialogo}
      {error && <Aviso tono="error" className="mb-3">{error}</Aviso>}
      {listo && !error && <Aviso tono="ok" className="mb-3">{listo}</Aviso>}
      {!datos ? <Cargando bloque /> : (
        <div className="space-y-5">
          {datos.deuda && (
            <section>
              <DiasDeDeuda d={datos.deuda} grande />
              <p className="mt-1 text-xs text-tinta/60">
                La factura sin pagar más vieja es del {datos.deuda.desde.split('-').reverse().join('/')}; quedan {datos.deuda.facturasAbiertas} facturas sin cubrir (los pagos cancelan primero lo más viejo).
              </p>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-tinta">Cómo compra</h3>
            <CtaCtePerfil p={datos.perfil} />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-tinta">Datos del cliente</h3>
            <CtaCteDatosCliente valor={form} onCambiar={setForm} deshabilitado={guardando} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Tipo de cuenta" ayuda="Los sponsors del Wine Fest se ven aparte, en Clientes › Sponsors WF.">
              <Selector value={c!.tipo} onChange={(e) => guardar({ tipo: e.target.value }, e.target.value === 'sponsor' ? 'Pasó a Sponsors WF.' : 'Pasó a cuentas de clientes.')} disabled={guardando}>
                <option value="cliente">Cliente</option>
                <option value="sponsor">Sponsor del Wine Fest</option>
              </Selector>
            </Campo>
            <Campo etiqueta="Tope de crédito" ayuda="Con el 80 % usado se pone en amarillo. Vacío: sin tope.">
              <Entrada value={tope} onChange={(e) => setTope(e.target.value)} type="number" inputMode="decimal" prefijo="$" placeholder="0" disabled={guardando} />
            </Campo>
            <div>
              <p className="mb-1 text-sm font-medium text-tinta">Resumen cada 15 días</p>
              <div className="flex flex-wrap items-center gap-2">
                <Etiqueta tono={c!.recibeResumen ? (c!.celularValido ? 'ok' : 'atencion') : 'neutro'} punto>
                  {!c!.recibeResumen ? 'Apagado para este cliente' : c!.celularValido ? 'Lo recibe' : 'Le falta el celular'}
                </Etiqueta>
                <Boton tamano="chico" variante="secundario" onClick={() => guardar({ recibeResumen: !c!.recibeResumen }, c!.recibeResumen ? 'Ya no le mandamos el resumen.' : 'Vuelve a recibir el resumen.')} disabled={guardando}>
                  {c!.recibeResumen ? 'No mandarle' : 'Volver a mandarle'}
                </Boton>
              </div>
            </div>
          </section>

          {esDueno && (
            <section className="rounded-xl border border-black/10 p-3">
              <h3 className="mb-1 text-sm font-semibold text-tinta">Corregir el saldo</h3>
              <p className="mb-2 text-xs text-tinta/60">Para un error de carga o una diferencia con el sistema viejo. Queda como movimiento con el motivo; el saldo nunca se pisa.</p>
              <div className="grid gap-2 sm:grid-cols-[10rem_9rem_1fr_auto] sm:items-end">
                <Campo etiqueta="Monto">
                  <Entrada value={ajMonto} onChange={(e) => setAjMonto(e.target.value)} type="number" inputMode="decimal" prefijo="$" placeholder="0" disabled={guardando} />
                </Campo>
                <Campo etiqueta="La deuda">
                  <Selector value={ajSube ? 'sube' : 'baja'} onChange={(e) => setAjSube(e.target.value === 'sube')} disabled={guardando}>
                    <option value="baja">baja</option>
                    <option value="sube">sube</option>
                  </Selector>
                </Campo>
                <Campo etiqueta="Motivo">
                  <Entrada value={ajMotivo} onChange={(e) => setAjMotivo(e.target.value)} placeholder="Ej.: factura cargada dos veces" disabled={guardando} />
                </Campo>
                <Boton variante="secundario" onClick={ajustar} disabled={guardando || !(Number(ajMonto) > 0) || ajMotivo.trim().length < 4}>Corregir</Boton>
              </div>
            </section>
          )}

          <section>
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
              <p className="text-sm text-tinta/60">No hay movimientos cargados todavía.</p>
            )}
          </section>

          <section>
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
          </section>

          {c!.saldo <= 0 && (
            <div className="border-t border-black/10 pt-3">
              <Boton tamano="chico" variante="peligro" onClick={cerrarCuenta} disabled={guardando}>Cerrar la cuenta corriente</Boton>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
