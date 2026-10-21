'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { pesos } from '../lib/formato';
import { cantidadLegible } from '../lib/pedidos';
import { conCodigo } from '../lib/codigo-producto';
import { textoVisible } from '../lib/texto';
import {
  FRANJAS, linkLlamar, linkMapa, linkWhatsappEnvio, MEDIOS_ENTREGA, personaLegible, telefonoDelEnvio, type Envio, type QuienLleva,
} from '../lib/envios';
import { Aviso, Boton, Campo, Cargando, Chips, clasesBoton, Entrada, FOCO, Modal, PlacaRoja, Selector, unir } from './kit';

// Las piezas de un envío que comparten Envíos (el despacho) y Mis entregas
// (el celular de quien lo lleva): lo mismo dicho de la misma manera.

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
          {quien.delLocal.map((u) => <option key={u.id} value={u.id}>{personaLegible(u.nombre, u.rol)}</option>)}
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
  cierre = false,
  trabajando,
  error,
  onCerrar,
  onConfirmar,
}: {
  e: Envio;
  titulo?: string;
  aclaracion?: string;
  textoBoton?: string;
  /** El botón cuando además se cobra en la puerta. */
  textoBotonCobro?: string;
  /**
   * Cierre de un envío viejo («Se entregó»): no viene nada marcado y el
   * efectivo pide confirmar que la plata está hoy en el cajón, porque entra en
   * la caja de hoy (revisión del 21/10/2026: si se cobró otro día, el arqueo
   * de hoy daba faltante).
   */
  cierre?: boolean;
  trabajando?: boolean;
  /** El error de la API: se ve acá adentro y la ventana queda abierta. */
  error?: string | null;
  onCerrar: () => void;
  onConfirmar: (medio?: string, extra?: { efectivoEnCaja: boolean }) => void;
}) {
  const [medio, setMedio] = useState<string>(!cierre && e.cobro.medio && MEDIOS_ENTREGA.some((m) => m.valor === e.cobro.medio) ? e.cobro.medio : '');
  const [enCaja, setEnCaja] = useState(false);
  const cobra = e.cobro.preguntar;
  const listo = (!cobra || !!medio) && !(cierre && medio === 'efectivo' && !enCaja);
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
          <Boton
            variante={cobra ? 'ok' : 'primario'}
            onClick={() => onConfirmar(cobra ? medio : undefined, { efectivoEnCaja: cierre && medio === 'efectivo' && enCaja })}
            disabled={!listo}
            cargando={trabajando}
          >
            {cobra ? textoBotonCobro : textoBoton}
          </Boton>
        </>
      }
    >
      <div className="space-y-3">
        {cobra ? (
          <>
            <p className="text-sm text-tinta">
              {cierre ? '¿Cómo se cobró?' : '¿Cómo pagó?'}
              {e.cobro.medio ? <span className="text-tinta/70"> Dijo {e.cobro.medio}.</span> : null}
            </p>
            <Chips etiquetaAccesible="Cómo pagó" valor={medio} onCambiar={(m) => { setMedio(m); setEnCaja(false); }} opciones={MEDIOS_ENTREGA} />
            {medio === 'efectivo' && !cierre && <p className="text-sm text-tinta/70">El efectivo entra en la caja abierta de la sucursal. Si no hay caja abierta, el sistema te lo va a pedir.</p>}
            {medio === 'efectivo' && cierre && (
              <div className="space-y-2 rounded-xl border border-atencion/20 bg-atencion-suave p-3">
                <p className="text-sm text-tinta">
                  El efectivo se suma a la caja abierta <b className="font-semibold">de hoy</b>. Si se cobró otro día y esa plata ya no está en el cajón, no lo cierres acá: el arqueo de hoy daría faltante. Consultalo con el dueño.
                </p>
                <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-tinta">
                  <input type="checkbox" checked={enCaja} onChange={(ev) => setEnCaja(ev.target.checked)} className="size-5 shrink-0 accent-marca" />
                  La plata está hoy en el cajón
                </label>
              </div>
            )}
            {medio === 'transferencia' && <p className="text-sm text-tinta/70">Confirmá que la transferencia entró antes de darlo por cobrado.</p>}
          </>
        ) : (
          <p className="text-sm text-tinta">{e.cobro.texto}: en la puerta no se cobra nada.</p>
        )}
        {aclaracion && <p className="text-sm text-tinta/70">{aclaracion}</p>}
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// --- quién lo lleva -------------------------------------------------------------

/** La lista de quién puede llevar un envío (repartidores y gente del local). */
export function useQuienLleva({ cadaMs = 0, activo = true }: { cadaMs?: number; activo?: boolean } = {}) {
  const [quien, setQuien] = useState<QuienLleva | null>(null);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    const r = await fetch('/api/envios?que=quien-lleva', { cache: 'no-store' }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (r?.ok && d && Array.isArray(d.repartidores) && Array.isArray(d.delLocal)) {
      setQuien(d);
      setError('');
    } else {
      setError(!r ? 'Sin conexión: no pude traer quién puede llevarlo.' : d?.message ?? 'No pude traer quién puede llevarlo.');
    }
  }, []);
  useEffect(() => {
    if (!activo) return;
    cargar();
    if (!cadaMs) return;
    const t = setInterval(cargar, cadaMs);
    return () => clearInterval(t);
  }, [cargar, cadaMs, activo]);
  return { quien, error, cargar };
}

