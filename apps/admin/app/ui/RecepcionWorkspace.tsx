'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

// Recepción con pistola: llega el camión, el depósito escanea lo que baja y el
// remito digital nace con lo REALMENTE ingresado. Mueve stock al confirmar y
// queda en la bandeja de Administración esperando la factura para el cruce.
export function RecepcionWorkspace({ proveedores, sucursales }: { proveedores: any[]; sucursales: any[] }) {
  const [proveedorId, setProveedorId] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursales.length === 1 ? sucursales[0].id : '');
  const [numeroRemito, setNumeroRemito] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<any[]>([]);
  // código escaneado que el sistema todavía no conoce: se vincula acá mismo
  const [huerfano, setHuerfano] = useState<string | null>(null);
  const [buscaH, setBuscaH] = useState('');
  const [sugH, setSugH] = useState<any[]>([]);
  const [vinculando, setVinculando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [listo, setListo] = useState<any>(null);
  const bufferRef = useRef('');
  const timerRef = useRef<any>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const agregarSku = useCallback((sku: string, nombre: string) => {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.sku === sku);
      if (i >= 0) return xs.map((x, j) => (j === i ? { ...x, cantidad: Number(x.cantidad) + 1 } : x));
      return [{ sku, nombre, cantidad: 1 }, ...xs];
    });
    setUltimo(nombre);
    setAviso('');
  }, []);

  const procesarCodigo = useCallback(async (codigo: string) => {
    if (!codigo || codigo.length < 4) return;
    try {
      const r = await fetch(`/api/compras?recurso=codigo&codigo=${encodeURIComponent(codigo)}`);
      const d = await r.json();
      if (d?.encontrado) { setHuerfano(null); agregarSku(d.sku, d.nombre); }
      else {
        // no lo conocemos todavía: se pregunta de quién es y queda aprendido
        setUltimo(null);
        setAviso('');
        setHuerfano(codigo);
        setBuscaH('');
        setSugH([]);
      }
    } catch {
      setAviso('No pude consultar el código, probá de nuevo.');
    }
  }, [agregarSku]);

  // Captura global del lector (wedge): teclas rápidas terminadas en Enter,
  // sin necesidad de tener ningún campo enfocado. Igual que en la caja.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const objetivo = e.target as HTMLElement;
      const enCampo = objetivo && (objetivo.tagName === 'INPUT' || objetivo.tagName === 'TEXTAREA' || objetivo.tagName === 'SELECT' || objetivo.isContentEditable);
      if (enCampo) return;
      if (e.key === 'Enter') {
        const codigo = bufferRef.current.trim();
        bufferRef.current = '';
        if (codigo) procesarCodigo(codigo);
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        // los lectores tipean en ráfaga: si pasa mucho tiempo, era tipeo humano
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 250);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => { window.removeEventListener('keydown', alTeclear); clearTimeout(timerRef.current); };
  }, [procesarCodigo]);

  // buscador del código huérfano
  useEffect(() => {
    if (buscaH.trim().length < 2) return setSugH([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(buscaH)}`);
      if (r.ok) setSugH((await r.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaH]);

  // Vincula el código al producto elegido y lo suma al remito de una.
  const vincular = useCallback(async (sku: string, nombre: string) => {
    if (!huerfano || vinculando) return;
    setVinculando(true);
    try {
      const r = await fetch('/api/compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'vincularCodigo', codigo: huerfano, sku }),
      });
      const d = await r.json();
      if (!r.ok) { setAviso(d?.message ?? 'No pude vincular el código.'); return; }
      setHuerfano(null);
      setBuscaH('');
      setSugH([]);
      agregarSku(sku, nombre);
      setAviso(`Código aprendido: de ahora en más ${nombre} escanea solo.`);
    } catch {
      setAviso('No pude vincular el código, probá de nuevo.');
    } finally {
      setVinculando(false);
    }
  }, [huerfano, vinculando, agregarSku]);

  // búsqueda manual (producto sin código o código roto)
  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`);
      if (r.ok) setSug((await r.json()).items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  const totalUnidades = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);

  const confirmar = async () => {
    if (!proveedorId || !sucursalId || !items.length) return;
    setConfirmando(true);
    setAviso('');
    try {
      const r = await fetch('/api/compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'recepcion',
          proveedorId,
          sucursalId,
          numeroRemito: numeroRemito || undefined,
          items: items.filter((i) => Number(i.cantidad) > 0).map((i) => ({ sku: i.sku, cantidad: Number(i.cantidad) })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? 'No se pudo registrar la recepción');
      setListo({ remitoId: d.remitoId, unidades: totalUnidades, renglones: items.length });
    } catch (e: any) {
      setAviso(e.message);
    } finally {
      setConfirmando(false);
    }
  };

  if (listo) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl bg-white p-8 text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-full bg-emerald-600 grid place-items-center text-3xl text-white">✓</div>
        <h2 className="font-semibold text-black text-xl">Mercadería ingresada</h2>
        <p className="text-sm text-black/60">
          {listo.renglones} producto{listo.renglones === 1 ? '' : 's'} · {listo.unidades} unidad{listo.unidades === 1 ? '' : 'es'}.
          El stock ya está actualizado{numeroRemito ? ` (remito ${numeroRemito})` : ''}.
        </p>
        <p className="rounded-lg bg-[#F0EBE2] px-4 py-3 text-xs text-black/60">
          El remito quedó en <b>Administración → Facturas de compra → Conciliación</b>, esperando la factura del proveedor para el cruce.
        </p>
        <button onClick={() => { setListo(null); setItems([]); setNumeroRemito(''); setUltimo(null); }} className="rounded-full bg-[#B82D25] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#932A1F]">
          Recibir otro camión
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={input}>
          <option value="">¿De qué proveedor llegó?</option>
          {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
        </select>
        <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={input}>
          <option value="">Sucursal…</option>
          {sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input value={numeroRemito} onChange={(e) => setNumeroRemito(e.target.value)} placeholder="N° del remito de papel (opcional)" className={input} />
      </div>

      {/* estado del escáner */}
      <div className={`rounded-2xl p-6 text-center ${ultimo ? 'bg-emerald-600 text-white' : 'bg-black text-[#F0EBE2]'}`}>
        {ultimo ? (
          <>
            <p className="text-xs uppercase tracking-widest opacity-80">Último escaneado</p>
            <p className="text-xl font-semibold mt-1">{ultimo}</p>
          </>
        ) : (
          <>
            <p className="text-3xl">🔫</p>
            <p className="text-sm mt-2 opacity-80">Escaneá los productos a medida que bajan del camión.<br />No hace falta tocar nada: la pistola carga sola.</p>
          </>
        )}
      </div>
      {/* código que el sistema no conoce: en vez de mandar al depósito a otra
          pantalla, se pregunta de quién es y queda aprendido para siempre */}
      {huerfano && (
        <div className="rounded-lg border-2 border-[#B82D25] bg-white p-4">
          <p className="text-sm font-semibold text-black">Este código no lo conocemos todavía</p>
          <p className="mt-0.5 font-mono text-lg tracking-wider text-[#B82D25]">{huerfano}</p>
          <p className="mt-2 text-sm text-black/60">Buscá el producto que tenés en la mano y queda vinculado para siempre.</p>
          <div className="relative mt-3">
            <input
              autoFocus
              value={buscaH}
              onChange={(e) => setBuscaH(e.target.value)}
              placeholder="Nombre del producto…"
              className={input}
            />
            {sugH.length > 0 && (
              <div className="absolute z-30 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-56 overflow-y-auto">
                {sugH.map((p: any) => (
                  <button
                    key={p.sku}
                    disabled={vinculando}
                    onClick={() => vincular(p.sku, p.nombre)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0 disabled:opacity-50"
                  >
                    {p.nombre} <span className="text-xs text-black/40">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* el producto puede no existir todavía: antes no había salida y había
              que abandonar el remito a la mitad */}
          <p className="mt-3 border-t border-black/10 pt-3 text-sm text-black/60">
            ¿No está en el sistema?{' '}
            <a
              href={`/productos/nuevo?codigo=${encodeURIComponent(huerfano)}&volver=/recepcion`}
              className="font-medium text-[#B82D25] underline"
            >
              Dalo de alta con este código
            </a>{' '}
            y volvés acá a seguir escaneando.
          </p>
          <button onClick={() => setHuerfano(null)} className="mt-3 text-xs text-black/45 underline">
            Ahora no, sigo escaneando
          </button>
        </div>
      )}

      {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">{aviso}</p>}

      {/* búsqueda manual */}
      <div className="relative">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="¿Sin código o roto? Buscá por nombre…" className={input} />
        {sug.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-56 overflow-y-auto">
            {sug.map((p: any) => (
              <button key={p.sku} onClick={() => { agregarSku(p.sku, p.nombre); setBusca(''); setSug([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">
                {p.nombre} <span className="text-xs text-black/40">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* lo ingresado */}
      <div className="rounded-xl bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/10">
          <p className="text-sm font-medium text-black">Lo que entró</p>
          <p className="text-xs text-black/50">{items.length} producto{items.length === 1 ? '' : 's'} · {totalUnidades} unidad{totalUnidades === 1 ? '' : 'es'}</p>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-black/40">Todavía no escaneaste nada.</p>
        ) : items.map((i, idx) => (
          <div key={i.sku} className="flex items-center gap-3 px-4 py-2.5 border-b border-black/5 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-black truncate">{i.nombre}</p>
              <p className="text-[11px] text-black/40">{i.sku}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Math.max(Number(x.cantidad) - 1, 0) } : x))} className="h-9 w-9 rounded-lg border border-black/15 text-black text-lg leading-none">−</button>
              <input
                type="number"
                value={i.cantidad}
                onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: e.target.value === '' ? '' : Math.max(Number(e.target.value), 0) } : x))}
                className="w-16 rounded-lg border border-black/15 px-1 py-2 text-center text-base font-semibold text-black"
              />
              <button onClick={() => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(x.cantidad) + 1 } : x))} className="h-9 w-9 rounded-lg border border-black/15 text-black text-lg leading-none">+</button>
            </div>
            <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/30 hover:text-[#B82D25] px-1" aria-label="Quitar">✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={confirmar}
        disabled={confirmando || !proveedorId || !sucursalId || !items.length || items.some((i) => i.cantidad === '' || Number(i.cantidad) < 0)}
        className="w-full rounded-xl bg-[#B82D25] py-4 text-base font-semibold text-white hover:bg-[#932A1F] disabled:opacity-40"
      >
        {confirmando ? 'Ingresando…' : `Confirmar ingreso (${totalUnidades} unidades)`}
      </button>
      <p className="text-center text-[11px] text-black/40">Al confirmar se suma el stock y el remito pasa a Administración para el cruce con la factura.</p>
    </div>
  );
}
