'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from '../ui/BotonMicrofono';
import type { Armada } from '../ui/NotaDePedido';
import { NotasDelAnalista, SUCURSALES_NOTAS, type NotasAnalista } from '../ui/NotasDelAnalista';
import { PlacaCompras, PlacaParado, type ComentarioProveedor, type ProveedorCompra, type TableroAnalista } from '../ui/PlacaProveedores';
import { Boton, Chip, Entrada, PlacaRoja, Tarjeta, unir, type DetallePlaca } from '../ui/kit';
import { pesos } from '../lib/formato';

type Armado = {
  nombre: string;
  ocasion: string;
  descripcion: string;
  items: { sku: string; nombre: string; cantidad: number; precioUnitario: number }[];
  sumaLista: number;
  precioBox: number;
  ahorro: number;
  margenPct: number | null;
};

// Qué piezas dibuja la pantalla debajo del veredicto. Lo elige el modelo según
// la pregunta; los números de cada pieza los arma el sistema (abastecimiento()),
// nunca el modelo.
type Pieza = 'compras' | 'notas' | 'parado';
const PIEZAS: Pieza[] = ['compras', 'notas', 'parado'];

// 2/10/2026: la respuesta del analista pasó a ser un veredicto corto más las
// piezas por proveedor (placa COMPRAS, notas de pedido, placa PLATA PARADA).
// Se fueron las «órdenes propuestas» que el modelo armaba a mano y se creaban
// por /api/oc: ahora se pide desde la nota de pedido, igual que en Qué comprar.
// detalle: los productos que el analista nombró en el texto, como Placa roja.
type Mensaje = {
  rol: 'usuario' | 'analista';
  texto: string;
  armados?: Armado[];
  detalle?: DetallePlaca;
  tablero?: TableroAnalista;
  comentarios?: ComentarioProveedor[];
  mostrar?: Pieza[];
  notas?: NotasAnalista | null;
};

type OrdenArmada = Armada & { proveedor: string; sucursal: string; sucursalId: string };

const SUGERENCIAS = [
  '¿Qué compro esta semana?',
  'Armame boxes para vender 🎁',
  '¿Dónde tengo plata inmovilizada?',
  '¿Qué costos aumentaron?',
];

// Lo que devuelve POST analista/charla, con cada campo revisado: un deploy
// desfasado (API vieja con pantalla nueva) trae solo respuesta y detalle, y
// tiene que verse la burbuja sola, sin romper.
function respuestaDelAnalista(d: any): Mensaje {
  return {
    rol: 'analista',
    texto: typeof d?.respuesta === 'string' ? d.respuesta : '',
    detalle: d?.detalle ?? undefined,
    tablero: d?.tablero?.datos ? d.tablero : undefined,
    comentarios: Array.isArray(d?.comentarios) ? d.comentarios : [],
    mostrar: Array.isArray(d?.mostrar) ? d.mostrar.filter((x: unknown): x is Pieza => PIEZAS.includes(x as Pieza)) : [],
    notas: d?.notas && Array.isArray(d.notas.proveedorIds) ? d.notas : null,
  };
}

// Sin animación para quien la tiene apagada en el sistema.
const movimiento = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

