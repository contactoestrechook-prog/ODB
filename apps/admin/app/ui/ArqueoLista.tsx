'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, BotonLink, Cargando, Chip, Entrada, Etiqueta, Modal, Selector, Tarjeta, Vacio, unir } from './kit';
import type { TonoEtiqueta } from './kit';
import { fechaHora, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';

// Arqueo de stock (24/10/2026): la lista de arqueos y el armado de uno nuevo.
// El equipo entra a "Contar" desde el celular; gerencia arma, revisa y aplica.

type Arqueo = {
  id: string; nombre: string; estado: 'abierto' | 'en_revision' | 'aplicado' | 'descartado'; alcance: any; ciego: boolean;
  sucursal: string; creadoPor: string | null; creadoEn: string; aplicadoEn: string | null; resumen: any;
  avance: { productos: number; lecturas: number; personas: number };
};

export const ESTADO_ARQUEO: Record<string, { texto: string; tono: TonoEtiqueta }> = {
  abierto: { texto: 'Contando', tono: 'info' },
  en_revision: { texto: 'En revisión', tono: 'atencion' },
  aplicado: { texto: 'Aplicado', tono: 'ok' },
  descartado: { texto: 'Descartado', tono: 'neutro' },
};

export function textoAlcance(a: any): string {
  if (!a || a.tipo === 'todo') return 'Todo el local';
  if (a.tipo === 'categorias') return a.nombres?.length ? `Rubros: ${a.nombres.join(', ')}` : `${a.ids?.length ?? 0} rubros`;
  if (a.tipo === 'proveedor') return `Proveedor: ${a.nombre ?? '—'}`;
  if (a.tipo === 'productos') return `${a.ids?.length ?? 0} productos elegidos`;
  return '—';
}

export function ArqueoLista({ sucursales, gerencia, sucursalPropia }: { sucursales: { id: string; nombre: string }[]; gerencia: boolean; sucursalPropia: string | null }) {
  const [arqueos, setArqueos] = useState<Arqueo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/arqueo?ruta=');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? 'No pude traer los arqueos');
      setArqueos(j); setError(null);
    } catch (e: any) { setError(e.message); setArqueos((a) => a ?? []); }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t); }, [cargar]);

  const activos = (arqueos ?? []).filter((a) => a.estado === 'abierto' || a.estado === 'en_revision');
  const cerrados = (arqueos ?? []).filter((a) => a.estado === 'aplicado' || a.estado === 'descartado');

  return (
    <div className="space-y-4">
      {gerencia && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-tinta/70">Armá un arqueo y el equipo lo cuenta desde el celular, con el lector o la cámara.</p>
          <Boton onClick={() => setNuevo(true)}>Nuevo arqueo</Boton>
        </div>
      )}
      {error && <Aviso tono="error">{error}</Aviso>}
      {arqueos == null ? <Cargando /> : (
        <>
          {activos.length === 0 ? (
            <Vacio titulo="No hay ningún arqueo en curso" texto={gerencia ? 'Tocá «Nuevo arqueo» para empezar.' : 'Cuando gerencia arme uno, aparece acá para contar.'} />
          ) : activos.map((a) => (
            <Tarjeta key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-lg font-semibold text-tinta">{a.nombre}</p>
                  <p className="text-sm text-tinta/70">{a.sucursal} · {textoAlcance(a.alcance)}{a.ciego ? ' · conteo ciego' : ''}</p>
                  <p className="text-xs text-tinta/60">Armado {fechaHora(a.creadoEn)}{a.creadoPor ? ` por ${a.creadoPor}` : ''}</p>
                </div>
                <Etiqueta tono={ESTADO_ARQUEO[a.estado]?.tono ?? 'neutro'}>{ESTADO_ARQUEO[a.estado]?.texto ?? a.estado}</Etiqueta>
              </div>
              <p className="mt-3 text-sm text-tinta">
                <b>{a.avance.productos}</b> productos contados · {a.avance.lecturas} lecturas · {a.avance.personas} {a.avance.personas === 1 ? 'persona' : 'personas'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <BotonLink href={`/arqueo/${a.id}/contar`}>{a.estado === 'en_revision' ? 'Recontar' : 'Contar'}</BotonLink>
                {gerencia && <BotonLink href={`/arqueo/${a.id}`} variante="secundario">Revisar</BotonLink>}
              </div>
            </Tarjeta>
          ))}
          {cerrados.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-tinta/70">Anteriores</h2>
              {cerrados.map((a) => (
                <Tarjeta key={a.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold text-tinta">{a.nombre}</p>
                      <p className="text-xs text-tinta/60">{a.sucursal} · {textoAlcance(a.alcance)} · {fechaHora(a.aplicadoEn ?? a.creadoEn)}</p>
                      {a.resumen && (
                        <p className="mt-1 text-sm text-tinta/70">
                          {a.resumen.productos_contados} contados · exactitud {a.resumen.exactitud_pct ?? '—'}% · faltante {pesos(a.resumen.valor_faltante)} · sobrante {pesos(a.resumen.valor_sobrante)}
                        </p>
                      )}
                    </div>
                    <Etiqueta tono={ESTADO_ARQUEO[a.estado]?.tono ?? 'neutro'}>{ESTADO_ARQUEO[a.estado]?.texto ?? a.estado}</Etiqueta>
                  </div>
                  {gerencia && a.estado === 'aplicado' && <div className="mt-2"><BotonLink href={`/arqueo/${a.id}`} variante="fantasma" tamano="chico">Ver informe</BotonLink></div>}
                </Tarjeta>
              ))}
            </section>
          )}
        </>
      )}
      {nuevo && <NuevoArqueo sucursales={sucursales} sucursalPropia={sucursalPropia} onCerrar={() => setNuevo(false)} />}
    </div>
  );
}