/** Lo mínimo para despachar un envío desde cualquier pantalla (Envíos, Pedidos, Depósito). */
export type ParaDespachar = { id: string; codigo: string; cliente: string | null; direccion: string | null; repartidorId: string | null };

/**
 * «Sale …»: quién lo lleva y la confirmación (al cliente le llega un WhatsApp).
 * Salir exige alguien que lo lleve (DOM-YD5GNY quedó dos meses «en camino» sin
 * nadie). Es la misma ventana en Envíos, Pedidos y Depósito: caja y depósito no
 * abren Reparto, y antes «Despachar» los mandaba ahí y el panel los devolvía a
 * su inicio sin decir nada (revisión del 21/10/2026). Si la lista de quién lo
 * lleva no está, la carga acá mismo, con «Reintentar» si falla.
 */
export function ModalDespachar({
  envio,
  quien: quienDado,
  trabajando,
  error,
  puedeCargarRepartidor = false,
  onCerrar,
  onConfirmar,
}: {
  envio: ParaDespachar;
  /** gerencia y dueño: se les ofrece ir a cargar un repartidor (ver puedeCargarRepartidores) */
  puedeCargarRepartidor?: boolean;
  /** La lista ya cargada (Envíos); si no viene, la ventana la trae. */
  quien?: QuienLleva | null;
  trabajando?: boolean;
  error?: string | null;
  onCerrar: () => void;
  onConfirmar: (repartidorId: string, nombre: string) => void;
}) {
  const [elegido, setElegido] = useState(envio.repartidorId ?? '');
  const propia = useQuienLleva({ activo: !quienDado });
  const quien = quienDado ?? propia.quien;
  const nombre = quien ? [...quien.repartidores, ...quien.delLocal].find((u) => u.id === elegido)?.nombre ?? 'quien elegiste' : 'quien elegiste';
  return (
    <Modal
      abierto
      ancho="chico"
      onCerrar={onCerrar}
      bloquearCierre={trabajando}
      titulo={`Sale ${envio.codigo}`}
      descripcion={`${envio.cliente ?? 'Cliente'} · ${envio.direccion ?? 'sin dirección'}`}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>Volver</Boton>
          <Boton onClick={() => onConfirmar(elegido, nombre)} disabled={!elegido || !quien} cargando={trabajando}>Salió</Boton>
        </>
      }
    >
      <div className="space-y-3">
        {quien ? (
          <Campo etiqueta="¿Quién lo lleva?" ayuda="Sin alguien que lo lleve el envío no sale: así siempre se sabe quién lo tiene.">
            <SelectorQuienLleva enCampo quien={quien} valor={elegido} onCambiar={setElegido} permitirVacio={false} disabled={trabajando} />
          </Campo>
        ) : propia.error ? (
          <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={propia.cargar}>Reintentar</Boton>}>{propia.error}</Aviso>
        ) : (
          <Cargando texto="Buscando quién puede llevarlo…" />
        )}
        {quien && quien.repartidores.length === 0 && (
          <p className="text-sm text-tinta/70">
            {puedeCargarRepartidor ? (
              <>
                No hay repartidores cargados: elegí a alguien del local o{' '}
                <Link href="/reparto?vista=repartidores" className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>cargá un repartidor</Link>.
              </>
            ) : (
              'No hay repartidores cargados: elegí a alguien del local. El encargado puede cargar un repartidor en Reparto.'
            )}{' '}
            Quien lo lleve lo ve en «Mis entregas» (en el menú, o en Reparto si lo abre), con la dirección, el teléfono y qué cobrar.
          </p>
        )}
        <p className="text-sm text-tinta/70">Al cliente le llega el WhatsApp de que su pedido salió.</p>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// --- autorización para la guardia del barrio ------------------------------------

/**
 * La autorización de ingreso para la guardia (quién entra, con qué vehículo y a
 * dónde), sin la forma de pago. Existía en la API desde el módulo de
 * repartidores pero ninguna pantalla la pedía (revisión del 21/10/2026).
 */
