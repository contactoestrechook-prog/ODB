'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// Armar el pedido a un proveedor desde el teléfono, caminando el depósito.
//
// Dos decisiones que hacen que se use: por defecto NO se muestra la lista
// entera del proveedor (hay una de 1.400 renglones) sino lo que hace falta
// reponer; y el producto que falta en la lista se puede agregar en el momento,
// porque el momento en que uno se da cuenta es justo ese.
const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

type Item = {
  sku: string; nombre: string; unidadesPack: number; codigoProveedor: string | null;
  costo: number | null; stock: number; minimo: number; reposicion: number;
  sugerido: number; urgente: boolean;
};

export function PedidoProveedor({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [proveedor, setProveedor] = useState<any | null>(null);
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
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
      .then((d) => setProveedores(Array.isArray(d) ? d : []))
      .catch(() => setError('No pude traer los proveedores'));
  }, []);

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
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold text-black">Pedido a proveedor</h1>
          <p className="text-xs text-black/50">Elegí a quién le vas a pedir. Después armás el pedido con su lista de productos.</p>
        </div>
        {error && <p className="rounded-xl bg-white p-4 text-sm text-[#B82D25]">{error}</p>}
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar proveedor"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base outline-none focus:border-black/30"
        />
        <div className="divide-y divide-black/5 overflow-hidden rounded-2xl bg-white shadow-sm">
          {proveedores
            .filter((p) => p.razon_social.toLowerCase().includes(busca.toLowerCase()))
            .map((p) => (
              <button key={p.id} onClick={() => { setProveedor(p); setBusca(''); setVerTodo(false); }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-black/5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-black">{p.razon_social}</span>
                  <span className="text-[11px] text-black/45">
                    {p.productos > 0 ? `${p.productos} producto${p.productos === 1 ? '' : 's'} en su lista` : 'sin lista cargada todavía'}
                  </span>
                </span>
                <span className="shrink-0 text-black/25">›</span>
              </button>
            ))}
          {proveedores.length === 0 && <p className="px-4 py-6 text-sm text-black/40">Cargando proveedores…</p>}
        </div>
      </div>
    );
  }

  // ---- paso 2: armar el pedido ----
  return (
    <div className="mx-auto max-w-2xl p-4 pb-32">
      <div className="flex items-center gap-2">
        <button onClick={() => { setProveedor(null); setItems([]); setCant({}); setBusca(''); setAviso(''); }}
          className="rounded-full border border-black/15 px-3 py-1.5 text-xs text-black/60">‹ Proveedores</button>
        {sucursales.length > 1 && (
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
            className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs text-black/70">
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
      </div>

      <h1 className="mt-3 text-lg font-semibold text-black">{proveedor.razon_social}</h1>
      <p className="text-[11px] text-black/45">
        {verTodo || busca ? 'Toda su lista' : 'Solo lo que hace falta reponer'} · {meta.total} producto{meta.total === 1 ? '' : 's'}
        {meta.recortado && ' (se muestran los primeros 300)'}
      </p>

      {aviso && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>}
      {error && <p className="mt-3 rounded-xl bg-white p-4 text-sm text-[#B82D25]">{error}</p>}

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-[#F0EBE2] px-4 pb-2 pt-1">
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en su lista (nombre, SKU o código)"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base outline-none focus:border-black/30"
        />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => setVerTodo((v) => !v)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${verTodo ? 'bg-black text-white' : 'bg-white text-black/60'}`}>
            {verTodo ? 'Viendo toda la lista' : 'Ver toda la lista'}
          </button>
          <button onClick={() => setAgregando((a) => !a)}
            className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black/60">
            + Producto que no está
          </button>
        </div>
      </div>

      {agregando && (
        <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm">
          <p className="text-[11px] text-black/50">
            Buscá en el catálogo completo y sumalo a la lista de {proveedor.razon_social}. Queda para siempre.
          </p>
          <input
            value={buscaCatalogo} onChange={(e) => buscarEnCatalogo(e.target.value)} placeholder="Nombre o código de barras"
            className="mt-2 w-full rounded-xl border border-black/10 px-3 py-2.5 text-base outline-none focus:border-black/30"
          />
          {resultados.map((p: any) => (
            <button key={p.sku} onClick={() => sumarALista(p.sku)}
              className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-black/5">
              <span className="min-w-0 truncate text-sm text-black">{p.nombre} <span className="text-xs text-black/35">{p.sku}</span></span>
              <span className="shrink-0 text-xs font-medium text-[#B82D25]">agregar</span>
            </button>
          ))}
        </div>
      )}

      {cargando && <p className="mt-4 text-sm text-black/40">Cargando…</p>}
      {!cargando && meta.sinLista && (
        <div className="mt-4 rounded-2xl bg-white p-5 text-sm text-black/60 shadow-sm">
          Este proveedor todavía no tiene productos en su lista. Agregalos con “+ Producto que no está”, o van a cargarse solos
          la próxima vez que se reciba mercadería suya.
        </div>
      )}
      {!cargando && !meta.sinLista && items.length === 0 && (
        <p className="mt-4 rounded-2xl bg-white p-5 text-sm text-black/50 shadow-sm">
          {busca ? 'Nada con esa búsqueda.' : 'No hay nada bajo mínimo de este proveedor. Tocá “Ver toda la lista”.'}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {items.map((it) => {
          const puesto = cant[it.sku] ?? 0;
          return (
            <div key={it.sku} className={`rounded-2xl bg-white p-3 shadow-sm ${puesto ? 'ring-2 ring-black' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug text-black">{it.nombre}</p>
                  <p className="text-[11px] text-black/45">
                    {it.sku}{it.codigoProveedor ? ` · cód. prov. ${it.codigoProveedor}` : ''}
                    {it.costo != null ? ` · ${pesos(it.costo)}` : ' · sin costo cargado'}
                  </p>
                  <p className={`text-[11px] ${it.urgente ? 'font-medium text-[#B82D25]' : 'text-black/45'}`}>
                    stock {it.stock}{it.minimo > 0 ? ` · mínimo ${it.minimo}` : ''}
                    {it.sugerido > 0 && ` · sugerido ${it.sugerido}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => poner(it.sku, puesto - 1)} disabled={!puesto}
                    className="h-9 w-9 rounded-full border border-black/15 text-lg leading-none text-black/60 disabled:opacity-30">−</button>
                  <input
                    inputMode="numeric" value={puesto || ''} placeholder="0"
                    onChange={(e) => poner(it.sku, Number(e.target.value.replace(/\D/g, '')) || 0)}
                    className="h-9 w-12 rounded-lg border border-black/15 text-center text-base tabular-nums outline-none focus:border-black"
                  />
                  <button onClick={() => poner(it.sku, puesto ? puesto + 1 : Math.max(1, it.sugerido))}
                    className="h-9 w-9 rounded-full bg-black text-lg leading-none text-white">+</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* barra fija: lo que llevás pedido y el botón de enviar */}
      {elegidos.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white px-4 py-3 lg:pl-64">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-black">
                {elegidos.length} producto{elegidos.length === 1 ? '' : 's'} · {pesos(totalPedido)}
              </p>
              <p className="truncate text-[11px] text-black/45">
                {totalPedido === 0 ? 'sin costos cargados: el total lo confirma la factura' : 'estimado con el último costo conocido'}
              </p>
            </div>
            <button onClick={enviar} disabled={enviando}
              className="shrink-0 rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {enviando ? 'Enviando…' : 'Enviar a aprobación'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
