'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Etiqueta, Monto, PlacaRoja, Tarjeta, useConfirmar } from './kit';
import { fechaHora, numero, pesos } from '../lib/formato';

// La cola de firmas. Antes estaba repartida en cinco pantallas y lo que nadie
// miraba se enteraba el proveedor antes que la dirección. Acá arriba va lo que
// más días lleva esperando, no lo más caro: lo que frena a alguien es lo
// urgente.

const ETIQUETA: Record<string, string> = {
  orden_compra: 'Orden de compra',
  orden_pago: 'Orden de pago',
  cobranza: 'Cobro a cuenta',
  cambio_factura: 'Cambio en factura',
  propuesta_costo: 'Cambio de costos',
  devolucion: 'Devolución en caja',
};
// El PDF que respalda la firma, cuando el tipo tiene uno
const PDF: Record<string, string> = { orden_compra: 'oc', orden_pago: 'op' };

export function Aprobaciones({ puedeFirmar }: { puedeFirmar: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const { confirmar, pedirTexto, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/aprobaciones');
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude consultar la API'); return; }
      setItems(d.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // la cola cambia sola: alguien carga un cobro o una OC mientras esto está abierto
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  const resolver = async (it: any, decision: 'aprobar' | 'rechazar') => {
    if (trabajando) return;
    let motivo: string | undefined;
    if (decision === 'rechazar') {
      const m = await pedirTexto({
        titulo: `Rechazar: ${ETIQUETA[it.tipo] ?? it.tipo}`,
        texto: it.titulo,
        campo: { etiqueta: `Motivo del rechazo (le llega a ${it.pidio ?? 'quien lo pidió'}):`, multilinea: true },
        variante: 'peligro',
        textoConfirmar: 'Rechazar',
      });
      if (m === null) return;
      motivo = m;
    } else if (it.monto != null && it.monto > 0) {
      // firmar plata sin releer el monto es cómo se firma lo que no se quiso firmar
      const ok = await confirmar({
        titulo: '¿Confirmás la aprobación?',
        texto: (
          <>
            <p>{ETIQUETA[it.tipo]}: {it.titulo}</p>
            <p className="mt-2">
              Monto: <span className="importe font-semibold text-tinta">{pesos(it.monto ?? 0)}</span>
            </p>
          </>
        ),
        variante: 'ok',
        textoConfirmar: 'Aprobar',
      });
      if (!ok) return;
    }
    setTrabajando(it.id);
    setAviso('');
    try {
      const r = await fetch('/api/aprobaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: it.tipo, id: it.id, decision, motivo }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No se pudo resolver'); return; }
      // una orden de compra firmada sale sola al proveedor por WhatsApp: se dice
      // si llegó o por qué no (la firma vale igual)
      const envio = d?.envio as { enviado?: boolean; mensaje?: string } | undefined;
      setError(envio && !envio.enviado ? `${ETIQUETA[it.tipo]} aprobada, pero ${String(envio.mensaje ?? '').replace(/^El pedido/, 'el pedido')}` : '');
      setAviso(decision === 'aprobar' ? `${ETIQUETA[it.tipo]} aprobada.${envio?.enviado ? ` ${envio.mensaje}` : ''}` : `${ETIQUETA[it.tipo]} rechazada.`);
      setItems((xs) => xs.filter((x) => !(x.id === it.id && x.tipo === it.tipo)));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta/60">
        Órdenes de compra, órdenes de pago, cobros a cuenta, cambios de factura y cambios de costos. Todo lo que no está firmado, acá.
      </p>

      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {cargando && <Cargando />}

      {!cargando && items.length === 0 && !error && (
        <Aviso tono="ok">No queda nada esperando firma.</Aviso>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((it) => {
            const firma = puedeFirmar ? (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Boton variante="ok" onClick={() => resolver(it, 'aprobar')} disabled={trabajando === it.id} cargando={trabajando === it.id}>
                  Aprobar
                </Boton>
                <Boton variante="peligro" onClick={() => resolver(it, 'rechazar')} disabled={trabajando === it.id}>
                  Rechazar
                </Boton>
              </div>
            ) : (
              <span className="text-xs text-tinta/60">espera la firma del dueño</span>
            );

            // La devolución en caja detalla productos: va en la Placa roja, el
            // paquete gráfico de pedidos y listas de precios (2/10/2026, pedido
            // de Leandro). Antes era una línea "2× Fernet, 1× Coca" y no se veía
            // qué costaba cada renglón. Un pedido viejo sin detalle sigue en tarjeta.
            const productos = (it.tipo === 'devolucion' ? it.productos ?? [] : []) as { nombre: string; cantidad: number; precio: number }[];
            if (productos.length > 0) {
              return (
                <PlacaRoja
                  key={`${it.tipo}-${it.id}`}
                  titulo="Devolución"
                  sub={`${it.pidio ? `Pidió ${it.pidio} · ` : ''}${fechaHora(it.cuando)}`}
                  renglones={productos.map((p, n) => ({
                    clave: `${n}-${p.nombre}`,
                    cantidad: p.cantidad,
                    nombre: p.nombre,
                    detalle: `${numero(p.cantidad, 3)} × ${pesos(p.precio)}`,
                    importe: pesos(p.cantidad * p.precio),
                  }))}
                  total={{ etiqueta: 'A devolver', valor: pesos(it.monto ?? 0) }}
                  recuadro={
                    <div className="space-y-2">
                      {it.dias >= 2 && <Etiqueta tono="error">esperando hace {it.dias} días</Etiqueta>}
                      <p className="break-words text-tinta/70">{it.detalle}</p>
                    </div>
                  }
                  acciones={firma}
                />
              );
            }

            return (
              <Tarjeta key={`${it.tipo}-${it.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Etiqueta tono="neutro">{ETIQUETA[it.tipo] ?? it.tipo}</Etiqueta>
                      {it.dias >= 2 && <Etiqueta tono="error">esperando hace {it.dias} días</Etiqueta>}
                    </div>
                    <p className="mt-2 break-words text-base font-semibold text-tinta sm:text-sm">{it.titulo}</p>
                    <p className="mt-0.5 break-words text-xs text-tinta/60">
                      {it.detalle}
                      {it.pidio && ` · pidió ${it.pidio}`}
                      {` · ${fechaHora(it.cuando)}`}
                    </p>
                    {PDF[it.tipo] && (
                      <a href={`/api/documento?tipo=${PDF[it.tipo]}&id=${it.id}`} target="_blank" rel="noreferrer"
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-marca-hondo underline underline-offset-2 sm:min-h-0 sm:text-xs">
                        ver el documento antes de firmar
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    {it.monto != null && <Monto valor={it.monto} className="text-xl font-semibold text-tinta" />}
                    {firma}
                  </div>
                </div>
              </Tarjeta>
            );
          })}
        </div>
      )}
      {dialogo}
    </div>
  );
}
