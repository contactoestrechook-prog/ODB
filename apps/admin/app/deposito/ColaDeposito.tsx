'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Etiqueta, FOCO, IconoCerrar, Monto, PlacaRoja, unir, type TonoEtiqueta } from '../ui/kit';
import { numero, pesos as formatoPesos } from '../lib/formato';
import { conCodigo } from '../lib/codigo-producto';
import { textoVisible } from '../lib/texto';
import { FaltantesAlEntregar, faltaDeStock, type FaltaDeStock } from '../ui/FaltantesAlEntregar';
import { ModalDespachar } from '../ui/EnvioPartes';

type Pedido = {
  id: string;
  estado: string;
  origen: string;
  /** 'domicilio' = envío: listo, no se «entrega» acá, se despacha con alguien que lo lleve */
  canal?: string | null;
  destino_direccion?: string | null;
  clienteNombre?: string | null;
  repartidor_id?: string | null;
  programado?: boolean;
  entregaEtiqueta?: string | null;
  notas?: string | null;
  total: number;
  qr_retiro: string | null;
  minutos: number;
  sucursal: { nombre: string } | null;
  cliente: { dni: string; tipo: string } | null;
  // precio_unitario y sku ya venían en la cola (apps/api/src/pedidos › cola)
  items: { cantidad: number; precio_unitario?: number | string | null; producto: { nombre: string; sku?: string } | null }[];
};

const pesos = (n: number) => formatoPesos(n);

// La cantidad tal cual, hasta 2 decimales: un fiambre por peso puede ser
// 0,5 kg y antes, redondeada, se leía "1×" (2/10/2026).
const cantidadDe = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Vista breve de la tarjeta cerrada: los primeros tres productos en una línea.
function resumenItems(items: Pedido['items']): string {
  const primeros = items.slice(0, 3).map((i) => `${numero(cantidadDe(i.cantidad), 2)}× ${conCodigo(i.producto?.nombre ?? '—', i.producto)}`);
  const resto = items.length - primeros.length;
  return primeros.join(' · ') + (resto > 0 ? ` +${resto} más` : '');
}

const ORIGEN_CHIP: Record<string, { label: string; tono: TonoEtiqueta }> = {
  pedidosya: { label: 'PedidosYa', tono: 'error' },
  web: { label: 'Web', tono: 'info' },
  pickup: { label: 'Pick-up', tono: 'info' },
  whatsapp: { label: 'WhatsApp', tono: 'ok' },
  mostrador: { label: 'Mostrador', tono: 'neutro' },
};

const COLUMNAS = [
  { estado: 'recibido', titulo: 'Recibidos', accion: 'en_preparacion', botenLabel: 'Empezar a preparar' },
  { estado: 'en_preparacion', titulo: 'En preparación', accion: 'listo', botenLabel: 'Marcar listo' },
  { estado: 'listo', titulo: 'Listos para retirar o salir', accion: 'entregado', botenLabel: 'Entregar' },
];

