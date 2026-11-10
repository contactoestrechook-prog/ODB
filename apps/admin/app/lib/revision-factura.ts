// ============================================================
// ANTES DE REGISTRAR (10/11/2026). Leandro: «¿podremos solucionar esto para
// que el sistema pueda resolver estas cosas sin pasar por acá?». Lo que el
// 9/11 pasó sin que nadie lo viera:
//   · 18 Jorgito entraron como Cachafaz (otra marca);
//   · el precio de Terrabusi bajó de $10.800 a $4.500 (el de otro producto);
//   · la Rhodesia iba a entrar como 0,333 paquetes.
// Cada renglón que entra al stock pasa por estas preguntas; lo que no da, frena
// el registro con una línea que dice qué mirar, hasta que una persona diga
// «está bien» (queda en la constancia). Se prueba en
// apps/api/src/compras/revision-factura.spec.ts.
// ============================================================
import { marcaDelRenglon, mismaMarca } from './marca';

export type RenglonARevisar = {
  renglon: number;
  descripcion: string;
  /** el producto vinculado; null si no tiene */
  producto: string | null;
  /** entra al stock */
  entra: boolean;
  cantidad: number;
  porPeso?: boolean;
  /** costo por unidad de stock que va a quedar, y el que tenía el catálogo */
  costoNuevo?: number | null;
  costoCatalogo?: number | null;
  /** precio de venta que va a quedar, y el de hoy */
  precioNuevo?: number | null;
  precioActual?: number | null;
};

export type Alerta = { clave: string; renglon: number; tipo: 'cantidad' | 'marca' | 'costo' | 'precio'; texto: string };

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pct = (a: number, b: number) => { const v = Math.round((a / b - 1) * 100); return `${v > 0 ? '+' : ''}${v} %`; };
const cant = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });

/** Costo: más del doble o menos de la mitad del que tenía. Precio de venta: más de 50 % arriba o un tercio abajo. */
export const LIMITES = { costoArriba: 2, costoAbajo: 0.5, precioArriba: 1.5, precioAbajo: 0.67 };

export function revisarAntesDeRegistrar(renglones: RenglonARevisar[]): Alerta[] {
  const alertas: Alerta[] = [];
  for (const r of renglones) {
    if (!r.entra || !r.producto) continue;
    const a = (tipo: Alerta['tipo'], texto: string) => alertas.push({ clave: `${tipo}-${r.renglon}`, renglon: r.renglon, tipo, texto });
    // una unidad no entra partida: 0,333 paquetes, 7,5 cajas
    if (!r.porPeso && r.cantidad > 0 && Math.abs(r.cantidad - Math.round(r.cantidad)) > 0.001) {
      a('cantidad', `Renglón ${r.renglon}: entran ${cant(r.cantidad)} de «${r.producto}». Algo que se vende por unidad no entra partido: revisá cómo entra (unidades, cajas, paquetes).`);
    }
    // otra marca
    const marca = marcaDelRenglon(r.descripcion);
    if (marca && !mismaMarca(r.descripcion, r.producto)) {
      a('marca', `Renglón ${r.renglon}: el papel dice «${marca}» y el producto vinculado es «${r.producto}». ¿Es el mismo producto?`);
    }
    // el costo, muy lejos del que tenía
    const cn = Number(r.costoNuevo ?? 0), cc = Number(r.costoCatalogo ?? 0);
    if (cn > 0 && cc > 0 && (cn > cc * LIMITES.costoArriba || cn < cc * LIMITES.costoAbajo)) {
      a('costo', `Renglón ${r.renglon}: el costo de «${r.producto}» pasa de ${pesos(cc)} a ${pesos(cn)} (${pct(cn, cc)}).`);
    }
    // el precio de venta, muy lejos del de hoy
    const pn = Number(r.precioNuevo ?? 0), pa = Number(r.precioActual ?? 0);
    if (pn > 0 && pa > 0 && (pn > pa * LIMITES.precioArriba || pn < pa * LIMITES.precioAbajo)) {
      a('precio', `Renglón ${r.renglon}: el precio de venta de «${r.producto}» pasaría de ${pesos(pa)} a ${pesos(pn)} (${pct(pn, pa)}).`);
    }
  }
  return alertas;
}
