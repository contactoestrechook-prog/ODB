'use client';

import { useEffect, useRef, useState } from 'react';
import { Aviso, Boton, Cargando, Confirmar, Tarjeta, clasesBoton, unir } from './kit';
import { fecha as fechaFmt, numero } from '../lib/formato';
import { leerStock, leerVentas, mismoLocal, textoDelArchivo, type StockLeido, type VentasLeidas } from '../lib/puesta-al-dia';

// PONER AL DÍA (11/11/2026): los locales todavía venden con su sistema, así que
// el stock y las ventas de NÚCLEO son la foto de la última carga. Hasta hoy cada
// carga era una sesión entera con los nueve archivos del Crack. Acá entra la
// parte de todos los días: stock.csv y ventas.csv.
//
// Los archivos se leen en el navegador (el de ventas pesa ~37 MB: viaja solo el
// resumen por día y producto). La API arma el plan con la misma regla de la
// carga del 10/11 y lo muestra ANTES de tocar nada; «Aplicar» lo hace todo o nada.

export type LocalAlDia = { sucursalId: string; nombre: string; sucursal: string; stockAl: string | null; ventasHasta: string | null; alDia: boolean };

type Simulacion = {
  referencia: string;
  corte: string;
  frenos: string[];
  avisos: string[];
  resumen: {
    stock: {
      enArchivo: number; conProducto: number; sinProducto: number; deBaja: number; ajustes: number; suben: number; bajan: number;
      unidadesSuben: number; unidadesBajan: number; quedanEnCero: number; comprasSoloNucleo: number; comprasQueElLocalYaTenia: number;
      mayores: { nombre: string; antes: number; objetivo: number }[];
    };
    ventas: { desde: string | null; hasta: string | null; dias: number; renglones: number; unidades: number };
  };
};

const miles = (n?: number) => numero(Math.round(n ?? 0));
const cant = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
const dia = (iso?: string | null) => fechaFmt(iso, 'completa');
const hora = (iso: string) => iso.slice(11, 16);

