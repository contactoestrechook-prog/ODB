'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Conteo cíclico: se cuenta un sector (o todo), renglón por renglón con scanner
// o buscador. Cada renglón guarda un snapshot del stock del sistema AL MOMENTO
// de contar, así las ventas simultáneas no ensucian el diff. Al finalizar, las
// diferencias se ajustan en un solo paso con autorización de un supervisor.

type Sucursal = { id: string; nombre: string };
type ItemConteo = {
  producto_id: string;
  cantidad_contada: number;
  cantidad_sistema: number;
  producto?: { sku: string; nombre: string } | null;
};
type Conteo = {
  id: string;
  sector: string | null;
  estado: string;
  creado_en: string;
  sucursal: { id: string; nombre: string } | null;
  usuario?: { nombre: string } | null;
  items: ItemConteo[];
};

const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function ConteoWorkspace({ sucursales, conteosIniciales }: { sucursales: Sucursal[]; conteosIniciales: Conteo[] }) {
  const router = useRouter();
  const [conteos, setConteos] = useState<Conteo[]>(conteosIniciales);
  const [activo, setActivo] = useState<Conteo | null>(null);
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const [sector, setSector] = useState('');
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<any[]>([]);
  const [producto, setProducto] = useState<any>(null);
  const [cantidad, setCantidad] = useState('');
  const [ultimo, setUltimo] = useState<{ nombre: string; sistema: number; contado: number; diferencia: number } | null>(null);
  const [pin, setPin] = useState('');
  const [finalizando, setFinalizando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState('');
  const cantRef = useRef<HTMLInputElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`);
      if (r.ok) setSug((await r.json()).items ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [busca]);

  const post = async (body: any) => {
    const r = await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message ?? 'Error');
    return d;
  };

  const refrescarConteos = async () => {
    try {
      const r = await fetch('/api/stock?recurso=conteos');
      if (r.ok) {
        const d = await r.json();
        setConteos(d);
        if (activo) setActivo(d.find((c: Conteo) => c.id === activo.id) ?? null);
      }
    } catch {}
  };

  async function crearConteo() {
    setError('');
    try {
      const d = await post({ accion: 'conteo-crear', sucursalId, sector: sector.trim() || undefined });
      await refrescarConteos();
      const r = await fetch('/api/stock?recurso=conteos');
      const lista = r.ok ? await r.json() : [];
      setConteos(lista);
      setActivo(lista.find((c: Conteo) => c.id === d.conteoId) ?? null);
      setSector('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el conteo');
    }
  }

  async function cargarItem() {
    if (!activo || !producto || cantidad === '') return;
    setError('');
    try {
      const d = await post({ accion: 'conteo-item', conteoId: activo.id, sku: producto.sku, cantidad: Number(cantidad) });
      setUltimo({ nombre: producto.nombre, sistema: Number(d.sistema), contado: Number(d.contado), diferencia: Number(d.diferencia) });
      setProducto(null);
      setCantidad('');
      buscaRef.current?.focus();
      refrescarConteos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }

  async function finalizar() {
    if (!activo || finalizando) return;
    setError('');
    setFinalizando(true);
    try {
      let autorizadoPor: string | undefined;
      if (pin.trim()) {
        const ra = await fetch('/api/caja', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'autorizar', pin }),
        });
        const da = await ra.json();
        if (!ra.ok) throw new Error(da.message ?? 'PIN incorrecto');
        autorizadoPor = da.usuarioId;
      }
      const d = await post({ accion: 'conteo-finalizar', conteoId: activo.id, autorizadoPor });
      setResultado(d);
      setActivo(null);
      setPin('');
      refrescarConteos();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo finalizar');
    }
    setFinalizando(false);
  }

  async function descartar() {
    if (!activo) return;
    if (!window.confirm('¿Descartar este conteo? No se ajusta nada.')) return;
    try {
      await post({ accion: 'conteo-descartar', conteoId: activo.id });
      setActivo(null);
      refrescarConteos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descartar');
    }
  }

  const itemsOrdenados = activo ? [...activo.items].sort((a, b) => Math.abs(b.cantidad_contada - b.cantidad_sistema) - Math.abs(a.cantidad_contada - a.cantidad_sistema)) : [];
  const conDiferencia = itemsOrdenados.filter((i) => i.cantidad_contada !== i.cantidad_sistema).length;

  // ---- resultado del conteo aplicado ----
  if (resultado) {
    return (
      <section className="rounded-xl bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold text-black">✓ Conteo aplicado</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[['Renglones contados', resultado.items_contados], ['Con diferencia', resultado.ajustados], ['Unidades ajustadas', resultado.unidades_ajustadas]].map(([l, v]: any) => (
            <div key={l} className="rounded-lg bg-[#F0EBE2]/60 p-3">
              <p className="text-2xl font-semibold text-black">{v}</p>
              <p className="text-[11px] text-black/45">{l}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-black/50">Cada diferencia quedó como ajuste auditado en Movimientos (motivo &quot;Inventario: conteo…&quot;).</p>
        <button onClick={() => setResultado(null)} className="rounded-full bg-black text-white text-sm font-medium px-5 py-2.5">Nuevo conteo</button>
      </section>
    );
  }

  // ---- sin conteo activo: crear o retomar ----
  if (!activo) {
    return (
      <div className="space-y-4">
        <section className="rounded-xl bg-white p-5 space-y-3">
          <h2 className="font-semibold text-black">Nuevo conteo</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={input + ' bg-white'}>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector (ej: góndola vinos) — opcional" className={input + ' sm:col-span-2'} />
          </div>
          {error && <p className="text-xs text-[#B82D25]">{error}</p>}
          <button onClick={crearConteo} disabled={!sucursalId} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">
            Empezar a contar
          </button>
        </section>

        {conteos.length > 0 && (
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Conteos abiertos</h2>
            {conteos.map((c) => (
              <button key={c.id} onClick={() => setActivo(c)} className="w-full px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between text-left hover:bg-[#F0EBE2]/50">
                <span className="text-sm text-black">
                  <span className="font-medium">{c.sucursal?.nombre}</span>
                  {c.sector ? ` · ${c.sector}` : ''} · {c.items.length} renglones
                  {c.usuario?.nombre ? <span className="text-black/45"> · {c.usuario.nombre}</span> : null}
                </span>
                <span className="text-xs text-[#B82D25] font-medium">Retomar →</span>
              </button>
            ))}
          </section>
        )}
      </div>
    );
  }

  // ---- contando ----
  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-black">
            Contando: {activo.sucursal?.nombre}{activo.sector ? ` · ${activo.sector}` : ''}
          </h2>
          <span className="text-xs text-black/50">{activo.items.length} renglones · {conDiferencia} con diferencia</span>
        </div>

        {/* scanner / buscador + cantidad */}
        {producto ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-lg bg-[#F0EBE2]/70 px-3 py-2.5 text-sm text-black truncate">
              {producto.nombre} <span className="text-black/40 text-xs">({producto.sku})</span>
            </span>
            <input
              ref={cantRef}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && cargarItem()}
              placeholder="Contado"
              inputMode="decimal"
              autoFocus
              className="w-28 rounded-lg border-2 border-[#B82D25] px-3 py-2.5 text-sm text-black text-right focus:outline-none"
            />
            <button onClick={cargarItem} className="rounded-lg bg-black text-white text-sm px-4 py-2.5">OK</button>
            <button onClick={() => { setProducto(null); setCantidad(''); }} className="text-black/40 px-1">✕</button>
          </div>
        ) : (
          <div className="relative">
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Escaneá o buscá el producto…"
              autoFocus
              className={input}
            />
            {sug.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-56 overflow-y-auto">
                {sug.map((p: any) => (
                  <button
                    key={p.sku}
                    onClick={() => { setProducto(p); setBusca(''); setSug([]); setTimeout(() => cantRef.current?.focus(), 50); }}
                    className="w-full text-left px-3 py-2 text-sm text-black hover:bg-[#F0EBE2] border-b border-black/5 last:border-0"
                  >
                    {p.nombre} <span className="text-xs text-black/40">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {ultimo && (
          <p className={`rounded-lg px-3 py-2 text-sm ${ultimo.diferencia === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
            {ultimo.nombre}: sistema {ultimo.sistema} → contado {ultimo.contado}
            {ultimo.diferencia === 0 ? ' · sin diferencia ✓' : ` · diferencia ${ultimo.diferencia > 0 ? '+' : ''}${ultimo.diferencia}`}
          </p>
        )}
        {error && <p className="text-xs text-[#B82D25]">{error}</p>}
      </section>

      {/* renglones contados (peores diferencias primero) */}
      {itemsOrdenados.length > 0 && (
        <section className="rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm text-black">
            <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium text-right">Sistema</th>
              <th className="px-4 py-2 font-medium text-right">Contado</th>
              <th className="px-4 py-2 font-medium text-right">Dif.</th>
            </tr></thead>
            <tbody>
              {itemsOrdenados.map((i) => {
                const d = Number(i.cantidad_contada) - Number(i.cantidad_sistema);
                return (
                  <tr key={i.producto_id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2"><p className="font-medium">{i.producto?.nombre ?? i.producto_id}</p><p className="text-xs text-black/40">{i.producto?.sku}</p></td>
                    <td className="px-4 py-2 text-right text-black/60">{Number(i.cantidad_sistema)}</td>
                    <td className="px-4 py-2 text-right">{Number(i.cantidad_contada)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${d === 0 ? 'text-emerald-700' : 'text-[#B82D25]'}`}>{d > 0 ? `+${d}` : d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* finalizar */}
      <section className="rounded-xl bg-white p-5 space-y-3">
        <p className="text-sm text-black/60">
          Al finalizar, cada diferencia se ajusta con un movimiento auditado. Requiere el PIN de un supervisor.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN del supervisor"
            type="password"
            inputMode="numeric"
            className="w-48 rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
          />
          <button
            onClick={finalizar}
            disabled={finalizando || activo.items.length === 0}
            className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
          >
            {finalizando ? 'Aplicando…' : `Finalizar y ajustar (${conDiferencia} dif.)`}
          </button>
          <button onClick={descartar} className="text-sm text-black/50 px-3 py-2 hover:text-[#B82D25]">Descartar conteo</button>
          <button onClick={() => setActivo(null)} className="text-sm text-black/50 px-3 py-2 hover:text-black">Pausar (seguir después)</button>
        </div>
      </section>
    </div>
  );
}
