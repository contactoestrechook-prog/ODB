'use client';

import { useState, type ReactNode } from 'react';
import { Etiqueta, FOCO, IconoFlechaAbajo, Monto, PlacaRoja, unir, type RenglonPlaca } from './kit';
import { fecha, numero, pesos, pesosCorto } from '../lib/formato';

// La respuesta del Analista ODB dibujada por proveedor (2/10/2026).
//
// Antes el Analista contestaba con una burbuja de texto y una placa «Orden de
// compra propuesta» con SKU y cantidad, sin plata ni urgencia; y como calculaba
// el ritmo solo con las ventas de la caja de ODB, decía «no hay nada que
// comprar». Ahora los números salen del motor único abastecimiento() (el mismo
// de Qué comprar) y el modelo solo escribe el veredicto y una línea por
// proveedor. Acá se dibujan con la Placa roja tal cual, sin tocar el kit:
//
// - COMPRAS: un renglón por proveedor con la plata sugerida partida en lo
//   urgente (rojo, sin stock o no llega) y lo que puede esperar (gris), el
//   mismo código de color de la barrita Alcance de la nota de pedido.
// - PLATA PARADA: lo que no se vende (oscuro) y lo que sobra por encima de 90
//   días de stock (claro). Sin rojo: no es una urgencia.
//
// Las barras son <span> porque van dentro del «detalle» del renglón de la
// placa, que es un <p>: un <div> adentro rompe la hidratación.

// ---------------------------------------------------------------- tipos espejo
// Copia de lo que devuelve POST analista/charla (apps/api/src/analista y
// apps/api/src/abastecimiento/tablero.ts), como NotaDePedido copia propuesta.ts.

export type AccionProveedor = 'comprar' | 'liquidar' | 'completar_datos' | 'revisar_datos' | 'esperar';
export type ComentarioProveedor = { proveedorId: string | null; proveedor: string; accion: AccionProveedor; comentario: string };

export type DatosTablero = {
  ventasHasta: string | null;
  datoViejo: boolean;
  ritmoFuente: string;
  plazosProvisorios: { provisorios: number; total: number };
};

export type ProveedorCompra = {
  proveedorId: string;
  proveedor: string;
  productos: number;
  urgentes: number;
  plata: number;
  plataUrgente: number;
  porSucursal: { sucursal: string; plata: number }[];
  faltan: string[];
  plazoDias: number;
  plazoProvisorio: boolean;
  aRevisar: number;
};

export type ComprasTablero = {
  total: number;
  totalUrgente: number;
  proveedores: ProveedorCompra[];
  sinProveedor: { productos: number; urgentes: number };
};

export type ProveedorParado = {
  proveedorId: string | null;
  proveedor: string;
  quietos: number;
  plataQuieta: number;
  sobran: number;
  plataSobra: number;
  masCaro: { nombre: string; plata: number } | null;
};

export type ParadoTablero = {
  totalQuieto: number;
  totalSobra: number;
  proveedores: ProveedorParado[];
  sinValorizar: number;
};

export type TableroAnalista = { datos: DatosTablero; compras?: ComprasTablero; parado?: ParadoTablero };

// ---------------------------------------------------------------- piezas

// Los 6 que más plata mueven y el resto detrás de un renglón (el mismo patrón
// que «Ver N productos más» de la nota de pedido). Si queda uno solo afuera, se
// muestra: un renglón que abre un renglón no ahorra nada.
const VISIBLES = 6;

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plural = (c: number, uno: string, varios: string) => `${numero(c)} ${c === 1 ? uno : varios}`;
const dias = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 1 });

