'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pesos as pesosFmt } from '../lib/formato';
import { Aviso, Boton, Campo, Entrada, Modal, Selector } from './kit';

const CONDICIONES = [
  ['consumidor_final', 'Consumidor final'],
  ['responsable_inscripto', 'Responsable inscripto'],
  ['monotributo', 'Monotributo'],
  ['exento', 'Exento'],
];

const pesos = (n: number) => pesosFmt(Number(n) || 0);

export function ConfigCliente({ cliente }: { cliente: any }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({
    nombre: cliente.nombre ?? '',
    razonSocial: cliente.razon_social ?? '',
    cuit: cliente.cuit ?? '',
    condicionIva: cliente.condicion_iva ?? 'consumidor_final',
    domicilio: cliente.domicilio ?? '',
    telefono: cliente.telefono ?? '',
    ctaCteHabilitada: !!cliente.cta_cte_habilitada,
    limiteCredito: cliente.limite_credito ?? 0,
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const campo = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/cliente-editar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cliente.id,
          ...form,
          limiteCredito: Number(form.limiteCredito) || 0,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).message ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <Boton variante="fantasma" tamano="chico" onClick={() => setAbierto(true)} className="whitespace-nowrap">
        {cliente.cta_cte_habilitada ? 'Cta. cte. habilitada' : 'Configurar'}
      </Boton>

      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={cliente.nombre ?? `DNI ${cliente.dni}`}
        descripcion="Datos fiscales y cuenta corriente"
        ancho="chico"
        bloquearCierre={cargando}
        cerrarAlTocarAfuera={false}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton onClick={guardar} cargando={cargando}>{cargando ? 'Guardando…' : 'Guardar'}</Boton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Razón social (para facturar)" className="sm:col-span-2">
              <Entrada value={form.razonSocial} onChange={(e) => campo('razonSocial', e.target.value)} />
            </Campo>
            <Campo etiqueta="CUIT">
              <Entrada value={form.cuit} onChange={(e) => campo('cuit', e.target.value)} placeholder="30-12345678-9" />
            </Campo>
            <Campo etiqueta="Condición IVA">
              <Selector value={form.condicionIva} onChange={(e) => campo('condicionIva', e.target.value)}>
                {CONDICIONES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Domicilio" className="sm:col-span-2">
              <Entrada value={form.domicilio} onChange={(e) => campo('domicilio', e.target.value)} />
            </Campo>
            <Campo etiqueta="Teléfono" className="sm:col-span-2">
              <Entrada value={form.telefono} onChange={(e) => campo('telefono', e.target.value)} inputMode="tel" />
            </Campo>
          </div>

          <div className="space-y-2 rounded-xl bg-crema-claro p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-tinta">
              <input
                type="checkbox"
                checked={form.ctaCteHabilitada}
                onChange={(e) => campo('ctaCteHabilitada', e.target.checked)}
                className="size-4 accent-marca"
              />
              Habilitar cuenta corriente
            </label>
            <p className="text-xs text-tinta/60">
              El cliente podrá comprar a crédito y ver su saldo en la app.
            </p>
            {form.ctaCteHabilitada && (
              <Campo
                etiqueta="Límite de crédito (0 = sin tope)"
                ayuda={Number(form.limiteCredito) > 0 ? `Tope: ${pesos(Number(form.limiteCredito))}` : undefined}
                className="pt-1"
              >
                <Entrada
                  type="number"
                  inputMode="decimal"
                  prefijo="$"
                  value={form.limiteCredito}
                  onChange={(e) => campo('limiteCredito', e.target.value)}
                />
              </Campo>
            )}
          </div>

          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      </Modal>
    </>
  );
}
