'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, BarraInferior, Boton, Cargando, Entrada, FOCO, FOCO_ADENTRO, IconoFlechaAbajo, Modal, PlacaRoja, Selector, Tarjeta, unir } from './kit';
import { filtrarPorBusqueda } from '../lib/busqueda';
import { CamaraCodigo } from './CamaraCodigo';

// La nota de pedido sin proveedor (Leandro, 10/11/2026): «una nota de pedido
// sin proveedor asignado y que después le podamos asignar el proveedor o
// simplemente exportarla así». Se arma con cualquier producto del catálogo
// (nombre o código de barras), se guarda sola, y después:
//  · se le asigna el proveedor a todo o a lo tildado: eso es una orden de
//    compra de siempre, que espera la aprobación del dueño (Don Satur está en
//    la lista de Clan, pero a veces se le compra a Distri Sur);
//  · o se exporta tal cual: Excel, copiar para WhatsApp o imprimir.

type Renglon = { sku: string; nombre: string; cantidad: number; proveedorId?: string; proveedor?: string; ordenCompraId?: string; ordenNumero?: number };
type Nota = {
  id: string | null; numero: number | null; titulo: string; sucursalId: string; sucursal?: string | null;
  renglones: Renglon[]; estado: 'abierta' | 'cerrada' | 'anulada';
  creadaPor?: string | null; actualizadaEn?: string | null; actualizadaPor?: string | null;
};
type EstadoGuardado = '' | 'guardando' | 'guardado' | 'error';
type Producto = {
  sku: string; nombre: string; costo: number | null; stock: number; minimo: number; porDia: number;
  diasDeStock: number | null; sugerido: number; urgente: boolean; proveedores: string | null;
};
const fmt = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });
// el mismo semáforo del pedido a proveedor: sin stock en rojo, arriba
function tonoStock(p: Producto) {
  if (p.stock <= 0) return { caja: 'bg-marca text-white', borde: 'border-marca', texto: 'text-marca-hondo', dice: 'Sin stock' };
  if (p.urgente) return { caja: 'bg-marca-suave text-marca-hondo', borde: 'border-marca/60', texto: 'text-marca-hondo', dice: 'Se termina' };
  if (p.sugerido > 0) return { caja: 'bg-atencion-suave text-atencion', borde: 'border-atencion', texto: 'text-atencion', dice: 'Poco' };
  return { caja: 'bg-ok-suave text-ok', borde: 'border-ok/50', texto: 'text-ok', dice: 'Bien' };
}