function NuevoArqueo({ sucursales, sucursalPropia, onCerrar }: { sucursales: { id: string; nombre: string }[]; sucursalPropia: string | null; onCerrar: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [sucursalId, setSucursalId] = useState(sucursalPropia ?? sucursales[0]?.id ?? '');
  const [tipo, setTipo] = useState<'todo' | 'categorias' | 'proveedor'>('categorias');
  const [opciones, setOpciones] = useState<{ categorias: { id: string; nombre: string }[]; proveedores: { id: string; nombre: string; productos: number }[] } | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [prov, setProv] = useState('');
  const [busca, setBusca] = useState('');
  const [ciego, setCiego] = useState(true);
  const [umbralU, setUmbralU] = useState('2');
  const [umbralP, setUmbralP] = useState('10000');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/arqueo?ruta=opciones').then((r) => r.json()).then((j) => setOpciones(j?.categorias ? j : { categorias: [], proveedores: [] })).catch(() => setOpciones({ categorias: [], proveedores: [] }));
  }, []);
  const catsVisibles = useMemo(() => filtrarPorBusqueda(opciones?.categorias ?? [], busca, (c) => c.nombre).slice(0, 60), [opciones, busca]);
  const nombresCats = (opciones?.categorias ?? []).filter((c) => cats.includes(c.id)).map((c) => c.nombre);

  async function crear() {
    setError(null);
    const alcance = tipo === 'todo' ? { tipo } : tipo === 'categorias' ? { tipo, ids: cats, nombres: nombresCats }
      : { tipo, id: prov, nombre: opciones?.proveedores.find((p) => p.id === prov)?.nombre };
    setGuardando(true);
    try {
      const r = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta: '', nombre, sucursalId, alcance, ciego, umbralUnidades: Number(umbralU), umbralPesos: Number(umbralP) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? 'No pude crear el arqueo');
      router.push(`/arqueo/${j.id}`);
    } catch (e: any) { setError(e.message); setGuardando(false); }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Nuevo arqueo de stock" ancho="normal"
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={crear} disabled={guardando || (tipo === 'categorias' && !cats.length) || (tipo === 'proveedor' && !prov)}>{guardando ? 'Creando…' : 'Crear y abrir'}</Boton>
      </>}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-tinta/70">Nombre</span>
          <Entrada value={nombre} maxLength={80} placeholder="Ej.: Bebidas sin alcohol · octubre" onChange={(e) => setNombre(e.target.value)} />
        </label>
        {sucursales.length > 1 && (
          <label className="block text-sm">
            <span className="mb-1 block text-tinta/70">Sucursal</span>
            <Selector value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre.replace(/^Suc\s+/, '') }))} />
          </label>
        )}
        <div>
          <p className="mb-1 text-sm text-tinta/70">Qué se cuenta</p>
          <div className="flex flex-wrap gap-2">
            <Chip activo={tipo === 'categorias'} onClick={() => setTipo('categorias')}>Rubros</Chip>
            <Chip activo={tipo === 'proveedor'} onClick={() => setTipo('proveedor')}>Un proveedor</Chip>
            <Chip activo={tipo === 'todo'} onClick={() => setTipo('todo')}>Todo el local</Chip>
          </div>
          <p className="mt-1 text-xs text-tinta/60">
            Lo profesional es contar por partes (un rubro o un proveedor por vez, rotando): sale más preciso y no frena el local. «Todo el local» es para el inventario general.
          </p>
        </div>
        {tipo === 'categorias' && (
          <div className="space-y-2">
            <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar rubro" aria-label="Buscar rubro" />
            {opciones == null ? <Cargando /> : (
              <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                {catsVisibles.map((c) => (
                  <Chip key={c.id} activo={cats.includes(c.id)} onClick={() => setCats((x) => x.includes(c.id) ? x.filter((i) => i !== c.id) : [...x, c.id])}>{c.nombre}</Chip>
                ))}
              </div>
            )}
            {!!cats.length && <p className="text-xs text-tinta/70">Elegidos: {nombresCats.join(', ')} (incluye sus subrubros)</p>}
          </div>
        )}
        {tipo === 'proveedor' && (
          <Selector value={prov} onChange={(e) => setProv(e.target.value)} vacio="Elegí el proveedor"
            opciones={(opciones?.proveedores ?? []).map((p) => ({ valor: p.id, etiqueta: `${p.nombre} (${p.productos})` }))} />
        )}
        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" checked={ciego} onChange={(e) => setCiego(e.target.checked)} className="mt-0.5 size-4 accent-marca" />
          <span><b>Conteo ciego</b> (recomendado): el que cuenta no ve cuánto dice el sistema, así cuenta lo que hay de verdad.</span>
        </label>
        <div>
          <p className="mb-1 text-sm text-tinta/70">Volver a contar cuando la diferencia sea de</p>
          <div className="grid grid-cols-2 gap-3">
            <Entrada type="number" inputMode="numeric" min={0} value={umbralU} onChange={(e) => setUmbralU(e.target.value)} sufijo="unidades" aria-label="Umbral en unidades" />
            <Entrada type="number" inputMode="numeric" min={0} value={umbralP} onChange={(e) => setUmbralP(e.target.value)} prefijo="$" aria-label="Umbral en pesos" />
          </div>
          <p className="mt-1 text-xs text-tinta/60">Lo que pase cualquiera de los dos se manda a recontar antes de aplicar.</p>
        </div>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}