// «a, b o c»: la lista de datos que les faltan a los proveedores
function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}`;
}

/**
 * Barra horizontal partida en tramos, hecha con <span> para que pueda ir
 * dentro del <p> del detalle de la placa. El largo es la suma de los tramos
 * sobre el máximo de la placa (con un piso del 2 % como en Estadísticas, para
 * que el más chico se vea); cada tramo ocupa su proporción. Escala lineal
 * siempre: una logarítmica achica a Luvik y engaña. aria-hidden porque cada
 * cifra está también escrita al lado.
 */
export function BarraPartida({ tramos, maximo, className }: { tramos: { valor: number; clase: string }[]; maximo: number; className?: string }) {
  const vivos = tramos.filter((t) => n(t.valor) > 0);
  const suma = vivos.reduce((s, t) => s + n(t.valor), 0);
  const largo = maximo > 0 && suma > 0 ? Math.min(Math.max((suma / maximo) * 100, 2), 100) : 0;
  return (
    <span aria-hidden="true" className={unir('block h-2 w-full overflow-hidden rounded-full bg-crema-hondo', className)}>
      {/* el hueco de 2 px entre tramos los separa aunque los grises se parezcan */}
      <span className="flex h-full gap-0.5" style={{ width: `${largo}%` }}>
        {vivos.map((t, i) => (
          <span key={i} className={unir('block h-full min-w-0.5 last:rounded-r-full', t.clase)} style={{ flexGrow: n(t.valor), flexBasis: 0 }} />
        ))}
      </span>
    </span>
  );
}

// El puntito de color que hace de leyenda al lado de cada cifra.
const Punto = ({ clase }: { clase: string }) => <span aria-hidden="true" className={unir('inline-block size-2 shrink-0 rounded-full', clase)} />;

const PREFIJO_ACCION: Record<AccionProveedor, string | null> = {
  comprar: null,
  liquidar: 'Liquidar',
  completar_datos: 'Completar datos',
  revisar_datos: 'Revisar datos',
  esperar: 'Puede esperar',
};

// La línea del modelo para un proveedor, en itálica como el motivo de la nota de pedido.
function Comentario({ c }: { c?: ComentarioProveedor }) {
  if (!c?.comentario?.trim()) return null;
  const prefijo = PREFIJO_ACCION[c.accion] ?? null;
  return (
    <span className="mt-1.5 block text-xs italic leading-snug text-tinta/70">
      {prefijo && <span className="font-semibold not-italic text-tinta">{prefijo}: </span>}
      {c.comentario.trim()}
    </span>
  );
}

export function comentarioDe(comentarios: ComentarioProveedor[] | undefined, proveedorId: string | null): ComentarioProveedor | undefined {
  return comentarios?.find((c) => c.proveedorId === proveedorId);
}

// El nombre del proveedor como botón: va dentro del <p> de la placa (un
// <button> es contenido de frase, se puede). La zona táctil se estira con el
// ::before, como la casilla de la nota de pedido, sin mover el renglón.
function NombreTocable({ children, onClick, etiqueta, icono }: { children: ReactNode; onClick?: () => void; etiqueta: string; icono: 'abajo' | 'derecha' }) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      className={unir(
        'relative rounded-sm text-left font-semibold leading-snug text-tinta underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-2.5 hover:underline',
        FOCO,
      )}
    >
      {children}
      <IconoFlechaAbajo className={unir('ml-1 inline size-4 align-[-2px] text-tinta/60', icono === 'derecha' && '-rotate-90')} />
    </button>
  );
}

// El renglón que abre el resto de los proveedores.
function renglonOtros({ cuantos, plata, onAbrir }: { cuantos: number; plata: number; onAbrir: () => void }): RenglonPlaca {
  return {
    clave: 'otros',
    nombre: (
      <button
        type="button"
        onClick={onAbrir}
        className={unir('flex min-h-11 w-full items-center justify-center gap-1 rounded-xl text-center text-sm font-medium text-tinta/70 transition-colors hover:text-tinta', FOCO)}
      >
        <span>
          Ver los otros {plural(cuantos, 'proveedor', 'proveedores')}
          {plata > 0 && <> · <Monto valor={plata} corto /></>}
        </span>
        <IconoFlechaAbajo className="size-4" />
      </button>
    ),
  };
}

// ---------------------------------------------------------------- COMPRAS

export function PlacaCompras({
  compras,
  datos,
  comentarios,
  onVerNota,
  onPreguntar,
  className,
}: {
  compras: ComprasTablero;
  datos: DatosTablero;
  comentarios?: ComentarioProveedor[];
  /** Tocar un proveedor: bajar a su nota de pedido. */
  onVerNota?: (p: ProveedorCompra) => void;
  /** Mandarle una pregunta al analista (el enviar() del chat). */
  onPreguntar?: (texto: string) => void;
  className?: string;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const lista = [...compras.proveedores].sort((a, b) => n(b.plata) - n(a.plata));
  const maximo = Math.max(...lista.map((p) => n(p.plata)), 0);
  const cortar = !verTodos && lista.length > VISIBLES + 1;
  const visibles = cortar ? lista.slice(0, VISIBLES) : lista;
  const ocultos = cortar ? lista.slice(VISIBLES) : [];

  // Si ningún plazo está confirmado se dice una vez al pie, no en cada renglón.
  const todosProvisorios = lista.length > 0 && lista.every((p) => p.plazoProvisorio);
  const sucursales = [...new Set(lista.flatMap((p) => p.porSucursal.filter((s) => n(s.plata) > 0).map((s) => s.sucursal)))];
  const conFaltantes = lista.filter((p) => p.faltan.length > 0);
  const camposFaltantes = [...new Set(conFaltantes.flatMap((p) => p.faltan))];
  const aRevisar = lista.reduce((s, p) => s + n(p.aRevisar), 0);
  const urgente = n(compras.totalUrgente);
  const puedeEsperar = Math.max(0, n(compras.total) - urgente);
  const comentarioSinProveedor = comentarioDe(comentarios, null);

  const renglones: RenglonPlaca[] = visibles.map((p) => {
    const plata = n(p.plata);
    const plataUrgente = Math.min(n(p.plataUrgente), plata);
    const porSucursal = p.porSucursal.filter((s) => n(s.plata) > 0).sort((a, b) => n(b.plata) - n(a.plata));
    return {
      clave: p.proveedorId,
      cantidad: n(p.productos),
      nombre: (
        <NombreTocable onClick={onVerNota && (() => onVerNota(p))} etiqueta={`${p.proveedor}: ver su nota de pedido`} icono="abajo">
          {p.proveedor}
        </NombreTocable>
      ),
      // lo único que se marca por renglón: costos que no se pueden creer (el
      // rojo por renglón dejaría de avisar, LEEME del kit)
      etiqueta: p.aRevisar > 0 ? <Etiqueta tono="atencion">{plural(n(p.aRevisar), 'costo a revisar', 'costos a revisar')}</Etiqueta> : undefined,
      importe: <Monto valor={plata} corto />,
      detalle: (
        <span className="block">
          <BarraPartida
            className="mt-1.5"
            maximo={maximo}
            tramos={[
              { valor: plataUrgente, clase: 'bg-marca' },
              { valor: plata - plataUrgente, clase: 'bg-tinta/45' },
            ]}
          />
          {/* sin puntos separadores: al bajar de renglón en el celular quedaban colgando */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs leading-snug">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Punto clase={p.urgentes > 0 ? 'bg-marca' : 'bg-tinta/45'} />
              {p.urgentes > 0 ? (
                <span>
                  {plural(n(p.urgentes), 'urgente', 'urgentes')}
                  {plataUrgente > 0 && <> · <span className="importe">{pesosCorto(plataUrgente)}</span></>}
                </span>
              ) : (
                'nada urgente'
              )}
            </span>
            {porSucursal.map((s) => (
              <span key={s.sucursal} className="whitespace-nowrap">
                {s.sucursal} <span className="importe">{pesosCorto(s.plata)}</span>
              </span>
            ))}
            {Number.isFinite(Number(p.plazoDias)) && (
              <span className="whitespace-nowrap">
                tarda {dias(n(p.plazoDias))} día{n(p.plazoDias) === 1 ? '' : 's'}
                {p.plazoProvisorio && !todosProvisorios ? ' (sin confirmar)' : ''}
              </span>
            )}
          </span>
          <Comentario c={comentarioDe(comentarios, p.proveedorId)} />
        </span>
      ),
    };
  });
  if (cortar) renglones.push(renglonOtros({ cuantos: ocultos.length, plata: ocultos.reduce((s, p) => s + n(p.plata), 0), onAbrir: () => setVerTodos(true) }));
  if (!lista.length) {
    renglones.push({
      clave: 'nada',
      nombre: 'Nada sugerido con proveedor habitual',
      detalle: 'Si no hay ventas cargadas no hay con qué calcular: eso es falta de datos, no que no haga falta comprar.',
    });
  }

  const sp = compras.sinProveedor ?? { productos: 0, urgentes: 0 };
  const hayRecuadro = conFaltantes.length > 0 || n(sp.productos) > 0 || aRevisar > 0;

  return (
    <PlacaRoja
      className={className}
      titulo="Compras"
      sub={
        <>
          Lo sugerido por proveedor
          <span className="block">
            {plural(lista.length, 'proveedor', 'proveedores')}
            {sucursales.length > 0 && ` · ${sucursales.length > 1 ? `las ${sucursales.length} sucursales` : sucursales[0]}`}
          </span>
        </>
      }
      renglones={renglones}
      total={lista.length ? { etiqueta: 'A comprar', valor: pesos(n(compras.total)) } : undefined}
      recuadro={
        hayRecuadro ? (
          <div className="space-y-2.5 leading-snug">
            {conFaltantes.length > 0 && (
              <p className="text-marca-hondo">
                <b>
                  {conFaltantes.length === lista.length
                    ? lista.length === 1 ? 'A este proveedor le falta' : `A los ${lista.length} proveedores les falta`
                    : `A ${conFaltantes.length} de los ${lista.length} proveedores ${conFaltantes.length === 1 ? 'le' : 'les'} falta`}{' '}
                  cargar datos
                </b>
                {camposFaltantes.length > 0 && ` (${enumerar(camposFaltantes)})`}: el pedido se arma igual y queda frenado hasta que administración los complete.
              </p>
            )}
            {n(sp.productos) > 0 && (
              <div className="text-tinta/70">
                <p>
                  <b className="text-tinta">{plural(n(sp.productos), 'producto para reponer no tiene', 'productos para reponer no tienen')} proveedor habitual</b>
                  {n(sp.urgentes) > 0 && ` (${plural(n(sp.urgentes), 'urgente', 'urgentes')})`}: no entran en la plata de arriba.
                  {onPreguntar && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => onPreguntar('¿A quién le compro lo que no tiene proveedor habitual?')}
                        className={unir('relative rounded-sm font-semibold text-marca-hondo underline underline-offset-2 before:absolute before:-inset-y-2.5 before:inset-x-0', FOCO)}
                      >
                        ¿A quién se los compro?
                      </button>
                    </>
                  )}
                </p>
                {comentarioSinProveedor && <p><Comentario c={comentarioSinProveedor} /></p>}
              </div>
            )}
            {aRevisar > 0 && (
              <p className="text-tinta/70">
                {plural(aRevisar, 'producto tiene', 'productos tienen')} un costo de menos de $100 o ninguno: no suman en la plata hasta que se revise la lista del proveedor.
              </p>
            )}
          </div>
        ) : undefined
      }
      pie={
        lista.length ? (
          <>
            <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Punto clase="bg-marca" />
                Urgente <span className="importe font-semibold text-tinta">{pesosCorto(urgente)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Punto clase="bg-tinta/45" />
                Puede esperar <span className="importe font-semibold text-tinta">{pesosCorto(puedeEsperar)}</span>
              </span>
            </span>
            <span className="mt-1 block">
              Urgente es sin stock o que no llega a tiempo. Al último costo conocido.
              {todosProvisorios && ' Ningún plazo de entrega está confirmado todavía.'}
              {onVerNota && ' Tocá un proveedor para ver su nota de pedido.'}
            </span>
            {datos.datoViejo && (
              <span className="mt-1 block text-marca-hondo">
                Ventas del sistema viejo{datos.ventasHasta ? ` hasta el ${fecha(datos.ventasHasta, 'corta')}` : ''}: cantidades orientativas.
              </span>
            )}
          </>
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------- PLATA PARADA

export function PlacaParado({
  parado,
  datos,
  comentarios,
  onPreguntar,
  className,
}: {
  parado: ParadoTablero;
  datos: DatosTablero;
  comentarios?: ComentarioProveedor[];
  /** Tocar un proveedor: preguntarle al analista qué liquidar. */
  onPreguntar?: (texto: string) => void;
  className?: string;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const plataDe = (p: ProveedorParado) => n(p.plataQuieta) + n(p.plataSobra);
  const lista = [...parado.proveedores].sort((a, b) => plataDe(b) - plataDe(a) || n(b.quietos) + n(b.sobran) - (n(a.quietos) + n(a.sobran)));
  const maximo = Math.max(...lista.map(plataDe), 0);
  const cortar = !verTodos && lista.length > VISIBLES + 1;
  const visibles = cortar ? lista.slice(0, VISIBLES) : lista;
  const ocultos = cortar ? lista.slice(VISIBLES) : [];
  const total = n(parado.totalQuieto) + n(parado.totalSobra);

  const renglones: RenglonPlaca[] = visibles.map((p) => {
    const plata = plataDe(p);
    const sinProveedor = p.proveedorId == null;
    const pregunta = sinProveedor ? '¿Qué liquido de lo que no tiene proveedor habitual?' : `¿Qué liquido de ${p.proveedor}?`;
    return {
      clave: p.proveedorId ?? 'sin-proveedor',
      cantidad: n(p.quietos) + n(p.sobran),
      nombre: (
        <NombreTocable onClick={onPreguntar && (() => onPreguntar(pregunta))} etiqueta={`${p.proveedor}: preguntarle al analista qué liquidar`} icono="derecha">
          {p.proveedor}
        </NombreTocable>
      ),
      importe: plata > 0 ? <Monto valor={plata} corto /> : undefined,
      detalle: (
        <span className="block">
          <BarraPartida
            className="mt-1.5"
            maximo={maximo}
            tramos={[
              { valor: n(p.plataQuieta), clase: 'bg-tinta/80' },
              { valor: n(p.plataSobra), clase: 'bg-tinta/40' },
            ]}
          />
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs leading-snug">
            {n(p.quietos) > 0 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Punto clase="bg-tinta/80" />
                {numero(n(p.quietos))} sin ventas
                {n(p.plataQuieta) > 0 && <span className="importe">{pesosCorto(p.plataQuieta)}</span>}
              </span>
            )}
            {n(p.sobran) > 0 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Punto clase="bg-tinta/40" />
                {plural(n(p.sobran), 'sobra', 'sobran')}
                {n(p.plataSobra) > 0 && <span className="importe">{pesosCorto(p.plataSobra)}</span>}
              </span>
            )}
            {plata <= 0 && <span>sin costo para valorizar</span>}
          </span>
          {p.masCaro && n(p.masCaro.plata) > 0 && (
            <span className="mt-0.5 block text-xs leading-snug">
              el más caro: {p.masCaro.nombre} <span className="importe whitespace-nowrap">{pesosCorto(p.masCaro.plata)}</span>
            </span>
          )}
          <Comentario c={comentarioDe(comentarios, p.proveedorId)} />
        </span>
      ),
    };
  });
  if (cortar) renglones.push(renglonOtros({ cuantos: ocultos.length, plata: ocultos.reduce((s, p) => s + plataDe(p), 0), onAbrir: () => setVerTodos(true) }));
  if (!lista.length) renglones.push({ clave: 'nada', nombre: 'No hay plata parada con costo conocido' });

  const desde = datos.ventasHasta ? ` al ${fecha(datos.ventasHasta, 'corta')}` : '';

  return (
    <PlacaRoja
      className={className}
      titulo="Plata parada"
      sub={
        <>
          Sin ventas{desde}
          <span className="block">o con más de 90 días de stock</span>
        </>
      }
      renglones={renglones}
      total={total > 0 ? { etiqueta: 'Plata parada', valor: pesos(total) } : undefined}
      recuadro={
        n(parado.sinValorizar) > 0 ? (
          <p className="leading-snug text-tinta/70">
            <b className="text-tinta">{plural(n(parado.sinValorizar), 'producto parado no tiene', 'productos parados no tienen')} costo</b>: no se pueden valorizar y no suman en la plata.
          </p>
        ) : undefined
      }
      pie={
        <>
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Punto clase="bg-tinta/80" />
              Sin ventas <span className="importe font-semibold text-tinta">{pesosCorto(n(parado.totalQuieto))}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Punto clase="bg-tinta/40" />
              Sobra (más de 90 días) <span className="importe font-semibold text-tinta">{pesosCorto(n(parado.totalSobra))}</span>
            </span>
          </span>
          <span className="mt-1 block">
            Al último costo conocido.{onPreguntar && ' Tocá un proveedor para preguntarle al analista qué liquidar.'}
          </span>
          {datos.datoViejo && (
            <span className="mt-1 block text-marca-hondo">
              Ventas del sistema viejo{datos.ventasHasta ? ` hasta el ${fecha(datos.ventasHasta, 'corta')}` : ''}: lo que figura sin ventas pudo venderse después.
            </span>
          )}
        </>
      }
    />
  );
}
