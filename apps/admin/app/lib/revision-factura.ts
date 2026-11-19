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
//
// 19/11/2026, Distri-Sur 00007-00060714 (Ana, 47 minutos y 17 mensajes sin poder
// registrar): dos preguntas eran mentira.
//   · «Entra partido» miraba cada renglón y el stock recibe cada PRODUCTO: los
//     Ferrero T8 de regalo (0,75 caja) y los pagos (5,25) son 6 cajas enteras,
//     que es lo que la pantalla manda al registrar (fusionarPorSku, costo
//     promediado, igual que Odoo y ERPNext con las unidades sin cargo). Ahora la
//     cantidad partida se mira sumando los renglones del mismo producto.
//   · La marca: 172 «está bien» en 59 facturas. Ahora pregunta con `otraMarca`
//     (lib/marca.ts), que entiende abreviaturas, plurales y siglas.
import { marcaDistinta } from './marca';

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
  /** en cuántos comprobantes de este proveedor ya se registró este texto del papel con este mismo producto */
  vecesRegistradoAsi?: number | null;
  /** el código del producto vinculado: los renglones del mismo producto entran juntos al stock */
  sku?: string | null;
};

export type Alerta = { clave: string; renglon: number; tipo: 'cantidad' | 'marca' | 'costo' | 'precio'; texto: string };

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pct = (a: number, b: number) => { const v = Math.round((a / b - 1) * 100); return `${v > 0 ? '+' : ''}${v} %`; };
const cant = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });

/**
 * YA SE REGISTRÓ ASÍ (17/11/2026). La pregunta de la marca no se repite cuando
 * este proveedor ya registró este mismo texto del papel con este mismo producto
 * en dos comprobantes o más: una persona ya lo miró dos veces. En La Serenísima
 * («LECHE LS ULTRA…» vinculada a «Leche La Serenísima…») eran 16 «está bien»
 * en dos facturas. El vínculo nuevo, o el que se cambió recién, se sigue
 * preguntando; el costo, el precio y la cantidad partida, siempre.
 */
export const YA_REGISTRADO_ASI = 2;

/** Costo: más del doble o menos de la mitad del que tenía. Precio de venta: más de 50 % arriba o un tercio abajo. */
export const LIMITES = { costoArriba: 2, costoAbajo: 0.5, precioArriba: 1.5, precioAbajo: 0.67 };

/** «17 y 19», «3, 5 y 8» */
const lista = (ns: number[]) => ns.length === 1 ? String(ns[0]) : `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`;

export function revisarAntesDeRegistrar(renglones: RenglonARevisar[]): Alerta[] {
  const alertas: Alerta[] = [];
  // lo que entra de cada producto, sumando sus renglones (el regalo y lo pago son una sola entrada)
  const delProducto = new Map<string, { cantidad: number; renglones: number[]; partes: number[] }>();
  for (const r of renglones) {
    if (!r.entra || !r.producto || r.porPeso || !(r.cantidad > 0)) continue;
    const k = r.sku || r.producto;
    const g = delProducto.get(k) ?? { cantidad: 0, renglones: [], partes: [] };
    g.cantidad += r.cantidad;
    g.renglones.push(r.renglon);
    g.partes.push(r.cantidad);
    delProducto.set(k, g);
  }
  for (const r of renglones) {
    if (!r.entra || !r.producto) continue;
    const a = (tipo: Alerta['tipo'], texto: string) => alertas.push({ clave: `${tipo}-${r.renglon}`, renglon: r.renglon, tipo, texto });
    // una unidad no entra partida: 0,333 paquetes, 7,5 cajas. Se mira el producto entero, en su primer renglón.
    const g = delProducto.get(r.sku || r.producto);
    if (!r.porPeso && g && g.renglones[0] === r.renglon && Math.abs(g.cantidad - Math.round(g.cantidad)) > 0.001) {
      a('cantidad', g.renglones.length === 1
        ? `Renglón ${r.renglon}: entran ${cant(g.cantidad)} de «${r.producto}». Algo que se vende por unidad no entra partido: revisá cómo entra (unidades, cajas, paquetes).`
        : `Renglones ${lista(g.renglones)}: entran ${g.partes.map(cant).join(' + ')} = ${cant(g.cantidad)} de «${r.producto}». Algo que se vende por unidad no entra partido: revisá cómo entra (unidades, cajas, paquetes).`);
    }
    // otra marca
    const dice = marcaDistinta(r.descripcion, r.producto);
    if (dice && (Number(r.vecesRegistradoAsi) || 0) < YA_REGISTRADO_ASI) {
      a('marca', `Renglón ${r.renglon}: el papel dice «${dice}» y el producto vinculado es «${r.producto}». ¿Es el mismo producto?`);
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