async function pedir(que: 'simular-carga' | 'aplicar-carga', cuerpo: unknown) {
  const r = await fetch(`/api/abastecimiento?que=${que}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? 'El servidor no pudo con la carga');
  return j;
}

/** De qué local es el archivo: lo dice la columna «sucursal» de su primer renglón. */
function localDelTexto(texto: string): string {
  const [encabezado = '', primero = ''] = texto.split(/\r?\n/, 2);
  const i = encabezado.split(';').findIndex((c) => c.trim().toLowerCase() === 'sucursal');
  return i < 0 ? '' : (primero.split(';')[i] ?? '').trim();
}

export function PuestaAlDia({ locales, onAplicada }: { locales: LocalAlDia[]; onAplicada: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [stock, setStock] = useState<StockLeido | null>(null);
  const [ventas, setVentas] = useState<VentasLeidas | null>(null);
  const [nombres, setNombres] = useState<{ stock?: string; ventas?: string }>({});
  const [leyendo, setLeyendo] = useState<'stock' | 'ventas' | null>(null);
  const [error, setError] = useState('');
  const [simulando, setSimulando] = useState(false);
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [listo, setListo] = useState('');
  const turno = useRef(0);

  const localDe = (texto: string) => locales.find((l) => mismoLocal(texto, l.nombre) || mismoLocal(texto, l.sucursal)) ?? null;
  const local = stock ? localDe(stock.sucursal) : ventas ? localDe(ventas.sucursal) : null;
  const cuerpo = stock && ventas && local ? { sucursalId: local.sucursalId, corte: stock.corte, stock: stock.filas, ventas: ventas.ventas } : null;

  async function elegir(cual: 'stock' | 'ventas', archivo: File | null) {
    if (!archivo) return;
    setError(''); setListo(''); setSim(null);
    setLeyendo(cual);
    try {
      const texto = textoDelArchivo(await archivo.arrayBuffer());
      const de = localDe(localDelTexto(texto));
      if (!de) throw new Error(`El archivo dice que es de «${localDelTexto(texto) || 'un local sin nombre'}», que no es ningún local de NÚCLEO.`);
      if (cual === 'stock') {
        const leido = leerStock(texto);
        if ('error' in leido) throw new Error(leido.error);
        if (ventas && !mismoLocal(ventas.sucursal, leido.sucursal)) throw new Error('Los dos archivos tienen que ser del mismo local.');
        setStock(leido);
      } else {
        // del archivo de ventas (un año de tickets) viajan solo los días que faltan cargar
        const leido = leerVentas(texto, de.ventasHasta);
        if ('error' in leido) throw new Error(leido.error);
        if (stock && !mismoLocal(stock.sucursal, leido.sucursal)) throw new Error('Los dos archivos tienen que ser del mismo local.');
        setVentas(leido);
      }
      setNombres((n) => ({ ...n, [cual]: archivo.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude leer el archivo');
    } finally {
      setLeyendo(null);
    }
  }

  // con los dos archivos leídos, se simula solo: todavía no se toca nada
  useEffect(() => {
    if (!cuerpo) return;
    const mio = ++turno.current;
    setSimulando(true); setSim(null); setError('');
    pedir('simular-carga', cuerpo)
      .then((j) => { if (mio === turno.current) setSim(j); })
      .catch((e) => { if (mio === turno.current) setError(e instanceof Error ? e.message : 'No pude simular la carga'); })
      .finally(() => { if (mio === turno.current) setSimulando(false); });
  }, [stock, ventas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function aplicar() {
    if (!cuerpo) return;
    try {
      const j = await pedir('aplicar-carga', cuerpo);
      setListo(`Listo: ${miles(j.stock_ajustes)} productos con el stock corregido y ${miles(j.ventas_renglones)} renglones de venta cargados. ${local?.sucursal ?? 'El local'} quedó con el stock del ${dia(sim?.corte)} a las ${hora(sim?.corte ?? '')}.`);
      setStock(null); setVentas(null); setNombres({}); setSim(null);
      onAplicada();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude aplicar la carga');
    } finally {
      setConfirmar(false);
    }
  }

  const s = sim?.resumen.stock;
  const v = sim?.resumen.ventas;
  const nadaQueHacer = !!sim && !sim.frenos.length && s?.ajustes === 0 && v?.renglones === 0;

  return (
    <Tarjeta className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-tinta">Poner al día el stock y las ventas</p>
          <p className="mt-0.5 text-xs text-tinta/70">
            {locales.map((l) => `${l.sucursal}: stock al ${l.stockAl ? dia(l.stockAl) : '—'}, ventas hasta el ${l.ventasHasta ? dia(l.ventasHasta) : '—'}`).join(' · ')}
          </p>
        </div>
        <Boton variante="secundario" tamano="chico" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>{abierto ? 'Cerrar' : 'Poner al día'}</Boton>
      </div>

      {listo && <Aviso tono="ok">{listo}</Aviso>}

      {abierto && (
        <div className="space-y-3 border-t border-black/[0.06] pt-3">
          <p className="text-sm leading-snug text-tinta/80">
            Mientras el local venda con su sistema, NÚCLEO sabe lo que hay hasta la última carga. Bajá del sistema del local los archivos <b>stock.csv</b> y <b>ventas.csv</b> y elegilos acá. Primero vas a ver qué cambia; nada se toca hasta que aprietes «Aplicar».
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['stock', 'ventas'] as const).map((cual) => {
              const leido = cual === 'stock' ? stock : ventas;
              return (
                <div key={cual} className="min-w-0 rounded-xl border border-black/[0.06] bg-crema-claro px-3 py-2.5">
                  <label className={clasesBoton({ variante: leido ? 'secundario' : 'primario', tamano: 'chico', className: unir('min-w-0 cursor-pointer', leyendo && 'pointer-events-none opacity-60') })}>
                    <span className="min-w-0 truncate">{nombres[cual] ?? `Elegir ${cual}.csv`}</span>
                    <input type="file" accept=".csv,text/csv" className="sr-only" disabled={!!leyendo} onChange={(e) => { elegir(cual, e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                  <p className="mt-1.5 text-xs text-tinta/70">
                    {leyendo === cual ? 'Leyendo…'
                      : cual === 'stock' && stock ? `${miles(stock.lineas)} productos de ${stock.sucursal} · corte del ${stock.corte ? `${dia(stock.corte)} a las ${hora(stock.corte)}` : 'sin fecha'}`
                      : cual === 'ventas' && ventas ? `${miles(ventas.lineas)} renglones de ticket de ${ventas.sucursal} · llega hasta el ${dia(ventas.hasta)}`
                      : cual === 'stock' ? 'Lo que hay de cada producto, con la fecha y hora del corte.' : 'Los tickets del local. Trae el año entero: se cargan solo los días que faltan.'}
                  </p>
                </div>
              );
            })}
          </div>

          {error && <Aviso tono="error">{error}</Aviso>}
          {simulando && <Cargando texto="Calculando qué cambia…" />}

          {sim && s && v && (
            <div className="space-y-2.5">
              {sim.frenos.map((f) => <Aviso key={f} tono="error">{f}</Aviso>)}
              {sim.avisos.map((a) => <Aviso key={a} tono="atencion">{a}</Aviso>)}
              <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2.5">
                <p className="text-sm text-tinta">
                  <b>Stock de {local?.sucursal}:</b>{' '}
                  {s.ajustes === 0 ? 'ya está igual que el archivo, no cambia nada.' : (
                    <>
                      cambian <span className="importe font-semibold">{miles(s.ajustes)}</span> de {miles(s.conProducto)} productos ·{' '}
                      <span className="importe font-semibold">{miles(s.bajan)}</span> bajan ({miles(s.unidadesBajan)} unidades) ·{' '}
                      <span className="importe font-semibold">{miles(s.suben)}</span> suben ({miles(s.unidadesSuben)}) ·{' '}
                      <span className="importe font-semibold">{miles(s.quedanEnCero)}</span> quedan en cero
                    </>
                  )}
                </p>
                {(s.comprasSoloNucleo > 0 || s.comprasQueElLocalYaTenia > 0) && (
                  <p className="mt-1 text-xs text-tinta/70">
                    Compras cargadas en NÚCLEO desde la última carga: {miles(s.comprasSoloNucleo)} productos se conservan (el sistema del local no las tiene) y {miles(s.comprasQueElLocalYaTenia)} ya estaban también en el del local (no se cuentan dos veces).
                  </p>
                )}
                {s.mayores.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-tinta/80">
                    <li className="text-tinta/60">Los cambios más grandes:</li>
                    {s.mayores.slice(0, 8).map((m) => (
                      <li key={m.nombre} className="flex gap-2">
                        <span className="min-w-0 flex-1 truncate">{m.nombre}</span>
                        <span className="importe shrink-0">{cant(m.antes)} → <b>{cant(m.objetivo)}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2.5">
                <p className="text-sm text-tinta">
                  <b>Ventas:</b>{' '}
                  {v.renglones === 0 ? 'no hay días completos nuevos para cargar (el día del corte entra con la próxima carga).' : (
                    <>
                      {v.dias === 1 ? `el ${dia(v.desde)}` : `del ${dia(v.desde)} al ${dia(v.hasta)} (${v.dias} días)`} ·{' '}
                      <span className="importe font-semibold">{miles(v.renglones)}</span> productos vendidos · <span className="importe font-semibold">{miles(v.unidades)}</span> unidades
                    </>
                  )}
                </p>
              </div>
              {nadaQueHacer ? (
                <p className="text-sm text-tinta/70">Con estos archivos no hay nada para aplicar.</p>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <p className="mr-auto text-xs text-tinta/60">Se aplica todo junto o nada. Queda registrado quién lo hizo y se puede deshacer.</p>
                  <Boton onClick={() => setConfirmar(true)} disabled={sim.frenos.length > 0}>Aplicar</Boton>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Confirmar
        abierto={confirmar}
        titulo={`¿Poner al día ${local?.sucursal ?? 'el local'}?`}
        textoConfirmar="Sí, aplicar"
        onConfirmar={aplicar}
        onCancelar={() => setConfirmar(false)}
      >
        {s && v && <>Se corrige el stock de {miles(s.ajustes)} productos y se cargan {miles(v.renglones)} renglones de venta{sim?.corte ? `, con el archivo del ${dia(sim.corte)} a las ${hora(sim.corte)}` : ''}.</>}
      </Confirmar>
    </Tarjeta>
  );
}
