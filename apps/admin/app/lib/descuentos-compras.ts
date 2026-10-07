// Reparte cada renglón de descuento de una factura de compra sobre la
// mercadería que le corresponde. Vive en el panel porque se recalcula en vivo
// mientras se edita la factura; se prueba en
// apps/api/src/compras/descuentos-compras.spec.ts, porque la API es la que
// tiene los tests.
//
// Cuatro formas, en orden:
//  1) el descuento NOMBRA un renglón de la ventana y la cuenta cierra con él.
//     El nombre se compara también sin espacios: «x100Grs» y «x 100Grs» son el
//     mismo maní (Distri Sur 0007-00044104: la rebaja del maní frito se
//     repartía entre el bicarbonato, la Nutella y el durazno, 2026-10-07).
//  2) REGALO del renglón de arriba: la rebaja es exactamente el importe del
//     renglón de mercadería inmediatamente anterior. Distri Sur imprime así lo
//     que va sin cargo —«Descuento» a secas, debajo del producto—, y si la
//     lectura no repite el nombre, la rebaja terminaba repartida entre todos
//     los renglones de arriba: el regalo quedaba con costo y los demás, más
//     baratos de lo que son.
//  3) descuento de GRUPO (típico de Coca/distribuidores: "Px mágico = 17,2%",
//     "AQ 1.5L = 24,3%"): aplica a TODOS los renglones desde el descuento
//     anterior hasta este y se reparte proporcional al importe de cada uno.
//     Nunca deja un costo en negativo y cierra con el pie por construcción.
//  4) no se puede atribuir → no se aplica y se avisa.

export type RenglonConDescuento = {
  descripcion?: string | null;
  cantidad?: unknown;
  precio?: unknown;
  importe?: unknown;
  esDescuento?: boolean;
  descuentoPct?: unknown;
  /** el operador decidió no aplicar esta rebaja */
  noAplicar?: boolean;
};

export type DestinoDescuento = { renglon: number; motivo: 'nombre' | 'regalo' };

export type Atribucion = {
  /** índice del renglón de mercadería → rebaja que le toca (negativa) */
  porIdx: Map<number, number>;
  /** índice del renglón de descuento → a qué renglón fue y por qué */
  destinos: Map<number, DestinoDescuento>;
  /** índice del renglón de descuento → reparto de grupo */
  grupos: Map<number, { n: number; pct: number | null; importe: number }>;
  sinAtribuir: { descripcion: string; importe: number }[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const esRenglonDescuento = (i: RenglonConDescuento) => !!i.esDescuento || num(i.precio) < 0;

export const soloTexto = (t: unknown) =>
  String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** El texto del descuento contiene el nombre del renglón, con o sin los mismos espacios. */
export function nombraAlRenglon(textoDescuento: unknown, descripcionRenglon: unknown): boolean {
  const nombre = soloTexto(descripcionRenglon);
  if (!nombre) return false;
  const texto = soloTexto(textoDescuento);
  return texto.includes(nombre) || texto.replace(/ /g, '').includes(nombre.replace(/ /g, ''));
}

/** Lo que vale el renglón: el importe impreso o, si no se leyó, cantidad × precio. */
export const importeDelRenglon = (x: RenglonConDescuento) => {
  const cant = num(x.cantidad) || 1;
  return x.importe != null && x.importe !== '' ? Math.abs(num(x.importe)) : Math.abs(num(x.precio) * cant);
};

// Tolerancia de redondeo: el maní se factura a $760,585, el papel imprime
// 760,58 y el importe 1.521,17 — una rebaja del 100% "superaba" a la línea por
// un centavo y quedaba sin atribuir (2026-09-08).
const tolerancia = (linea: number) => Math.max(0.05, linea * 0.001);

export function atribuirDescuentos(items: RenglonConDescuento[]): Atribucion {
  const porIdx = new Map<number, number>();
  const destinos = new Map<number, DestinoDescuento>();
  const grupos = new Map<number, { n: number; pct: number | null; importe: number }>();
  const sinAtribuir: { descripcion: string; importe: number }[] = [];
  let ventanaInicio = 0; // primer índice de mercadería de la ventana en curso

  items.forEach((d, j) => {
    if (!esRenglonDescuento(d)) return;
    const cerrarVentana = () => { ventanaInicio = j + 1; };
    // El operador decidió no aplicar esta rebaja: la mercadería queda a precio
    // de lista y lo pagado de menos se reparte solo en la reconciliación.
    if (d.noAplicar) return cerrarVentana();
    const importe = d.importe != null && d.importe !== '' && num(d.importe) !== 0 ? num(d.importe) : num(d.cantidad) * num(d.precio);
    if (!importe) return cerrarVentana();
    const abs = Math.abs(importe);
    const pct = d.descuentoPct != null && d.descuentoPct !== '' ? num(d.descuentoPct) : null;
    const asignar = (k: number, motivo: DestinoDescuento['motivo']) => {
      porIdx.set(k, (porIdx.get(k) ?? 0) + importe);
      destinos.set(j, { renglon: k, motivo });
      cerrarVentana();
    };

    // 1) NOMBRA un renglón puntual (dentro de la ventana) y cierra con él
    for (let k = j - 1; k >= ventanaInicio; k--) {
      if (esRenglonDescuento(items[k])) continue;
      const linea = importeDelRenglon(items[k]);
      const cierra = linea > 0 && (pct != null ? Math.abs((abs / linea) * 100 - pct) <= 1.5 : abs <= linea + tolerancia(linea));
      if (cierra && nombraAlRenglon(d.descripcion, items[k].descripcion)) return asignar(k, 'nombre');
    }

    // 2) REGALO: es exactamente el renglón de mercadería de arriba
    let arriba = -1;
    for (let k = j - 1; k >= ventanaInicio; k--) {
      if (!esRenglonDescuento(items[k])) { arriba = k; break; }
    }
    if (arriba >= 0) {
      const linea = importeDelRenglon(items[arriba]);
      const todoElRenglon = linea > 0 && Math.abs(abs - linea) <= tolerancia(linea);
      if (todoElRenglon && (pct == null || Math.abs(pct - 100) <= 1.5)) return asignar(arriba, 'regalo');
    }

    // 3) descuento de GRUPO: los renglones de mercadería de la ventana
    const grupo: number[] = [];
    let sumaG = 0;
    for (let k = ventanaInicio; k < j; k++) {
      if (esRenglonDescuento(items[k])) continue;
      const b = importeDelRenglon(items[k]);
      if (b > 0) { grupo.push(k); sumaG += b; }
    }
    // Se acepta si el descuento es una fracción del grupo y —cuando el papel
    // trae el %— ese % cierra con la suma del grupo (tolerancia amplia para no
    // depender de si la IA leyó la columna con o sin IVA).
    const pctCierra = pct == null || Math.abs(sumaG * (pct / 100) - abs) / abs < 0.06;
    if (grupo.length > 0 && sumaG > 0 && abs < sumaG * 0.999 && pctCierra) {
      for (const k of grupo) porIdx.set(k, (porIdx.get(k) ?? 0) + importe * (importeDelRenglon(items[k]) / sumaG));
      grupos.set(j, { n: grupo.length, pct, importe: abs });
      return cerrarVentana();
    }

    // 4) no se pudo atribuir con certeza
    sinAtribuir.push({ descripcion: String(d.descripcion ?? ''), importe: abs });
    cerrarVentana();
  });

  return { porIdx, destinos, grupos, sinAtribuir };
}
