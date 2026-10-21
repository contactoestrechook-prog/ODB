'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { haceCuanto, origenDe } from '../lib/pedidos';
import { enVivoTexto, ESTADO_ENVIO, pasoDe, PASOS, type Envio, type QuienLleva } from '../lib/envios';
import { FaltantesAlEntregar, faltaDeStock, type FaltaDeStock } from './FaltantesAlEntregar';
import { DatosDelEnvio, ModalEntregarEnvio, PlacaDelEnvio, SelectorQuienLleva } from './EnvioPartes';
import {
  Aviso, Boton, BotonLink, Campo, Cargando, Etiqueta, FOCO, IconoAtencion, Kpi, Modal, ROTULO, Tarjeta, unir, useConfirmar, Vacio,
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

type Respuesta = { ok: boolean; status: number; datos: any };

const SECCIONES: { grupo: Envio['grupo']; titulo: string; bajada: string }[] = [
  { grupo: 'atrasado', titulo: 'Atrasados', bajada: 'Resolvelos primero: la fecha pasó, nadie los movió en un día o salieron hace más de 12 horas.' },
  { grupo: 'hoy', titulo: 'Para hoy', bajada: 'Pactados para hoy y los que no tienen fecha (lo antes posible).' },
  { grupo: 'programado', titulo: 'Programados', bajada: 'Tienen fecha más adelante: se preparan ese día.' },
];

export function EnviosWorkspace({ destacar }: { destacar?: string | null }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [quien, setQuien] = useState<QuienLleva | null>(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [falta, setFalta] = useState<{ datos: FaltaDeStock; reintentar: () => Promise<void> } | null>(null);
  const [despachando, setDespachando] = useState<Envio | null>(null);
  const [entregando, setEntregando] = useState<{ e: Envio; cierre: boolean } | null>(null);
  const { confirmar, dialogo } = useConfirmar();
  const yaDestacado = useRef(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/envios', { cache: 'no-store' }).catch(() => null);
    if (!r) { setErrorCarga('Sin conexión: no pude traer los envíos. Reintento solo en unos segundos.'); return; }
    const d = await r.json().catch(() => null);
    if (r.status === 403) { setErrorCarga('Tu usuario no puede ver los envíos. Pedíselo a un dueño.'); setEnvios((v) => v ?? []); return; }
    if (!r.ok || !Array.isArray(d)) { setErrorCarga(d?.message ?? 'No pude traer los envíos.'); return; }
    setErrorCarga('');
    setEnvios(d);
  }, []);
  const cargarQuien = useCallback(async () => {
    const r = await fetch('/api/envios?que=quien-lleva', { cache: 'no-store' }).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d && Array.isArray(d.repartidores) && Array.isArray(d.delLocal)) setQuien(d);
  }, []);

  useEffect(() => {
    cargar();
    cargarQuien();
    const t = setInterval(cargar, 8000);
    const q = setInterval(cargarQuien, 60_000);
    return () => { clearInterval(t); clearInterval(q); };
  }, [cargar, cargarQuien]);

  // ?pedido=<id> (desde Pedidos): se baja hasta ese envío y queda marcado
  useEffect(() => {
    if (!destacar || !envios || yaDestacado.current) return;
    yaDestacado.current = true;
    requestAnimationFrame(() => document.getElementById(`envio-${destacar}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [destacar, envios]);

  async function llamar(url: string, metodo: 'POST' | 'PATCH', cuerpo: any): Promise<Respuesta> {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => null);
    if (!r) return { ok: false, status: 0, datos: { message: 'Sin conexión. Probá de nuevo.' } };
    return { ok: r.ok, status: r.status, datos: await r.json().catch(() => ({})) };
  }

  // Cada acción: si falta stock abre la ventana de faltantes (y al terminar
  // repite la misma acción); si falta quién lo lleva, pregunta; si no, avisa.
  async function hacer(e: Envio, accion: () => Promise<Respuesta>, hecho: string) {
    setTrabajando(e.id);
    setAviso(null);
    const r = await accion();
    setTrabajando(null);
    if (!r.ok) {
      const fs = faltaDeStock(e.id, r.status, r.datos);
      if (fs) { setFalta({ datos: fs, reintentar: () => hacer(e, accion, hecho) }); return; }
      if (r.datos?.codigo === 'FALTA_REPARTIDOR') { setDespachando(e); return; }
      setAviso({ tono: 'error', texto: `${e.codigo}: ${r.datos?.message ?? 'no se pudo hacer el cambio.'}` });
    } else {
      setAviso({ tono: 'ok', texto: `${e.codigo}: ${hecho}` });
    }
    await cargar();
  }

  const avanzar = (e: Envio, estado: string, extra: { medioPago?: string; repartidorId?: string } = {}, hecho = 'listo.') =>
    hacer(e, () => llamar('/api/pedidos', 'POST', { pedidoId: e.id, estado, ...extra }), hecho);

  function principal(e: Envio) {
    if (['recibido', 'pagado'].includes(e.estado)) return avanzar(e, 'en_preparacion', {}, 'se empezó a preparar.');
    if (e.estado === 'en_preparacion') return avanzar(e, 'listo', {}, 'quedó listo para salir.');
    if (e.estado === 'listo') {
      if (!e.repartidor) { setDespachando(e); return; }
      return avanzar(e, 'en_camino', {}, `salió con ${e.repartidor.nombre}.`);
    }
    if (e.estado === 'en_camino') setEntregando({ e, cierre: false });
  }

  async function asignar(e: Envio, repartidorId: string) {
    const nombre = [...(quien?.repartidores ?? []), ...(quien?.delLocal ?? [])].find((u) => u.id === repartidorId)?.nombre;
    // se ve en el momento; si la API no lo acepta, vuelve y lo dice
    setEnvios((lista) => lista?.map((x) => (x.id === e.id ? { ...x, repartidor: repartidorId ? { id: repartidorId, nombre: nombre ?? 'Alguien del equipo' } : null } : x)) ?? lista);
    await hacer(e, () => llamar(`/api/pedidos/${encodeURIComponent(e.id)}/repartidor`, 'PATCH', { repartidorId: repartidorId || null }), repartidorId ? `lo lleva ${nombre ?? 'quien elegiste'}.` : 'quedó sin asignar.');
  }

  async function cancelar(e: Envio, directo = false) {
    const ok = await confirmar({
      titulo: directo ? `¿Se cancela ${e.codigo}?` : `¿Cancelar ${e.codigo}?`,
      texto: `${e.cliente.nombre ?? 'El cliente'} · ${e.destino.direccion ?? 'sin dirección'}. Se devuelve el stock reservado y le llega la baja a administración. Al cliente no se le manda nada: avisale vos si hace falta.`,
      variante: 'peligro',
      textoConfirmar: 'Cancelar el envío',
      textoCancelar: 'Volver',
    });
    if (ok) await avanzar(e, 'cancelado', {}, 'quedó cancelado.');
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
      {aviso && (
        <Aviso tono={aviso.tono} accion={<Boton tamano="chico" variante="secundario" onClick={() => setAviso(null)}>Entendido</Boton>}>
          {aviso.texto}
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
          Mientras tanto, cada envío puede salir con alguien del local: elegilo en «Quién lo lleva».
        </Aviso>
      )}

      {envios === null ? (
        <Tarjeta relleno={false}>
          <Cargando bloque texto="Buscando los envíos…" />
        </Tarjeta>
      ) : lista.length === 0 ? (
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
                          onPrincipal={() => principal(e)}
                          onAsignar={(id) => asignar(e, id)}
                          onCancelar={() => cancelar(e, e.paraCerrar)}
                          onSeEntrego={() => setEntregando({ e, cierre: true })}
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

      {despachando && quien && (
        <ModalDespachar
          e={despachando}
          quien={quien}
          trabajando={trabajando === despachando.id}
          onCerrar={() => setDespachando(null)}
          onConfirmar={async (repartidorId) => {
            const e = despachando;
            const nombre = [...quien.repartidores, ...quien.delLocal].find((u) => u.id === repartidorId)?.nombre ?? 'quien elegiste';
            setDespachando(null);
            await avanzar(e, 'en_camino', { repartidorId }, `salió con ${nombre}.`);
          }}
        />
      )}
      {entregando && (
        <ModalEntregarEnvio
          e={entregando.e}
          titulo={entregando.cierre ? `${entregando.e.codigo}: se entregó` : undefined}
          textoBoton={entregando.cierre ? 'Se entregó' : 'Entregado'}
          textoBotonCobro={entregando.cierre ? 'Se entregó y se cobró' : 'Entregado y cobrado'}
          aclaracion={
            entregando.cierre
              ? 'Se registra hoy la venta (y el cobro, si corresponde) y sale del stock. Al cliente no le llega ningún WhatsApp: ya lo recibió.'
              : 'Al cliente le llega el WhatsApp de que se entregó.'
          }
          trabajando={trabajando === entregando.e.id}
          onCerrar={() => setEntregando(null)}
          onConfirmar={async (medioPago) => {
            const { e, cierre } = entregando;
            setEntregando(null);
            if (cierre) await hacer(e, () => llamar('/api/envios', 'POST', { accion: 'se-entrego', pedidoId: e.id, medioPago }), 'quedó entregado.');
            else await avanzar(e, 'entregado', { medioPago }, 'entregado.');
          }}
        />
      )}
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
  e, quien, trabajando, destacado, onPrincipal, onAsignar, onCancelar, onSeEntrego,
}: {
  e: Envio;
  quien: QuienLleva | null;
  trabajando: boolean;
  destacado: boolean;
  onPrincipal: () => void;
  onAsignar: (id: string) => void;
  onCancelar: () => void;
  onSeEntrego: () => void;
}) {
  const estado = ESTADO_ENVIO[e.estado] ?? { label: e.estado, tono: 'neutro' as const };
  const paso = pasoDe(e.estado);
  const origen = e.origen ? origenDe({ origen: e.origen, canal: 'domicilio' }) : null;
  const vivo = enVivoTexto(e);
  // un programado se puede preparar antes, pero no es lo que corresponde hoy
  const adelantado = e.grupo === 'programado' && ['recibido', 'pagado'].includes(e.estado);
  const sinQuien = e.estado === 'listo' && !e.repartidor;

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
        </div>

        <PlacaDelEnvio e={e} className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" />

        <div className="min-w-0 lg:col-start-1">
          {e.paraCerrar ? (
            <div className="space-y-3 rounded-xl border border-marca/20 bg-marca-suave p-3">
              <p className="text-sm font-semibold text-tinta">¿Se entregó o se cancela?</p>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={onSeEntrego} cargando={trabajando} className="grow sm:grow-0">Se entregó</Boton>
                <Boton variante="peligro" onClick={onCancelar} disabled={trabajando} className="grow sm:grow-0">Se cancela</Boton>
                {e.estado !== 'en_camino' && paso?.boton && (
                  <Boton variante="secundario" onClick={onPrincipal} disabled={trabajando} className="grow sm:grow-0">
                    Sigue pendiente: {paso.boton.toLowerCase()}
                  </Boton>
                )}
              </div>
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
        </div>
      </div>
    </Tarjeta>
  );
}

// Salir exige alguien que lo lleve (DOM-YD5GNY quedó dos meses «en camino» sin nadie).
function ModalDespachar({
  e, quien, trabajando, onCerrar, onConfirmar,
}: {
  e: Envio;
  quien: QuienLleva;
  trabajando: boolean;
  onCerrar: () => void;
  onConfirmar: (repartidorId: string) => void;
}) {
  const [elegido, setElegido] = useState(e.repartidor?.id ?? '');
  return (
    <Modal
      abierto
      ancho="chico"
      onCerrar={onCerrar}
      bloquearCierre={trabajando}
      titulo={`Sale ${e.codigo}`}
      descripcion={`${e.cliente.nombre ?? 'Cliente'} · ${e.destino.direccion ?? 'sin dirección'}`}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={trabajando}>Volver</Boton>
          <Boton onClick={() => onConfirmar(elegido)} disabled={!elegido} cargando={trabajando}>Salió</Boton>
        </>
      }
    >
      <div className="space-y-3">
        <Campo etiqueta="¿Quién lo lleva?" ayuda="Sin alguien que lo lleve el envío no sale: así siempre se sabe quién lo tiene.">
          <SelectorQuienLleva enCampo quien={quien} valor={elegido} onCambiar={setElegido} permitirVacio={false} />
        </Campo>
        {quien.repartidores.length === 0 && (
          <p className="text-sm text-tinta/70">
            No hay repartidores cargados: elegí a alguien del local o{' '}
            <Link href="/reparto?vista=repartidores" className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>cargá un repartidor</Link>.
          </p>
        )}
        <p className="text-sm text-tinta/70">Al cliente le llega el WhatsApp de que su pedido salió.</p>
      </div>
    </Modal>
  );
}
