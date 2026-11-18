'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Cargando, Entrada, FOCO, FOCO_ADENTRO, Modal, unir } from './kit';
import { filtrarPorBusqueda } from '../lib/busqueda';

// «PROVEEDOR: X · CAMBIAR», EN CUALQUIER PANTALLA DONDE APARECE UN PRODUCTO
// (18/11/2026). Leandro: «tenemos que poder cambiar un producto de proveedor
// desde cualquier lado, tiene que ser muy fácil reasignarlo».
//
// Dos toques: «cambiar» abre el buscador de proveedores y tocar uno lo pasa.
// Lo hace la API en una sola transacción (apps/api/src/proveedores/
// proveedor-de-producto.service.ts → reasignar_proveedor en la base):
// - el nuevo queda como el proveedor decidido (manda sobre el Crack);
// - se asegura el vínculo con el nuevo;
// - la lista del proveedor viejo pierde el producto solo si nunca se le compró
//   (con compras queda como historia);
// - Qué comprar y los pedidos lo toman enseguida, y queda en la auditoría.
//
// El proveedor de hoy de cada producto se pide de a muchos juntos (una sola
// llamada por pantalla, aunque la lista tenga cien productos) y se guarda un
// minuto. Lo ve cualquiera que ve el producto; «cambiar» aparece solo para los
// que compran (comprador, administración, gerencia y dueño).

export type ProveedorCorto = { id: string; razonSocial: string };
type Actual = { productoId: string; sku: string; nombre: string; proveedor: (ProveedorCorto & { decidido: boolean }) | null };
export type PantallaCambio = 'ficha-producto' | 'stock' | 'que-comprar' | 'pedido' | 'factura' | 'ficha-proveedor' | 'mesa-compras';
export type CambioProveedor = { productoId: string; sku: string; ahora: ProveedorCorto; antes: ProveedorCorto | null; mensaje: string };

/* ---------- el proveedor de hoy, pedido de a muchos ---------- */

const VIGENCIA_MS = 60_000;
const cache = new Map<string, { en: number; p: Promise<Actual | null> }>();
let pendientes: { ref: string; listo: (a: Actual | null) => void }[] = [];
let reloj: ReturnType<typeof setTimeout> | null = null;
let puede: boolean | null = null;
const oyentes = new Set<(a: Actual) => void>();

async function vaciar() {
  const lote = pendientes;
  pendientes = [];
  reloj = null;
  for (let i = 0; i < lote.length; i += 300) {
    const tramo = lote.slice(i, i + 300);
    try {
      const r = await fetch('/api/proveedor-producto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ accion: 'actuales', refs: tramo.map((x) => x.ref) }),
      });
      const j = r.ok ? await r.json() : null;
      if (j) puede = j.puedeCambiar === true;
      for (const x of tramo) {
        const a = j?.actuales?.[x.ref] ?? null;
        if (!j) cache.delete(x.ref); // sin respuesta: la próxima vez se vuelve a pedir
        x.listo(a);
      }
    } catch {
      for (const x of tramo) { cache.delete(x.ref); x.listo(null); }
    }
  }
}

function pedirActual(ref: string): Promise<Actual | null> {
  const c = cache.get(ref);
  if (c && Date.now() - c.en < VIGENCIA_MS) return c.p;
  const p = new Promise<Actual | null>((listo) => {
    pendientes.push({ ref, listo });
    if (!reloj) reloj = setTimeout(vaciar, 25);
  });
  cache.set(ref, { en: Date.now(), p });
  return p;
}

/** Después de un cambio: todas las pantallas que muestran ese producto se enteran. */
function anotar(a: Actual) {
  const p = Promise.resolve(a);
  cache.set(a.productoId, { en: Date.now(), p });
  if (a.sku) cache.set(a.sku, { en: Date.now(), p });
  oyentes.forEach((o) => o(a));
}

/* ---------- los proveedores activos, para el buscador ---------- */

