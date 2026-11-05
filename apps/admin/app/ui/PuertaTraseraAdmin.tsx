'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Campo, Entrada, Pestanas, Tarjeta, Vacio, useConfirmar } from './kit';
import { numero } from '../lib/formato';
import { EstadoIngreso } from './SalonWorkspace';

// PUERTA TRASERA · administración (5/11/2026). Lo que el salón recibió con
// remito espera acá la factura. Al confirmar con el número de factura (y
// corregir lo que no coincida) entra al stock como una recepción más, y el
// remito queda para conciliar con la factura de compra.

type Ingreso = {
  id: string; numero: number; numero_remito: string; notas: string | null; estado: string; creado_en: string;
  creadoPorNombre: string | null; confirmadoPorNombre: string | null; numero_factura: string | null; motivo_rechazo: string | null;
  proveedor: { nombre: string } | null; sucursal: { nombre: string } | null;
  items: { cantidad: number; cantidad_confirmada: number | null; vencimiento: string | null; producto: { sku: string; nombre: string } | null }[];
};
type Vista = 'espera_factura' | 'todos';

export function PuertaTraseraAdmin() {
  const [vista, setVista] = useState<Vista>('espera_factura');
  const [lista, setLista] = useState<Ingreso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/salon?recurso=ingresos&estado=${vista}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? 'No pude consultar la API');
      setLista(d);
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [vista]);
  useEffect(() => { setLista(null); cargar(); }, [cargar]);

  return (
    <div className="space-y-4">
      <Pestanas<Vista> etiquetaAccesible="Ingresos por puerta trasera" valor={vista} onCambiar={setVista} opciones={[
        { valor: 'espera_factura', etiqueta: 'Esperan factura', cuenta: vista === 'espera_factura' ? lista?.length : undefined },
        { valor: 'todos', etiqueta: 'Todos' },
      ]} />
      {error && <Aviso tono="error">{error}</Aviso>}
      {lista?.length === 0 && <Vacio titulo={vista === 'espera_factura' ? 'No hay ingresos esperando factura' : 'Todavía no hay ingresos'} texto="Los carga el salón cuando baja mercadería por puerta trasera." />}
      {lista?.map((i) => (vista === 'espera_factura' && i.estado === 'espera_factura'
        ? <Confirmable key={i.id} i={i} onListo={cargar} />
        : <Resumen key={i.id} i={i} />))}
    </div>
  );
}

const cuando = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function Cabecera({ i }: { i: Ingreso }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold text-tinta">#{i.numero} · {i.proveedor?.nombre ?? 'Proveedor'}</p>
        <p className="text-xs text-tinta/60">Remito {i.numero_remito} · {i.sucursal?.nombre ?? ''} · {cuando(i.creado_en)}{i.creadoPorNombre ? ` · lo recibió ${i.creadoPorNombre}` : ''}</p>
      </div>
      <EstadoIngreso estado={i.estado} />
    </div>
  );
}

function Resumen({ i }: { i: Ingreso }) {
  return (
    <Tarjeta className="space-y-2">
      <Cabecera i={i} />
      <ul className="text-sm text-tinta">
        {i.items.map((it) => (
          <li key={it.producto?.sku} className="flex justify-between gap-2">
            <span className="min-w-0">{it.producto?.nombre}</span>
            <span className="importe shrink-0">{numero(Number(it.cantidad_confirmada ?? it.cantidad), 2)}{it.cantidad_confirmada != null && Number(it.cantidad_confirmada) !== Number(it.cantidad) ? ` (remito ${numero(Number(it.cantidad), 2)})` : ''}</span>
          </li>
        ))}
      </ul>
      {i.estado === 'ingresado' && <p className="text-xs text-tinta/60">Factura {i.numero_factura}{i.confirmadoPorNombre ? ` · confirmó ${i.confirmadoPorNombre}` : ''}</p>}
      {i.estado === 'rechazado' && <p className="text-xs text-marca">Rechazado: {i.motivo_rechazo}</p>}
    </Tarjeta>
  );
}

function Confirmable({ i, onListo }: { i: Ingreso; onListo: () => void }) {
  const [factura, setFactura] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string>>(() => Object.fromEntries(i.items.map((it) => [it.producto?.sku ?? '', String(Number(it.cantidad))])));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pedirTexto, dialogo } = useConfirmar();

  async function enviar(cuerpo: Record<string, unknown>) {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingresoId: i.id, ...cuerpo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo');
      onListo();
    } catch (e: any) { setError(e.message); setOcupado(false); }
  }

  async function rechazar() {
    const motivo = await pedirTexto({ titulo: `Rechazar el ingreso #${i.numero}`, texto: 'No suma nada al stock. El salón ve el motivo.', variante: 'peligro', textoConfirmar: 'Rechazar', campo: { etiqueta: 'Motivo', obligatorio: true } });
    if (motivo) enviar({ accion: 'rechazar', motivo });
  }

  const cambiadas = i.items.filter((it) => Number(cantidades[it.producto?.sku ?? '']) !== Number(it.cantidad)).length;
  return (
    <Tarjeta className="space-y-3">
      {dialogo}
      <Cabecera i={i} />
      {i.notas && <p className="rounded-lg bg-crema-claro px-3 py-2 text-sm text-tinta"><b>Nota del salón:</b> {i.notas}</p>}
      <ul className="divide-y divide-black/5">
        {i.items.map((it) => {
          const sku = it.producto?.sku ?? '';
          return (
            <li key={sku} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-tinta">{it.producto?.nombre}</p>
                <p className="text-xs text-tinta/50">{sku} · remito {numero(Number(it.cantidad), 2)}{it.vencimiento ? ` · vence ${it.vencimiento}` : ''}</p>
              </div>
              <div className="w-24 shrink-0"><Entrada type="number" inputMode="decimal" min={0} step="any" aria-label={`Cantidad que factura de ${it.producto?.nombre}`}
                value={cantidades[sku] ?? ''} onChange={(e) => setCantidades((c) => ({ ...c, [sku]: e.target.value }))} /></div>
            </li>
          );
        })}
      </ul>
      {cambiadas > 0 && <p className="text-xs text-atencion">Cambiaste {cambiadas} cantidad{cambiadas === 1 ? '' : 'es'} contra el remito: entra lo que dice la factura.</p>}
      <Campo etiqueta="N.º de factura" obligatorio>
        <Entrada value={factura} onChange={(e) => setFactura(e.target.value)} />
      </Campo>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex flex-wrap gap-2">
        <Boton variante="ok" onClick={() => enviar({ accion: 'confirmar', numeroFactura: factura, items: Object.entries(cantidades).map(([sku, c]) => ({ sku, cantidad: Number(c) })) })} disabled={!factura.trim() || ocupado} cargando={ocupado} className="flex-1">
          Confirmar y sumar al stock
        </Boton>
        <Boton variante="peligro" onClick={rechazar} disabled={ocupado}>Rechazar</Boton>
      </div>
    </Tarjeta>
  );
}
