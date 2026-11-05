'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, BarraInferior, Boton, Cargando, Chip, Entrada, FOCO, FOCO_ADENTRO, IconoFlechaAbajo, PlacaRoja, Selector, Tarjeta, unir } from './kit';
import { fecha, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';
import { ParecidosProducto } from './ParecidosProducto';

// Armar el pedido a un proveedor desde el teléfono, caminando el depósito.
//
// Dos decisiones que hacen que se use: por defecto NO se muestra la lista
// entera del proveedor (hay una de 1.400 renglones) sino lo que hace falta
// reponer; y el producto que falta en la lista se puede agregar en el momento,
// porque el momento en que uno se da cuenta es justo ese.
//
// EL PEDIDO SE GUARDA SOLO (Leandro, 4/11/2026): «cargamos un montón de cosas
// que queríamos pedir y se nos borraron» … «no puede volver a pasar nunca
// más». Las cantidades vivían solo en memoria hasta «Enviar a aprobación»: una
// recarga (el cartel de versión nueva, cerrar la pestaña) las perdía. Ahora
// cada cambio se guarda en el sistema, por proveedor y sucursal, y al volver a
// entrar —desde cualquier computadora— aparece tal cual. Si el sistema no
// contesta, queda además en este navegador y se avisa; nunca en silencio.

// los botones − y + de cada renglón: 44 px en el celular
const PASO = unir(
  'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-lg leading-none transition-colors hover:bg-crema-claro active:scale-[0.98] disabled:opacity-30 sm:size-10',
  FOCO,
);

// Cómo se ve el stock de cada producto (23/10/2026: «más visual: cuánto stock
// tengo de cada uno, de menor a mayor, los que menos tienen arriba y en rojo»).
type EstadoStock = 'sin' | 'critico' | 'bajo' | 'ok';
const ESTADO_STOCK: Record<EstadoStock, { titulo: string; caja: string; borde: string; texto: string }> = {
  sin: { titulo: 'sin stock', caja: 'bg-marca text-white', borde: 'border-marca', texto: 'text-marca-hondo' },
  critico: { titulo: 'se terminan en 5 días', caja: 'bg-marca-suave text-marca-hondo', borde: 'border-marca/60', texto: 'text-marca-hondo' },
  bajo: { titulo: 'alcanzan menos de 2 semanas', caja: 'bg-atencion-suave text-atencion', borde: 'border-atencion', texto: 'text-atencion' },
  ok: { titulo: 'bien de stock', caja: 'bg-ok-suave text-ok', borde: 'border-ok/50', texto: 'text-ok' },
};
function estadoStock(it: { stock: number; urgente: boolean; diasDeStock: number | null; sugerido: number }): EstadoStock {
  if (it.stock <= 0) return 'sin';
  if (it.urgente) return 'critico';
  if (it.sugerido > 0 || (it.diasDeStock != null && it.diasDeStock < 14)) return 'bajo';
  return 'ok';
}
const formatoStock = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
function textoEstado(it: { stock: number; diasDeStock: number | null; minimo: number }, e: EstadoStock): string {
  if (e === 'sin') return 'Sin stock';
  const dias = it.diasDeStock != null ? `alcanza para ${it.diasDeStock} día${it.diasDeStock === 1 ? '' : 's'}` : 'sin ventas recientes';
  if (e === 'critico') return `Se termina: ${dias}${it.minimo > 0 ? ` · mínimo ${it.minimo}` : ''}`;
  if (e === 'bajo') return `Poco: ${dias}`;
  return `Bien: ${dias}`;
}
const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');

type Item = {
  sku: string; nombre: string; unidadesPack: number; codigoProveedor: string | null;
  costo: number | null; stock: number; minimo: number; reposicion: number;
  sugerido: number; urgente: boolean; porDia: number; diasDeStock: number | null;
  /** ya pedido y sin recibir (órdenes aprobadas o enviadas), y el día que confirmó el proveedor */
  enCamino?: number; llega?: string | null;
  /** lo que hay del mismo producto en las otras sucursales (4/11/2026) */
  stockOtras?: { sucursalId: string; sucursal: string; cantidad: number }[];
  /** la cuenta del sugerido, en palabras, y en cuántos bultos enteros entra (4/11/2026) */
  explicacion?: string; sugeridoBultos?: number | null;
};
// "Suc Sant Thomas" → "Sant Thomas"
const nombreCorto = (sucursal: string) => sucursal.replace(/^suc(ursal)?\.?\s+/i, '');

type Cantidades = Record<string, number>;
type EstadoGuardado = '' | 'guardando' | 'guardado' | 'error';
// quién cargó lo que está en pantalla y cuándo (null = lo cargaste vos recién)
type Borrador = { por: string | null; en: string | null };

const claveLocal = (proveedorId: string, sucursalId: string) => `odb:pedido-proveedor:${proveedorId}:${sucursalId}`;
const leerLocal = (proveedorId: string, sucursalId: string): Cantidades => {
  try {
    const crudo = JSON.parse(localStorage.getItem(claveLocal(proveedorId, sucursalId)) ?? 'null');
    return crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? crudo : {};
  } catch { return {}; }
};
const escribirLocal = (proveedorId: string, sucursalId: string, items: Cantidades) => {
  try {
    if (Object.keys(items).length) localStorage.setItem(claveLocal(proveedorId, sucursalId), JSON.stringify(items));
    else localStorage.removeItem(claveLocal(proveedorId, sucursalId));
  } catch { /* sin almacenamiento: el sistema igual lo guarda */ }
};

export function PedidoProveedor({ sucursales, proveedorInicial, sucursalInicial }: {
  sucursales: { id: string; nombre: string }[];
  proveedorInicial?: string;
  sucursalInicial?: string;
}) {
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [proveedor, setProveedor] = useState<any | null>(null);
  // la sucursal llega con el nombre corto de Mesa de compras ("Saint Thomas")
  // y en la base se llama "Suc Sant Thomas": se busca con la regla de búsqueda
  const [sucursalId, setSucursalId] = useState(
    (sucursalInicial ? filtrarPorBusqueda(sucursales, sucursalInicial, (s) => s.nombre)[0]?.id : null) ?? sucursales[0]?.id ?? '',
  );
  const [items, setItems] = useState<Item[]>([]);
  // Todo lo que se vio de su lista, por SKU. Lo elegido se muestra en la nota
  // de pedido de abajo aunque después se busque otra cosa y ya no esté en
  // pantalla (2/10/2026: antes salía el SKU pelado y el total perdía el costo
  // de lo que no se veía).
  const [vistos, setVistos] = useState<Record<string, Item>>({});
  const [meta, setMeta] = useState<{ total: number; recortado?: boolean; sinLista?: boolean }>({ total: 0 });
  const [busca, setBusca] = useState('');
  const [verTodo, setVerTodo] = useState(true); // 23/10/2026: toda la lista, de menor a mayor stock
  const [cant, setCant] = useState<Cantidades>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [buscaCatalogo, setBuscaCatalogo] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [agregando, setAgregando] = useState(false);
  // el producto del que se están mirando los parecidos (otra marca, otro tamaño); el pedido queda debajo, intacto
  const [parecidosDe, setParecidosDe] = useState<Item | null>(null);
  // el renglón que tiene abierta la cuenta del sugerido (plegada por defecto: pantalla limpia)
  const [explicado, setExplicado] = useState<string | null>(null);

  // ---- el pedido guardado solo ----
  const [guardado, setGuardado] = useState<EstadoGuardado>('');
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  // proveedor:sucursal cuyo pedido ya se trajo del sistema y está en pantalla.
  // Mientras no coincida con el actual, no se guarda nada: así una pantalla
  // recién abierta nunca pisa con un vacío lo que había guardado.
  const claveCargada = useRef('');
  // lo último que se guardó (o se trajo) tal cual: si no cambió, no se vuelve a mandar
  const ultimoGuardado = useRef('');
  // el guardado que espera (se junta medio segundo de tecleo en una sola llamada)
  const pendiente = useRef<{ timer: ReturnType<typeof setTimeout>; proveedorId: string; sucursalId: string; items: Cantidades } | null>(null);

  const guardar = useCallback(async (proveedorId: string, sucursalId: string, items: Cantidades, keepalive = false) => {
    escribirLocal(proveedorId, sucursalId, items);
    setGuardado('guardando');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive,
        body: JSON.stringify({ accion: 'guardarBorradorPedido', proveedorId, sucursalId, items }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      ultimoGuardado.current = JSON.stringify(items);
      setGuardado('guardado');
      setBorrador(d?.vacio ? null : { por: null, en: d?.actualizadoEn ?? new Date().toISOString() });
    } catch {
      setGuardado('error');
    }
  }, []);

  // manda ya lo que estaba esperando (al cambiar de proveedor o sucursal, al cerrar la pestaña)
  const mandarPendiente = useCallback((keepalive = false) => {
    const p = pendiente.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendiente.current = null;
    void guardar(p.proveedorId, p.sucursalId, p.items, keepalive);
  }, [guardar]);

  useEffect(() => {
    const alCerrar = () => mandarPendiente(true);
    window.addEventListener('pagehide', alCerrar);
    window.addEventListener('beforeunload', alCerrar);
    return () => {
      window.removeEventListener('pagehide', alCerrar);
      window.removeEventListener('beforeunload', alCerrar);
      mandarPendiente(true);
    };
  }, [mandarPendiente]);

  useEffect(() => {
    fetch('/api/compras?recurso=proveedores-lista')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const lista = Array.isArray(d) ? d : [];
        setProveedores(lista);
        // desde Mesa de compras ("Pedirle algo"): directo a la lista de ese proveedor
        const elegido = proveedorInicial ? lista.find((p: any) => p.id === proveedorInicial) : null;
        if (elegido) setProveedor(elegido);
      })
      .catch(() => setError('No pude traer los proveedores'));
  }, [proveedorInicial]);

  const cargarCatalogo = useCallback(async (provId: string, q: string, todo: boolean, suc: string) => {
    setCargando(true);
    setError('');
    try {
      const p = new URLSearchParams({ recurso: 'catalogo-proveedor', proveedorId: provId });
      if (q.trim()) p.set('q', q.trim());
      if (todo) p.set('todo', '1');
      if (suc) p.set('sucursalId', suc);
      const r = await fetch(`/api/compras?${p.toString()}`);
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude traer la lista del proveedor'); return; }
      const lista: Item[] = d.items ?? [];
      setItems(lista);
      setVistos((v) => {
        const copia = { ...v };
        for (const it of lista) copia[it.sku] = it;
        return copia;
      });
      setMeta({ total: d.total ?? 0, recortado: d.recortado, sinLista: d.sinLista });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!proveedor) return;
    const t = setTimeout(() => cargarCatalogo(proveedor.id, busca, verTodo, sucursalId), busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [proveedor, busca, verTodo, sucursalId, cargarCatalogo]);

  // Al entrar a un proveedor (o cambiar de sucursal): lo que quedó guardado
  // vuelve a la pantalla. Primero lo del sistema; si el sistema no tiene nada
  // pero este navegador sí (se guardó acá cuando no había conexión), va eso y
  // se manda al sistema.
  useEffect(() => {
    if (!proveedor || !sucursalId) return;
    const proveedorId: string = proveedor.id;
    const clave = `${proveedorId}:${sucursalId}`;
    let vigente = true;
    claveCargada.current = '';
    (async () => {
      let items: Cantidades = {};
      let info: Borrador | null = null;
      let fallo = false;
      try {
        const r = await fetch(`/api/compras?recurso=borrador-pedido&proveedorId=${encodeURIComponent(proveedorId)}&sucursalId=${encodeURIComponent(sucursalId)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (d?.items && Object.keys(d.items).length) {
          items = d.items;
          info = { por: d.actualizadoPor ?? null, en: d.actualizadoEn ?? null };
          // nombre y costo de lo guardado, para la nota de pedido, aunque el
          // renglón no esté en la lista que se ve
          setVistos((v) => {
            const copia = { ...v };
            for (const rg of (d.renglones ?? []) as any[]) {
              if (!copia[rg.sku]) {
                copia[rg.sku] = {
                  sku: rg.sku, nombre: rg.nombre ?? rg.sku, unidadesPack: 1, codigoProveedor: rg.codigoProveedor ?? null,
                  costo: rg.costo ?? null, stock: 0, minimo: 0, reposicion: 0, sugerido: 0, urgente: false, porDia: 0, diasDeStock: null,
                };
              }
            }
            return copia;
          });
        }
      } catch {
        fallo = true;
      }
      let deEsteNavegador = false;
      if (!Object.keys(items).length) {
        const local = leerLocal(proveedorId, sucursalId);
        if (Object.keys(local).length) { items = local; deEsteNavegador = true; }
      }
      if (!vigente) return;
      ultimoGuardado.current = deEsteNavegador ? '' : JSON.stringify(items);
      setCant(items);
      setBorrador(info);
      setGuardado(fallo ? 'error' : Object.keys(items).length ? 'guardado' : '');
      claveCargada.current = clave;
      // lo de este navegador todavía no llegó al sistema: va ahora
      if (deEsteNavegador) void guardar(proveedorId, sucursalId, items);
    })();
    return () => {
      vigente = false;
      // lo que esperaba para este proveedor y sucursal se manda antes de cambiar
      mandarPendiente();
    };
  }, [proveedor, sucursalId, guardar, mandarPendiente]);

  // Cada cambio se guarda: medio segundo después de la última tecla, una sola llamada.
  useEffect(() => {
    if (!proveedor || !sucursalId) return;
    if (claveCargada.current !== `${proveedor.id}:${sucursalId}`) return;
    if (JSON.stringify(cant) === ultimoGuardado.current) return;
    if (pendiente.current) clearTimeout(pendiente.current.timer);
    const proveedorId: string = proveedor.id;
    const timer = setTimeout(() => {
      pendiente.current = null;
      void guardar(proveedorId, sucursalId, cant);
    }, 500);
    pendiente.current = { timer, proveedorId, sucursalId, items: cant };
  }, [cant, proveedor, sucursalId, guardar]);

  const poner = (sku: string, valor: number) =>
    setCant((c) => {
      const n = Math.max(0, Math.round(valor));
      const copia = { ...c };
      if (n === 0) delete copia[sku];
      else copia[sku] = n;
      return copia;
    });

  const elegidos = useMemo(
    () => Object.entries(cant).map(([sku, cantidad]) => {
      const it = vistos[sku];
      return { sku, cantidad, nombre: it?.nombre ?? sku, costo: it?.costo ?? null, codigoProveedor: it?.codigoProveedor ?? null };
    }),
    [cant, vistos],
  );
  const totalPedido = elegidos.reduce((s, e) => s + (e.costo ?? 0) * e.cantidad, 0);
  const notaTotal = totalPedido === 0 ? 'sin costos cargados: el total lo confirma la factura' : 'estimado con el último costo conocido';
  const sucursalNombre = sucursales.find((s) => s.id === sucursalId)?.nombre;

  const buscarEnCatalogo = async (q: string) => {
    setBuscaCatalogo(q);
    if (q.trim().length < 3) { setResultados([]); return; }
    const r = await fetch(`/api/pos-buscar?q=${encodeURIComponent(q.trim())}`);
    setResultados(r.ok ? (await r.json()).slice(0, 8) : []);
  };

  const sumarALista = async (sku: string) => {
    if (!proveedor) return;
    const r = await fetch('/api/compras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'agregarALista', proveedorId: proveedor.id, sku }),
    });
    if (!r.ok) { setError('No pude sumarlo a la lista'); return; }
    setBuscaCatalogo(''); setResultados([]); setAgregando(false);
    setAviso(`${sku} quedó en la lista de ${proveedor.razon_social}.`);
    cargarCatalogo(proveedor.id, sku, true, sucursalId);
    setBusca(sku);
  };

  // volver a la lista de proveedores: lo cargado queda guardado para cuando se vuelva
  const volverAProveedores = () => {
    mandarPendiente();
    claveCargada.current = '';
    setProveedor(null); setItems([]); setVistos({}); setCant({}); setBusca(''); setAviso(''); setBorrador(null); setGuardado('');
  };

  // vaciar el pedido a propósito: la única forma de que lo guardado desaparezca sin enviarlo
  const vaciar = () => {
    if (!window.confirm(`¿Vaciar el pedido a ${proveedor?.razon_social}? Se borra lo cargado para ${sucursalNombre ?? 'esta sucursal'}.`)) return;
    setCant({});
  };

  const enviar = async () => {
    if (!proveedor || !elegidos.length || enviando) return;
    setEnviando(true);
    setError('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'crearOC', proveedorId: proveedor.id, sucursalId,
          items: elegidos.map((e) => ({ sku: e.sku, cantidad: e.cantidad })),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No se pudo crear el pedido'); return; }
      // ya es una orden: el sistema borró el guardado; acá también
      if (pendiente.current) { clearTimeout(pendiente.current.timer); pendiente.current = null; }
      escribirLocal(proveedor.id, sucursalId, {});
      ultimoGuardado.current = JSON.stringify({});
      setCant({});
      setBorrador(null);
      setGuardado('');
      setAviso('Pedido enviado. Queda esperando la aprobación del dueño en Aprobaciones.');
    } finally {
      setEnviando(false);
    }
  };

  // ---- paso 1: elegir proveedor ----
  if (!proveedor) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-tinta/60">Elegí a quién le vas a pedir. Después armás el pedido con su lista de productos.</p>
        {error && <Aviso tono="error">{error}</Aviso>}
        <Entrada
          aria-label="Buscar proveedor"
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar proveedor"
        />
        <Tarjeta relleno={false} className="overflow-hidden">
          <div className="divide-y divide-black/[0.06]">
            {filtrarPorBusqueda(proveedores, busca, (p) => p.razon_social)
              .map((p) => (
                <button key={p.id} type="button" onClick={() => { setProveedor(p); setBusca(''); setVerTodo(false); }}
                  className={unir('flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-crema-claro active:bg-crema-claro', FOCO_ADENTRO)}>
                  <span className="min-w-0">
                    <span className="block min-w-0 break-words text-sm font-semibold text-tinta">{p.razon_social}</span>
                    <span className="text-xs text-tinta/60">
                      {p.productos > 0 ? `${p.productos} producto${p.productos === 1 ? '' : 's'} en su lista` : 'sin lista cargada todavía'}
                    </span>
                  </span>
                  <IconoFlechaAbajo className="size-5 shrink-0 -rotate-90 text-tinta/40" />
                </button>
              ))}
            {proveedores.length === 0 && <Cargando texto="Cargando proveedores…" bloque />}
          </div>
        </Tarjeta>
      </div>
    );
  }

  // ---- paso 2: armar el pedido ----
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Boton variante="secundario" tamano="chico" icono={<IconoFlechaAbajo className="size-4 rotate-90" />} onClick={volverAProveedores}>
          Proveedores
        </Boton>
        {sucursales.length > 1 && (
          <Selector aria-label="Sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-xs"
            opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} />
        )}
      </div>

      <div>
        <h2 className="break-words text-lg font-semibold text-tinta">{proveedor.razon_social}</h2>
        <p className="text-xs text-tinta/60">
          {verTodo || busca ? 'Toda su lista, de menor a mayor stock' : 'Solo lo que hace falta reponer'} · {meta.total} producto{meta.total === 1 ? '' : 's'}
          {meta.recortado && ' (se muestran los primeros 300)'}
          <br />El sugerido cubre 14 días según lo que se vendió en los últimos 30 (sistema anterior + ODB).
        </p>
        {/* el pedido se guarda solo: se dice siempre, y si no se pudo, se grita */}
        {guardado === 'guardando' && <p className="mt-1 text-xs text-tinta/60">Guardando el pedido…</p>}
        {guardado === 'guardado' && elegidos.length > 0 && (
          <p className="mt-1 text-xs text-ok">
            Pedido guardado{borrador?.en ? ` · ${hora(borrador.en)}` : ''}{borrador?.por ? ` · lo cargó ${borrador.por}` : ''}. Podés salir y seguirlo después, desde cualquier computadora.
          </p>
        )}
      </div>

      {guardado === 'error' && (
        <Aviso tono="error">
          No hay conexión con el sistema para guardar el pedido. Lo cargado queda en este navegador: no cierres la pestaña hasta que se guarde.
          <button type="button" onClick={() => proveedor && guardar(proveedor.id, sucursalId, cant)} className="ml-2 font-semibold underline">Reintentar</button>
        </Aviso>
      )}
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="sticky top-(--alto-barra-movil) z-contenido -mx-4 bg-crema px-4 pb-2 pt-2 lg:top-0">
        <Entrada
          aria-label="Buscar en su lista"
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en su lista (nombre, SKU o código)"
          className="bg-white"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip activo={!verTodo} onClick={() => setVerTodo((v) => !v)}>
            Solo lo que hay que reponer
          </Chip>
          <Chip activo={agregando} onClick={() => setAgregando((a) => !a)}>
            + Producto que no está
          </Chip>
          {elegidos.length > 0 && (
            <Chip onClick={vaciar}>Vaciar el pedido</Chip>
          )}
        </div>
      </div>

      {agregando && (
        <Tarjeta>
          <p className="text-xs text-tinta/60">
            Buscá en el catálogo completo y sumalo a la lista de {proveedor.razon_social}. Queda para siempre.
          </p>
          <Entrada
            aria-label="Buscar en el catálogo completo"
            value={buscaCatalogo} onChange={(e) => buscarEnCatalogo(e.target.value)} placeholder="Nombre o código de barras"
            className="mt-2"
          />
          {resultados.length > 0 && (
            <div className="mt-2 divide-y divide-black/[0.06]">
              {resultados.map((p: any) => (
                <button key={p.sku} type="button" onClick={() => sumarALista(p.sku)}
                  className={unir('flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-crema-claro', FOCO_ADENTRO)}>
                  <span className="min-w-0 break-words text-sm text-tinta">{p.nombre} <span className="text-xs text-tinta/60">{p.sku}</span></span>
                  <span className="shrink-0 text-sm font-semibold text-marca-hondo">agregar</span>
                </button>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {cargando && <Cargando />}
      {!cargando && meta.sinLista && (
        <Tarjeta>
          <p className="text-sm text-tinta/70">
            Este proveedor todavía no tiene productos en su lista. Agregalos con “+ Producto que no está”, o van a cargarse solos
            la próxima vez que se reciba mercadería suya.
          </p>
        </Tarjeta>
      )}
      {!cargando && !meta.sinLista && items.length === 0 && (
        <Tarjeta>
          <p className="text-sm text-tinta/60">
            {busca ? 'Nada con esa búsqueda.' : 'No hay nada bajo mínimo de este proveedor. Tocá “Ver toda la lista”.'}
          </p>
        </Tarjeta>
      )}

      {!cargando && items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['sin', 'critico', 'bajo', 'ok'] as const).map((e) => (
            <div key={e} className={unir('rounded-2xl px-3 py-2', ESTADO_STOCK[e].caja)}>
              <p className="importe text-2xl font-bold leading-none">{items.filter((it) => estadoStock(it) === e).length}</p>
              <p className="mt-1 text-xs font-medium">{ESTADO_STOCK[e].titulo}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {items.map((it) => {
          const puesto = cant[it.sku] ?? 0;
          const est = estadoStock(it);
          return (
            <div key={it.sku}
              className={`rounded-2xl border-l-[6px] bg-white p-3 shadow-tarjeta sm:p-4 ${ESTADO_STOCK[est].borde} ${puesto ? 'ring-2 ring-marca' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className={unir('flex size-16 shrink-0 flex-col items-center justify-center rounded-xl text-center', ESTADO_STOCK[est].caja)}>
                  <span className="importe text-2xl font-bold leading-none">{formatoStock(it.stock)}</span>
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">stock</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug text-tinta">{it.nombre}</p>
                  <p className={unir('text-xs font-semibold', ESTADO_STOCK[est].texto)}>
                    {textoEstado(it, est)}
                  </p>
                  {/* la otra sucursal: si allá sobra, no hace falta pedirlo */}
                  {(it.stockOtras ?? []).map((o) => (
                    <p key={o.sucursalId} className={unir('text-xs font-semibold', o.cantidad > 0 ? 'text-info' : 'text-tinta/50')}>
                      En {nombreCorto(o.sucursal)}: {formatoStock(o.cantidad)}
                    </p>
                  ))}
                  {!!it.enCamino && (
                    <p className="text-xs font-semibold text-info">
                      Ya pedido: {formatoStock(it.enCamino)} en camino{it.llega ? ` · llega ${fecha(it.llega, 'dia')}` : ' · sin fecha confirmada'}
                    </p>
                  )}
                  <p className="break-words text-xs text-tinta/60">
                    {it.porDia > 0 ? `vende ~${formatoStock(Math.round(it.porDia * 7 * 10) / 10)} por semana` : 'sin ventas en 30 días'}
                    {it.sugerido > 0 && <> · <b className="text-tinta">sugerido {it.sugerido}{it.sugeridoBultos ? ` (${it.sugeridoBultos} bulto${it.sugeridoBultos === 1 ? '' : 's'})` : ''}</b></>}
                    {it.costo != null ? ` · ${pesos(it.costo)}` : ' · sin costo'}
                    {` · ${it.sku}`}{it.codigoProveedor ? ` · cód. ${it.codigoProveedor}` : ''}
                  </p>
                  {/* de dónde sale el sugerido: la cuenta, en palabras, plegada (4/11/2026) */}
                  {it.explicacion && (
                    <button type="button" onClick={() => setExplicado(explicado === it.sku ? null : it.sku)} aria-expanded={explicado === it.sku}
                      className={unir('mr-2 mt-1.5 inline-flex min-h-9 items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-tinta/70 transition-colors hover:bg-crema-claro', FOCO)}>
                      {it.sugerido > 0 ? `¿Por qué ${it.sugerido}?` : '¿Por qué no sugiere?'}
                    </button>
                  )}
                  {/* antes de pedirlo: ¿hay de lo mismo en otra marca o en otro tamaño? (4/11/2026) */}
                  <button type="button" onClick={() => setParecidosDe(it)}
                    className={unir(
                      'mt-1.5 inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
                      est === 'sin' || est === 'critico' ? 'border-marca text-marca-hondo hover:bg-marca-suave' : 'border-black/15 text-tinta/70 hover:bg-crema-claro',
                      FOCO,
                    )}>
                    ¿Qué tengo parecido?
                  </button>
                  {explicado === it.sku && it.explicacion && (
                    <p className="mt-1.5 rounded-xl bg-crema-claro px-3 py-2 text-xs leading-relaxed text-tinta">{it.explicacion}</p>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button type="button" aria-label={`Restar uno de ${it.nombre}`} onClick={() => poner(it.sku, puesto - 1)} disabled={!puesto}
                    className={unir(PASO, 'text-tinta/70')}>−</button>
                  <input
                    aria-label={`Cantidad de ${it.nombre}`}
                    inputMode="numeric" value={puesto || ''} placeholder="0"
                    onChange={(e) => poner(it.sku, Number(e.target.value.replace(/\D/g, '')) || 0)}
                    className="importe h-11 w-14 rounded-xl border border-black/15 bg-crema-claro text-center text-base text-tinta placeholder:text-tinta/40 focus:border-marca focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15 sm:h-10"
                  />
                  <button type="button" aria-label={`Sumar uno de ${it.nombre}`} onClick={() => poner(it.sku, puesto ? puesto + 1 : Math.max(1, it.sugerido))}
                    className={unir(PASO, 'text-tinta')}>+</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lo elegido, como la nota de pedido que le va a llegar al proveedor
          (Placa roja, 2/10/2026: todo detalle de productos usa el paquete
          gráfico de los pedidos). Se repasa acá, al final de la lista, antes
          de mandarlo a aprobación con la barra de abajo. */}
      {elegidos.length > 0 && (
        <PlacaRoja
          titulo="Nota de pedido"
          sub={
            <>
              <span className="font-semibold text-white">{proveedor.razon_social}</span>
              {sucursalNombre && ` · ${sucursalNombre}`}
              <span className="block">{elegidos.length} producto{elegidos.length === 1 ? '' : 's'}</span>
            </>
          }
          renglones={elegidos.map((e) => ({
            clave: e.sku,
            cantidad: e.cantidad,
            nombre: e.nombre,
            detalle: [
              e.sku,
              e.codigoProveedor && `cód. prov. ${e.codigoProveedor}`,
              e.costo != null ? `${e.cantidad} × ${pesos(e.costo)}` : 'sin costo cargado',
            ].filter(Boolean).join(' · '),
            importe: e.costo != null ? pesos(e.costo * e.cantidad) : undefined,
          }))}
          total={{ etiqueta: 'Total', valor: pesos(totalPedido) }}
          pie={notaTotal}
        />
      )}

      {/* barra fija: lo que llevás pedido y el botón de enviar */}
      {elegidos.length > 0 && (
        <BarraInferior
          etiqueta="Pedido"
          resumen={
            <>
              <p className="truncate text-sm font-semibold text-tinta">
                {elegidos.length} producto{elegidos.length === 1 ? '' : 's'} · <span className="importe">{pesos(totalPedido)}</span>
              </p>
              <p className="min-w-0 break-words text-xs text-tinta/60">{notaTotal}</p>
            </>
          }
        >
          <Boton onClick={enviar} disabled={enviando} cargando={enviando}>
            {enviando ? 'Enviando…' : 'Enviar a aprobación'}
          </Boton>
        </BarraInferior>
      )}

      {parecidosDe && (
        <ParecidosProducto
          sku={parecidosDe.sku}
          nombre={parecidosDe.nombre}
          proveedorId={proveedor.id}
          proveedorNombre={proveedor.razon_social}
          cantidades={cant}
          onSumar={(p) => {
            // lo que se suma desde Parecidos también tiene que salir con nombre y costo en la nota de pedido
            setVistos((v) => (v[p.sku] ? v : {
              ...v,
              [p.sku]: {
                sku: p.sku, nombre: p.nombre, unidadesPack: 1, codigoProveedor: null, costo: p.costo,
                stock: p.stockTotal, minimo: 0, reposicion: 0, sugerido: 0, urgente: false, porDia: 0, diasDeStock: null,
              },
            }));
            poner(p.sku, (cant[p.sku] ?? 0) + 1);
          }}
          onCerrar={() => setParecidosDe(null)}
        />
      )}
    </div>
  );
}
