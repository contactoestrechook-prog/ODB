'use client';

import { useCallback, useEffect, useState } from 'react';
import { fechaHora, pesos as pesosFmt } from '../lib/formato';
import { Aviso, Boton, Chips, Etiqueta, Tarjeta, TarjetaCabecera, TarjetaCuerpo, clasesBoton, useConfirmar } from './kit';

// Bandeja del dueño: los pagos a cuenta que tomaron los cajeros y todavía no
// bajaron la deuda. Los mira contra la caja o el posnet y los aprueba — recién
// ahí se aplica el pago a la cuenta corriente del cliente.
const pesos = (n: number) => pesosFmt(Number(n) || 0);
const fecha = (s: string) => fechaHora(s);

export function CobrosAIngresar({ esDueno }: { esDueno: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [vista, setVista] = useState<'pendiente' | 'aprobada' | 'rechazada'>('pendiente');
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const { pedirTexto, dialogo } = useConfirmar();

  const cargar = useCallback(async (estado: string) => {
    try {
      const r = await fetch(`/api/cobranzas?estado=${estado}`);
      if (r.ok) setItems(await r.json());
    } catch { /* se reintenta al cambiar de pestaña */ }
  }, []);

  useEffect(() => { cargar(vista); }, [vista, cargar]);

  const resolver = async (id: string, accion: 'aprobar' | 'rechazar') => {
    if (trabajando) return;
    const respuesta =
      accion === 'rechazar'
        ? ((await pedirTexto({
            titulo: 'Rechazar el cobro',
            textoConfirmar: 'Rechazar',
            variante: 'peligro',
            campo: { etiqueta: 'Motivo del rechazo (le llega a quien lo cargó)', multilinea: true },
          })) ?? undefined)
        : undefined;
    if (accion === 'rechazar' && respuesta === undefined) return;
    setTrabajando(id);
    setAviso('');
    try {
      const r = await fetch('/api/cobranzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, id, respuesta }),
      });
      const d = await r.json();
      if (!r.ok) { setAviso(d?.message ?? 'No se pudo resolver'); return; }
      if (accion === 'aprobar' && d?.saldoNuevo != null) {
        setAviso(`Aplicado. El cliente queda con saldo ${pesos(d.saldoNuevo)}.`);
      }
      cargar(vista);
    } finally {
      setTrabajando(null);
    }
  };

  const nombreDe = (c: any) => c.cliente?.razon_social || c.cliente?.nombre || '—';

  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera
        titulo="Cobros a ingresar"
        sub="El pago no baja la deuda hasta que se aprueba acá. Chequealo contra la caja o el posnet antes."
      />
      <TarjetaCuerpo className="space-y-3">
        <Chips
          etiquetaAccesible="Estado de los cobros"
          valor={vista}
          onCambiar={setVista}
          opciones={[
            { valor: 'pendiente', etiqueta: 'Pendientes' },
            { valor: 'aprobada', etiqueta: 'Aplicados' },
            { valor: 'rechazada', etiqueta: 'Rechazados' },
          ]}
        />

        {aviso && <Aviso tono={aviso.startsWith('Aplicado') ? 'ok' : 'error'}>{aviso}</Aviso>}

        {items.length === 0 ? (
          <p className="py-2 text-sm text-tinta/60">Nada {vista === 'pendiente' ? 'pendiente' : `en ${vista}s`}.</p>
        ) : (
          <div className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.06]">
            {items.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="min-w-0 break-words text-sm text-tinta">
                    <b className="font-semibold">{nombreDe(c)}</b> · <span className="importe">{pesos(c.monto)}</span> <span className="text-tinta/60">({c.medio})</span>
                    {c.comprobanteUrl && (
                      <a href={c.comprobanteUrl} target="_blank" rel="noreferrer" className="ml-2 text-sm text-marca-hondo underline underline-offset-2">ver comprobante</a>
                    )}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-tinta/60">
                    {fecha(c.cargada_en)} · cargó {c.cargador?.nombre ?? '—'}
                    {c.cliente?.saldo_cta_cte != null && vista === 'pendiente' && ` · saldo actual ${pesos(c.cliente.saldo_cta_cte)}`}
                    {c.nota && ` · "${c.nota}"`}
                    {vista !== 'pendiente' && c.aprobador?.nombre && ` · resolvió ${c.aprobador.nombre}`}
                    {c.respuesta && ` · ${c.respuesta}`}
                  </p>
                </div>
                {vista === 'pendiente' && esDueno && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Boton variante="ok" tamano="chico" onClick={() => resolver(c.id, 'aprobar')} cargando={trabajando === c.id}>
                      Aprobar
                    </Boton>
                    <Boton variante="peligro" tamano="chico" onClick={() => resolver(c.id, 'rechazar')} disabled={trabajando === c.id}>
                      Rechazar
                    </Boton>
                  </div>
                )}
                {vista === 'pendiente' && !esDueno && (
                  <Etiqueta tono="atencion" className="shrink-0 self-start sm:self-center">espera aprobación</Etiqueta>
                )}
                {/* Aplicado el pago, el cliente tiene derecho a su papel: recibo
                    con folio propio, que se puede volver a imprimir sin renumerar. */}
                {vista === 'aprobada' && (
                  <a
                    href={`/api/documento?tipo=recibo&id=${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={clasesBoton({ variante: 'secundario', tamano: 'chico', className: 'shrink-0 self-start sm:self-center' })}
                  >
                    Recibo
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </TarjetaCuerpo>
      {dialogo}
    </Tarjeta>
  );
}
