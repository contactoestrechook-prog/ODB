'use client';

import { useState } from 'react';
import { pesos } from '../lib/formato';
import { cuentaDelPapel, entraDeRenglon, papelDeLectura, unidadesDelPapel, type CampoPapel, type EntraComo, type Papel } from '../lib/tabla-factura';
import { FOCO, ROTULO, unir } from './kit/clases';

// ============================================================
// LA FACTURA COMO TABLA (8/10/2026). Cada renglón con las columnas del papel,
// todo editable, y la cuenta en vivo: verde si da el importe impreso, roja con
// la diferencia si no. La lógica está en lib/tabla-factura.ts; acá solo se
// dibuja y se avisa cada cambio a la pantalla de compras, que es la que guarda
// los renglones y la constancia de quién cambió qué.
// ============================================================

const numero = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const cifra = (v: unknown, d = 2) => {
  const n = numero(v);
  return n == null ? '' : n.toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(n) && d === 0 ? 0 : 0, maximumFractionDigits: d });
};
function leerNumero(s: string): number | null {
  let t = String(s ?? '').trim().replace(/\s|\$|%/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Si el renglón no cierra y es de algo que se pesa, los kilos que explicarían el importe. */
function kilosImplicitos(p: Papel, cierra: boolean, descripcion: unknown): number | null {
  const precio = numero(p.precio);
  const importe = numero(p.importe);
  if (cierra || !precio || !importe || !/\d\s*(kg|kgs|kilo|grs?|gr)\b/i.test(String(descripcion ?? ''))) return null;
  const kg = importe / (precio * (1 - Math.min(100, Math.abs(numero(p.desc) ?? 0)) / 100));
  return kg > 0.05 && Math.abs(kg - Math.round(kg)) > 0.02 ? kg : null;
}

/** Un número editable: se escribe como uno quiera («1.022,60», «1022.6») y se guarda al salir. */
function CeldaNumero({ valor, decimales = 2, etiqueta, ayuda, onCambio, className }: { valor: number | null; decimales?: number; etiqueta: string; ayuda: string; onCambio: (v: number | null) => void; className?: string }) {
  // mientras se escribe manda lo escrito; si no, el valor (que pudo cambiar la IA)
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(false);
  return (
    <label className={unir('block min-w-0', className)}>
      <span className="mb-0.5 block text-xs text-tinta/60 @min-[46rem]:sr-only">{etiqueta}</span>
      <input
        inputMode="decimal"
        aria-label={ayuda}
        value={editando ? texto : cifra(valor, decimales)}
        onFocus={() => { setTexto(cifra(valor, decimales)); setEditando(true); }}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          setEditando(false);
          const v = leerNumero(texto);
          if (v !== valor && !(v == null && valor == null)) onCambio(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={unir(
          'importe h-9 w-full min-w-0 rounded-xl border bg-white px-2 text-right text-sm text-tinta',
          valor == null ? 'border-dashed border-black/15' : 'border-black/15',
          FOCO,
        )}
      />
    </label>
  );
}

// las columnas de los números: en angosto, de a tres con su rótulo; desde 46rem, una sola fila alineada con los rótulos de arriba
const NUMEROS = '@min-[46rem]:grid-cols-[minmax(0,3fr)_minmax(0,2.6fr)_minmax(0,3.2fr)_minmax(0,5fr)_minmax(0,3fr)_minmax(0,4.6fr)_minmax(0,5.4fr)_minmax(0,5.6fr)_minmax(0,4.6fr)]';

// en angosto la segunda línea va en seis columnas (precio, importe y cómo entra, más anchos); desde 46rem cada celda es una columna
const A1 = 'col-span-1 @min-[46rem]:col-span-1';
const A2 = 'col-span-2 @min-[46rem]:col-span-1';
const A3 = 'col-span-3 @min-[46rem]:col-span-1';
const A6 = 'col-span-6 @min-[46rem]:col-span-1';

export type PropsTablaFactura = {
  /** los renglones de la pantalla de compras (itemsCalc), con _esDescuento */
  items: any[];
  /** costo final por unidad de stock (con IVA y percepciones), el mismo que se registra */
  costoFinal: (i: any, idx: number) => number;
  /** a dónde va cada renglón de descuento, en palabras */
  destinoDescuento: (idx: number) => string;
  onCambiarPapel: (idx: number, papel: Papel, entra: EntraComo, campo: string, antes: unknown, despues: unknown) => void;
  onNoAplicar: (idx: number, valor: boolean) => void;
  /** renglones recién cambiados por la IA: se iluminan un momento */
  marcados: number[];
  /** la alícuota con la que se está costeando (impresa, elegida o del catálogo), para el IVA vacío */
  alicuotaDe?: (idx: number) => number | null;
};

export function TablaFactura({ items, costoFinal, destinoDescuento, onCambiarPapel, onNoAplicar, marcados, alicuotaDe }: PropsTablaFactura) {
  // por peso (fiambres, hormas) se maneja en su tarjeta: la cuenta es kilos × precio
  const merc = items.filter((i) => !i._esDescuento && !i.porPeso);
  const noCierran = merc.filter((i) => !cuentaDelPapel(i.papel ?? papelDeLectura(i)).cierra).length;
  const porDecidir = merc.filter((i) => entraDeRenglon(i, i.papel ?? papelDeLectura(i)) === null).length;
  return (
    <section aria-labelledby="t-tabla-factura" className="@container rounded-2xl border border-black/[0.06] bg-white">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-black/[0.06] px-3 py-2.5">
        <h3 id="t-tabla-factura" className="text-sm font-semibold text-tinta">La factura, renglón por renglón</h3>
        <span className="text-xs text-tinta/60">Unidades = bultos × unid. por bulto + sueltas · la cuenta tiene que dar el importe del papel</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {noCierran
            ? <span className="rounded-full bg-marca-suave px-2.5 py-0.5 text-xs font-semibold text-marca-hondo">{noCierran} {noCierran === 1 ? 'renglón no cierra' : 'renglones no cierran'}</span>
            : <span className="rounded-full bg-ok-suave px-2.5 py-0.5 text-xs font-semibold text-ok">Todos los renglones cierran</span>}
          {porDecidir > 0 && <span className="rounded-full bg-atencion-suave px-2.5 py-0.5 text-xs font-semibold text-atencion">{porDecidir} por decidir cómo entran</span>}
        </span>
      </div>
      {/* los rótulos de la segunda línea de cada renglón (los números del papel) */}
      <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3 pt-2 @min-[46rem]:grid">
        <span />
        <div className={unir('grid gap-2', NUMEROS, ROTULO)}>
          <span className="text-right">Bultos</span><span className="text-right">U×B</span><span className="text-right">Sueltas</span>
          <span className="text-right">Precio u.</span><span className="text-right">% desc</span><span>IVA</span><span className="text-right">Importe</span><span>Entra al stock</span><span className="text-right">Costo</span>
        </div>
      </div>
      <ol className="divide-y divide-black/[0.06]">
        {items.map((i, idx) => {
          const marcado = marcados.includes(idx);
          if (i._esDescuento) {
            const destino = destinoDescuento(idx);
            return (
              <li key={idx} className={unir('grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 bg-crema-claro px-3 py-2.5 text-sm', marcado && 'ring-2 ring-inset ring-info')}>
                <span className="importe pt-0.5 text-xs text-tinta/60">{idx + 1}</span>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words font-medium text-tinta">{i.descripcion}</span>
                  <span className="importe text-xs text-marca-hondo">− {pesos(Math.abs(Number(i.importe) || 0))}</span>
                  <span className={unir('rounded-full px-2.5 py-0.5 text-xs font-semibold', i.noAplicar ? 'bg-crema-hondo text-tinta/70' : /sin destino/.test(destino) ? 'bg-atencion-suave text-atencion' : 'bg-ok-suave text-ok')}>
                    {i.noAplicar ? 'sin aplicar' : destino}
                  </span>
                  <button type="button" onClick={() => onNoAplicar(idx, !i.noAplicar)} className={unir('min-h-9 rounded-full text-xs text-tinta/70 underline hover:text-marca-hondo', FOCO)}>
                    {i.noAplicar ? 'Aplicar' : 'No aplicar'}
                  </button>
                </div>
              </li>
            );
          }
          if (i.porPeso) {
            return (
              <li key={idx} className={unir('grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-sm', marcado && 'ring-2 ring-inset ring-info')}>
                <span className="importe pt-0.5 text-xs text-tinta/60">{idx + 1}</span>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words font-medium text-tinta">{i.descripcion}</span>
                  <span className="importe text-xs text-tinta/70">{cifra(i.kg ?? i.cantidad, 3)} kg × {pesos(numero(i.precio) ?? 0)} · {pesos(numero(i.importe) ?? 0)}</span>
                  <span className="rounded-full bg-info-suave px-2.5 py-0.5 text-xs font-semibold text-info">va por peso: se corrige en su tarjeta</span>
                </div>
              </li>
            );
          }
          const papel: Papel = i.papel ?? papelDeLectura(i);
          const entra: EntraComo = entraDeRenglon(i, papel);
          const enBultos = (numero(papel.bultos) ?? 0) > 0;
          const cajasDe = entra?.como === 'cajas' ? entra.de : (numero(papel.uxb) ?? 1);
          const c = cuentaDelPapel(papel);
          const cambiar = (campo: CampoPapel, v: number | null) => onCambiarPapel(idx, { ...papel, [campo]: v }, entra, campo, papel[campo], v);
          const uxb = numero(papel.uxb);
          const unidades = unidadesDelPapel(papel);
          const costo = costoFinal(i, idx);
          // el jamón de 5,5 kg facturado a precio por kilo: importe ÷ precio neto no da entero
          const porKilo = kilosImplicitos(papel, c.cierra, i.descripcion);
          return (
            <li key={idx} className={unir('grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3 py-2.5 text-sm', !c.cierra && 'bg-marca-suave/50', marcado && 'ring-2 ring-inset ring-info')}>
              <span className="importe pt-0.5 text-xs text-tinta/60">{idx + 1}</span>
              <div className="min-w-0 space-y-2">
                {/* primera línea: lo leído y si la cuenta da el importe del papel */}
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="break-words font-medium leading-snug text-tinta">
                      {i.codigo ? <span className="mr-1.5 font-mono text-xs text-tinta/60">{i.codigo}</span> : null}{i.descripcion}
                    </p>
                    <p className={unir('break-words text-xs', i.nombre ? 'text-ok' : 'text-atencion')}>{i.nombre ? `→ ${i.nombre}` : 'Sin vincular al catálogo (abajo)'}</p>
                  </div>
                  <div className="min-w-0 max-w-full text-right">
                    <p className={unir('importe text-sm font-semibold', c.cierra ? 'text-ok' : 'text-marca-hondo')}>{c.cierra ? 'Cierra' : 'No cierra'} · {pesos(c.cuenta)}</p>
                    <p className="break-words text-xs tabular-nums text-tinta/60">
                      {unidades > 0 ? `${cifra(unidades, 3)} × ${pesos(numero(papel.precio) ?? 0)}${numero(papel.desc) ? ` − ${cifra(papel.desc)}%` : ''}` : 'sin unidades'}
                      {!c.cierra && c.dif != null ? ` · difiere ${pesos(Math.abs(c.dif))}` : ''}
                      {porKilo != null ? ` · ¿va por kilo? da ${cifra(porKilo, 2)} kg` : ''}
                    </p>
                  </div>
                </div>
                {/* segunda línea: los números del papel, todos editables */}
                <div className={unir('grid grid-cols-6 items-end gap-2', NUMEROS)}>
                  <CeldaNumero className={A2} etiqueta="Bultos" ayuda={`Bultos del renglón ${idx + 1}`} valor={numero(papel.bultos)} decimales={3} onCambio={(v) => cambiar('bultos', v)} />
                  <CeldaNumero className={A2} etiqueta="U×B" ayuda={`Unidades por bulto del renglón ${idx + 1}`} valor={uxb} decimales={0} onCambio={(v) => cambiar('uxb', v)} />
                  <CeldaNumero className={A2} etiqueta="Sueltas" ayuda={`Unidades sueltas del renglón ${idx + 1}`} valor={numero(papel.sueltas)} decimales={3} onCambio={(v) => cambiar('sueltas', v)} />
                  <CeldaNumero className={A3} etiqueta="Precio u." ayuda={`Precio unitario del renglón ${idx + 1}`} valor={numero(papel.precio)} onCambio={(v) => cambiar('precio', v)} />
                  <CeldaNumero className={A1} etiqueta="% desc" ayuda={`Descuento en % del renglón ${idx + 1}`} valor={numero(papel.desc)} onCambio={(v) => cambiar('desc', v)} />
                  <label className={unir('block min-w-0', A2)}>
                    <span className="mb-0.5 block text-xs text-tinta/60 @min-[46rem]:sr-only">IVA</span>
                    <select
                      aria-label={`IVA del renglón ${idx + 1}`}
                      value={numero(papel.iva) ?? ''}
                      onChange={(e) => cambiar('iva', e.target.value === '' ? null : Number(e.target.value))}
                      className={unir('h-9 w-full min-w-0 rounded-xl border border-black/15 bg-white px-1.5 text-sm text-tinta', FOCO)}
                    >
                      <option value="">{alicuotaDe?.(idx) != null ? `auto ${String(alicuotaDe(idx)).replace('.', ',')}%` : '—'}</option>
                      {[21, 10.5, 27, 0].map((a) => <option key={a} value={a}>{String(a).replace('.', ',')}%</option>)}
                    </select>
                  </label>
                  <CeldaNumero className={A3} etiqueta="Importe" ayuda={`Importe del papel, renglón ${idx + 1}`} valor={numero(papel.importe)} onCambio={(v) => cambiar('importe', v)} />
                  <div className={unir('min-w-0', A3)}>
                    <span className="mb-0.5 block text-xs text-tinta/60 @min-[46rem]:sr-only">Entra al stock</span>
                    {uxb != null && uxb > 1 ? (
                      <select
                        aria-label={`Cómo entra al stock el renglón ${idx + 1}`}
                        value={entra === null ? '' : entra.como}
                        onChange={(e) => {
                          const v = e.target.value;
                          const nuevo: EntraComo = v === 'cajas' ? { como: 'cajas', de: cajasDe } : v === 'abiertas' ? { como: 'abiertas', de: uxb } : { como: 'unidades' };
                          onCambiarPapel(idx, papel, nuevo, 'entraComo', entra?.como ?? null, nuevo?.como ?? null);
                        }}
                        className={unir('h-9 w-full min-w-0 rounded-xl border bg-white px-1.5 text-sm text-tinta', entra === null ? 'border-atencion bg-atencion-suave' : 'border-black/15', FOCO)}
                      >
                        {entra === null && <option value="">¿Cómo entra?</option>}
                        {/* el papel cuenta bultos: la otra salida es la caja; cuenta cajas sueltas: abrirlas */}
                        <option value="unidades">{cifra(unidades, 3)} {enBultos ? 'unid.' : 'tal cual'}</option>
                        {(enBultos || entra?.como === 'cajas') && <option value="cajas">{cifra(unidades / cajasDe, 3)} {unidades / cajasDe === 1 ? 'caja' : 'cajas'} ×{cajasDe}</option>}
                        {(!enBultos || entra?.como === 'abiertas') && <option value="abiertas">{cifra(unidades * uxb, 3)} unid. (abrir ×{uxb})</option>}
                      </select>
                    ) : (
                      <p className="importe flex h-9 items-center text-sm text-tinta">{cifra(i.cantidad, 3)} {numero(i.cantidad) === 1 ? 'unidad' : 'unid.'}</p>
                    )}
                  </div>
                  <div className={unir('min-w-0 text-right', A6)}>
                    <span className="mb-0.5 block text-xs text-tinta/60 @min-[46rem]:sr-only">Costo</span>
                    <p className="importe text-sm font-semibold leading-tight text-tinta">{Number.isFinite(costo) && costo > 0 ? pesos(costo) : '—'}</p>
                    <p className="text-xs leading-tight text-tinta/60">{entra?.como === 'cajas' ? 'la caja' : 'c/u'} c/IVA</p>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