const PASO = unir(
  'grid size-11 shrink-0 place-items-center rounded-full border border-black/15 bg-white text-lg leading-none transition-colors hover:bg-crema-claro active:scale-[0.98] disabled:opacity-30 sm:size-10',
  FOCO,
);
const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const asignado = (r: Renglon) => !!r.ordenCompraId;
const nombreNota = (n: Nota) => `Nota de pedido${n.numero ? ` N.º ${n.numero}` : ''}${n.titulo ? ` · ${n.titulo}` : ''}`;
const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const escHtml = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function NotaSinProveedor({ sucursales, proveedores, sucursalInicial, onVolver }: {
  sucursales: { id: string; nombre: string }[];
  proveedores: { id: string; razon_social: string }[];
  sucursalInicial: string;
  onVolver: () => void;
}) {
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const [guardado, setGuardado] = useState<EstadoGuardado>('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busca, setBusca] = useState('');
  // lo que falta en la sucursal (sin buscar) o lo que se buscó, con stock y sugerido
  const [lista, setLista] = useState<Producto[]>([]);
  const [totalLista, setTotalLista] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [camara, setCamara] = useState(false);
  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [eligiendo, setEligiendo] = useState(false);
  const [buscaProv, setBuscaProv] = useState('');
  const [asignando, setAsignando] = useState<string | null>(null);

  // ---- el guardado solo: una llamada a la vez, la última versión siempre gana ----
  const ultimo = useRef(''); // lo último guardado tal cual
  const enCurso = useRef<Promise<void>>(Promise.resolve());
  const notaRef = useRef<Nota | null>(null);
  notaRef.current = nota;
  // el id de la nota recién creada, al instante: el guardado que sigue en la
  // fila no puede esperar al redibujo o crearía otra nota
  const idRef = useRef<string | null>(null);

  const cargarNotas = useCallback(async () => {
    try {
      const r = await fetch('/api/compras?recurso=notas-pedido', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message ?? String(r.status));
      setNotas(Array.isArray(d) ? d : []);
    } catch (e) {
      setNotas([]);
      setError(`No pude traer las notas de pedido: ${e instanceof Error ? e.message : e}`);
    }
  }, []);
  useEffect(() => { void cargarNotas(); }, [cargarNotas]);

  const guardar = useCallback(() => {
    enCurso.current = enCurso.current.then(async () => {
      const n = notaRef.current;
      if (!n || n.estado !== 'abierta') return;
      const id = n.id ?? idRef.current;
      const pendientes = n.renglones.filter((r) => !asignado(r));
      const cuerpo = JSON.stringify({ titulo: n.titulo, sucursalId: n.sucursalId, renglones: pendientes });
      if (cuerpo === ultimo.current) return;
      // una nota nueva sin nada todavía no se crea (no quedan notas vacías)
      if (!id && !pendientes.length && !n.titulo.trim()) return;
      setGuardado('guardando');
      try {
        const r = await fetch('/api/compras', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'guardarNotaPedido', id, titulo: n.titulo, sucursalId: n.sucursalId, renglones: pendientes }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message ?? String(r.status));
        ultimo.current = cuerpo;
        idRef.current = d.id;
        // lo que se tecleó mientras viajaba no se pisa: del sistema solo el id, el número y quién
        setNota((actual) => (actual && (actual.id === d.id || !actual.id)
          ? { ...actual, id: d.id, numero: d.numero, sucursal: d.sucursal, actualizadaEn: d.actualizadaEn, actualizadaPor: d.actualizadaPor }
          : actual));
        setGuardado('guardado');
      } catch (e) {
        setGuardado('error');
        setError(`No se pudo guardar la nota: ${e instanceof Error ? e.message : e}`);
      }
    });
    return enCurso.current;
  }, []);

  // medio segundo después del último cambio
  useEffect(() => {
    if (!nota || nota.estado !== 'abierta') return;
    const t = setTimeout(() => { void guardar(); }, 500);
    return () => clearTimeout(t);
  }, [nota, guardar]);

  const abrir = (n: Nota) => {
    ultimo.current = JSON.stringify({ titulo: n.titulo ?? '', sucursalId: n.sucursalId, renglones: n.renglones.filter((r) => !asignado(r)) });
    idRef.current = n.id;
    notaRef.current = { ...n, titulo: n.titulo ?? '' };
    setNota(notaRef.current);
    setTildados(new Set()); setAviso(''); setError(''); setGuardado(''); setBusca('');
  };
  const nueva = () => abrir({ id: null, numero: null, titulo: '', sucursalId: sucursalInicial || sucursales[0]?.id || '', renglones: [], estado: 'abierta' });
  const volverALista = async () => {
    await guardar();
    setNota(null);
    void cargarNotas();
  };

  // ---- productos ----
  const cambiar = (cambio: (rs: Renglon[]) => Renglon[]) =>
    setNota((n) => (n ? { ...n, renglones: cambio(n.renglones) } : n));
  const poner = (sku: string, valor: number) =>
    cambiar((rs) => {
      const v = Math.max(0, Math.round(valor));
      return v === 0 ? rs.filter((r) => asignado(r) || r.sku !== sku) : rs.map((r) => (!asignado(r) && r.sku === sku ? { ...r, cantidad: v } : r));
    });
  const cantidadDe = (sku: string) => nota?.renglones.find((r) => !asignado(r) && r.sku === sku)?.cantidad ?? 0;
  // poner una cantidad desde la lista: si no estaba en la nota, entra
  const ponerDesdeLista = (p: { sku: string; nombre: string }, valor: number) =>
    cambiar((rs) => {
      const v = Math.max(0, Math.round(valor));
      const ya = rs.some((r) => !asignado(r) && r.sku === p.sku);
      if (!ya) return v > 0 ? [...rs, { sku: p.sku, nombre: p.nombre, cantidad: v }] : rs;
      return v === 0 ? rs.filter((r) => asignado(r) || r.sku !== p.sku) : rs.map((r) => (!asignado(r) && r.sku === p.sku ? { ...r, cantidad: v } : r));
    });
  const sumar = (p: Producto) => {
    ponerDesdeLista(p, cantidadDe(p.sku) ? cantidadDe(p.sku) + 1 : Math.max(1, p.sugerido));
    setAviso(`En la nota: ${p.nombre}`);
  };

  const sucursalLista = nota?.sucursalId ?? '';
  const abiertaLista = nota?.estado === 'abierta';
  const traer = useCallback(async (q: string, suc: string): Promise<Producto[]> => {
    if (!suc) return [];
    setBuscando(true);
    try {
      const p = new URLSearchParams({ recurso: 'faltantes-nota', sucursalId: suc, q: q.trim() });
      const r = await fetch(`/api/compras?${p.toString()}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude traer los productos'); return []; }
      setLista(d.items ?? []);
      setTotalLista(d.total ?? 0);
      return d.items ?? [];
    } catch {
      setError('No hay conexión para traer los productos.');
      return [];
    } finally {
      setBuscando(false);
    }
  }, []);
  // sin buscar: lo que falta; buscando (2 letras o más): todo el catálogo
  useEffect(() => {
    if (!abiertaLista || !sucursalLista) return;
    const q = busca.trim().length >= 2 ? busca : '';
    const t = setTimeout(() => { void traer(q, sucursalLista); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [busca, sucursalLista, abiertaLista, traer]);

  // el lector de mano escribe el código y aprieta Enter: si hay uno solo, entra directo
  const alEnter = async () => {
    if (busca.trim().length < 2 || !nota) return;
    const l = await traer(busca, nota.sucursalId);
    if (l.length === 1) { sumar(l[0]); setBusca(''); }
    else if (!l.length) setError(`No encontré «${busca.trim()}» en el catálogo.`);
  };
  const porCodigo = async (codigo: string) => {
    setCamara(false);
    if (!nota) return;
    setBusca(codigo);
    const l = await traer(codigo, nota.sucursalId);
    if (l.length === 1) { sumar(l[0]); setBusca(''); }
    else if (!l.length) setError(`El código ${codigo} no está en el catálogo.`);
  };

  // ---- asignar proveedor ----
  const sinProveedor = useMemo(() => (nota?.renglones ?? []).filter((r) => !asignado(r)), [nota]);
  const yaAsignados = useMemo(() => (nota?.renglones ?? []).filter(asignado), [nota]);
  const van = tildados.size ? sinProveedor.filter((r) => tildados.has(r.sku)) : sinProveedor;
  const tildar = (sku: string) => setTildados((t) => {
    const copia = new Set(t);
    if (copia.has(sku)) copia.delete(sku); else copia.add(sku);
    return copia;
  });

  const asignar = async (prov: { id: string; razon_social: string }) => {
    if (!nota || asignando) return;
    setAsignando(prov.id);
    setError('');
    try {
      await guardar(); // lo último tecleado tiene que estar en el sistema antes de armar la orden
      const id = notaRef.current?.id ?? idRef.current;
      if (!id) { setError('La nota todavía no se guardó: probá de nuevo en un segundo.'); return; }
      const r = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'asignarProveedorNota', id, proveedorId: prov.id, skus: van.map((x) => x.sku) }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No se pudo asignar el proveedor'); return; }
      const n: Nota = { ...d.nota, titulo: d.nota.titulo ?? '' };
      ultimo.current = JSON.stringify({ titulo: n.titulo, sucursalId: n.sucursalId, renglones: n.renglones.filter((x) => !asignado(x)) });
      setNota(n);
      setTildados(new Set());
      setEligiendo(false); setBuscaProv('');
      setAviso(`Orden${d.ordenNumero ? ` N.º ${d.ordenNumero}` : ''} a ${d.proveedor}: ${d.renglones} producto${d.renglones === 1 ? '' : 's'}. Espera la aprobación del dueño en Aprobaciones.${n.estado === 'cerrada' ? ' La nota quedó completa.' : ''}`);
    } finally {
      setAsignando(null);
    }
  };

  const borrar = async () => {
    if (!nota) return;
    if (!nota.id) { setNota(null); return; }
    const quedan = yaAsignados.length ? ` Las ${yaAsignados.length > 1 ? 'órdenes ya creadas siguen' : 'orden ya creada sigue'} su camino.` : '';
    if (!window.confirm(`¿Borrar la ${nombreNota(nota)}?${quedan}`)) return;
    const r = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'anularNotaPedido', id: nota.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d?.message ?? 'No se pudo borrar la nota'); return; }
    setNota(null);
    void cargarNotas();
  };

  // ---- exportar tal cual ----
  const sucursalNombre = sucursales.find((s) => s.id === nota?.sucursalId)?.nombre ?? nota?.sucursal ?? '';
  const archivo = () => `nota-de-pedido${nota?.numero ? `-${nota.numero}` : ''}`;
  const exportarExcel = () => {
    if (!nota) return;
    const lineas = [
      ['Cantidad', 'Producto', 'SKU', 'Proveedor', 'Orden'].map(esc).join(';'),
      ...nota.renglones.map((r) => [r.cantidad, r.nombre, r.sku, r.proveedor ?? '', r.ordenNumero ?? ''].map(esc).join(';')),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `${archivo()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setAviso('Excel descargado.');
  };
  const texto = () => nota
    ? [`*${nombreNota(nota)}*`, sucursalNombre, '', ...nota.renglones.map((r) => `${r.cantidad} × ${r.nombre}`)].filter((l, i) => i !== 1 || l).join('\n')
    : '';
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto());
      setAviso('Copiada: pegala en WhatsApp o en un mail.');
    } catch {
      setError('Este navegador no dejó copiar. Usá Excel o Imprimir.');
    }
  };
  const imprimir = () => {
    if (!nota) return;
    const w = window.open('', '_blank');
    if (!w) { setError('El navegador bloqueó la ventana para imprimir.'); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escHtml(nombreNota(nota))}</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#1a1a1a}h1{font-size:20px;margin:0}p{margin:4px 0 16px;color:#555}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left;font-size:14px}td.c{text-align:right;font-weight:700;width:70px}</style></head>
<body><h1>${escHtml(nombreNota(nota))}</h1><p>${escHtml(sucursalNombre)} · ${new Date().toLocaleDateString('es-AR')}</p>
<table><thead><tr><th style="text-align:right">Cant.</th><th>Producto</th><th>SKU</th></tr></thead><tbody>
${nota.renglones.map((r) => `<tr><td class="c">${r.cantidad}</td><td>${escHtml(r.nombre)}</td><td>${escHtml(r.sku)}</td></tr>`).join('')}
</tbody></table><script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  };

  // ---------- la lista de notas ----------
  if (!nota) {
    const abiertas = (notas ?? []).filter((n) => n.estado === 'abierta');
    const cerradas = (notas ?? []).filter((n) => n.estado === 'cerrada');
    return (
      <div className="space-y-4">
        <Boton variante="secundario" tamano="chico" icono={<IconoFlechaAbajo className="size-4 rotate-90" />} onClick={onVolver}>
          Proveedores
        </Boton>
        <div>
          <h2 className="text-lg font-semibold text-tinta">Notas de pedido sin proveedor</h2>
          <p className="text-sm text-tinta/60">
            Armá el pedido con lo que hace falta y elegí el proveedor después, renglón por renglón. O exportala tal cual.
          </p>
        </div>
        {error && <Aviso tono="error">{error}</Aviso>}
        <Boton onClick={nueva} anchoCompleto>Nueva nota de pedido</Boton>
        {notas === null && <Cargando texto="Cargando notas…" bloque />}
        {[{ titulo: 'Abiertas', lista: abiertas }, { titulo: 'Completas (todo con proveedor)', lista: cerradas }].map((g) => g.lista.length > 0 && (
          <div key={g.titulo} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-tinta/60">{g.titulo}</h3>
            <Tarjeta relleno={false} className="overflow-hidden">
              <div className="divide-y divide-black/[0.06]">
                {g.lista.map((n) => {
                  const falta = n.renglones.filter((r) => !asignado(r)).length;
                  return (
                    <button key={n.id} type="button" onClick={() => abrir(n)}
                      className={unir('flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-crema-claro active:bg-crema-claro', FOCO_ADENTRO)}>
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold text-tinta">{nombreNota(n)}</span>
                        <span className="text-xs text-tinta/60">
                          {n.renglones.length} producto{n.renglones.length === 1 ? '' : 's'}
                          {falta > 0 ? ` · ${falta} sin proveedor` : ''}
                          {n.sucursal ? ` · ${n.sucursal}` : ''}
                          {n.actualizadaEn ? ` · ${hora(n.actualizadaEn)}` : ''}{n.actualizadaPor ? ` · ${n.actualizadaPor}` : ''}
                        </span>
                      </span>
                      <IconoFlechaAbajo className="size-5 shrink-0 -rotate-90 text-tinta/40" />
                    </button>
                  );
                })}
              </div>
            </Tarjeta>
          </div>
        ))}
        {notas !== null && !abiertas.length && !cerradas.length && (
          <p className="text-sm text-tinta/60">Todavía no hay notas de pedido.</p>
        )}
      </div>
    );
  }

  // ---------- la nota ----------
  const abierta = nota.estado === 'abierta';
  const provFiltrados = filtrarPorBusqueda(proveedores, buscaProv, (p) => p.razon_social);
  return (
    <div className="space-y-3 pb-28">
      <div className="flex flex-wrap items-center gap-2">
        <Boton variante="secundario" tamano="chico" icono={<IconoFlechaAbajo className="size-4 rotate-90" />} onClick={volverALista}>
          Notas de pedido
        </Boton>
        {abierta && sucursales.length > 1 && !yaAsignados.length && (
          <Selector aria-label="Sucursal" value={nota.sucursalId} onChange={(e) => setNota({ ...nota, sucursalId: e.target.value })}
            className="min-w-0 flex-1 sm:max-w-xs" opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} />
        )}
      </div>

      <div>
        <h2 className="break-words text-lg font-semibold text-tinta">{nota.numero ? `Nota de pedido N.º ${nota.numero}` : 'Nota de pedido nueva'}</h2>
        <p className="text-xs text-tinta/60">
          {sucursalNombre}{!abierta ? ' · completa: todo tiene proveedor' : ''}
        </p>
        {guardado === 'guardando' && <p className="mt-1 text-xs text-tinta/60">Guardando…</p>}
        {guardado === 'guardado' && (
          <p className="mt-1 text-xs text-ok">Guardada{nota.actualizadaEn ? ` · ${hora(nota.actualizadaEn)}` : ''}. Podés salir y seguirla después.</p>
        )}
      </div>

      {error && <Aviso tono="error">{error}{guardado === 'error' && <button type="button" onClick={() => { setError(''); void guardar(); }} className="ml-2 font-semibold underline">Reintentar</button>}</Aviso>}
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}

      {abierta && (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-tinta/70">Nombre de la nota (opcional)</span>
            <Entrada aria-label="Nombre de la nota" value={nota.titulo} maxLength={120}
              onChange={(e) => setNota({ ...nota, titulo: e.target.value })} className="mt-1" />
          </label>

          <div className="sticky top-(--alto-barra-movil) z-contenido -mx-4 bg-crema px-4 pb-2 pt-2 lg:top-0">
            <div className="flex gap-2">
              <Entrada
                aria-label="Buscar producto por nombre, SKU o código de barras"
                value={busca} placeholder="Buscar producto (nombre, SKU o código)"
                onChange={(e) => { setBusca(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void alEnter(); } }}
                className="min-w-0 flex-1 bg-white"
              />
              <Boton variante="secundario" onClick={() => setCamara(true)} aria-label="Leer el código con la cámara">Cámara</Boton>
            </div>
            <p className="mt-1 text-xs text-tinta/60">
              {busca.trim().length >= 2
                ? (buscando ? 'Buscando en todo el catálogo…' : `${lista.length} producto${lista.length === 1 ? '' : 's'} con esa búsqueda`)
                : (buscando ? 'Buscando lo que falta…' : `Lo que falta en ${sucursalNombre || 'la sucursal'}: ${totalLista} producto${totalLista === 1 ? '' : 's'}, los sin stock arriba${totalLista > lista.length ? ` (se muestran ${lista.length})` : ''}. El sugerido cubre 14 días de venta.`)}
            </p>
          </div>

          <div className="space-y-2">
            {lista.map((p) => {
              const puesto = cantidadDe(p.sku);
              const t = tonoStock(p);
              return (
                <div key={p.sku} className={unir('rounded-2xl border-l-[6px] bg-white p-3 shadow-tarjeta sm:p-4', t.borde, puesto ? 'ring-2 ring-marca' : '')}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className={unir('flex size-16 shrink-0 flex-col items-center justify-center rounded-xl text-center', t.caja)}>
                      <span className="importe text-2xl font-bold leading-none">{fmt(p.stock)}</span>
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">stock</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-snug text-tinta">{p.nombre}</p>
                      <p className={unir('text-xs font-semibold', t.texto)}>
                        {t.dice}{p.diasDeStock != null && p.stock > 0 ? `: alcanza para ${p.diasDeStock} día${p.diasDeStock === 1 ? '' : 's'}` : ''}
                      </p>
                      <p className="break-words text-xs text-tinta/60">
                        {p.porDia > 0 ? `vende ~${fmt(Math.round(p.porDia * 7 * 10) / 10)} por semana` : 'sin ventas en 30 días'}
                        {p.sugerido > 0 && <> · <b className="text-tinta">sugerido {p.sugerido}</b></>}
                        {` · ${p.sku}`}
                      </p>
                      {p.proveedores && <p className="break-words text-xs text-tinta/60">Lo vende: {p.proveedores}</p>}
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <button type="button" aria-label={`Restar uno de ${p.nombre}`} onClick={() => ponerDesdeLista(p, puesto - 1)} disabled={!puesto} className={unir(PASO, 'text-tinta/70')}>−</button>
                      <input aria-label={`Cantidad de ${p.nombre}`} inputMode="numeric" value={puesto || ''} placeholder="0"
                        onChange={(e) => ponerDesdeLista(p, Number(e.target.value.replace(/\D/g, '')) || 0)}
                        className="importe h-11 w-14 rounded-xl border border-black/15 bg-crema-claro text-center text-base text-tinta placeholder:text-tinta/40 focus:border-marca focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15 sm:h-10" />
                      <button type="button" aria-label={`Sumar ${p.nombre}`} onClick={() => sumar(p)} className={unir(PASO, 'text-tinta')}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!buscando && !lista.length && (
              <Tarjeta><p className="text-sm text-tinta/60">{busca.trim().length >= 2 ? 'Nada con esa búsqueda.' : 'No falta nada en esta sucursal.'}</p></Tarjeta>
            )}
          </div>
        </>
      )}

      {camara && <CamaraCodigo onCodigo={porCodigo} onCerrar={() => setCamara(false)} />}

      {nota.renglones.length === 0 ? (
        !abierta && <Tarjeta><p className="text-sm text-tinta/60">La nota está vacía.</p></Tarjeta>
      ) : (
        <div id="nota-armada" className="scroll-mt-24">
        <PlacaRoja
          titulo="Nota de pedido"
          sub={<>{nota.numero ? `N.º ${nota.numero}` : 'nueva'}{sucursalNombre ? ` · ${sucursalNombre}` : ''}<span className="block">{sinProveedor.length} sin proveedor{yaAsignados.length ? ` · ${yaAsignados.length} ya en orden` : ''}</span></>}
          renglones={[...sinProveedor, ...yaAsignados].map((r) => ({
            clave: `${r.sku}:${r.ordenCompraId ?? ''}`,
            cantidad: r.cantidad,
            nombre: r.nombre,
            detalle: r.sku,
            destacado: asignado(r) ? `${r.proveedor} · orden${r.ordenNumero ? ` N.º ${r.ordenNumero}` : ''}` : undefined,
            acciones: !asignado(r) && abierta ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <label className={unir('mr-1 inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold', tildados.has(r.sku) ? 'border-marca bg-marca-suave text-marca-hondo' : 'border-black/15 text-tinta/70')}>
                  <input type="checkbox" checked={tildados.has(r.sku)} onChange={() => tildar(r.sku)} className="size-4 accent-marca" />
                  elegir
                </label>
                <button type="button" aria-label={`Restar uno de ${r.nombre}`} onClick={() => poner(r.sku, r.cantidad - 1)} className={unir(PASO, 'text-tinta/70')}>−</button>
                <input aria-label={`Cantidad de ${r.nombre}`} inputMode="numeric" value={r.cantidad || ''}
                  onChange={(e) => poner(r.sku, Number(e.target.value.replace(/\D/g, '')) || 0)}
                  className="importe h-11 w-14 rounded-xl border border-black/15 bg-crema-claro text-center text-base text-tinta focus:border-marca focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15 sm:h-10" />
                <button type="button" aria-label={`Sumar uno de ${r.nombre}`} onClick={() => poner(r.sku, r.cantidad + 1)} className={unir(PASO, 'text-tinta')}>+</button>
              </div>
            ) : undefined,
          }))}
          pie={abierta && sinProveedor.length ? 'Tildá «elegir» para mandar solo esos a un proveedor; sin tildar, va todo lo que falta.' : undefined}
        />
        </div>
      )}

      {nota.renglones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" tamano="chico" onClick={exportarExcel}>Descargar Excel</Boton>
          <Boton variante="secundario" tamano="chico" onClick={copiar}>Copiar para WhatsApp</Boton>
          <Boton variante="secundario" tamano="chico" onClick={imprimir}>Imprimir</Boton>
          {abierta && <Boton variante="fantasma" tamano="chico" onClick={borrar}>Borrar la nota</Boton>}
        </div>
      )}
      {nota.renglones.length === 0 && abierta && nota.id && (
        <Boton variante="fantasma" tamano="chico" onClick={borrar}>Borrar la nota</Boton>
      )}

      {abierta && sinProveedor.length > 0 && (
        <BarraInferior
          etiqueta="Nota"
          resumen={
            <p className="text-sm font-semibold text-tinta">
              {sinProveedor.length} producto{sinProveedor.length === 1 ? '' : 's'} en la nota{tildados.size ? ` · ${van.length} elegido${van.length === 1 ? '' : 's'}` : ''}
            </p>
          }
        >
          <Boton variante="secundario" onClick={() => document.getElementById('nota-armada')?.scrollIntoView({ behavior: 'smooth' })}>
            Ver la nota
          </Boton>
          <Boton onClick={() => { setEligiendo(true); setError(''); }}>
            {tildados.size ? 'Asignar proveedor a lo elegido' : 'Asignar proveedor'}
          </Boton>
        </BarraInferior>
      )}

      <Modal abierto={eligiendo} onCerrar={() => { if (!asignando) { setEligiendo(false); setBuscaProv(''); } }}
        titulo="¿A qué proveedor se lo pedimos?"
        descripcion={`${van.length} producto${van.length === 1 ? '' : 's'} pasan a una orden de compra para ese proveedor, que espera la aprobación del dueño.`}>
        <Entrada aria-label="Buscar proveedor" value={buscaProv} onChange={(e) => setBuscaProv(e.target.value)} placeholder="Buscar proveedor" autoFocus />
        <div className="mt-2 max-h-[50vh] divide-y divide-black/[0.06] overflow-y-auto">
          {provFiltrados.slice(0, 60).map((p) => (
            <button key={p.id} type="button" disabled={!!asignando} onClick={() => asignar(p)}
              className={unir('flex min-h-12 w-full items-center justify-between gap-2 px-2 py-2 text-left transition-colors hover:bg-crema-claro disabled:opacity-50', FOCO_ADENTRO)}>
              <span className="min-w-0 break-words text-sm font-semibold text-tinta">{p.razon_social}</span>
              <span className="shrink-0 text-xs font-semibold text-marca-hondo">{asignando === p.id ? 'Creando la orden…' : 'Asignar'}</span>
            </button>
          ))}
          {!provFiltrados.length && <p className="py-3 text-sm text-tinta/60">Ningún proveedor con ese nombre.</p>}
        </div>
      </Modal>
    </div>
  );
}
