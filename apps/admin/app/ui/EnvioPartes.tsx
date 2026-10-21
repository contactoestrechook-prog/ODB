'use client';

import { useState } from 'react';
import { pesos } from '../lib/formato';
import { cantidadLegible } from '../lib/pedidos';
import { conCodigo } from '../lib/codigo-producto';
import { textoVisible } from '../lib/texto';
import {
  linkLlamar, linkMapa, linkWhatsappEnvio, MEDIOS_ENTREGA, rolLegible, telefonoDelEnvio, type Envio, type QuienLleva,
} from '../lib/envios';
import { Boton, Chips, clasesBoton, FOCO, Modal, PlacaRoja, Selector, unir } from './kit';

// Las piezas de un envío que comparten Envíos (el despacho) y Entregas en la
// calle (el celular del repartidor): lo mismo dicho de la misma manera.

/** Cuándo, cómo se cobra, a dónde y a quién llamar, más las indicaciones. */
export function DatosDelEnvio({ e }: { e: Envio }) {
  const mapa = linkMapa(e);
  const wa = linkWhatsappEnvio(e);
  const llamar = linkLlamar(e);
  const tel = telefonoDelEnvio(e);
  const indicaciones = textoVisible(e.indicaciones);
  return (
    <dl className="grid min-w-0 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-xs text-tinta/60">Cuándo</dt>
        <dd className="break-words font-semibold text-tinta">{e.entrega.texto}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-tinta/60">Cobro</dt>
        <dd className={unir('break-words font-semibold', e.cobro.pagado ? 'text-ok' : 'text-tinta')}>{e.cobro.texto}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-tinta/60">Dirección</dt>
        <dd className="break-words text-tinta">
          {e.destino.direccion ?? 'Sin dirección cargada'}
          {mapa && (
            <>
              {' '}
              <a href={mapa} target="_blank" rel="noopener noreferrer" className={unir('whitespace-nowrap font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>
                Abrir en el mapa
              </a>
            </>
          )}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-tinta/60">Contacto</dt>
        <dd className="text-tinta">
          {tel ? <span className="importe">{tel}</span> : <span className="text-tinta/60">No dejó teléfono</span>}
          {(wa || llamar) && (
            <span className="mt-1.5 flex flex-wrap gap-2">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={clasesBoton({ variante: 'secundario', tamano: 'chico' })}>
                  WhatsApp
                </a>
              )}
              {llamar && (
                <a href={llamar} className={clasesBoton({ variante: 'secundario', tamano: 'chico' })}>
                  Llamar
                </a>
              )}
            </span>
          )}
        </dd>
      </div>
      {indicaciones && (
        <div className="min-w-0 rounded-xl bg-atencion-suave px-3 py-2 sm:col-span-2">
          <dt className="text-xs font-semibold text-atencion">Indicaciones</dt>
          <dd className="whitespace-pre-wrap break-words text-tinta">{indicaciones}</dd>
        </div>
      )}
    </dl>
  );
}

/** Qué lleva, en la Placa roja (regla: todo detalle de productos va en la placa). */
export function PlacaDelEnvio({ e, className }: { e: Envio; className?: string }) {
  const n = e.items.length;
  return (
    <PlacaRoja
      className={className}
      titulo="PEDIDO"
      sub={`${e.codigo} · ${n === 1 ? '1 producto' : `${n} productos`}`}
      renglones={
        n
          ? e.items.map((it, i) => ({
              clave: `${it.sku ?? ''}-${i}`,
              cantidad: it.cantidad,
              nombre: conCodigo(it.nombre, { sku: it.sku }),
              detalle: it.precio != null ? `${cantidadLegible(it.cantidad)} × ${pesos(it.precio)}` : undefined,
              importe: it.subtotal != null ? pesos(it.subtotal) : undefined,
            }))
          : [{ clave: 'vacio', nombre: 'El pedido no tiene productos cargados' }]
      }
      total={{ etiqueta: 'Total', valor: pesos(e.total) }}
    />
  );
}