// Las piezas de una respuesta. Cada una guarda su estado (qué sucursal miran
// las notas, a qué proveedor bajar): tocar un proveedor en la placa COMPRAS
// abre su nota, aunque el analista no las haya mostrado.
function PiezasDeLaRespuesta({
  m,
  onPreguntar,
  yaPedidos,
  onArmada,
  desplazarA,
}: {
  m: Mensaje;
  onPreguntar: (texto: string) => void;
  yaPedidos: Set<string>;
  onArmada: (o: OrdenArmada) => void;
  desplazarA: (el: HTMLElement) => void;
}) {
  const mostrar = m.mostrar ?? [];
  const datos = m.tablero?.datos;
  const compras = mostrar.includes('compras') ? m.tablero?.compras : undefined;
  const parado = mostrar.includes('parado') ? m.tablero?.parado : undefined;
  const [verNotas, setVerNotas] = useState(mostrar.includes('notas'));
  const [sucursal, setSucursal] = useState(() =>
    m.notas?.sucursal && SUCURSALES_NOTAS.includes(m.notas.sucursal) ? m.notas.sucursal : SUCURSALES_NOTAS[0],
  );
  const [buscado, setBuscado] = useState<string | null>(null);
  const terminarBusqueda = useCallback(() => setBuscado(null), []);

  // Cada línea del analista se dibuja una sola vez. Cada pieza toma las que le
  // corresponden (PlacaProveedores: ACCIONES_COMPRA y ACCIONES_PARADO); con las
  // dos placas a la vista, PLATA PARADA se queda solo con las de liquidar, y
  // las notas las muestran solo si no está la placa COMPRAS.
  const comentarios = m.comentarios ?? [];
  const deParado = compras ? comentarios.filter((c) => c.accion === 'liquidar') : comentarios;

  // La nota es por proveedor y sucursal: si el proveedor no tiene nada en la
  // sucursal que se está mirando, se pasa a la que más plata le compra.
  const verNota = (p: ProveedorCompra) => {
    const donde = [...p.porSucursal].sort((a, b) => b.plata - a.plata).map((s) => s.sucursal).filter((s) => SUCURSALES_NOTAS.includes(s));
    if (donde.length && !donde.includes(sucursal)) setSucursal(donde[0]);
    setVerNotas(true);
    setBuscado(p.proveedorId);
  };

  if (!datos && !verNotas) return null;
  return (
    <>
      {datos && compras && (
        <PlacaCompras className="mt-2 w-full" compras={compras} datos={datos} comentarios={comentarios} onVerNota={verNota} onPreguntar={onPreguntar} />
      )}
      {verNotas && (
        <div className="mt-3 w-full min-w-0">
          <NotasDelAnalista
            notas={m.notas ?? null}
            sucursal={sucursal}
            onSucursal={setSucursal}
            buscado={buscado}
            onBuscado={terminarBusqueda}
            yaPedidos={yaPedidos}
            onArmada={onArmada}
            comentarios={compras ? undefined : comentarios}
            onPreguntar={compras ? undefined : onPreguntar}
            desplazarA={desplazarA}
          />
        </div>
      )}
      {datos && parado && <PlacaParado className="mt-3 w-full" parado={parado} datos={datos} comentarios={deParado} onPreguntar={onPreguntar} />}
    </>
  );
}

