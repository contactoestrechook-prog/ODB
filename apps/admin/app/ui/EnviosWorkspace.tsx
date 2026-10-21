'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { haceCuanto, origenDe } from '../lib/pedidos';
import { enVivoTexto, ESTADO_ENVIO, pasoDe, PASOS, type Envio, type QuienLleva } from '../lib/envios';
import { FaltantesAlEntregar, faltaDeStock, type FaltaDeStock } from './FaltantesAlEntregar';
import {
  DatosDelEnvio, ModalAutorizacion, ModalCambiarEnvio, ModalDespachar, ModalEntregarEnvio, PlacaDelEnvio, SelectorQuienLleva, useQuienLleva,
} from './EnvioPartes';
import {
  Aviso, Boton, BotonLink, Campo, Cargando, Etiqueta, IconoAtencion, Kpi, ROTULO, Tarjeta, unir, useConfirmar, Vacio,
} from './kit';

// ENVÍOS A DOMICILIO, la primera sección de Reparto (Leandro, 21/10/2026:
// «misma basura» y «hacelo bien pro»).
//
// Antes: tres números, tarjetas con nombre y total, «Indicaciones» con la
// sintaxis del bot adentro, un desplegable de repartidores vacío sin forma de
// cargar uno y un solo botón. Ni teléfono, ni productos, ni horario, y nada
// avisaba que tres pedidos del bot llevaban días en «Recibido» y uno de agosto
// seguía «En camino».
//
// Ahora la pantalla está ordenada por lo que hay que hacer: Atrasados (en rojo,
// con cuánto hace), Para hoy y Programados; adentro, por paso (para preparar,
// preparando, listos para salir, en la calle). Cada envío trae a quién (con
// WhatsApp y llamar), a dónde (con el mapa), cuándo, qué lleva (Placa roja),
// cómo se cobra y las indicaciones limpias. No sale sin alguien que lo lleve,
// al entregar pregunta cómo pagó, y a los atrasados viejos les pregunta
// directo «¿Se entregó o se cancela?».
//
// Revisión del mismo día:
// - El resultado de cada acción se ve EN su tarjeta (en el celular una tarjeta
//   mide casi una pantalla y el aviso de arriba quedaba fuera de la vista). Las
//   ventanas de «Salió», «Entregado» y «Cambiar» quedan abiertas hasta que la
//   API contesta y, si algo falla, lo dicen adentro.
// - «Salió» abre siempre la ventana (quién lo lleva y que al cliente le llega
//   un WhatsApp); la ventana carga sola la lista si no estaba.
// - Se puede cambiar cuándo (fecha y franja) y corregir la dirección, y pedir
//   la autorización para la guardia del barrio.
// - Si la API todavía es la anterior (se publicó el panel primero), lo dice en
//   lugar de mostrar «Nada para hoy» con envíos pendientes.

type Respuesta = { ok: boolean; status: number; datos: any };
type AvisoEnvio = { tono: 'ok' | 'error'; texto: string };

const SECCIONES: { grupo: Envio['grupo']; titulo: string; bajada: string }[] = [
  { grupo: 'atrasado', titulo: 'Atrasados', bajada: 'Resolvelos primero: la fecha pasó, nadie los movió en un día o salieron hace más de 12 horas.' },
  { grupo: 'hoy', titulo: 'Para hoy', bajada: 'Pactados para hoy y los que no tienen fecha (lo antes posible).' },
  { grupo: 'programado', titulo: 'Programados', bajada: 'Tienen fecha más adelante: se preparan ese día.' },
];

/** El envío que arma la API nueva (si falta, la API es la anterior). */
const esEnvioNuevo = (x: any) => !!x && typeof x.grupo === 'string' && !!x.entrega && !!x.cobro && !!x.cliente;