/** El desplegable de quién lo lleva: repartidores primero y, aparte, la gente del local. */
export function SelectorQuienLleva({
  quien,
  valor,
  onCambiar,
  permitirVacio,
  disabled,
  enCampo = false,
}: {
  quien: QuienLleva;
  valor: string;
  onCambiar: (id: string) => void;
  /** «Sin asignar» se puede elegir (no, si ya está en la calle). */
  permitirVacio: boolean;
  disabled?: boolean;
  /** Dentro de un <Campo> el rótulo lo pone el campo. */
  enCampo?: boolean;
}) {
  return (
    <Selector value={valor} onChange={(ev) => onCambiar(ev.target.value)} disabled={disabled} aria-label={enCampo ? undefined : 'Quién lo lleva'}>
      <option value="" disabled={!permitirVacio}>{permitirVacio ? 'Sin asignar' : 'Elegí quién lo lleva…'}</option>
      {quien.repartidores.length > 0 && (
        <optgroup label="Repartidores">
          {quien.repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </optgroup>
      )}
      {quien.delLocal.length > 0 && (
        <optgroup label="Lo lleva alguien del local">
          {quien.delLocal.map((u) => <option key={u.id} value={u.id}>{`${u.nombre} (${rolLegible(u.rol)})`}</option>)}
        </optgroup>
      )}
    </Selector>
  );
}

/**
 * Entregar: si se cobra en la puerta, cómo pagó (viene marcado lo que dijo el
 * cliente). Antes Envíos entregaba sin preguntar y la venta quedaba en
 * efectivo aunque el cliente hubiera dicho transferencia.
 */
export function ModalEntregarEnvio({
  e,
  titulo,
  aclaracion,
  textoBoton = 'Entregado',
  textoBotonCobro = 'Entregado y cobrado',
  trabajando,
  onCerrar,
  onConfirmar,
}: {
  e: Envio;
  titulo?: string;
  aclaracion?: string;
  textoBoton?: string;
  /** El botón cuando además se cobra en la puerta. */
  textoBotonCobro?: string;
  trabajando?: boolean;
  onCerrar: () => void;
  onConfirmar: (medio?: string) => void;
}) {
  const [medio, setMedio] = useState<string>(e.cobro.medio && MEDIOS_ENTREGA.some((m) => m.valor === e.cobro.medio) ? e.cobro.medio : '');
  const cobra = e.cobro.preguntar;
  const listo = !cobra || !!medio;
  return (
    <Modal
      abierto
      ancho="chico"
      onCerrar={onCerrar}
      bloquearCierre={trabajando}
      titulo={titulo ?? `Entregar ${e.codigo}`}
      descripcion={`${e.cliente.nombre ?? 'Cliente'} · total ${pesos(e.total)}`}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>Volver</Boton>
          <Boton variante={cobra ? 'ok' : 'primario'} onClick={() => onConfirmar(cobra ? medio : undefined)} disabled={!listo} cargando={trabajando}>
            {cobra ? textoBotonCobro : textoBoton}
          </Boton>
        </>
      }
    >
      <div className="space-y-3">
        {cobra ? (
          <>
            <p className="text-sm text-tinta">¿Cómo pagó?{e.cobro.medio ? <span className="text-tinta/70"> Dijo {e.cobro.medio}.</span> : null}</p>
            <Chips etiquetaAccesible="Cómo pagó" valor={medio} onCambiar={setMedio} opciones={MEDIOS_ENTREGA} />
            {medio === 'efectivo' && <p className="text-sm text-tinta/70">El efectivo entra en la caja abierta de la sucursal. Si no hay caja abierta, el sistema te lo va a pedir.</p>}
            {medio === 'transferencia' && <p className="text-sm text-tinta/70">Confirmá que la transferencia entró antes de darlo por cobrado.</p>}
          </>
        ) : (
          <p className="text-sm text-tinta">{e.cobro.texto}: en la puerta no se cobra nada.</p>
        )}
        {aclaracion && <p className="text-sm text-tinta/70">{aclaracion}</p>}
      </div>
    </Modal>
  );
}
