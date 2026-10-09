'use client';

import { useState } from 'react';
import { pesos } from '../lib/formato';
import { cuentaDelPapel, entraDeRenglon, papelDeLectura, unidadesDelPapel, type CampoPapel, type EntraComo, type Papel } from '../lib/tabla-factura';
import { FOCO, unir } from './kit/clases';

// ============================================================
// LA FACTURA EDITABLE (8/10/2026). Lo que dice el papel de cada renglón, todo
// editable, con la cuenta en vivo: verde si da el importe impreso, roja con la
// diferencia si no. Va DENTRO de la tarjeta de cada renglón de la carga por
// foto (Leandro: «sale dos veces la factura, arriba y abajo; completar todo
// una sola vez»). La lógica está en lib/tabla-factura.ts; acá solo se dibuja y
// se avisa cada cambio a la pantalla de compras, que guarda los renglones y la
// constancia de quién cambió qué.
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
      <span className="mb-0.5 block text-xs text-tinta/60">{etiqueta}</span>
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

// Los números del papel dentro de cada tarjeta. En angosto: bultos, U×B y
// sueltas de a tres; precio y % desc; importe y cómo entra. Desde 40rem, todo
// en una fila.
const NUMEROS = '@min-[40rem]:grid-cols-[minmax(0,3fr)_minmax(0,2.6fr)_minmax(0,3.2fr)_minmax(0,5fr)_minmax(0,3fr)_minmax(0,5.4fr)_minmax(0,6.4fr)]';
const A2 = 'col-span-2 @min-[40rem]:col-span-1';
const A3 = 'col-span-3 @min-[40rem]:col-span-1';

const deMercaderia = (items: any[]) => items.filter((i) => !i._esDescuento && !i.porPeso && i.papel);

/** El encabezado de la lista: qué es cada número y cuántos renglones no cierran o falta decidir. */
export function CabeceraFactura({ items }: { items: any[] }) {
  const merc = deMercaderia(items);
  const noCierran = merc.filter((i) => !cuentaDelPapel(i.papel).cierra).length;
  const porDecidir = merc.filter((i) => entraDeRenglon(i, i.papel) === null).length;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2">
      <h3 className="text-sm font-semibold text-tinta">La factura, renglón por renglón</h3>
      <span className="text-xs text-tinta/60">Corregí los números como están en el papel: unidades = bultos × U×B + sueltas, y la cuenta tiene que dar el importe. Abajo de cada renglón, el producto, la remarcación y el precio de venta.</span>
      <span className="flex flex-wrap gap-1.5">
        {noCierran
          ? <span className="rounded-full bg-marca-suave px-2.5 py-0.5 text-xs font-semibold text-marca-hondo">{noCierran} {noCierran === 1 ? 'renglón no cierra' : 'renglones no cierran'}</span>
          : merc.length ? <span className="rounded-full bg-ok-suave px-2.5 py-0.5 text-xs font-semibold text-ok">Todos los renglones cierran</span> : null}
        {porDecidir > 0 && <span className="rounded-full bg-atencion-suave px-2.5 py-0.5 text-xs font-semibold text-atencion">{porDecidir} por decidir cómo entran</span>}
      </span>
    </div>
  );
}

export type PropsPapel = {
  /** el renglón de la pantalla de compras (itemsCalc), con su `papel` */
  i: any;
  idx: number;
  onCambiarPapel: (idx: number, papel: Papel, entra: EntraComo, campo: string, antes: unknown, despues: unknown) => void;
};

/** Lo que dice el papel de un renglón, editable, con la cuenta en vivo y cómo entra al stock. */
export function PapelDelRenglon({ i, idx, onCambiarPapel }: PropsPapel) {
  const papel: Papel = i.papel ?? papelDeLectura(i);
  const entra: EntraComo = entraDeRenglon(i, papel);
  const enBultos = (numero(papel.bultos) ?? 0) > 0;
  const cajasDe = entra?.como === 'cajas' ? entra.de : (numero(papel.uxb) ?? 1);
  const c = cuentaDelPapel(papel);
  const cambiar = (campo: CampoPapel, v: number | null) => onCambiarPapel(idx, { ...papel, [campo]: v }, entra, campo, papel[campo], v);
  const uxb = numero(papel.uxb);
  const unidades = unidadesDelPapel(papel);
  // el jamón de 5,5 kg facturado a precio por kilo: importe ÷ precio neto no da entero
  const porKilo = kilosImplicitos(papel, c.cierra, i.descripcion);
  return (
    <div className={unir('@container space-y-1.5 rounded-xl px-2.5 py-2', c.cierra ? 'bg-crema-claro' : 'bg-marca-suave/60')}>
      <p className="text-xs tabular-nums">
        <b className={c.cierra ? 'text-ok' : 'text-marca-hondo'}>{c.cierra ? 'Cierra' : 'No cierra'} · {pesos(c.cuenta)}</b>
        <span className="text-tinta/60">
          {' '}= {unidades > 0 ? `${cifra(unidades, 3)} × ${pesos(numero(papel.precio) ?? 0)}${numero(papel.desc) ? ` − ${cifra(papel.desc)}%` : ''}` : 'sin unidades'}
          {!c.cierra && c.dif != null ? ` · difiere ${pesos(Math.abs(c.dif))} del importe` : ''}
          {porKilo != null ? ` · ¿va por kilo? da ${cifra(porKilo, 2)} kg` : ''}
        </span>
      </p>
      <div className={unir('grid grid-cols-6 items-end gap-2', NUMEROS)}>
        <CeldaNumero className={A2} etiqueta="Bultos" ayuda={`Bultos del renglón ${idx + 1}`} valor={numero(papel.bultos)} decimales={3} onCambio={(v) => cambiar('bultos', v)} />
        <CeldaNumero className={A2} etiqueta="U×B" ayuda={`Unidades por bulto del renglón ${idx + 1}`} valor={uxb} decimales={0} onCambio={(v) => cambiar('uxb', v)} />
        <CeldaNumero className={A2} etiqueta="Sueltas" ayuda={`Unidades sueltas del renglón ${idx + 1}`} valor={numero(papel.sueltas)} decimales={3} onCambio={(v) => cambiar('sueltas', v)} />
        <CeldaNumero className={A3} etiqueta="Precio u." ayuda={`Precio unitario del renglón ${idx + 1}`} valor={numero(papel.precio)} onCambio={(v) => cambiar('precio', v)} />
        <CeldaNumero className={A3} etiqueta="% desc" ayuda={`Descuento en % del renglón ${idx + 1}`} valor={numero(papel.desc)} onCambio={(v) => cambiar('desc', v)} />
        <CeldaNumero className={A3} etiqueta="Importe" ayuda={`Importe del papel, renglón ${idx + 1}`} valor={numero(papel.importe)} onCambio={(v) => cambiar('importe', v)} />
        <div className={unir('min-w-0', A3)}>
          <span className="mb-0.5 block text-xs text-tinta/60">Entra al stock</span>
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
      </div>
    </div>
  );
}