export function EnviosWorkspace({ destacar }: { destacar?: string | null }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [apiVieja, setApiVieja] = useState<number | null>(null);
  const { quien } = useQuienLleva({ cadaMs: 60_000 });
  const [errorCarga, setErrorCarga] = useState('');
  // el resultado de cada acción, en la tarjeta de ese envío
  const [avisos, setAvisos] = useState<Record<string, AvisoEnvio>>({});
  // los de los envíos que se cerraron (la tarjeta ya no está)
  const [avisoGeneral, setAvisoGeneral] = useState<AvisoEnvio | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [falta, setFalta] = useState<{ datos: FaltaDeStock; reintentar: () => Promise<void> } | null>(null);
  const [despachando, setDespachando] = useState<Envio | null>(null);
  const [entregando, setEntregando] = useState<{ e: Envio; cierre: boolean } | null>(null);
  const [cambiando, setCambiando] = useState<Envio | null>(null);
  const [autorizando, setAutorizando] = useState<Envio | null>(null);
  const [errorVentana, setErrorVentana] = useState<string | null>(null);
  const { confirmar, dialogo } = useConfirmar();
  const yaDestacado = useRef(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/envios', { cache: 'no-store' }).catch(() => null);
    if (!r) { setErrorCarga('Sin conexión: no pude traer los envíos. Reintento solo en unos segundos.'); return; }
    const d = await r.json().catch(() => null);
    if (r.status === 403) { setErrorCarga('Tu usuario no puede ver los envíos. Pedíselo a un dueño.'); setEnvios((v) => v ?? []); return; }
    if (!r.ok || !Array.isArray(d)) { setErrorCarga(d?.message ?? 'No pude traer los envíos.'); return; }
    setErrorCarga('');
    if (d.some((x) => !esEnvioNuevo(x))) {
      setApiVieja(d.length);
      setEnvios([]);
      return;
    }
    setApiVieja(null);
    setEnvios(d);
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 8000);
    return () => clearInterval(t);
  }, [cargar]);

  // ?pedido=<id>: se baja hasta ese envío y queda marcado
  useEffect(() => {
    if (!destacar || !envios || yaDestacado.current) return;
    yaDestacado.current = true;
    requestAnimationFrame(() => document.getElementById(`envio-${destacar}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [destacar, envios]);

  const avisoDe = (id: string, aviso: AvisoEnvio | null) =>
    setAvisos((a) => {
      const nuevo = { ...a };
      if (aviso) nuevo[id] = aviso;
      else delete nuevo[id];
      return nuevo;
    });

  async function llamar(url: string, metodo: 'POST' | 'PATCH', cuerpo: any): Promise<Respuesta> {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => null);
    if (!r) return { ok: false, status: 0, datos: { message: 'Sin conexión. Probá de nuevo.' } };
    return { ok: r.ok, status: r.status, datos: await r.json().catch(() => ({})) };
  }

  /**
   * Cada acción: si falta stock abre la ventana de faltantes (y al terminar
   * repite la misma acción); si falta quién lo lleva, pregunta. El resultado va
   * a la tarjeta. Con `enVentana`, el error vuelve para mostrarlo en la ventana
   * abierta (que no se cierra); devuelve null si salió bien.
   */
  async function hacer(
    e: Envio,
    accion: () => Promise<Respuesta>,
    hecho: string,
    { cierra = false, enVentana = false }: { cierra?: boolean; enVentana?: boolean } = {},
  ): Promise<string | null> {
    setTrabajando(e.id);
    avisoDe(e.id, null);
    const r = await accion();
    setTrabajando(null);
    if (!r.ok) {
      const fs = faltaDeStock(e.id, r.status, r.datos);
      if (fs) {
        setEntregando(null);
        setDespachando(null);
        setFalta({ datos: fs, reintentar: async () => { await hacer(e, accion, hecho, { cierra }); } });
        return null;
      }
      if (r.datos?.codigo === 'FALTA_REPARTIDOR') { setEntregando(null); setErrorVentana(null); setDespachando(e); return null; }
      const texto = r.datos?.message ?? 'No se pudo hacer el cambio.';
      if (!enVentana) avisoDe(e.id, { tono: 'error', texto });
      await cargar();
      return texto;
    }
    if (cierra) setAvisoGeneral({ tono: 'ok', texto: `${e.codigo}: ${hecho}` });
    else avisoDe(e.id, { tono: 'ok', texto: hecho });
    await cargar();
    return null;
  }

  const avanzar = (
    e: Envio,
    estado: string,
    extra: { medioPago?: string; repartidorId?: string } = {},
    hecho = 'listo.',
    opciones: { cierra?: boolean; enVentana?: boolean } = {},
  ) =>
    hacer(e, () => llamar('/api/pedidos', 'POST', { pedidoId: e.id, estado, ...extra }), hecho, opciones);

  // en una ventana: si sale bien se cierra; si no, el error queda adentro
  async function desdeVentana(cerrar: () => void, tarea: () => Promise<string | null>) {
    setErrorVentana(null);
    const error = await tarea();
    if (error) setErrorVentana(error);
    else cerrar();
  }

  function principal(e: Envio) {
    if (['recibido', 'pagado'].includes(e.estado)) return avanzar(e, 'en_preparacion', {}, 'Se empezó a preparar.');
    if (e.estado === 'en_preparacion') return avanzar(e, 'listo', {}, 'Quedó listo para salir.');
    // salir siempre pasa por la ventana: quién lo lleva y que al cliente le llega un WhatsApp
    if (e.estado === 'listo') { setErrorVentana(null); setDespachando(e); return; }
    if (e.estado === 'en_camino') { setErrorVentana(null); setEntregando({ e, cierre: false }); }
  }

  async function asignar(e: Envio, repartidorId: string) {
    const nombre = [...(quien?.repartidores ?? []), ...(quien?.delLocal ?? [])].find((u) => u.id === repartidorId)?.nombre;
    // se ve en el momento; si la API no lo acepta, vuelve y lo dice en la tarjeta
    setEnvios((lista) => lista?.map((x) => (x.id === e.id ? { ...x, repartidor: repartidorId ? { id: repartidorId, nombre: nombre ?? 'Alguien del equipo' } : null } : x)) ?? lista);
    await hacer(
      e,
      () => llamar(`/api/pedidos/${encodeURIComponent(e.id)}/repartidor`, 'PATCH', { repartidorId: repartidorId || null }),
      repartidorId ? `Lo lleva ${nombre ?? 'quien elegiste'}.` : 'Quedó sin asignar.',
    );
  }

  async function cancelar(e: Envio, directo = false) {
    const ok = await confirmar({
      titulo: directo ? `¿Se cancela ${e.codigo}?` : `¿Cancelar ${e.codigo}?`,
      texto: `${e.cliente.nombre ?? 'El cliente'} · ${e.destino.direccion ?? 'sin dirección'}. Se devuelve el stock reservado y le llega la baja a administración. Al cliente no se le manda nada: avisale vos si hace falta.`,
      variante: 'peligro',
      textoConfirmar: 'Cancelar el envío',
      textoCancelar: 'Volver',
    });
    if (ok) await avanzar(e, 'cancelado', {}, 'quedó cancelado.', { cierra: true });
  }

  const lista = envios ?? [];
  const atrasados = lista.filter((e) => e.grupo === 'atrasado');
  const paraHoy = lista.filter((e) => e.grupo === 'hoy');
  const programados = lista.filter((e) => e.grupo === 'programado');
  const enLaCalle = lista.filter((e) => e.estado === 'en_camino').length;
  const sinRepartidor = lista.filter((e) => e.grupo !== 'programado' && !e.repartidor).length;
  const sinRepartidores = quien !== null && quien.repartidores.length === 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {errorCarga && <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={cargar}>Reintentar</Boton>}>{errorCarga}</Aviso>}
      {apiVieja !== null && (
        <Aviso tono="atencion" titulo="Falta actualizar el servidor">
          Esta pantalla es nueva y el servidor todavía tiene la versión anterior, así que no puede mostrar los envíos
          {apiVieja ? ` (hay ${apiVieja === 1 ? '1 abierto' : `${apiVieja} abiertos`})` : ''}. Mientras tanto, despachalos desde Pedidos. Si en unos minutos sigue así, avisale a Leandro.
        </Aviso>
      )}
      {avisoGeneral && (
        <Aviso tono={avisoGeneral.tono} accion={<Boton tamano="chico" variante="secundario" onClick={() => setAvisoGeneral(null)}>Entendido</Boton>}>
          {avisoGeneral.texto}
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Atrasados" valor={atrasados.length} tono={atrasados.length ? 'error' : 'neutro'} sub={atrasados.length ? 'resolvelos primero' : 'ninguno'} />
        <Kpi etiqueta="Para hoy" valor={paraHoy.length} sub={programados.length === 1 ? '1 programado' : programados.length ? `${programados.length} programados` : 'sin programados'} />
        <Kpi etiqueta="En la calle" valor={enLaCalle} tono={enLaCalle ? 'info' : 'neutro'} />
        <Kpi etiqueta="Sin repartidor" valor={sinRepartidor} tono={sinRepartidor ? 'atencion' : 'neutro'} sub="de hoy y atrasados" />
      </div>

      {sinRepartidores && (
        <Aviso
          tono="atencion"
          titulo="No hay repartidores cargados"
          accion={<BotonLink href="/reparto?vista=repartidores" tamano="chico" variante="secundario">Cargar un repartidor</BotonLink>}
        >
          Mientras tanto, cada envío puede salir con alguien del local (encargado, caja o depósito): elegilo en «Quién lo lleva». Esa persona lo ve en «Mis entregas» (o en Entregas en la calle), con la dirección, el teléfono y qué cobrar, y lo marca entregado desde ahí.
        </Aviso>
      )}

      {envios === null ? (
        <Tarjeta relleno={false}>
          <Cargando bloque texto="Buscando los envíos…" />
        </Tarjeta>
      ) : apiVieja !== null ? null : lista.length === 0 ? (
        !errorCarga && (
          <Vacio
            titulo="No hay envíos a domicilio pendientes"
            texto="Los pedidos a domicilio del bot, la tienda web y la app aparecen acá apenas entran, ordenados por lo que hay que hacer."
          />
        )
      ) : (
        SECCIONES.map(({ grupo, titulo, bajada }) => {
          const deEste = lista.filter((e) => e.grupo === grupo);
          if (!deEste.length && grupo !== 'hoy') return null;
          return (
            <section key={grupo} aria-labelledby={`envios-${grupo}`} className="space-y-3">
              <div className="px-1">
                <h2 id={`envios-${grupo}`} className={unir('flex items-baseline gap-2 text-lg font-semibold', grupo === 'atrasado' ? 'text-marca-hondo' : 'text-tinta')}>
                  {grupo === 'atrasado' && <IconoAtencion className="size-5 shrink-0 self-center" />}
                  {titulo}
                  <span className="importe text-sm font-medium text-tinta/60">{deEste.length}</span>
                </h2>
                <p className="text-xs text-tinta/60">{bajada}</p>
              </div>
              {deEste.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/15 p-5 text-center text-sm text-tinta/60">Nada para hoy por ahora.</p>
              ) : (
                PASOS.map((paso) => {
                  const enPaso = deEste.filter((e) => paso.estados.includes(e.estado));
                  if (!enPaso.length) return null;
                  return (
                    <div key={paso.titulo} className="space-y-3">
                      <h3 className={unir(ROTULO, 'px-1')}>{paso.titulo} · {enPaso.length}</h3>
                      {enPaso.map((e) => (
                        <TarjetaEnvio
                          key={e.id}
                          e={e}
                          quien={quien}
                          trabajando={trabajando === e.id}
                          destacado={destacar === e.id}
                          aviso={avisos[e.id] ?? null}
                          onCerrarAviso={() => avisoDe(e.id, null)}
                          onPrincipal={() => principal(e)}
                          onAsignar={(id) => asignar(e, id)}
                          onCancelar={() => cancelar(e, e.paraCerrar)}
                          onSeEntrego={() => { setErrorVentana(null); setEntregando({ e, cierre: true }); }}
                          onCambiar={() => { setErrorVentana(null); setCambiando(e); }}
                          onAutorizacion={() => setAutorizando(e)}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </section>
          );
        })
      )}

      {despachando && (
        <ModalDespachar
          envio={{
            id: despachando.id,
            codigo: despachando.codigo,
            cliente: despachando.cliente.nombre,
            direccion: despachando.destino.direccion,
            repartidorId: despachando.repartidor?.id ?? null,
          }}
          quien={quien ?? undefined}
          trabajando={trabajando === despachando.id}
          error={errorVentana}
          onCerrar={() => { setDespachando(null); setErrorVentana(null); }}
          onConfirmar={(repartidorId, nombre) => {
            const e = despachando;
            desdeVentana(() => setDespachando(null), () => avanzar(e, 'en_camino', { repartidorId }, `Salió con ${nombre}.`, { enVentana: true }));
          }}
        />
      )}
      {entregando && (
        <ModalEntregarEnvio
          e={entregando.e}
          cierre={entregando.cierre}
          titulo={entregando.cierre ? `${entregando.e.codigo}: se entregó` : undefined}
          textoBoton={entregando.cierre ? 'Se entregó' : 'Entregado'}
          textoBotonCobro={entregando.cierre ? 'Se entregó y se cobró' : 'Entregado y cobrado'}
          aclaracion={
            entregando.cierre
              ? 'Se registra hoy la venta (y el cobro, si corresponde) y sale del stock. Al cliente no le llega ningún WhatsApp: ya lo recibió.'
              : 'Al cliente le llega el WhatsApp de que se entregó.'
          }
          trabajando={trabajando === entregando.e.id}
          error={errorVentana}
          onCerrar={() => { setEntregando(null); setErrorVentana(null); }}
          onConfirmar={(medioPago, extra) => {
            const { e, cierre } = entregando;
            desdeVentana(
              () => setEntregando(null),
              () =>
                cierre
                  ? hacer(e, () => llamar('/api/envios', 'POST', { accion: 'se-entrego', pedidoId: e.id, medioPago, efectivoEnCaja: extra?.efectivoEnCaja === true }), 'quedó entregado.', { cierra: true, enVentana: true })
                  : avanzar(e, 'entregado', { medioPago }, 'entregado.', { cierra: true, enVentana: true }),
            );
          }}
        />
      )}
      {cambiando && (
        <ModalCambiarEnvio
          e={cambiando}
          trabajando={trabajando === cambiando.id}
          error={errorVentana}
          onCerrar={() => { setCambiando(null); setErrorVentana(null); }}
          onGuardar={(cambios) => {
            const e = cambiando;
            desdeVentana(
              () => setCambiando(null),
              () => hacer(e, () => llamar('/api/envios', 'PATCH', { pedidoId: e.id, ...cambios }), 'Se guardó el cambio.', { enVentana: true }),
            );
          }}
        />
      )}
      {autorizando && <ModalAutorizacion envio={{ id: autorizando.id, codigo: autorizando.codigo }} onCerrar={() => setAutorizando(null)} />}
      {falta && (
        <FaltantesAlEntregar
          falta={falta.datos}
          onCerrar={() => { setFalta(null); cargar(); }}
          onEntregar={async () => { const f = falta; setFalta(null); await f.reintentar(); }}
        />
      )}
      {dialogo}
    </div>
  );
}

function TarjetaEnvio({
  e, quien, trabajando, destacado, aviso, onCerrarAviso, onPrincipal, onAsignar, onCancelar, onSeEntrego, onCambiar, onAutorizacion,
}: {
  e: Envio;
  quien: QuienLleva | null;
  trabajando: boolean;
  destacado: boolean;
  aviso: AvisoEnvio | null;
  onCerrarAviso: () => void;
  onPrincipal: () => void;
  onAsignar: (id: string) => void;
  onCancelar: () => void;
  onSeEntrego: () => void;
  onCambiar: () => void;
  onAutorizacion: () => void;
}) {
  const estado = ESTADO_ENVIO[e.estado] ?? { label: e.estado, tono: 'neutro' as const };
  const paso = pasoDe(e.estado);
  const origen = e.origen ? origenDe({ origen: e.origen, canal: 'domicilio' }) : null;
  const vivo = enVivoTexto(e);
  // un programado se puede preparar antes, pero no es lo que corresponde hoy
  const adelantado = e.grupo === 'programado' && ['recibido', 'pagado'].includes(e.estado);
  const sinQuien = e.estado === 'listo' && !e.repartidor;
  // lo que salió bien se va solo; un error queda hasta que alguien lo lee. La
  // pantalla se recarga cada 8 s: el reloj depende solo del aviso.
  const cerrarAviso = useRef(onCerrarAviso);
  cerrarAviso.current = onCerrarAviso;
  useEffect(() => {
    if (aviso?.tono !== 'ok') return;
    const t = setTimeout(() => cerrarAviso.current(), 8000);
    return () => clearTimeout(t);
  }, [aviso]);

  return (
    <Tarjeta
      id={`envio-${e.id}`}
      aria-label={`Envío ${e.codigo} de ${e.cliente.nombre ?? 'cliente sin nombre'}`}
      className={unir('scroll-mt-24', destacado ? 'ring-2 ring-info/60' : e.grupo === 'atrasado' && 'ring-2 ring-marca/40')}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-3 lg:col-start-1">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta tono={estado.tono} punto>{estado.label}</Etiqueta>
            {origen && <Etiqueta tono={origen.tono}>{origen.label}</Etiqueta>}
            <span className="importe min-w-0 text-xs text-tinta/60 sm:ml-auto">
              {e.codigo} · entró {haceCuanto(e.creado_en)}
            </span>
          </div>

          {e.atraso && (
            <p className="flex items-start gap-1.5 break-words text-sm font-semibold text-marca-hondo">
              <IconoAtencion className="mt-0.5 size-4 shrink-0" />
              {e.atraso.texto}
            </p>
          )}

          <p className="break-words text-base font-semibold text-tinta">{e.cliente.nombre ?? 'Cliente sin nombre'}</p>

          <DatosDelEnvio e={e} />

          <div className="max-w-sm">
            {quien ? (
              <Campo
                etiqueta="Quién lo lleva"
                error={sinQuien ? 'Elegí quién lo lleva para que pueda salir.' : undefined}
                ayuda={vivo && e.repartidor ? `${e.repartidor.nombre} está ${vivo}` : undefined}
              >
                <SelectorQuienLleva
                  enCampo
                  quien={quien}
                  valor={e.repartidor?.id ?? ''}
                  onCambiar={onAsignar}
                  permitirVacio={e.estado !== 'en_camino'}
                  disabled={trabajando}
                />
              </Campo>
            ) : (
              <p className="text-sm text-tinta/70">Lo lleva: {e.repartidor?.nombre ?? 'sin asignar'}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Boton variante="secundario" tamano="chico" onClick={onCambiar} disabled={trabajando}>Cambiar cuándo o dirección</Boton>
            {e.repartidor && (
              <Boton variante="secundario" tamano="chico" onClick={onAutorizacion} disabled={trabajando}>Autorización para la guardia</Boton>
            )}
          </div>
        </div>

        <PlacaDelEnvio e={e} className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" />

        <div className="min-w-0 space-y-3 lg:col-start-1">
          {e.paraCerrar ? (
            <div className="space-y-3 rounded-xl border border-marca/20 bg-marca-suave p-3">
              <p className="text-sm font-semibold text-tinta">¿Se entregó o se cancela?</p>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={onSeEntrego} cargando={trabajando} className="grow sm:grow-0">Se entregó</Boton>
                <Boton variante="peligro" onClick={onCancelar} disabled={trabajando} className="grow sm:grow-0">Se cancela</Boton>
                {paso?.pendiente && (
                  <Boton variante="secundario" onClick={onPrincipal} disabled={trabajando} className="grow sm:grow-0">
                    {paso.pendiente}
                  </Boton>
                )}
              </div>
              <p className="text-xs text-tinta/70">Si el cliente lo quiere para otro día, «Cambiar cuándo o dirección» lo saca de Atrasados.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {adelantado && <p className="text-xs text-tinta/60">Es para {e.entrega.texto.charAt(0).toLowerCase() + e.entrega.texto.slice(1)}: prepararlo antes solo si hace falta.</p>}
              <div className="flex flex-wrap items-center gap-2">
                {paso?.boton && (
                  <Boton variante={adelantado ? 'secundario' : 'primario'} onClick={onPrincipal} cargando={trabajando} className="grow sm:grow-0">
                    {paso.boton}
                  </Boton>
                )}
                <Boton variante="peligro" onClick={onCancelar} disabled={trabajando} className="grow sm:ml-auto sm:grow-0">Cancelar</Boton>
              </div>
            </div>
          )}
          {aviso && (
            <Aviso tono={aviso.tono} accion={<Boton tamano="chico" variante="secundario" onClick={onCerrarAviso}>Entendido</Boton>}>
              {aviso.texto}
            </Aviso>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}
