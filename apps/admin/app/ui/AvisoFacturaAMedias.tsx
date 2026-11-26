'use client';

// «TENÉS UNA FACTURA A MEDIAS» (26/11/2026). Juan Pablo: si sale de la factura (otra pantalla,
// se corta la luz, se cierra el navegador), al volver tiene que quedar como la dejó. Lo
// cargado queda guardado (lib/borrador-local.ts); este recordatorio lo lleva de vuelta desde
// cualquier pantalla. No suena: es un recordatorio, no una alarma. No se muestra en la
// pantalla donde la factura ya se reabre sola.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BORRADOR_EMITIR, BORRADOR_FACTURA_PROVEEDOR, EVENTO_BORRADOR, emitirTieneAlgo, haceCuantoGuardado, leerBorrador, linkParaSeguirEmitir,
  type BorradorEmitir,
} from '../lib/borrador-local';
import { esRutaDeAcceso } from '../lib/rutas';
import { FOCO, unir } from './kit';

type Pendiente = { clave: string; que: string; cuando: number; href: string; ruta: string };

function pendientes(): Pendiente[] {
  const lista: Pendiente[] = [];
  const e = leerBorrador<BorradorEmitir>(BORRADOR_EMITIR);
  if (e && emitirTieneAlgo(e.datos)) {
    const cliente = (e.datos.cliente?.razon_social ?? e.datos.cliente?.nombre) as string | undefined;
    lista.push({ clave: 'emitir', que: `Factura a medias${cliente ? ` de ${cliente}` : ''}`, cuando: e.en, href: linkParaSeguirEmitir(e.datos), ruta: '/facturacion' });
  }
  const c = leerBorrador<{ lecturaId: string }>(BORRADOR_FACTURA_PROVEEDOR);
  if (c?.datos?.lecturaId) lista.push({ clave: 'proveedor', que: 'Factura de proveedor a medias', cuando: c.en, href: '/compras', ruta: '/compras' });
  return lista;
}

export function AvisoFacturaAMedias() {
  const ruta = usePathname();
  const [lista, setLista] = useState<Pendiente[]>([]);

  useEffect(() => {
    const leer = () => setLista(pendientes());
    const primera = requestAnimationFrame(leer);
    window.addEventListener(EVENTO_BORRADOR, leer);
    window.addEventListener('storage', leer); // otra pestaña de la misma compu
    return () => { cancelAnimationFrame(primera); window.removeEventListener(EVENTO_BORRADOR, leer); window.removeEventListener('storage', leer); };
  }, [ruta]);

  if (esRutaDeAcceso(ruta)) return null;
  // en su pantalla la factura ya se reabre sola
  const visibles = lista.filter((p) => !(ruta === p.ruta || ruta?.startsWith(`${p.ruta}/`)));
  if (!visibles.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {visibles.map((p) => (
        <Link key={p.clave} href={p.href}
          className={unir('flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 text-sm shadow-flotante ring-1 ring-black/[0.08] hover:bg-crema-claro', FOCO)}>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-atencion" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-tinta">{p.que}</span>
            <span className="block text-xs text-tinta/60">Quedó como la dejaste ({haceCuantoGuardado(p.cuando)})</span>
          </span>
          <span className="shrink-0 font-semibold text-marca">Seguir →</span>
        </Link>
      ))}
    </div>
  );
}