export function ModalAutorizacion({ envio, onCerrar }: { envio: { id: string; codigo: string }; onCerrar: () => void }) {
  const [datos, setDatos] = useState<{ texto: string; seguroVencido?: boolean; polizaUrl?: string | null } | null>(null);
  const [error, setError] = useState('');
  const [copiada, setCopiada] = useState(false);
  const cargar = useCallback(async () => {
    setError('');
    const r = await fetch(`/api/envios?que=autorizacion&pedido=${encodeURIComponent(envio.id)}`, { cache: 'no-store' }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (r?.ok && typeof d?.texto === 'string') setDatos(d);
    else setError(!r ? 'Sin conexión: no pude armar la autorización.' : d?.message ?? 'No pude armar la autorización.');
  }, [envio.id]);
  useEffect(() => { cargar(); }, [cargar]);
  async function copiar() {
    if (!datos) return;
    try {
      await navigator.clipboard.writeText(datos.texto);
      setCopiada(true);
    } catch {
      setError('No pude copiarla: seleccioná el texto y copialo a mano.');
    }
  }
  return (
    <Modal
      abierto
      ancho="normal"
      onCerrar={onCerrar}
      titulo={`Autorización para la guardia · ${envio.codigo}`}
      descripcion="Para mandarle a la seguridad del barrio: quién entra, con qué vehículo y a dónde."
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
          {datos && (
            <>
              <Boton variante="secundario" onClick={copiar}>{copiada ? 'Copiada' : 'Copiar'}</Boton>
              <a href={`https://wa.me/?text=${encodeURIComponent(datos.texto)}`} target="_blank" rel="noopener noreferrer" className={clasesBoton({})}>
                Mandar por WhatsApp
              </a>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {error && <Aviso tono="error" accion={!datos ? <Boton tamano="chico" variante="secundario" onClick={cargar}>Reintentar</Boton> : undefined}>{error}</Aviso>}
        {!datos && !error && <Cargando texto="Armando la autorización…" />}
        {datos?.seguroVencido && <Aviso tono="atencion" titulo="El seguro del vehículo está vencido">Revisalo en Reparto › Repartidores antes de mandarla.</Aviso>}
        {datos && <pre className="whitespace-pre-wrap break-words rounded-xl bg-crema-claro p-3 font-sans text-sm text-tinta">{datos.texto}</pre>}
        {datos?.polizaUrl && (
          <a href={datos.polizaUrl} target="_blank" rel="noopener noreferrer" className={unir('text-sm font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>
            Ver la póliza del seguro
          </a>
        )}
      </div>
    </Modal>
  );
}

// --- cambiar cuándo o a dónde ---------------------------------------------------

const hoyEnCanning = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

/**
 * Cambiar la fecha y la franja de entrega o corregir la dirección (revisión del
 * 21/10/2026: un atrasado que el cliente pedía para otro día quedaba para
 * siempre en Atrasados). Manda solo lo que cambió.
 */
export function ModalCambiarEnvio({
  e,
  trabajando,
  error,
  onCerrar,
  onGuardar,
}: {
  e: Envio;
  trabajando?: boolean;
  error?: string | null;
  onCerrar: () => void;
  onGuardar: (cambios: { entregaFecha?: string | null; entregaFranja?: string | null; direccion?: string }) => void;
}) {
  const hoy = hoyEnCanning();
  // una fecha que ya pasó no se propone: hay que elegir otra
  const fechaInicial = e.entrega.fecha && e.entrega.fecha >= hoy ? e.entrega.fecha : '';
  const [fecha, setFecha] = useState(fechaInicial);
  const [franja, setFranja] = useState(e.entrega.franja ?? '');
  const [direccion, setDireccion] = useState(e.destino.direccion ?? '');
  const cambios: { entregaFecha?: string | null; entregaFranja?: string | null; direccion?: string } = {};
  if ((fecha || null) !== (e.entrega.fecha ?? null)) cambios.entregaFecha = fecha || null;
  if ((franja || null) !== (e.entrega.franja ?? null)) cambios.entregaFranja = franja || null;
  if (direccion.trim() !== (e.destino.direccion ?? '')) cambios.direccion = direccion.trim();
  const fechaMal = !!fecha && fecha < hoy;
  const sinDireccion = !direccion.trim();
  const hayCambios = Object.keys(cambios).length > 0;
  return (
    <Modal
      abierto
      ancho="chico"
      onCerrar={onCerrar}
      bloquearCierre={trabajando}
      titulo={`Cambiar ${e.codigo}`}
      descripcion={`Ahora: ${e.entrega.texto}`}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>Volver</Boton>
          <Boton onClick={() => onGuardar(cambios)} disabled={!hayCambios || fechaMal || sinDireccion} cargando={trabajando}>Guardar</Boton>
        </>
      }
    >
      <div className="space-y-4">
        <Campo etiqueta="Qué día" ayuda="Vacío = lo antes posible." error={fechaMal ? 'No puede ser antes de hoy.' : undefined}>
          <Entrada type="date" min={hoy} value={fecha} onChange={(ev) => setFecha(ev.target.value)} disabled={trabajando} />
        </Campo>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-tinta">Franja</p>
          <Chips etiquetaAccesible="Franja" valor={franja} onCambiar={setFranja} opciones={FRANJAS} />
        </div>
        <Campo etiqueta="Dirección" error={sinDireccion ? 'Falta la dirección.' : undefined} ayuda="Si cambia, el mapa usa la nueva.">
          <Entrada value={direccion} onChange={(ev) => setDireccion(ev.target.value)} maxLength={300} autoComplete="off" disabled={trabajando} />
        </Campo>
        <p className="text-sm text-tinta/70">Queda en el historial del pedido. Al cliente no se le manda nada: avisale vos si hace falta.</p>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}
