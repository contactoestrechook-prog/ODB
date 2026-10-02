'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, BarraInferior, Boton, Cargando, Chip, Entrada, FOCO, FOCO_ADENTRO, IconoFlechaAbajo, Selector, Tarjeta, unir } from './kit';
import { pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// Armar el pedido a un proveedor desde el teléfono, caminando el depósito.
//
// Dos decisiones que hacen que se use: por defecto NO se muestra la lista
// entera del proveedor (hay una de 1.400 renglones) sino lo que hace falta
// reponer; y el producto que falta en la lista se puede agregar en el momento,
// porque el momento en que uno se da cuenta es justo ese.

// los botones − y + de cada renglón: 44 px en el celular
const PASO = unir(
  'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-lg leading-none transition-colors hover:bg-crema-claro active:scale-[0.98] disabled:opacity-30 sm:size-10',
  FOCO,
);

type Item = {
  sku: string; nombre: string; unidadesPack: number; codigoProveedor: string | null;
  costo: number | null; stock: number; minimo: number; reposicion: number;
  sugerido: number; urgente: boolean; porDia: number; diasDeStock: number | null;
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
  const [meta, setMeta] = useState<{ total: number; recortado?: boolean; sinLista?: boolean }>({ total: 0 });
  const [busca, setBusca] = useState('');
  const [verTodo, setVerTodo] = useState(false);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [buscaCatalogo, setBuscaCatalogo] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [agregando, setAgregando] = useState(false);

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
      setItems(d.items ?? []);
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
      const it = items.find((i) => i.sku === sku);
      return { sku, cantidad, nombre: it?.nombre ?? sku, costo: it?.costo ?? null };
    }),
    [cant, items],
  );
  const totalPedido = elegidos.reduce((s, e) => s + (e.costo ?? 0) * e.cantidad, 0);

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
      setCant({});
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
        <Boton variante="secundario" tamano="chico" icono={<IconoFlechaAbajo className="size-4 rotate-90" />}
          onClick={() => { setProveedor(null); setItems([]); setCant({}); setBusca(''); setAviso(''); }}>
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
          {verTodo || busca ? 'Toda su lista' : 'Solo lo que hace falta reponer'} · {meta.total} producto{meta.total === 1 ? '' : 's'}
          {meta.recortado && ' (se muestran los primeros 300)'}
          <br />El sugerido cubre 14 días según lo que se vendió en los últimos 30.
        </p>
      </div>

      {aviso && <Aviso tono="ok">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="sticky top-(--alto-barra-movil) z-contenido -mx-4 bg-crema px-4 pb-2 pt-2 lg:top-0">
        <Entrada
          aria-label="Buscar en su lista"
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en su lista (nombre, SKU o código)"
          className="bg-white"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip activo={verTodo} onClick={() => setVerTodo((v) => !v)}>
            {verTodo ? 'Viendo toda la lista' : 'Ver toda la lista'}
          </Chip>
          <Chip activo={agregando} onClick={() => setAgregando((a) => !a)}>
            + Producto que no está
          </Chip>
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

      <div className="space-y-2">
        {items.map((it) => {
          const puesto = cant[it.sku] ?? 0;
          return (
            <div key={it.sku}
              className={`rounded-2xl border bg-white p-3 shadow-tarjeta sm:p-4 ${puesto ? 'border-marca ring-1 ring-marca' : 'border-black/[0.06]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <p className="break-words text-sm font-semibold leading-snug text-tinta">{it.nombre}</p>
                  <p className="break-words text-xs text-tinta/60">
                    {it.sku}{it.codigoProveedor ? ` · cód. prov. ${it.codigoProveedor}` : ''}
                    {it.costo != null ? ` · ${pesos(it.costo)}` : ' · sin costo cargado'}
                  </p>
                  <p className={`text-xs ${it.urgente ? 'font-semibold text-marca-hondo' : 'text-tinta/60'}`}>
                    stock {it.stock}
                    {it.diasDeStock != null && ` · aguanta ${it.diasDeStock} día${it.diasDeStock === 1 ? '' : 's'}`}
                    {it.minimo > 0 && ` · mínimo ${it.minimo}`}
                    {it.sugerido > 0 && ` · sugerido ${it.sugerido}`}
                  </p>
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

      {/* barra fija: lo que llevás pedido y el botón de enviar */}
      {elegidos.length > 0 && (
        <BarraInferior
          etiqueta="Pedido"
          resumen={
            <>
              <p className="truncate text-sm font-semibold text-tinta">
                {elegidos.length} producto{elegidos.length === 1 ? '' : 's'} · <span className="importe">{pesos(totalPedido)}</span>
              </p>
              <p className="min-w-0 break-words text-xs text-tinta/60">
                {totalPedido === 0 ? 'sin costos cargados: el total lo confirma la factura' : 'estimado con el último costo conocido'}
              </p>
            </>
          }
        >
          <Boton onClick={enviar} disabled={enviando} cargando={enviando}>
            {enviando ? 'Enviando…' : 'Enviar a aprobación'}
          </Boton>
        </BarraInferior>
      )}
    </div>
  );
}
