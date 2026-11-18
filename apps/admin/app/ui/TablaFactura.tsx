'use client';

import { useState } from 'react';
import { pesos } from '../lib/formato';
import { cuentaDelPapel, entraDeRenglon, papelDeLectura, unidadesDelPapel, vistaDelPapel, type CampoPapel, type EntraComo, type Papel } from '../lib/tabla-factura';
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

// un renglón juntado en otro (18/11/2026) ya no cuenta: ni cierra ni deja de cerrar
const deMercaderia = (items: any[]) => items.filter((i) => !i._esDescuento && !i.porPeso && !i.juntadoEn && i.papel);

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
  /**
   * Un dato del papel, como lo ve la persona (18/11/2026). Lo aplica la pantalla
   * de compras con lib/tabla-factura → cambiarDatoDelPapel: con el precio por
   * bulto, «bultos» son los bultos del papel.
   */
  onCambiarDato: (idx: number, campo: CampoPapel | 'precioPor', antes: unknown, despues: unknown) => void;
};

/** Lo que dice el papel de un renglón, editable, con la cuenta en vivo y cómo entra al stock. */
export function PapelDelRenglon({ i, idx, onCambiarPapel, onCambiarDato }: PropsPapel) {
  const papel: Papel = i.papel ?? papelDeLectura(i);
  const entra: EntraComo = entraDeRenglon(i, papel);
  // LA UNIDAD DEL RENGLÓN (18/11/2026, Leandro: «toma los bultos como suelto, y no
  // se lo puede explicar»). Se muestra como lo dice el papel: si el precio impreso
  // es el del bulto, los bultos van en «Bultos» y el precio dice «bulto». Antes se
  // veía cómo lo guarda la cuenta por dentro: «Bultos 0 · Sueltas 5» para 5 cajas.
  const vista = vistaDelPapel(i, papel);
  const porBulto = vista.precioPor === 'bulto';
  const enBultos = (numero(papel.bultos) ?? 0) > 0;
  const cajasDe = entra?.como === 'cajas' ? entra.de : (numero(papel.uxb) ?? 1);
  const c = cuentaDelPapel(papel);
  const cambiar = (campo: CampoPapel, v: number | null) => onCambiarDato(idx, campo, vista[campo], v);
  const uxb = numero(papel.uxb);
  const precioNeto = Math.round((numero(papel.precio) ?? 0) * (1 - Math.min(100, Math.abs(numero(papel.desc) ?? 0)) / 100) * 100) / 100;
  const bultosVista = numero(vista.bultos) ?? 0;
  const unidades = unidadesDelPapel(papel);
  // llegó una parte (la nota a mano «ingresaron 3 bultos»): al stock entran las
  // que llegaron, y eso es lo que se muestra; el papel de al lado no cambia
  const llegaron = numero(i.recibidoAMano);
  const entran = llegaron != null && llegaron > 0 && llegaron < unidades ? llegaron : unidades;
  const parte = entran < unidades ? ` de ${cifra(unidades, 3)}` : '';
  // el jamón de 5,5 kg facturado a precio por kilo: importe ÷ precio neto no da entero
  const porKilo = kilosImplicitos(papel, c.cierra, i.descripcion);
  return (
    <div className={unir('@container space-y-1.5 rounded-xl px-2.5 py-2', c.cierra ? 'bg-crema-claro' : 'bg-marca-suave/60')}>
      <p className="text-xs tabular-nums">
        <b className={c.cierra ? 'text-ok' : 'text-marca-hondo'}>{c.cierra ? 'Cierra' : 'No cierra'} · {pesos(c.cuenta)}</b>
        <span className="text-tinta/60">
          {/* con la oferta a la vista: «− 10% (queda $1.698,30 c/u)», para que no parezca que no se tomó (5/11/2026) */}
          {' '}= {unidades <= 0 ? 'sin unidades'
            // con precio por bulto: «5 bultos × $355.041 − 61,5% (queda $136.691 el bulto · $22.782 c/u)»
            : porBulto && uxb ? `${cifra(bultosVista, 3)} ${bultosVista === 1 ? 'bulto' : 'bultos'} × ${pesos(numero(papel.precio) ?? 0)}${numero(papel.desc) ? ` − ${cifra(papel.desc)}% (queda ${pesos(precioNeto)} el bulto · ${pesos(Math.round((precioNeto / uxb) * 100) / 100)} c/u)` : ` (${pesos(Math.round((precioNeto / uxb) * 100) / 100)} c/u)`}`
            : `${cifra(unidades, 3)} × ${pesos(numero(papel.precio) ?? 0)}${numero(papel.desc) ? ` − ${cifra(papel.desc)}% (queda ${pesos(precioNeto)} c/u)` : ''}`}
          {!c.cierra && c.dif != null ? ` · difiere ${pesos(Math.abs(c.dif))} del importe` : ''}
          {porKilo != null ? ` · ¿va por kilo? da ${cifra(porKilo, 2)} kg` : ''}
        </span>
      </p>
      <div className={unir('grid grid-cols-6 items-end gap-2', NUMEROS)}>
        <CeldaNumero className={A2} etiqueta="Bultos" ayuda={`Bultos del renglón ${idx + 1}`} valor={numero(vista.bultos)} decimales={3} onCambio={(v) => cambiar('bultos', v)} />
        <CeldaNumero className={A2} etiqueta="U×B" ayuda={`Unidades por bulto del renglón ${idx + 1}`} valor={uxb} decimales={0} onCambio={(v) => cambiar('uxb', v)} />
        <CeldaNumero className={A2} etiqueta="Sueltas" ayuda={`Unidades sueltas del renglón ${idx + 1}`} valor={numero(vista.sueltas)} decimales={3} onCambio={(v) => cambiar('sueltas', v)} />
        <CeldaNumero className={A3} etiqueta={porBulto ? 'Precio bulto' : 'Precio u.'} ayuda={porBulto ? `Precio de cada bulto del renglón ${idx + 1}` : `Precio unitario del renglón ${idx + 1}`} valor={numero(papel.precio)} onCambio={(v) => cambiar('precio', v)} />
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
              <option value="unidades">{cifra(entran, 3)}{parte} {porBulto ? `${entran === 1 ? 'bulto' : 'bultos'} tal cual` : enBultos ? 'unid.' : 'tal cual'}</option>
              {(enBultos || entra?.como === 'cajas') && <option value="cajas">{cifra(entran / cajasDe, 3)} {entran / cajasDe === 1 ? 'caja' : 'cajas'} ×{cajasDe}</option>}
              {(!enBultos || entra?.como === 'abiertas') && <option value="abiertas">{cifra(entran * uxb, 3)} unid. (abrir ×{uxb})</option>}
            </select>
          ) : (
            <p className="importe flex h-9 items-center text-sm text-tinta">{cifra(entran < unidades ? entran : i.cantidad, 3)}{parte} {numero(i.cantidad) === 1 ? 'unidad' : 'unid.'}</p>
          )}
        </div>
      </div>
      {uxb != null && uxb > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-tinta/70" role="group" aria-label={`De qué es el precio impreso del renglón ${idx + 1}`}>
          <span>El precio impreso es de:</span>
          {(['unidad', 'bulto'] as const).map((op) => (
            <button
              key={op} type="button" aria-pressed={vista.precioPor === op}
              onClick={() => { if (vista.precioPor !== op) onCambiarDato(idx, 'precioPor', vista.precioPor, op); }}
              className={unir('min-h-7 rounded-full border px-2.5 font-medium', vista.precioPor === op ? 'border-tinta bg-tinta text-white' : 'border-black/15 bg-white text-tinta/70 hover:bg-crema-claro', FOCO)}
            >
              {op === 'unidad' ? 'cada unidad' : `cada bulto de ${cifra(uxb, 0)}`}
            </button>
          ))}
          {porBulto && <span>· son {cifra(bultosVista, 3)} {bultosVista === 1 ? 'bulto' : 'bultos'}: {cifra(bultosVista * uxb, 3)} unidades</span>}
        </div>
      )}
    </div>
  );
}

