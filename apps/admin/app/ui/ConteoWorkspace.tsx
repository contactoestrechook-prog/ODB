'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Aviso,
  Boton,
  Entrada,
  FOCO,
  FOCO_ADENTRO,
  IconoCerrar,
  IconoOk,
  Selector,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  unir,
  useConfirmar,
} from './kit';

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


export function ConteoWorkspace({ sucursales, conteosIniciales }: { sucursales: Sucursal[]; conteosIniciales: Conteo[] }) {
  const router = useRouter();
  const { confirmar, dialogo } = useConfirmar();
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
      let autorizacionToken: string | undefined;
      if (pin.trim()) {
        const ra = await fetch('/api/caja', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'autorizar', pin }),
        });
        const da = await ra.json();
        if (!ra.ok) throw new Error(da.message ?? 'PIN incorrecto');
        autorizacionToken = da.token;
      }
      const d = await post({ accion: 'conteo-finalizar', conteoId: activo.id, autorizacionToken });
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
    if (!(await confirmar({ titulo: '¿Descartar este conteo?', texto: 'No se ajusta nada.', variante: 'peligro', textoConfirmar: 'Descartar conteo' }))) return;
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
      <Tarjeta className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-tinta">
          <IconoOk className="size-6 shrink-0 text-ok" />
          Conteo aplicado
        </h2>
        <div className="grid grid-cols-3 gap-2 text-center sm:gap-4">
          {[['Renglones contados', resultado.items_contados], ['Con diferencia', resultado.ajustados], ['Unidades ajustadas', resultado.unidades_ajustadas]].map(([l, v]: any) => (
            <div key={l} className="min-w-0 rounded-xl bg-crema-claro p-3">
              <p className="importe truncate text-xl font-bold text-tinta sm:text-2xl sm:font-semibold">{v}</p>
              <p className="mt-1 text-xs text-tinta/60">{l}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-tinta/60">Cada diferencia quedó como ajuste auditado en Movimientos (motivo &quot;Inventario: conteo…&quot;).</p>
        <Boton onClick={() => setResultado(null)}>Nuevo conteo</Boton>
      </Tarjeta>
    );
  }

  // ---- sin conteo activo: crear o retomar ----
  if (!activo) {
    return (
      <div className="space-y-4">
        <Tarjeta className="space-y-3">
          <h2 className="text-base font-semibold text-tinta">Nuevo conteo</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} aria-label="Sucursal">
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Selector>
            <Entrada
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Sector (ej: góndola vinos) — opcional"
              aria-label="Sector (opcional)"
              className="sm:col-span-2"
            />
          </div>
          {error && <Aviso tono="error">{error}</Aviso>}
          <Boton onClick={crearConteo} disabled={!sucursalId} className="w-full sm:w-auto">
            Empezar a contar
          </Boton>
        </Tarjeta>

        {conteos.length > 0 && (
          <Tarjeta relleno={false} className="overflow-hidden">
            <TarjetaCabecera titulo="Conteos abiertos" />
            <div className="divide-y divide-black/[0.06]">
              {conteos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActivo(c)}
                  className={unir('flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
                >
                  <span className="min-w-0 break-words text-sm text-tinta">
                    <span className="font-medium">{c.sucursal?.nombre}</span>
                    {c.sector ? ` · ${c.sector}` : ''} · {c.items.length} renglones
                    {c.usuario?.nombre ? <span className="text-tinta/60"> · {c.usuario.nombre}</span> : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-marca">Retomar →</span>
                </button>
              ))}
            </div>
          </Tarjeta>
        )}
      </div>
    );
  }

  // ---- contando ----
  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 break-words text-base font-semibold text-tinta">
            Contando: {activo.sucursal?.nombre}{activo.sector ? ` · ${activo.sector}` : ''}
          </h2>
          <span className="text-xs text-tinta/60">{activo.items.length} renglones · {conDiferencia} con diferencia</span>
        </div>

        {/* scanner / buscador + cantidad */}
        {producto ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full min-w-0 break-words rounded-xl bg-crema-claro px-3.5 py-2.5 text-sm text-tinta sm:w-auto sm:flex-1">
              {producto.nombre} <span className="text-xs text-tinta/60">({producto.sku})</span>
            </span>
            <Entrada
              ref={cantRef}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && cargarItem()}
              placeholder="Contado"
              aria-label="Cantidad contada"
              inputMode="decimal"
              autoFocus
              className="min-w-0 flex-1 text-right sm:w-28 sm:flex-none"
            />
            <Boton onClick={cargarItem}>OK</Boton>
            <button
              type="button"
              onClick={() => { setProducto(null); setCantidad(''); }}
              aria-label="Quitar el producto"
              className={unir('grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-marca-hondo', FOCO)}
            >
              <IconoCerrar className="size-5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Entrada
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Escaneá o buscá el producto…"
              aria-label="Escaneá o buscá el producto"
              autoFocus
            />
            {sug.length > 0 && (
              <div className="absolute z-contenido mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-flotante">
                {sug.map((p: any) => (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => { setProducto(p); setBusca(''); setSug([]); setTimeout(() => cantRef.current?.focus(), 50); }}
                    className="block min-h-11 w-full border-b border-black/[0.06] px-3.5 py-2 text-left text-sm text-tinta last:border-0 hover:bg-crema-claro focus-visible:bg-crema-claro focus-visible:outline-none"
                  >
                    {p.nombre} <span className="text-xs text-tinta/60">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {ultimo && (
          <Aviso tono={ultimo.diferencia === 0 ? 'ok' : 'atencion'}>
            {ultimo.nombre}: sistema {ultimo.sistema} → contado {ultimo.contado}
            {ultimo.diferencia === 0 ? ' · sin diferencia' : ` · diferencia ${ultimo.diferencia > 0 ? '+' : ''}${ultimo.diferencia}`}
          </Aviso>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
      </Tarjeta>

      {/* renglones contados (peores diferencias primero) */}
      {itemsOrdenados.length > 0 && (
        <TablaResponsiva
          etiqueta="Renglones contados"
          filas={itemsOrdenados}
          claveFila="producto_id"
          columnas={[
            {
              clave: 'producto', titulo: 'Producto', principal: true,
              celda: (i) => (
                <div className="min-w-0">
                  <p className="break-words font-medium text-tinta">{i.producto?.nombre ?? i.producto_id}</p>
                  <p className="text-xs font-normal text-tinta/60">{i.producto?.sku}</p>
                </div>
              ),
            },
            { clave: 'sistema', titulo: 'Sistema', importe: true, celda: (i) => <span className="text-tinta/60">{Number(i.cantidad_sistema)}</span> },
            { clave: 'contado', titulo: 'Contado', importe: true, celda: (i) => Number(i.cantidad_contada) },
            {
              clave: 'dif', titulo: 'Dif.', importe: true,
              celda: (i) => {
                const d = Number(i.cantidad_contada) - Number(i.cantidad_sistema);
                return <span className={`font-semibold ${d === 0 ? 'text-ok' : 'text-marca-hondo'}`}>{d > 0 ? `+${d}` : d}</span>;
              },
            },
          ]}
        />
      )}

      {/* finalizar */}
      <Tarjeta className="space-y-3">
        <p className="text-sm text-tinta/70">
          Al finalizar, cada diferencia se ajusta con un movimiento auditado. Requiere el PIN de un supervisor.
        </p>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Entrada
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN del supervisor"
            aria-label="PIN del supervisor"
            type="password"
            inputMode="numeric"
            className="sm:w-48"
          />
          <Boton
            onClick={finalizar}
            disabled={activo.items.length === 0}
            cargando={finalizando}
          >
            {finalizando ? 'Aplicando…' : `Finalizar y ajustar (${conDiferencia} dif.)`}
          </Boton>
          <Boton variante="peligro" onClick={descartar}>Descartar conteo</Boton>
          <Boton variante="fantasma" onClick={() => setActivo(null)}>Pausar (seguir después)</Boton>
        </div>
      </Tarjeta>

      {dialogo}
    </div>
  );
}
