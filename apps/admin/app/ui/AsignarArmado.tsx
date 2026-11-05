'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Selector } from './kit';
import { imprimirComanda } from '../lib/comanda';
import { haceCuanto, type PedidoCola } from '../lib/pedidos';

// «¿A quién se le asigna?» (op salón, 5/11/2026). En la caja, con la comanda
// recién impresa: se elige quién lo arma, se le da la comanda en la mano y le
// aparece el pedido en el celular. Desde ahí corre el reloj.

type Preparador = { id: string; nombre: string; rol: string };

export function AsignarArmado({ p, onAsignado }: { p: PedidoCola; onAsignado: () => void }) {
  const [gente, setGente] = useState<Preparador[] | null>(null);
  const [elegido, setElegido] = useState(p.asignado_a ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recien, setRecien] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/salon?recurso=preparadores', { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); setGente(r.ok && Array.isArray(d) ? d : []); if (!r.ok) setError(d?.message ?? null); })
      .catch(() => setGente([]));
  }, []);

  async function asignar() {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch('/api/salon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'asignar', pedidoId: p.id, usuarioId: elegido }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'No se pudo asignar');
      setRecien(d.nombre);
      onAsignado();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  const nombre = recien ?? p.asignadoNombre ?? null;
  return (
    <section aria-label="Quién lo arma" className="space-y-2 rounded-xl border border-black/[0.08] bg-crema-claro p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-tinta">Quién lo arma</h3>
        {nombre && <span className="text-xs text-tinta/60">{nombre}{p.asignado_en && !recien ? ` · ${haceCuanto(p.asignado_en)}` : recien ? ' · recién' : ''}</span>}
      </div>
      <div className="flex gap-2">
        <Selector
          className="flex-1"
          aria-label="Quién lo arma"
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          vacio={gente === null ? 'Cargando…' : gente.length ? 'Elegí a quién' : 'No hay nadie de salón cargado'}
          opciones={(gente ?? []).map((g) => ({ valor: g.id, etiqueta: `${g.nombre}${g.rol === 'deposito' ? ' (depósito)' : ''}` }))}
        />
        <Boton onClick={asignar} disabled={!elegido || elegido === (p.asignado_a ?? '') || ocupado} cargando={ocupado}>
          {p.asignado_a ? 'Cambiar' : 'Asignar'}
        </Boton>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {nombre && (
        <Boton tamano="chico" variante="secundario" onClick={() => imprimirComanda({ ...p, asignadoNombre: nombre })}>
          Imprimir comanda para {nombre.split(' ')[0]}
        </Boton>
      )}
    </section>
  );
}