// ============================================================
// EL RESUMEN DE LA ENTRADA (18/11/2026). Juan Pablo (dueño de ODB), con una
// factura de vinos abierta: «acá creé un producto nuevo, o sea el que está en
// verde, pero arriba me sigue apareciendo con el nombre de la etiqueta. ¿Cuál va
// a utilizar? Esto es lo que nos va a solucionar lo que yo te pido de resumen de
// entrada». En cada renglón se ve primero lo que dice el papel; con qué nombre y
// en qué cantidad entra al sistema había que deducirlo renglón por renglón.
//
// Va al final de la lista, antes de registrar: lo que va a entrar al stock,
// producto por producto, con el nombre del SISTEMA, la cantidad ya en unidades de
// stock y de qué renglones del papel sale; y aparte lo que no entra y por qué. Es
// exactamente lo que se manda al registrar (los mismos datos), no otra cuenta.
// ============================================================

export type ProductoQueEntra = { sku: string; nombre: string; cantidad: number; costo: number | null; renglones: number[]; porPeso?: boolean; sinCargo?: number };
export type RenglonQueNoEntra = { renglon: number; descripcion: string; porque: string };

export function ResumenEntrada({ entran, noEntran }: { entran: ProductoQueEntra[]; noEntran: RenglonQueNoEntra[] }) {
  if (!entran.length && !noEntran.length) return null;
  const unidades = entran.filter((p) => !p.porPeso).reduce((s, p) => s + p.cantidad, 0);
  const kilos = entran.filter((p) => p.porPeso).reduce((s, p) => s + p.cantidad, 0);
  return (
    <section aria-label="Resumen de la entrada" className="rounded-2xl border border-black/[0.06] bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-semibold text-tinta">Resumen de la entrada</h3>
        <span className="text-xs text-tinta/60">
          Lo que va a entrar al stock al registrar, con el nombre de cada producto en el sistema
          {entran.length ? ` · ${entran.length} ${entran.length === 1 ? 'producto' : 'productos'}${unidades ? ` · ${cifra(unidades, 3)} unidades` : ''}${kilos ? ` · ${cifra(kilos, 3)} kg` : ''}` : ''}
        </span>
      </div>
      {entran.length > 0 && (
        <ul className="mt-1.5 divide-y divide-black/[0.06]">
          {entran.map((p) => (
            <li key={p.sku} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 basis-56 break-words text-tinta">{p.nombre}</span>
              <span className="text-xs text-tinta/60">{p.renglones.length === 1 ? `renglón ${p.renglones[0]}` : `renglones ${p.renglones.join(', ')}`}{p.sinCargo ? ` · ${cifra(p.sinCargo, 3)} sin cargo` : ''}</span>
              {p.costo != null && <span className="importe text-xs text-tinta/60">{pesos(p.costo)} c/u con IVA</span>}
              <span className="importe w-24 text-right font-semibold text-tinta">{cifra(p.cantidad, 3)} {p.porPeso ? 'kg' : p.cantidad === 1 ? 'unidad' : 'unid.'}</span>
            </li>
          ))}
        </ul>
      )}
      {noEntran.length > 0 && (
        <div className="mt-2 rounded-xl bg-atencion-suave px-2.5 py-1.5 text-xs text-atencion">
          <p className="font-semibold">No {noEntran.length === 1 ? 'entra' : 'entran'} al stock:</p>
          <ul className="space-y-0.5">
            {noEntran.map((r) => <li key={r.renglon}>Renglón {r.renglon} · {r.descripcion}: {r.porque}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
