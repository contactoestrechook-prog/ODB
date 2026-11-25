'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, BotonLink, FOCO, IconoCerrar, unir } from '../ui/kit';
import { codigoDe, haceCuanto } from '../lib/pedidos';
import { pesos as formatoPesos } from '../lib/formato';
import { textoVisible } from '../lib/texto';
import { NotaDePedido, type PedidoDeposito } from './NotaDePedido';
import { AsignarArmado } from '../ui/AsignarArmado';
import { FaltantesAlEntregar, faltaDeStock, type FaltaDeStock } from '../ui/FaltantesAlEntregar';
import { ModalDespachar } from '../ui/EnvioPartes';

type Pedido = PedidoDeposito;

const pesos = (n: number | string) => formatoPesos(Number(n) || 0);

// Las clases van escritas enteras para que Tailwind las encuentre. Mismos
// colores que las etapas de Pedidos (PedidosWorkspace › ETAPAS); el botón que
// pasa el pedido a la columna siguiente se pinta del color de esa columna.
const COLUMNAS = [
  {
    estado: 'recibido', paso: 1, titulo: 'Recibidos', bajada: 'Entraron · falta empezar a armarlos', vacio: 'No entró nada nuevo',
    accion: 'en_preparacion', botenLabel: 'Empezar a preparar',
    cabecera: 'bg-marca', numero: 'text-marca', fondo: 'bg-marca-suave', franja: 'border-l-marca',
    boton: 'bg-dato-3! hover:bg-[#673D74]! focus-visible:outline-dato-3!',
  },
  {
    estado: 'en_preparacion', paso: 2, titulo: 'En preparación', bajada: 'Se están armando', vacio: 'Nadie está armando nada',
    accion: 'listo', botenLabel: 'Marcar listo',
    cabecera: 'bg-dato-3', numero: 'text-dato-3', fondo: 'bg-[#F2EBF4]', franja: 'border-l-dato-3',
    boton: 'bg-ok! hover:bg-[#11552F]! focus-visible:outline-ok!',
  },
  {
    estado: 'listo', paso: 3, titulo: 'Listos para retirar o salir', bajada: 'En la mesa de retiro o esperando reparto', vacio: 'La mesa de retiro está vacía',
    accion: 'entregado', botenLabel: 'Entregar',
    cabecera: 'bg-ok', numero: 'text-ok', fondo: 'bg-ok-suave', franja: 'border-l-ok',
    boton: '',
  },
];