export function ChatAnalista() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      rol: 'analista',
      texto:
        'Buenas. Soy el Analista ODB: miro el ritmo de venta, el stock de las dos sucursales, los plazos de cada proveedor y los costos. Preguntame qué comprar, qué liquidar o dónde hay plata parada.',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  // productos ya pedidos desde cualquier nota del chat ("sucursalId:sku"):
  // salen de las demás notas, como en Qué comprar, para no pedirlos dos veces
  const [yaPedidos, setYaPedidos] = useState<Set<string>>(() => new Set());
  const cajaRef = useRef<HTMLDivElement>(null);
  const ultimoRef = useRef<HTMLDivElement>(null);

  const alArmar = useCallback((o: OrdenArmada) => {
    setYaPedidos((s) => new Set([...s, ...(o.pedidos ?? []).map((p) => `${o.sucursalId}:${p.sku}`)]));
  }, []);

  // Se mueve solo la caja del chat (tiene scroll propio), no la página: con
  // scrollIntoView la página entera subía y la cabecera quedaba afuera.
  const desplazarA = useCallback((el: HTMLElement) => {
    const caja = cajaRef.current;
    if (!caja) return;
    const arriba = el.getBoundingClientRect().top - caja.getBoundingClientRect().top + caja.scrollTop - 12;
    caja.scrollTo({ top: Math.max(0, arriba), behavior: movimiento() });
  }, []);

  // Mientras piensa, al final (se ve el «cruzando ventas…»). Cuando contesta,
  // al ARRANQUE de la respuesta: antes bajaba hasta el pie y, con las placas y
  // las notas, el dueño caía debajo de todo sin ver el veredicto ni el gráfico.
  useEffect(() => {
    const caja = cajaRef.current;
    if (!caja || (mensajes.length <= 1 && !pensando)) return;
    const ultimo = mensajes[mensajes.length - 1];
    if (!pensando && ultimo?.rol === 'analista' && ultimoRef.current) desplazarA(ultimoRef.current);
    else caja.scrollTo({ top: caja.scrollHeight, behavior: movimiento() });
  }, [mensajes, pensando, desplazarA]);

  async function pedirArmados() {
    setMensajes((m) => [...m, { rol: 'usuario', texto: 'Armame boxes para vender' }]);
    setPensando(true);
    try {
      const res = await fetch('/api/armados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        res.ok
          ? {
              rol: 'analista',
              texto: 'Te propongo estos armados con lo que hay en stock (precios y márgenes ya verificados):',
              armados: datos.armados,
            }
          : { rol: 'analista', texto: `(${datos.message ?? 'No pude armar los boxes'})` },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'analista', texto: '(Sin conexión con la API)' }]);
    }
    setPensando(false);
  }

  async function enviar(textoMensaje: string) {
    const limpio = textoMensaje.trim();
    if (!limpio || pensando) return;
    if (limpio.includes('Armame boxes')) return pedirArmados();
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: limpio }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const res = await fetch('/api/analista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: nuevos.map(({ rol, texto }) => ({ rol, texto })),
        }),
      });
      const datos = await res.json().catch(() => ({}));
      setMensajes((m) => [
        ...m,
        res.ok
          ? respuestaDelAnalista(datos)
          : { rol: 'analista', texto: `(${datos?.message ?? 'No pude analizar, probá de nuevo'})` },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'analista', texto: '(Sin conexión con la API)' }]);
    }
    setPensando(false);
  }

  return (
    <Tarjeta relleno={false} className="flex h-[78dvh] min-h-[26rem] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-marca text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight text-tinta">Analista ODB</p>
          <p className="text-xs text-tinta/60">
            Compras, stock y proveedores · números reales de las 2 sucursales
          </p>
        </div>
      </div>

      {/* el lector de pantalla anuncia solo el veredicto nuevo: la caja tiene
          adentro notas de pedido interactivas y placas, y con aria-live en el
          contenedor anunciaba cada cambio (revisión del 2/10/2026) */}
      <p className="sr-only" aria-live="polite">
        {[...mensajes].reverse().find((m) => m.rol === 'analista')?.texto ?? ''}
      </p>
      <div ref={cajaRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
        {mensajes.map((m, i) => (
          <div
            key={i}
            ref={i === mensajes.length - 1 ? ultimoRef : undefined}
            className={'flex min-w-0 flex-col ' + (m.rol === 'usuario' ? 'items-end' : 'items-start')}
          >
            {m.texto && (
              <div
                className={unir(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
                  m.rol === 'usuario' ? 'rounded-br-md bg-tinta text-white' : 'rounded-bl-md bg-crema text-tinta',
                )}
              >
                {m.texto}
              </div>
            )}
            {m.rol === 'analista' && (
              <PiezasDeLaRespuesta m={m} onPreguntar={enviar} yaPedidos={yaPedidos} onArmada={alArmar} desplazarA={desplazarA} />
            )}
            {m.detalle && <PlacaRoja {...m.detalle} className="mt-2 w-full" />}
            {/* cada box, como Placa roja: los componentes con cantidad, su
                precio de lista y el precio del box en la píldora */}
            {m.armados && (
              <div className="mt-2 grid w-full gap-3 lg:grid-cols-2">
                {m.armados.map((a, j) => (
                  <PlacaRoja
                    key={j}
                    titulo={a.nombre}
                    sub={a.ocasion}
                    renglones={a.items.map((it) => ({
                      clave: it.sku,
                      cantidad: it.cantidad,
                      nombre: it.nombre,
                      detalle: `${it.cantidad} × ${pesos(it.precioUnitario)}`,
                      importe: pesos(it.cantidad * it.precioUnitario),
                    }))}
                    total={{ etiqueta: 'Precio del box', valor: pesos(a.precioBox) }}
                    recuadro={<span className="text-tinta/70">{a.descripcion}</span>}
                    pie={`Suelto ${pesos(a.sumaLista)} · ahorra ${pesos(a.ahorro)}${a.margenPct != null ? ` · margen ${a.margenPct} %` : ''}`}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-crema px-4 py-2.5 text-sm text-tinta/60">
              cruzando ventas, stock y proveedores…
            </div>
          </div>
        )}
      </div>

      {mensajes.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {SUGERENCIAS.map((s) => (
            <Chip key={s} onClick={() => enviar(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="flex items-center gap-2 border-t border-black/[0.06] p-3"
      >
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntale al analista… o hablá 🎤"
          aria-label="Pregunta para el analista"
          className="min-w-0 flex-1"
        />
        <BotonMicrofono textoActual={texto} onTexto={setTexto} titulo="Hablarle al analista" />
        <Boton type="submit" disabled={pensando || !texto.trim()} className="shrink-0">
          Enviar
        </Boton>
      </form>
    </Tarjeta>
  );
}