type ProveedorLista = ProveedorCorto & { nombreFantasia: string | null; cuit: string | null };
let lista: { en: number; p: Promise<ProveedorLista[]> } | null = null;
function proveedoresActivos(): Promise<ProveedorLista[]> {
  if (lista && Date.now() - lista.en < 5 * 60_000) return lista.p;
  const p = fetch('/api/proveedor-producto?recurso=proveedores', { cache: 'no-store' })
    .then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j)) throw new Error(j?.message ?? 'No pude traer los proveedores');
      return j as ProveedorLista[];
    });
  lista = { en: Date.now(), p };
  p.catch(() => { lista = null; });
  return p;
}

/* ---------- el componente ---------- */

export function CambiarProveedor({
  producto,
  actual: conocido,
  esperado,
  sugeridos,
  pantalla,
  onCambio,
  tamano = 'chico',
  className,
}: {
  /** El producto, por id o por SKU (las listas de pedido solo traen el SKU). */
  producto: { id?: string | null; sku?: string | null; nombre: string };
  /** Lo que la pantalla ya sabe (se muestra mientras llega el dato de la base). */
  actual?: ProveedorCorto | null;
  /** En la lista de un proveedor: si el producto ya se le compra a otro, se avisa. */
  esperado?: string;
  /** Proveedores para ofrecer primero (el de la factura). */
  sugeridos?: ProveedorCorto[];
  /** De dónde se cambió (queda en la auditoría). */
  pantalla: PantallaCambio;
  /** Avisa el cambio. Si no se pasa, la página se vuelve a leer. */
  onCambio?: (c: CambioProveedor) => void;
  /** chico (12 px, en listas) o normal (14 px, en una ficha). */
  tamano?: 'chico' | 'normal';
  className?: string;
}) {
  const router = useRouter();
  const ref = producto.id || producto.sku || '';
  const [estado, setEstado] = useState<Actual | null | undefined>(undefined);
  const [puedeCambiar, setPuedeCambiar] = useState<boolean>(puede ?? false);
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; deshacer: ProveedorCorto | null } | null>(null);

  useEffect(() => {
    if (!ref) return;
    let vivo = true;
    pedirActual(ref).then((a) => {
      if (!vivo) return;
      setEstado(a);
      if (puede != null) setPuedeCambiar(puede);
    });
    const oir = (a: Actual) => { if (a.productoId === ref || a.sku === ref || a.productoId === producto.id) setEstado(a); };
    oyentes.add(oir);
    return () => { vivo = false; oyentes.delete(oir); };
  }, [ref, producto.id]);

  // el aviso de «listo» se va solo
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 12_000);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!ref) return null;
  const prov = estado === undefined ? (conocido ? { ...conocido, decidido: false } : null) : estado?.proveedor ?? null;
  const cargando = estado === undefined && !conocido;
  const deOtro = !!(esperado && prov && prov.id !== esperado);

  function listo(c: CambioProveedor & { deshacer: ProveedorCorto | null }) {
    setAbierto(false);
    anotar({ productoId: c.productoId, sku: c.sku, nombre: producto.nombre, proveedor: { ...c.ahora, decidido: true } });
    setAviso({ texto: c.mensaje, deshacer: c.deshacer });
    if (onCambio) onCambio(c);
    else router.refresh();
  }

  return (
    <>
      <span className={unir('inline-flex max-w-full flex-wrap items-baseline gap-x-1.5', tamano === 'normal' ? 'text-sm' : 'text-xs', deOtro ? 'text-atencion' : 'text-tinta/70', className)}>
        {cargando ? (
          <span>Proveedor: …</span>
        ) : prov ? (
          <span className="min-w-0 break-words">
            {deOtro ? 'Se le compra a ' : 'Proveedor: '}
            <b className={unir('font-semibold', deOtro ? 'text-atencion' : 'text-tinta')}>{prov.razonSocial}</b>
          </span>
        ) : (
          <span>Sin proveedor</span>
        )}
        {puedeCambiar && !cargando && (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAbierto(true); }}
              className={unir('rounded-sm font-semibold text-marca-hondo underline underline-offset-2 hover:text-marca', FOCO)}
              aria-label={`${prov ? 'Cambiar el proveedor' : 'Asignar un proveedor'} de ${producto.nombre}`}
            >
              {prov ? 'cambiar' : 'asignar'}
            </button>
          </>
        )}
      </span>

      {/* En una fila que es enlace (Stock), lo que se toca en la ventana o en el aviso
          no tiene que llegar al enlace: los eventos de React suben por el árbol aunque
          la ventana se dibuje aparte (portal), y abrirían la ficha. */}
      {abierto && (
        <span className="contents" onClick={cortar}>
        <ElegirProveedor
          producto={{ ref, nombre: producto.nombre }}
          actual={prov}
          sugeridos={sugeridos}
          pantalla={pantalla}
          onCerrar={() => setAbierto(false)}
          onListo={listo}
        />
        </span>
      )}

      {aviso && typeof document !== 'undefined' && createPortal(
        <div onClick={cortar} className="flotante-ocultable fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-toast animate-entra-aviso motion-reduce:animate-none sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96 print:hidden">
          <Aviso
            tono="ok"
            className="shadow-flotante"
            accion={
              <span className="flex flex-wrap gap-2">
                {aviso.deshacer && (
                  <DeshacerCambio
                    producto={{ ref, nombre: producto.nombre }}
                    volverA={aviso.deshacer}
                    pantalla={pantalla}
                    onListo={(c) => { setAviso(null); listo({ ...c, deshacer: null }); }}
                  />
                )}
                <Boton tamano="chico" variante="secundario" onClick={() => setAviso(null)}>Entendido</Boton>
              </span>
            }
          >
            {aviso.texto}
          </Aviso>
        </div>,
        document.body,
      )}
    </>
  );
}

