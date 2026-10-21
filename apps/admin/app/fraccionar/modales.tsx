'use client';

import { useMemo, useState } from 'react';
import { Aviso, Boton, Campo, Chips, Entrada, Etiqueta, Modal, useConfirmar } from '../ui/kit';
import { numero, pesos } from '../lib/formato';
import {
  cantidadDelPozo,
  enviar,
  leerNumero,
  leerPrecio,
  lleva,
  pedirAutorizacion,
  sumaStock,
  type Grupo,
  type Presentacion,
  type Sucursal,
} from './datos';
import { BuscadorProducto, Contador, ProductoElegido, type ItemBusqueda, type NotaBusqueda } from './piezas';

const aGramos = (n: number) => Math.round(n * 1000) / 1000;

// Resumen chico de dos cifras (en el pozo / armadas) arriba de cada modal.
function Cifras({ items }: { items: { rotulo: string; valor: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((i) => (
        <div key={i.rotulo} className="min-w-0 rounded-xl bg-crema-claro px-3 py-2">
          <p className="text-xs text-tinta/60">{i.rotulo}</p>
          <p className="importe truncate text-base font-semibold text-tinta">{i.valor}</p>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ armar / abrir

/**
 * Armar presentaciones con lo que hay en el pozo, o abrir armadas y pasar lo
 * que tienen al pozo (el maple que se abre para armar docenas, el envase que
 * se rompió). La cantidad de presentaciones siempre es entera.
 */
export function ModalMover({
  modo,
  grupo,
  presentacion,
  sucursal,
  puedeCargarPozo,
  onCerrar,
  onListo,
  onCargarPozo,
  onAbrirOtra,
}: {
  modo: 'armar' | 'abrir';
  grupo: Grupo;
  presentacion: Presentacion;
  sucursal: Sucursal;
  puedeCargarPozo: boolean;
  onCerrar: () => void;
  onListo: (texto: string) => void;
  onCargarPozo: () => void;
  onAbrirOtra: (p: Presentacion) => void;
}) {
  const { pozo } = grupo;
  const porPeso = pozo.porPeso;
  const enPozo = Number(pozo.stock[sucursal.id] ?? 0);
  const armadas = Math.max(0, Math.floor(Number(presentacion.stock[sucursal.id] ?? 0)));
  const max = Math.min(1000, modo === 'armar' ? Number(presentacion.alcanza[sucursal.id] ?? 0) : armadas);
  const [cantidad, setCantidad] = useState(max > 0 ? '1' : '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = parseInt(cantidad, 10) || 0;
  const valida = n >= 1 && n <= max;
  const mueve = aGramos(n * presentacion.unidades);
  const pozoDespues = aGramos(modo === 'armar' ? enPozo - mueve : enPozo + mueve);
  const armadasDespues = modo === 'armar' ? armadas + n : armadas - n;

  // pozo vacío: la presentación más chica de las más grandes que tenga armadas
  // (el maple que se abre para armar docenas)
  const paraAbrir =
    modo === 'armar' && max === 0
      ? grupo.presentaciones
          .filter((p) => p.id !== presentacion.id && p.unidades > presentacion.unidades && Number(p.stock[sucursal.id] ?? 0) >= 1)
          .sort((a, b) => a.unidades - b.unidades)[0]
      : undefined;

  const confirmar = async () => {
    if (!valida) {
      setError(max === 0 ? 'No hay de dónde sacar.' : `Elegí una cantidad entre 1 y ${max}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    const r = await enviar({ accion: 'armar', destinoId: presentacion.id, sucursalId: sucursal.id, cantidad: modo === 'armar' ? n : -n });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    const quedan = Number(r.datos?.stock_madre ?? pozoDespues);
    onListo(
      modo === 'armar'
        ? `Se armaron ${n} × ${presentacion.nombre} (salieron ${cantidadDelPozo(mueve, porPeso)} del pozo). En el pozo quedan ${cantidadDelPozo(quedan, porPeso)}.`
        : `Se abrieron ${n} × ${presentacion.nombre}: volvieron ${cantidadDelPozo(mueve, porPeso)} al pozo, que ahora tiene ${cantidadDelPozo(quedan, porPeso)}.`,
    );
  };

  const armar = modo === 'armar';
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="chico"
      bloquearCierre={guardando}
      titulo={armar ? `Armar ${presentacion.nombre}` : `Abrir ${presentacion.nombre}`}
      descripcion={
        armar
          ? `Cada una saca ${lleva(presentacion, porPeso)} del pozo de ${sucursal.nombre}.`
          : `Lo que tiene cada una (${lleva(presentacion, porPeso)}) vuelve al pozo de ${sucursal.nombre}.`
      }
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={confirmar} cargando={guardando} disabled={!valida}>
            {armar ? `Armar ${n > 0 ? n : ''}` : `Pasar ${n > 0 ? n : ''} al pozo`}
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        <Cifras
          items={[
            { rotulo: 'En el pozo', valor: cantidadDelPozo(enPozo, porPeso, true) },
            { rotulo: 'Armadas', valor: numero(armadas) },
          ]}
        />

        {max === 0 ? (
          armar ? (
            <Aviso
              tono="atencion"
              titulo="El pozo no alcanza para armar una"
              accion={
                (paraAbrir || puedeCargarPozo) && (
                  <div className="flex flex-wrap gap-2">
                    {paraAbrir && (
                      <Boton tamano="chico" variante="secundario" onClick={() => onAbrirOtra(paraAbrir)}>
                        Abrir {paraAbrir.nombre}
                      </Boton>
                    )}
                    {puedeCargarPozo && (
                      <Boton tamano="chico" variante="secundario" onClick={onCargarPozo}>
                        Cargar el pozo
                      </Boton>
                    )}
                  </div>
                )
              }
            >
              Cada una lleva {lleva(presentacion, porPeso)} y en el pozo hay {cantidadDelPozo(enPozo, porPeso)}.
              {paraAbrir
                ? ` Podés abrir ${paraAbrir.nombre} (hay ${numero(paraAbrir.stock[sucursal.id] ?? 0)}) y pasarlo al pozo.`
                : puedeCargarPozo
                  ? ' Cargá el pozo y volvé a armar.'
                  : ' Pedile a depósito o a gerencia que carguen el pozo.'}
            </Aviso>
          ) : (
            <Aviso tono="atencion">No hay {presentacion.nombre} armadas en {sucursal.nombre} para abrir.</Aviso>
          )
        ) : (
          <>
            <Campo
              etiqueta={armar ? '¿Cuántas armás?' : '¿Cuántas abrís?'}
              ayuda={armar ? `Con lo que hay en el pozo alcanza para ${numero(max)}.` : `Hay ${numero(max)} armadas.`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Contador valor={cantidad} onCambiar={setCantidad} max={max} />
                <Boton tamano="chico" variante="secundario" onClick={() => setCantidad(String(max))} disabled={n === max}>
                  {armar ? `Todo lo que alcanza (${numero(max)})` : `Todas (${numero(max)})`}
                </Boton>
              </div>
            </Campo>
            {n > max && <Aviso tono="error">{armar ? `Alcanza para ${numero(max)} como máximo.` : `Hay ${numero(max)} armadas como máximo.`}</Aviso>}
            {valida && (
              <p className="rounded-xl border border-black/[0.06] px-3.5 py-2.5 text-sm text-tinta/70">
                {armar ? (
                  <>
                    Salen <strong className="importe text-tinta">{cantidadDelPozo(mueve, porPeso)}</strong> del pozo, que queda en{' '}
                    <strong className="importe text-tinta">{cantidadDelPozo(pozoDespues, porPeso)}</strong>. Armadas: {numero(armadas)} → {numero(armadasDespues)}.
                  </>
                ) : (
                  <>
                    Vuelven <strong className="importe text-tinta">{cantidadDelPozo(mueve, porPeso)}</strong> al pozo, que queda en{' '}
                    <strong className="importe text-tinta">{cantidadDelPozo(pozoDespues, porPeso)}</strong>. Armadas: {numero(armadas)} → {numero(armadasDespues)}.
                  </>
                )}
              </p>
            )}
          </>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- cargar el pozo

/**
 * Ingreso manual al pozo. Lo normal es que entre por la factura del
 * proveedor; esto es para lo que llegó sin factura o para corregir. Pasa por
 * las mismas reglas que un ajuste de stock: arriba del tope pide el PIN de un
 * supervisor (gerencia y dueño se autorizan solos).
 */
export function ModalCargarPozo({
  grupo,
  sucursal,
  onCerrar,
  onListo,
}: {
  grupo: Grupo;
  sucursal: Sucursal;
  onCerrar: () => void;
  onListo: (texto: string) => void;
}) {
  const { pozo } = grupo;
  const porPeso = pozo.porPeso;
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [pidePin, setPidePin] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enPozo = Number(pozo.stock[sucursal.id] ?? 0);
  const valor = leerNumero(cantidad);
  const errorCantidad =
    cantidad.trim() === ''
      ? null
      : valor == null || valor <= 0
        ? 'Tiene que ser un número mayor que 0'
        : !porPeso && !Number.isInteger(valor)
          ? 'Este pozo se cuenta por unidad: va sin decimales'
          : null;
  const lista = valor != null && valor > 0 && !errorCantidad && motivo.trim().length >= 3;

  const confirmar = async () => {
    if (!lista) {
      setError(valor == null ? `Poné ${porPeso ? 'cuántos kilos' : 'cuántas unidades'} entran.` : errorCantidad ?? 'Escribí el motivo de la carga.');
      return;
    }
    setGuardando(true);
    setError(null);
    let autorizacionToken: string | undefined;
    if (pidePin) {
      if (!pin.trim()) {
        setGuardando(false);
        setError('Falta el PIN del supervisor.');
        return;
      }
      const a = await pedirAutorizacion(pin.trim());
      if (!a.ok) {
        setGuardando(false);
        setError(a.mensaje);
        return;
      }
      autorizacionToken = a.token;
    }
    const r = await enviar({ accion: 'cargar-pozo', pozoId: pozo.id, sucursalId: sucursal.id, cantidad: valor, motivo: motivo.trim(), autorizacionToken });
    setGuardando(false);
    if (!r.ok) {
      if (/supervisor|PIN/i.test(r.mensaje) && !pidePin) setPidePin(true);
      setError(r.mensaje);
      return;
    }
    onListo(`Entraron ${cantidadDelPozo(valor!, porPeso)} al pozo de ${sucursal.nombre}. Ahora hay ${cantidadDelPozo(Number(r.datos?.stockPozo ?? enPozo + valor!), porPeso)}.`);
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="chico"
      cerrarAlTocarAfuera={false}
      bloquearCierre={guardando}
      titulo="Cargar el pozo"
      descripcion={`${pozo.nombre} · ${sucursal.nombre}`}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={confirmar} cargando={guardando} disabled={!lista}>
            Cargar al pozo
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-tinta/70">
          Lo normal es que el pozo se cargue con la factura del proveedor. Usá esto si entró mercadería sin factura o para corregir: queda registrado con tu nombre, y si es mucho lo autoriza un supervisor con su PIN.
        </p>
        <Campo
          etiqueta={porPeso ? '¿Cuántos kilos entran?' : '¿Cuántas unidades entran?'}
          error={errorCantidad}
          ayuda={valor != null && valor > 0 && !errorCantidad ? `El pozo pasa de ${cantidadDelPozo(enPozo, porPeso)} a ${cantidadDelPozo(aGramos(enPozo + valor), porPeso)}.` : `Hoy hay ${cantidadDelPozo(enPozo, porPeso)}.`}
          obligatorio
        >
          <Entrada
            inputMode={porPeso ? 'decimal' : 'numeric'}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value.replace(porPeso ? /[^\d.,]/g : /\D/g, ''))}
            sufijo={porPeso ? 'kg' : 'u.'}
            placeholder={porPeso ? 'Ej.: 4,5' : 'Ej.: 360'}
            autoFocus
          />
        </Campo>
        <Campo etiqueta="Motivo" obligatorio ayuda="Queda en el historial del pozo y en Stock › Movimientos.">
          <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: entró sin factura, corrección por conteo" maxLength={140} />
        </Campo>
        {pidePin && (
          <Campo etiqueta="PIN del supervisor" ayuda="La carga supera el tope: la autoriza gerencia o el dueño con su PIN.">
            <Entrada type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
          </Campo>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// ------------------------------------------- sumar presentación / fraccionable

type PozoElegido = { sku: string; nombre: string; porPeso: boolean; costo: number | null };

/**
 * Sumar una presentación a un pozo: un producto que ya existe (buscador) o uno
 * nuevo con nombre y precio. Sin `grupo`, primero se elige el pozo: así nace
 * un fraccionable nuevo con su primera presentación.
 */
export function ModalPresentacion({
  grupo,
  grupos,
  sucursal,
  onCerrar,
  onListo,
}: {
  grupo: Grupo | null;
  grupos: Grupo[];
  sucursal: Sucursal;
  onCerrar: () => void;
  onListo: (texto: string, pozoSku: string) => void;
}) {
  const [pozo, setPozo] = useState<PozoElegido | null>(
    grupo ? { sku: grupo.pozo.sku, nombre: grupo.pozo.nombre, porPeso: grupo.pozo.porPeso, costo: grupo.pozo.costo } : null,
  );
  const [modo, setModo] = useState<'existente' | 'nuevo'>('existente');
  const [producto, setProducto] = useState<ItemBusqueda | null>(null);
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [unidades, setUnidades] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // de quién es cada SKU hoy: para avisar en el buscador antes de elegir
  const { grupoDePozo, grupoDePresentacion } = useMemo(() => {
    const dePozo = new Map<string, Grupo>();
    const dePres = new Map<string, Grupo>();
    for (const g of grupos) {
      dePozo.set(g.pozo.sku, g);
      for (const p of g.presentaciones) dePres.set(p.sku, g);
    }
    return { grupoDePozo: dePozo, grupoDePresentacion: dePres };
  }, [grupos]);

  const notaPozo = (p: ItemBusqueda): NotaBusqueda => {
    const g = grupoDePresentacion.get(p.sku);
    if (g) return { texto: `es presentación de ${g.pozo.nombre}`, bloquea: true };
    if (grupoDePozo.has(p.sku)) return { texto: 'ya es pozo: se le suma', bloquea: false };
    return null;
  };
  const notaPresentacion = (p: ItemBusqueda): NotaBusqueda => {
    if (pozo && p.sku === pozo.sku) return { texto: 'es el pozo', bloquea: true };
    if (grupoDePozo.has(p.sku)) return { texto: 'es pozo de otro grupo', bloquea: true };
    const g = grupoDePresentacion.get(p.sku);
    if (g) return { texto: g.pozo.sku === pozo?.sku ? 'ya está en este grupo' : `es presentación de ${g.pozo.nombre}`, bloquea: true };
    if (p.porPeso) return { texto: 'se vende por kilo', bloquea: true };
    return null;
  };

  const porPeso = !!pozo?.porPeso;
  const valorUnidades = leerNumero(unidades);
  const errorUnidades =
    unidades.trim() === ''
      ? null
      : valorUnidades == null || valorUnidades <= 0
        ? 'Tiene que ser mayor que 0'
        : !porPeso && !Number.isInteger(valorUnidades)
          ? 'El pozo se cuenta por unidad: va sin decimales'
          : null;
  const unidadesOk = valorUnidades != null && valorUnidades > 0 && !errorUnidades;
  const valorPrecio = leerPrecio(precio);
  const costoEstimado = pozo?.costo && unidadesOk ? pozo.costo * valorUnidades! : null;
  const lista =
    !!pozo && unidadesOk && (modo === 'existente' ? !!producto : nombre.trim().length >= 3 && valorPrecio != null);

  const confirmar = async () => {
    if (!lista || !pozo) {
      setError(
        !pozo
          ? 'Elegí el producto pozo.'
          : !unidadesOk
            ? `Poné ${porPeso ? 'cuántos kilos' : 'cuántas unidades'} lleva.`
            : modo === 'existente'
              ? 'Elegí el producto de la presentación.'
              : 'Poné el nombre y el precio de la presentación nueva.',
      );
      return;
    }
    setGuardando(true);
    setError(null);
    const r = await enviar({
      accion: 'vincular',
      pozoSku: pozo.sku,
      unidades: valorUnidades,
      ...(modo === 'existente' ? { sku: producto!.sku } : { nuevo: { nombre: nombre.trim(), precio: valorPrecio } }),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    const d = r.datos ?? {};
    onListo(
      `«${d.nombre}» ya es presentación de ${pozo.nombre} y lleva ${cantidadDelPozo(valorUnidades!, porPeso)}.` +
        (d.nuevo ? ` Se dio de alta con SKU ${d.sku} y precio ${pesos(valorPrecio)}.` : ''),
      pozo.sku,
    );
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      cerrarAlTocarAfuera={false}
      bloquearCierre={guardando}
      titulo={grupo ? 'Sumar presentación' : 'Sumar fraccionable'}
      descripcion={
        grupo
          ? `Una forma más de vender ${grupo.pozo.nombre}.`
          : 'Lo que entra a granel (el pozo) y la primera presentación que se arma con eso.'
      }
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={confirmar} cargando={guardando} disabled={!lista}>
            {grupo ? 'Sumar presentación' : 'Crear fraccionable'}
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        {!grupo && (
          <section className="space-y-2">
            <h3 className="text-base font-semibold text-tinta">1. El pozo</h3>
            {pozo ? (
              <ProductoElegido
                nombre={pozo.nombre}
                detalle={
                  <>
                    <span>{pozo.sku}</span>
                    <Etiqueta tono={porPeso ? 'info' : 'neutro'}>{porPeso ? 'se cuenta en kilos' : 'se cuenta por unidad'}</Etiqueta>
                    {grupoDePozo.has(pozo.sku) && <Etiqueta>ya es pozo</Etiqueta>}
                  </>
                }
                onQuitar={() => setPozo(null)}
                etiquetaQuitar="Elegir otro pozo"
              />
            ) : (
              <Campo etiqueta="Producto que entra a granel" ayuda="Lo que trae el proveedor y se fracciona en el local: huevos por unidad, una horma de queso por kilo.">
                <BuscadorProducto
                  sucursalId={sucursal.id}
                  autoFocus
                  nota={notaPozo}
                  onElegir={(p) => {
                    setPozo({ sku: p.sku, nombre: p.nombre, porPeso: p.porPeso, costo: grupoDePozo.get(p.sku)?.pozo.costo ?? null });
                    setError(null);
                  }}
                />
              </Campo>
            )}
          </section>
        )}

        <section className={grupo ? 'space-y-3' : 'space-y-3 border-t border-black/[0.06] pt-4'}>
          {!grupo && <h3 className="text-base font-semibold text-tinta">2. La presentación</h3>}
          <Chips
            etiquetaAccesible="De dónde sale la presentación"
            valor={modo}
            onCambiar={(v) => {
              setModo(v);
              setError(null);
            }}
            opciones={[
              { valor: 'existente', etiqueta: 'Ya existe' },
              { valor: 'nuevo', etiqueta: 'Crear uno nuevo' },
            ]}
          />

          {modo === 'existente' ? (
            producto ? (
              <ProductoElegido
                nombre={producto.nombre}
                detalle={
                  <>
                    <span>{producto.sku}</span>
                    {producto.precio != null && <span className="importe">{pesos(producto.precio)}</span>}
                    {producto.stock != null && <span className="importe">stock {numero(producto.stock)}</span>}
                  </>
                }
                onQuitar={() => setProducto(null)}
                etiquetaQuitar="Elegir otro producto"
              />
            ) : (
              <Campo etiqueta="Producto de la presentación" ayuda="El que vende la caja: la docena, el maple, el cuarto kilo envasado.">
                <BuscadorProducto
                  sucursalId={sucursal.id}
                  autoFocus={!!grupo}
                  nota={notaPresentacion}
                  onElegir={(p) => {
                    setProducto(p);
                    setError(null);
                  }}
                />
              </Campo>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre" obligatorio className="sm:col-span-2" ayuda="Así lo ve la caja y el ticket.">
                <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={porPeso ? 'Ej.: Reggianito x 1/4 kg' : 'Ej.: Huevos x 1/2 docena'} maxLength={120} />
              </Campo>
              <Campo
                etiqueta="Precio de venta"
                obligatorio
                ayuda={valorPrecio != null && unidadesOk ? `${pesos(valorPrecio / valorUnidades!)} ${porPeso ? 'el kilo' : 'cada unidad'}` : 'Lista Minorista, como en la ficha.'}
              >
                <Entrada prefijo="$" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" />
              </Campo>
              {costoEstimado != null && (
                <p className="self-end pb-2 text-sm text-tinta/60 sm:pb-3">
                  Costo: <span className="importe">{pesos(costoEstimado)}</span> (lo que lleva × el costo del pozo)
                </p>
              )}
            </div>
          )}

          <Campo
            etiqueta={porPeso ? '¿Cuántos kilos del pozo lleva?' : '¿Cuántas unidades del pozo lleva?'}
            obligatorio
            error={errorUnidades}
            ayuda={porPeso ? 'Ej.: 0,25 para el cuarto kilo.' : 'Ej.: 12 para la docena, 30 para el maple.'}
          >
            <div className="w-40 max-w-full">
              <Entrada
                inputMode={porPeso ? 'decimal' : 'numeric'}
                value={unidades}
                onChange={(e) => setUnidades(e.target.value.replace(porPeso ? /[^\d.,]/g : /\D/g, ''))}
                sufijo={porPeso ? 'kg' : 'u.'}
                disabled={!pozo}
              />
            </div>
          </Campo>
        </section>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ editar

/**
 * Nombre, precio y lo que lleva una presentación; y sacarla del grupo (no se
 * borra: sigue en el catálogo con su stock). Lo que lleva no se cambia si hay
 * armadas: al abrirlas volverían al pozo con la cuenta nueva.
 */
export function ModalEditar({
  grupo,
  presentacion,
  sucursales,
  onCerrar,
  onListo,
}: {
  grupo: Grupo;
  presentacion: Presentacion;
  sucursales: Sucursal[];
  onCerrar: () => void;
  onListo: (texto: string) => void;
}) {
  const { confirmar, dialogo } = useConfirmar();
  const porPeso = grupo.pozo.porPeso;
  const [nombre, setNombre] = useState(presentacion.nombre);
  const [unidades, setUnidades] = useState(numero(presentacion.unidades, 3).replace(/\./g, ''));
  const [precio, setPrecio] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armadas = sumaStock(presentacion.stock);
  const dondeHay = sucursales
    .filter((s) => Number(presentacion.stock[s.id] ?? 0) > 0)
    .map((s) => `${numero(presentacion.stock[s.id])} en ${s.nombre}`)
    .join(' y ');
  const valorUnidades = leerNumero(unidades);
  const errorUnidades =
    valorUnidades == null || valorUnidades <= 0
      ? 'Tiene que ser mayor que 0'
      : !porPeso && !Number.isInteger(valorUnidades)
        ? 'El pozo se cuenta por unidad: va sin decimales'
        : null;
  const valorPrecio = leerPrecio(precio);
  const errorPrecio = precio.trim() && valorPrecio == null ? 'Tiene que ser un precio mayor que 0' : null;

  const cambios: Record<string, unknown> = {};
  if (nombre.trim() && nombre.trim() !== presentacion.nombre) cambios.nombre = nombre.trim();
  if (!errorUnidades && valorUnidades !== presentacion.unidades) cambios.unidades = valorUnidades;
  if (valorPrecio != null) cambios.precio = valorPrecio;
  const hayCambios = Object.keys(cambios).length > 0;
  const valido = nombre.trim().length > 0 && !errorUnidades && !errorPrecio;

  const guardar = async () => {
    if (!valido) {
      setError(!nombre.trim() ? 'El nombre no puede quedar vacío.' : errorUnidades ?? errorPrecio);
      return;
    }
    if (!hayCambios) {
      onCerrar();
      return;
    }
    setGuardando(true);
    setError(null);
    const r = await enviar({ accion: 'editar', id: presentacion.id, ...cambios });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    onListo(`Se guardaron los cambios de «${String(cambios.nombre ?? presentacion.nombre)}».`);
  };

  const quitar = async () => {
    const ok = await confirmar({
      titulo: `¿Quitar «${presentacion.nombre}» de ${grupo.pozo.nombre}?`,
      texto:
        'El producto no se borra: sigue en el catálogo y en la caja' +
        (armadas > 0 ? `, con sus ${numero(armadas)} armadas` : '') +
        '. Solo deja de armarse desde el pozo. Si te equivocaste, lo volvés a sumar.',
      variante: 'peligro',
      textoConfirmar: 'Quitar del grupo',
    });
    if (!ok) return;
    setGuardando(true);
    setError(null);
    const r = await enviar({ accion: 'quitar', id: presentacion.id });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    onListo(`«${presentacion.nombre}» ya no es presentación de ${grupo.pozo.nombre}. El producto sigue en el catálogo.`);
  };

  return (
    <>
      <Modal
        abierto
        onCerrar={onCerrar}
        ancho="chico"
        cerrarAlTocarAfuera={false}
        bloquearCierre={guardando}
        titulo="Editar presentación"
        descripcion={`${presentacion.sku} · ${grupo.pozo.nombre}`}
        pie={
          <>
            <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Boton>
            <Boton onClick={guardar} cargando={guardando} disabled={!valido}>
              Guardar
            </Boton>
          </>
        }
      >
        <div className="space-y-4">
          <Campo etiqueta="Nombre" obligatorio>
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta={porPeso ? 'Kilos que lleva' : 'Unidades que lleva'}
              error={armadas > 0 ? undefined : unidades.trim() ? errorUnidades : undefined}
              ayuda={armadas > 0 ? `Hay armadas (${dondeHay}): abrilas y pasalas al pozo para cambiarlo.` : 'Cuánto del pozo usa cada una.'}
            >
              <Entrada
                inputMode={porPeso ? 'decimal' : 'numeric'}
                value={unidades}
                onChange={(e) => setUnidades(e.target.value.replace(porPeso ? /[^\d.,]/g : /\D/g, ''))}
                sufijo={porPeso ? 'kg' : 'u.'}
                disabled={armadas > 0}
              />
            </Campo>
            <Campo etiqueta="Precio de venta" error={errorPrecio} ayuda={`Hoy: ${pesos(presentacion.precio)}. Si lo cambiás, rige desde ahora.`}>
              <Entrada prefijo="$" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder={presentacion.precio != null ? numero(presentacion.precio) : '0'} />
            </Campo>
          </div>
          {error && <Aviso tono="error">{error}</Aviso>}
          <div className="space-y-2 border-t border-black/[0.06] pt-4">
            <p className="text-sm text-tinta/70">
              ¿Ya no se arma desde el pozo? Quitala del grupo: el producto no se borra, sigue en el catálogo con su stock.
            </p>
            <Boton variante="peligro" tamano="chico" onClick={quitar} disabled={guardando}>
              Quitar del grupo
            </Boton>
          </div>
        </div>
      </Modal>
      {dialogo}
    </>
  );
}
