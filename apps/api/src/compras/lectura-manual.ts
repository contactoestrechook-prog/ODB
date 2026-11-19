// LA FACTURA CARGADA A MANO (19/11/2026). Leandro: «necesitamos poder hacer una
// carga manual opcional de facturas para cuando no reconoce items».
//
// Había tres caminos y ninguno servía para una factura de mercadería que la IA
// no entiende: «Entrada por foto» depende de la lectura; «Entrada directa» suma
// stock pero no registra la factura ni sus impuestos; y «Cargar comprobante» de
// Administración registra la factura sin mover stock.
//
// La carga a mano es una lectura que NO lee nadie: nace lista, sin renglones,
// y se abre en la misma pantalla de la factura (la cuenta, el IVA, las
// percepciones, el vínculo con los productos, «Registrar entrada + factura»).
// Los renglones los escribe la persona. Puede nacer de cero —con o sin la foto
// o el PDF guardados como original— o de una factura ya leída cuyos renglones
// no sirven: ahí se quedan el proveedor, el número, la fecha, los impuestos y
// el original, y se descartan solo los renglones.
//
// Este archivo es puro (sin base ni red): arma el `resultado` de esa lectura.

export const TIPOS_A_MANO = ['factura_a', 'factura_b', 'factura_c', 'remito'] as const;
const TIPOS_CONOCIDOS = new Set<string>([...TIPOS_A_MANO, 'nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'ticket', 'otro']);

/** Los campos del pie que acepta la pantalla (los mismos que lee el lector). */
const CAMPOS_PIE = ['neto', 'iva', 'percepcionIva', 'percepcionIibb', 'impuestosInternos', 'descuentoGlobal', 'otros', 'total'] as const;

const textoCorto = (v: unknown, max: number): string | null => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

const fechaIso = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/** El tipo que se pide; si no es uno conocido, factura A (la de casi todos los proveedores). */
export function tipoAMano(v: unknown, siNo: string = 'factura_a'): string {
  const t = String(v ?? '').trim().toLowerCase();
  return TIPOS_CONOCIDOS.has(t) ? t : siNo;
}

/** El pie tal como viene de la pantalla: solo números, y los campos que existen. */
export function pieAMano(v: unknown): Record<string, number | null> {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const salida: Record<string, number | null> = {};
  for (const k of CAMPOS_PIE) {
    if (!(k in o)) continue;
    const crudo = o[k];
    if (crudo == null || crudo === '') { salida[k] = null; continue; }
    const n = Number(crudo);
    if (Number.isFinite(n)) salida[k] = Math.round(n * 100) / 100;
  }
  return salida;
}

export type ProveedorAMano = { id: string; razon_social: string; nombre?: string | null; cuit?: string | null } | null;

export type PedidoAMano = {
  /** de una factura ya leída: su resultado tal como está guardado */
  desde?: { id: string; resultado: any } | null;
  proveedor?: ProveedorAMano;
  comprobante?: { tipo?: unknown; numero?: unknown; fecha?: unknown; condicionVenta?: unknown } | null;
  /** el pie como lo tenía la pantalla (con lo que la persona ya corrigió) */
  impuestos?: unknown;
  /** la ruta del original en el bucket, si se subió uno */
  archivoUrl?: string | null;
};

/**
 * El `resultado` de una lectura a mano. Sin renglones y sin dudas: no lo leyó
 * nadie. De una factura ya leída se queda con todo lo que no son renglones.
 */
export function resultadoAMano(p: PedidoAMano) {
  const r = p.desde?.resultado && typeof p.desde.resultado === 'object' ? p.desde.resultado : {};
  const compLeido = r.comprobante && typeof r.comprobante === 'object' ? r.comprobante : {};
  const c = p.comprobante ?? {};
  const tieneCampo = (k: string) => Object.prototype.hasOwnProperty.call(c, k);
  const comprobante = {
    tipo: tipoAMano(tieneCampo('tipo') ? c.tipo : compLeido.tipo),
    numero: textoCorto(tieneCampo('numero') ? c.numero : compLeido.numero, 40),
    fecha: fechaIso(tieneCampo('fecha') ? c.fecha : compLeido.fecha),
    condicionVenta: textoCorto(tieneCampo('condicionVenta') ? c.condicionVenta : compLeido.condicionVenta, 60),
    facturaAsociada: textoCorto(compLeido.facturaAsociada, 40) ?? '',
  };
  const impuestos = p.impuestos !== undefined ? pieAMano(p.impuestos) : pieAMano(r.impuestos);
  const prov = p.proveedor
    ? { id: p.proveedor.id, razon_social: p.proveedor.razon_social, nombre: p.proveedor.nombre ?? p.proveedor.razon_social, cuit: p.proveedor.cuit ?? null, metodo: 'a_mano' }
    : null;
  const leidos = Array.isArray(r.items) ? r.items.length : 0;
  return {
    aMano: {
      // de qué lectura salió, y cuántos renglones de la IA se dejaron de lado
      desde: p.desde?.id ?? null,
      renglonesDeLaIa: p.desde ? leidos : null,
      en: new Date().toISOString(),
    },
    comprobante,
    proveedor: {
      // el que eligió la persona manda sobre el que reconoció la lectura
      match: prov ?? (r.proveedor?.match ?? null),
      detectado: r.proveedor?.detectado ?? { cuit: null, nombre: null },
    },
    impuestos,
    items: [] as unknown[],
    dudas: [] as unknown[],
    archivoUrl: p.archivoUrl ?? r.archivoUrl ?? null,
    // lo que la lectura sabía del papel y no son renglones
    ...(r.qrArca ? { qrArca: r.qrArca } : {}),
    ...(r.ncPara ? { ncPara: r.ncPara } : {}),
    ...(r.regimenEspecial ? { regimenEspecial: r.regimenEspecial } : {}),
    ...(textoCorto(r.notasManuscritas, 2000) ? { notasManuscritas: textoCorto(r.notasManuscritas, 2000) } : {}),
  };
}

/** Cómo se llama en la bandeja. */
export function nombreAMano(nombreOriginal?: string | null): string {
  const base = String(nombreOriginal ?? '').replace(/^A mano · /, '').trim();
  return base ? `A mano · ${base}`.slice(0, 200) : 'Factura cargada a mano';
}