const cortar = (e: { stopPropagation: () => void }) => e.stopPropagation();

async function reasignar(ref: string, proveedorId: string, pantalla: PantallaCambio) {
  const r = await fetch('/api/proveedor-producto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reasignar', producto: ref, proveedorId, pantalla }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j?.message === 'string' ? j.message : 'No se pudo cambiar el proveedor');
  return j as { producto: { id: string; sku: string }; antes: ProveedorCorto | null; ahora: ProveedorCorto; yaEstaba: boolean; mensaje: string };
}

function DeshacerCambio({ producto, volverA, pantalla, onListo }: {
  producto: { ref: string; nombre: string };
  volverA: ProveedorCorto;
  pantalla: PantallaCambio;
  onListo: (c: CambioProveedor) => void;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <Boton tamano="chico" variante="secundario" cargando={trabajando} onClick={async () => {
        setTrabajando(true); setError('');
        try {
          const j = await reasignar(producto.ref, volverA.id, pantalla);
          onListo({ productoId: j.producto.id, sku: j.producto.sku, ahora: j.ahora, antes: j.antes, mensaje: j.mensaje });
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo deshacer'); } finally { setTrabajando(false); }
      }}>
        Volver a {volverA.razonSocial}
      </Boton>
      {error && <span className="basis-full text-xs text-marca-hondo">{error}</span>}
    </>
  );
}

function ElegirProveedor({ producto, actual, sugeridos, pantalla, onCerrar, onListo }: {
  producto: { ref: string; nombre: string };
  actual: (ProveedorCorto & { decidido?: boolean }) | null;
  sugeridos?: ProveedorCorto[];
  pantalla: PantallaCambio;
  onCerrar: () => void;
  onListo: (c: CambioProveedor & { deshacer: ProveedorCorto | null }) => void;
}) {
  const [todos, setTodos] = useState<ProveedorLista[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    proveedoresActivos().then(setTodos).catch((e) => setError(e instanceof Error ? e.message : 'No pude traer los proveedores'));
  }, []);

  const primeros = (sugeridos ?? []).filter((s) => s.id !== actual?.id);
  const encontrados = useMemo(() => {
    if (!todos) return [];
    const base = q.trim()
      ? filtrarPorBusqueda(todos, q, (p) => `${p.razonSocial} ${p.nombreFantasia ?? ''} ${p.cuit ?? ''}`)
      : todos;
    return base.slice(0, 40);
  }, [todos, q]);

  async function elegir(p: ProveedorCorto) {
    if (guardando) return;
    setGuardando(p.id); setError('');
    try {
      const j = await reasignar(producto.ref, p.id, pantalla);
      onListo({
        productoId: j.producto.id, sku: j.producto.sku, ahora: j.ahora, antes: j.antes, mensaje: j.mensaje,
        deshacer: j.antes && j.antes.id !== j.ahora.id && !j.yaEstaba ? j.antes : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el proveedor');
    } finally {
      setGuardando(null);
    }
  }

  const fila = (p: ProveedorCorto & { nombreFantasia?: string | null; cuit?: string | null }, marca?: string) => {
    const esActual = p.id === actual?.id;
    return (
      <li key={p.id}>
        <button
          type="button"
          disabled={!!guardando || esActual}
          onClick={() => void elegir(p)}
          className={unir(
            'flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-tinta transition-colors hover:bg-crema-claro disabled:cursor-default disabled:hover:bg-transparent',
            FOCO_ADENTRO,
          )}
        >
          <span className="min-w-0">
            <span className="block break-words font-medium">{p.razonSocial}</span>
            {(p.nombreFantasia || p.cuit) && (
              <span className="block break-words text-xs text-tinta/60">{[p.nombreFantasia, p.cuit && `CUIT ${p.cuit}`].filter(Boolean).join(' · ')}</span>
            )}
          </span>
          <span className="shrink-0 text-xs font-semibold text-tinta/60">
            {guardando === p.id ? 'Pasando…' : esActual ? 'es el de hoy' : marca ?? ''}
          </span>
        </button>
      </li>
    );
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloquearCierre={!!guardando}
      titulo={actual ? 'Cambiar el proveedor' : 'Asignar un proveedor'}
      descripcion={producto.nombre}
      sinRelleno
    >
      <div className="space-y-3 px-4 pt-4 sm:px-5">
        <p className="text-sm text-tinta/70">
          {actual ? <>Hoy se le compra a <b className="text-tinta">{actual.razonSocial}</b>. </> : 'Hoy no tiene proveedor. '}
          Tocá el proveedor nuevo: queda como el de este producto en Qué comprar, en los pedidos y en la carga del Crack.
        </p>
        {error && <Aviso tono="error">{error}</Aviso>}
        <Entrada
          autoFocus
          aria-label="Buscar proveedor"
          placeholder="Buscar proveedor por nombre o CUIT"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="pb-2 pt-2">
        {primeros.length > 0 && !q.trim() && (
          <ul className="divide-y divide-black/[0.06] border-b border-black/[0.06]">
            {primeros.map((p) => fila(p, 'el de la factura'))}
          </ul>
        )}
        {!todos && !error ? (
          <div className="px-4 py-3 sm:px-5"><Cargando texto="Buscando proveedores…" /></div>
        ) : encontrados.length === 0 && todos ? (
          <p className="px-4 py-3 text-sm text-tinta/70 sm:px-5">No hay ningún proveedor activo que se llame «{q.trim()}».</p>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {encontrados.map((p) => fila(p))}
          </ul>
        )}
        {todos && !q.trim() && todos.length > encontrados.length && (
          <p className="px-4 py-2 text-xs text-tinta/60 sm:px-5">Escribí para buscar entre los {todos.length} proveedores.</p>
        )}
      </div>
    </Modal>
  );
}