export function ColaDeposito({ puedeCargarRepartidor = false, miId = null, veTodo = true }: { puedeCargarRepartidor?: boolean; miId?: string | null; veTodo?: boolean }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  // ¿QUIÉN LO ARMA? TAMBIÉN DESDE DEPÓSITO (Leandro, 25/11/2026: «Juan Pablo desde su usuario
  // no puede designar a quién hace el pedido, y antes podía»): lo hacía desde Pedidos; en
  // Depósito la tarjeta no lo tenía. Ahora cada pedido que se arma lo trae, como en Pedidos.
  const [asignando, setAsignando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falta, setFalta] = useState<{ datos: FaltaDeStock; pedido: Pedido } | null>(null);
  // un envío a domicilio listo sale con alguien que lo lleve (revisión del
  // 21/10/2026): antes «Entregar» lo daba por entregado con el paquete en el
  // local, le mandaba al cliente «fue entregado» y cobraba sin preguntar
  const [despachando, setDespachando] = useState<Pedido | null>(null);
  const [errorDespacho, setErrorDespacho] = useState<string | null>(null);
  // qué pedidos se ven abiertos (como Placa roja) y cuáles en la vista breve;
  // sin tocar, se abren solos los que están "En preparación"
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const mios = miId
    ? pedidos.filter((p) => p.asignado_a === miId && ['recibido', 'pagado', 'en_preparacion'].includes(p.estado))
    : [];

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/pedidos');
      if (res.ok) {
        const todos: Pedido[] = await res.json();
        // el que arma no ve lo que está armando otro (19/11/2026, «todos pueden ver
        // el pedido que prepara el resto»): lo asignado a otra persona y abierto, afuera
        setPedidos(veTodo ? todos : todos.filter((p) => !(p.asignado_a && p.asignado_a !== miId && ['recibido', 'pagado', 'en_preparacion'].includes(p.estado))));
      }
    } catch {}
  }, [veTodo, miId]);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 10_000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  async function avanzar(pedido: Pedido, estado: string) {
    setOcupado(pedido.id);
    setAviso(null);
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId: pedido.id, estado }),
    });
    const datos = await res.json().catch(() => ({}));
    const fs = !res.ok && estado === 'entregado' ? faltaDeStock(pedido.id, res.status, datos) : null;
    if (fs) setFalta({ datos: fs, pedido });
    else if (!res.ok) setAviso(datos.message ?? 'No se pudo avanzar el pedido');
    // una prueba «entregada» se cierra sin venta (20/11/2026)
    else if (datos.prueba && datos.mensaje) setAviso(String(datos.mensaje));
    else if (estado === 'entregado' && datos.venta) {
      setAviso(`Pedido entregado: venta registrada por ${pesos(datos.venta.total)}`);
    }
    await cargar();
    setOcupado(null);
  }

  async function simular() {
    setOcupado('simular');
    setAviso(null);
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simular: true }),
    });
    const datos = await res.json();
    if (!res.ok) setAviso(datos.message ?? 'No se pudo simular');
    await cargar();
    setOcupado(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-tinta/60">
          Se actualiza solo cada 10 segundos · el stock queda reservado al entrar el pedido
        </p>
        <Boton
          variante="secundario"
          tamano="chico"
          onClick={simular}
          disabled={ocupado === 'simular'}
        >
          {ocupado === 'simular' ? 'Llegando…' : 'Pedido de prueba (PedidosYa)'}
        </Boton>
      </div>

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      {/* lo que la caja le asignó para armar, arriba de todo y con su botón
          (19/11/2026: a Pablo Avalos le asignaron uno y no lo encontraba entre
          los recibidos viejos) */}
      {mios.length > 0 && (
        <Aviso tono="atencion" titulo={mios.length === 1 ? `Te asignaron el pedido ${codigoDe(mios[0])} para armar` : `Te asignaron ${mios.length} pedidos para armar`}
          accion={<BotonLink href="/salon" tamano="chico">{mios.length === 1 ? 'Armarlo' : 'Armarlos'}</BotonLink>}>
          {mios.length === 1
            ? mios[0].clienteNombre || 'Tocá «Armarlo» para abrirlo y cargar el carro.'
            : mios.map((p) => [codigoDe(p), p.clienteNombre].filter(Boolean).join(' · ')).join(' — ')}
        </Aviso>
      )}

      {/* Las tres etapas con su color, igual que en Pedidos: rojo, ciruela y verde
          (Leandro, 17/11/2026: «los títulos de en qué estadio está cada pedido no se notan») */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNAS.map((col) => {
          const enColumna = pedidos
            .filter((p) => p.estado === col.estado || (col.estado === 'recibido' && p.estado === 'pagado'))
            // lo de HOY primero; lo programado para otro día al final, que no
            // apure a nadie ni se prepare antes de tiempo
            // y dentro de cada grupo, arriba los más nuevos (6/11/2026)
            .sort((a, b) => Number(!!a.programado) - Number(!!b.programado) || (a.minutos ?? 0) - (b.minutos ?? 0));
          return (
            <section key={col.estado} aria-labelledby={`dep-${col.paso}`} className={unir('flex min-w-0 flex-col rounded-2xl md:max-h-[calc(100dvh-7rem)] md:min-h-72', col.fondo)}>
              <header className={unir('flex items-center gap-3 rounded-t-2xl px-4 py-3 text-white max-md:sticky max-md:top-(--alto-barra-movil) max-md:z-contenido', col.cabecera)}>
                <span aria-hidden="true" className={unir('importe flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold', col.numero)}>{col.paso}</span>
                <div className="min-w-0 flex-1">
                  <h2 id={`dep-${col.paso}`} className="truncate text-base font-bold leading-tight">{col.titulo}</h2>
                  <p className="truncate text-xs leading-snug text-white/85">{col.bajada}</p>
                </div>
                <span className="importe shrink-0 text-2xl font-bold leading-none tracking-tight" aria-label={`${enColumna.length} ${enColumna.length === 1 ? 'pedido' : 'pedidos'}`}>{enColumna.length}</span>
              </header>
              {/* cada carril desplaza lo suyo y, si el ancho da, va de a dos (6/11/2026) */}
              <div className="min-h-0 flex-1 p-3 md:overflow-y-auto">
              <div className="grid items-start gap-3 min-[1800px]:grid-cols-2">
                {enColumna.map((p) => {
                  // sin tocar, se abren solos los que se están armando: ahí hace falta todo
                  const abierto = abiertos[p.id] ?? col.estado === 'en_preparacion';
                  const envioListo = p.canal === 'domicilio' && col.estado === 'listo';
                  return (
                    <NotaDePedido
                      key={p.id}
                      p={p}
                      franja={col.franja}
                      abierto={abierto}
                      onAlternar={() => setAbiertos((a) => ({ ...a, [p.id]: !abierto }))}
                      // solo quien ve toda la cola reparte: el que solo arma ve lo suyo (19/11/2026)
                      armado={veTodo && ['recibido', 'pagado', 'en_preparacion'].includes(p.estado) ? (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setAsignando((x) => (x === p.id ? null : p.id))}
                            aria-expanded={asignando === p.id}
                            className={unir('flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors', p.asignadoNombre ? 'border-ok/30 bg-ok-suave/60 hover:bg-ok-suave' : 'border-dashed border-marca/40 bg-white hover:bg-marca-suave', FOCO)}
                          >
                            {p.asignadoNombre
                              ? <span className="min-w-0 truncate text-tinta">Lo arma <b className="font-semibold">{p.asignadoNombre}</b>{p.asignado_en ? ` · ${haceCuanto(p.asignado_en)}` : ''}</span>
                              : <span className="font-semibold text-marca-hondo">¿Quién lo arma?</span>}
                            <span className="shrink-0 text-xs font-semibold text-tinta/60">{asignando === p.id ? 'Cerrar' : p.asignadoNombre ? 'Cambiar' : 'Asignar'}</span>
                          </button>
                          {asignando === p.id && (
                            <AsignarArmado key={`${p.id}|${p.asignado_a ?? ''}`} p={p} onAsignado={() => { void cargar(); }} />
                          )}
                        </div>
                      ) : undefined}
                      acciones={
                        <>
                          <Boton
                            onClick={() => (envioListo ? (setErrorDespacho(null), setDespachando(p)) : avanzar(p, col.accion))}
                            disabled={ocupado === p.id}
                            className={unir('min-w-40 flex-1 sm:flex-none', col.boton)}
                          >
                            {ocupado === p.id ? '…' : envioListo ? 'Despachar' : col.botenLabel}
                          </Boton>
                          <button
                            type="button"
                            onClick={() => avanzar(p, 'cancelado')}
                            disabled={ocupado === p.id}
                            className={unir(
                              'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-tinta/70 transition-colors hover:border-marca/50 hover:text-marca-hondo disabled:opacity-50 sm:size-10',
                              FOCO,
                            )}
                            title="Cancelar pedido (libera el stock)"
                            aria-label="Cancelar pedido (libera el stock)"
                          >
                            <IconoCerrar className="size-5" />
                          </button>
                        </>
                      }
                    />
                  );
                })}
                {enColumna.length === 0 && (
                  <p className="col-span-full px-1 py-8 text-center text-sm text-tinta/60">{col.vacio}</p>
                )}
              </div>
              </div>
            </section>
          );
        })}
      </div>
      {despachando && (
        <ModalDespachar
          envio={{
            id: despachando.id,
            codigo: despachando.qr_retiro ?? despachando.id.slice(0, 8).toUpperCase(),
            cliente: despachando.clienteNombre || null,
            direccion: textoVisible(despachando.destino_direccion, { unaLinea: true }),
            repartidorId: despachando.repartidor_id ?? null,
          }}
          puedeCargarRepartidor={puedeCargarRepartidor}
          trabajando={ocupado === despachando.id}
          error={errorDespacho}
          onCerrar={() => { setDespachando(null); setErrorDespacho(null); }}
          onConfirmar={async (repartidorId, nombre) => {
            const p = despachando;
            setOcupado(p.id);
            setErrorDespacho(null);
            const res = await fetch('/api/pedidos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pedidoId: p.id, estado: 'en_camino', repartidorId }),
            }).catch(() => null);
            const datos = res ? await res.json().catch(() => ({})) : null;
            setOcupado(null);
            if (!res) { setErrorDespacho('Sin conexión. Probá de nuevo.'); return; }
            if (!res.ok) { setErrorDespacho(datos?.message ?? 'No se pudo despachar.'); return; }
            setDespachando(null);
            setAviso(`${p.qr_retiro ?? 'El envío'} salió con ${nombre}.`);
            await cargar();
          }}
        />
      )}
      {falta && (
        <FaltantesAlEntregar
          falta={falta.datos}
          onCerrar={() => { setFalta(null); cargar(); }}
          onEntregar={async () => { const p = falta.pedido; setFalta(null); await avanzar(p, 'entregado'); }}
        />
      )}
    </div>
  );
}