export function ColaDeposito({ puedeCargarRepartidor = false }: { puedeCargarRepartidor?: boolean }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
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

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/pedidos');
      if (res.ok) setPedidos(await res.json());
    } catch {}
  }, []);

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
          {ocupado === 'simular' ? 'Llegando…' : 'Simular pedido de PedidosYa'}
        </Boton>
      </div>

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNAS.map((col) => {
          const enColumna = pedidos
            .filter((p) => p.estado === col.estado || (col.estado === 'recibido' && p.estado === 'pagado'))
            // lo de HOY primero; lo programado para otro día al final, que no
            // apure a nadie ni se prepare antes de tiempo
            .sort((a, b) => Number(!!a.programado) - Number(!!b.programado));
          return (
            <section key={col.estado} className="min-w-0 rounded-2xl bg-crema-hondo/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold text-tinta">{col.titulo}</h2>
                <span className="importe rounded-full bg-white px-2 text-xs font-semibold leading-5 text-tinta/70">
                  {enColumna.length}
                </span>
              </div>
              <div className="space-y-2">
                {enColumna.map((p) => {
                  const chip = ORIGEN_CHIP[p.origen] ?? ORIGEN_CHIP.web;
                  // Placa roja (2/10/2026): "siempre que se detallen productos vamos
                  // a usar el paquete gráfico de pedidos". Entera es muy alta para un
                  // tablero de tres columnas, así que la tarjeta tiene dos vistas: la
                  // breve (los datos de siempre, los primeros tres productos en una
                  // línea y los botones) y la placa PEDIDO, que se abre sola en "En
                  // preparación", donde se arma el pedido y hace falta la lista
                  // completa. "Ver pedido" / "Ver menos" pasa de una a otra.
                  const abierto = abiertos[p.id] ?? col.estado === 'en_preparacion';
                  const alternar = (
                    <Boton
                      variante="fantasma"
                      tamano="chico"
                      aria-expanded={abierto}
                      onClick={() => setAbiertos((a) => ({ ...a, [p.id]: !abierto }))}
                      className={abierto ? 'mr-auto' : undefined}
                    >
                      {abierto ? 'Ver menos' : 'Ver pedido'}
                    </Boton>
                  );
                  const envioListo = p.canal === 'domicilio' && col.estado === 'listo';
                  const botones = (
                    <>
                      <Boton
                        onClick={() => (envioListo ? (setErrorDespacho(null), setDespachando(p)) : avanzar(p, col.accion))}
                        disabled={ocupado === p.id}
                        className="flex-1"
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
                  );
                  const minutos = (
                    <span
                      className={
                        'shrink-0 text-xs font-medium ' +
                        (p.minutos > 20 ? 'text-marca-hondo' : 'text-tinta/60')
                      }
                    >
                      hace {p.minutos} min
                    </span>
                  );

                  if (abierto) {
                    return (
                      <PlacaRoja
                        key={p.id}
                        titulo="PEDIDO"
                        sub={[p.qr_retiro, chip.label].filter(Boolean).join(' · ')}
                        renglones={p.items.map((i, j) => {
                          const cantidad = cantidadDe(i.cantidad);
                          // el unitario con el que entró el pedido: "2 × $1.500" y el subtotal, como en la tarjeta del bot
                          const unitario = Number(i.precio_unitario);
                          const conPrecio = i.precio_unitario != null && i.precio_unitario !== '' && Number.isFinite(unitario);
                          return {
                            clave: String(j),
                            cantidad,
                            nombre: conCodigo(i.producto?.nombre ?? '—', i.producto),
                            detalle: conPrecio ? `${numero(cantidad, 2)} × ${pesos(unitario)}` : undefined,
                            importe: conPrecio ? pesos(cantidad * unitario) : undefined,
                          };
                        })}
                        total={{ etiqueta: 'Total', valor: pesos(p.total) }}
                        recuadro={
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {minutos}
                              {p.entregaEtiqueta && (
                                <Etiqueta tono={p.programado ? 'neutro' : 'error'}>{p.entregaEtiqueta}</Etiqueta>
                              )}
                              {p.sucursal?.nombre && (
                                <span className="min-w-0 break-words text-xs text-tinta/60">{p.sucursal.nombre}</span>
                              )}
                            </div>
                            {textoVisible(p.notas) && <p className="break-words text-xs italic text-tinta/70">{textoVisible(p.notas)}</p>}
                          </div>
                        }
                        acciones={
                          <>
                            {alternar}
                            {botones}
                          </>
                        }
                      />
                    );
                  }

                  return (
                    <div key={p.id} className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-tarjeta">
                      <div className="flex items-center justify-between gap-2">
                        <Etiqueta tono={chip.tono}>
                          {chip.label}
                        </Etiqueta>
                        {minutos}
                      </div>
                      {p.entregaEtiqueta && (
                        <div className="mt-1">
                          <Etiqueta tono={p.programado ? 'neutro' : 'error'}>
                            {p.entregaEtiqueta}
                          </Etiqueta>
                        </div>
                      )}
                      {p.qr_retiro && (
                        <p className="mt-1 break-all font-mono text-xs text-tinta/60">{p.qr_retiro}</p>
                      )}
                      {textoVisible(p.notas) && <p className="mt-1 break-words text-xs italic text-tinta/70">{textoVisible(p.notas)}</p>}
                      <p className="mt-2 break-words text-sm leading-snug text-tinta">{resumenItems(p.items)}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <Monto valor={p.total} className="text-sm font-semibold text-tinta" />
                          <span className="min-w-0 truncate text-xs text-tinta/60">{p.sucursal?.nombre}</span>
                        </div>
                        {alternar}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {botones}
                      </div>
                    </div>
                  );
                })}
                {enColumna.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-tinta/60">vacío</p>
                )}
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
