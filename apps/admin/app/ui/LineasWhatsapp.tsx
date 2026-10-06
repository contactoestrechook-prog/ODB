'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boton, Etiqueta, ROTULO, Tarjeta, useConfirmar } from './kit';

// LAS LÍNEAS DE WHATSAPP EN EL PANEL (6/10/2026). Leandro: «necesitamos
// automatizar una nueva línea de ODB, mismo todo pero otra línea». Cada número
// tiene su tarjeta, con su interruptor del bot ("Pausar en todas" pausa SOLO ese
// número) y el estado de su WhatsApp. Con una sola línea cargada todo se ve
// como antes: una tarjeta, sin nombres de línea ni chips.

export type LineaWhatsapp = {
  linea: string;
  tipo: 'pedidos' | 'proveedores';
  /** «Línea local» */
  nombre: string;
  /** «Línea local (11 5555-1234)» */
  etiqueta: string;
  numero_legible: string | null;
  activa: boolean;
  bot_activo: boolean;
  bot_pausado_en: string | null;
  principal: boolean;
  /** lo que vio el vigilante de la sesión en su última vuelta */
  whatsapp: { estado: string | null; visto_en: string } | null;
};

/** Las líneas de clientes que atienden (las que van en tarjetas, chips y selectores). */
export const deClientes = (xs: LineaWhatsapp[] | null) => (xs ?? []).filter((l) => l.tipo === 'pedidos' && l.activa);
/** ¿Hay más de un número de clientes? Recién ahí se muestran los nombres de línea. */
export const hayVarias = (xs: LineaWhatsapp[] | null) => deClientes(xs).length > 1;

export function useLineasWhatsapp(cadaMs = 15000) {
  const [lineas, setLineas] = useState<LineaWhatsapp[] | null>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/responde?recurso=lineas', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j)) { setLineas(j); return; }
      }
      // un API anterior a la multilínea no tiene /bot/lineas: la línea de siempre
      const rl = await fetch('/api/responde?recurso=linea&linea=pedidos', { cache: 'no-store' });
      if (rl.ok) {
        const l = await rl.json();
        setLineas([{
          linea: 'pedidos', tipo: 'pedidos', nombre: 'Línea general', etiqueta: 'Línea general', numero_legible: l?.numero_legible ?? null,
          activa: true, bot_activo: l?.bot_activo !== false, bot_pausado_en: l?.bot_pausado_en ?? null, principal: true, whatsapp: null,
        }]);
      }
    } catch { /* sin red: mantiene lo que hay */ }
  }, []);
  useEffect(() => {
    const primera = setTimeout(cargar, 0);
    const t = setInterval(cargar, cadaMs);
    return () => { clearTimeout(primera); clearInterval(t); };
  }, [cargar, cadaMs]);
  return { lineas, cargar };
}

/** El nombre de la línea de una fila (charla, programado, difusión, aviso), solo si hay más de una. */
export function ChipLinea({ linea, lineas, className }: { linea?: string | null; lineas: LineaWhatsapp[] | null; className?: string }) {
  if (!linea || !hayVarias(lineas)) return null;
  const l = (lineas ?? []).find((x) => x.linea === linea);
  return <Etiqueta tono="info" className={className}>{l?.nombre ?? linea}</Etiqueta>;
}

const ESTADO_WHATSAPP: Record<string, string> = {
  SCAN_QR_CODE: 'WhatsApp desvinculado: escanear el QR',
  FAILED: 'WhatsApp caído',
  STOPPED: 'WhatsApp detenido',
  STARTING: 'WhatsApp arrancando',
};

/**
 * Una tarjeta por número de clientes, con su interruptor. `rotulo` es el de la
 * pantalla («Línea de WhatsApp», «Difusiones · O.D.B»); con más de una línea se
 * le suma el nombre de cada una.
 */
export function TarjetasDeLineas({
  lineas, cargar, rotulo, puedeApagar = true, verbo = 'Pausar',
}: {
  lineas: LineaWhatsapp[] | null;
  cargar: () => Promise<void> | void;
  rotulo: string;
  puedeApagar?: boolean;
  verbo?: 'Pausar' | 'Apagar';
}) {
  const [ocupada, setOcupada] = useState<string | null>(null);
  const { confirmar, dialogo } = useConfirmar();
  const varias = hayVarias(lineas);
  const lista = lineas ? deClientes(lineas) : null;

  async function botLinea(l: LineaWhatsapp, activo: boolean) {
    if (ocupada) return;
    if (!activo && !(await confirmar(varias
      ? {
          titulo: `¿${verbo} el bot en todas las charlas de la ${l.etiqueta}?`,
          texto: 'Los clientes que escriben a ese número no reciben respuesta automática hasta que lo vuelvas a encender. Las otras líneas siguen atendiendo.',
          variante: 'peligro',
          textoConfirmar: 'Pausar esta línea',
        }
      : {
          titulo: `¿${verbo} RESPONDE en TODAS las conversaciones?`,
          texto: 'Nadie recibe respuesta automática hasta que lo vuelvas a encender.',
          variante: 'peligro',
          textoConfirmar: `${verbo} en todas`,
        }))) return;
    setOcupada(l.linea);
    try {
      await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'botLinea', linea: l.linea, activo }) });
      await cargar();
    } finally {
      setOcupada(null);
    }
  }

  // mientras carga, la tarjeta de siempre sin número (no se inventa uno)
  if (!lista) {
    return (
      <Tarjeta>
        <p className={ROTULO}>{rotulo}</p>
        <p className="importe mt-0.5 text-xl font-bold text-tinta/40">…</p>
      </Tarjeta>
    );
  }

  return (
    <>
      <div className={varias ? 'grid gap-3 sm:grid-cols-2' : ''}>
        {lista.map((l) => {
          const pausada = l.bot_activo === false;
          const estado = l.whatsapp?.estado ?? null;
          const caida = !!estado && estado !== 'WORKING';
          return (
            <Tarjeta key={l.linea}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={ROTULO}>{varias ? `${rotulo} · ${l.nombre}` : rotulo}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="importe text-xl font-bold text-tinta">{l.numero_legible ?? l.nombre}</p>
                    <Etiqueta tono={pausada ? 'atencion' : 'ok'} punto>
                      {pausada ? (varias ? 'Pausado en esta línea' : 'Pausado en todas') : 'Atendiendo'}
                    </Etiqueta>
                    {caida && <Etiqueta tono="error" punto>{ESTADO_WHATSAPP[estado!] ?? `WhatsApp ${estado}`}</Etiqueta>}
                  </div>
                  {caida && varias && (
                    <p className="mt-1 text-xs text-marca-hondo">Los clientes que escriben a este número no reciben respuesta hasta que vuelva a conectarse.</p>
                  )}
                </div>
                {puedeApagar && (
                  <Boton
                    variante={pausada ? 'primario' : 'peligro'}
                    tamano="chico"
                    onClick={() => botLinea(l, pausada)}
                    disabled={!!ocupada}
                  >
                    {pausada ? (varias ? 'Encender esta línea' : 'Encender en todas') : (varias ? 'Pausar esta línea' : 'Pausar en todas')}
                  </Boton>
                )}
              </div>
            </Tarjeta>
          );
        })}
      </div>
      {dialogo}
    </>
  );
}
