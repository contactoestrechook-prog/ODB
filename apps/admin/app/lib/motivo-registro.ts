// ============================================================
// POR QUÉ NO SE PUEDE REGISTRAR (12/11/2026). Juan Pablo cargó la factura de
// Leares y «Registrar entrada + factura» quedó apagado sin decir nada: faltaba
// la sucursal, arriba de todo. Terminó registrándola «para conciliar» y la
// mercadería no entró al stock. Ningún botón apagado sin explicación: al lado
// del botón va lo que falta, en palabras comunes, y cada cosa lleva al lugar
// donde se arregla. El botón se apaga si y solo si esta lista tiene algo.
// Se prueba en apps/api/src/compras/motivo-registro.spec.ts.
// ============================================================

export type Donde = 'proveedor' | 'sucursal' | 'renglon' | 'pie' | 'cuenta' | 'iva' | 'internos' | 'sin-cierre' | 'antes-de-registrar';
export type Falta = { texto: string; donde: Donde | null; renglon?: number };

export type EstadoEntrada = {
  proveedor: boolean;
  sucursal: boolean;
  tildadosConProducto: number;
  /** índices (desde 0) de los renglones tildados que no tienen producto */
  tildadosSinProducto: number[];
  /** índice del primer renglón con cantidad o precio sin leer; null si no hay */
  renglonIncompleto: number | null;
  cuentaNoCierra: boolean;
  /** el control del IVA, solo cuando frena */
  iva: { estado: string; motivo?: string } | null;
  internosSinMarcar: boolean;
  /** renglones que no dan el importe del papel y nadie marcó como revisados */
  renglonesSinCierre: number;
  avisosAntesDeRegistrar: number;
};

export function faltaParaEntrada(e: EstadoEntrada): Falta[] {
  const f: Falta[] = [];
  if (!e.proveedor) f.push({ texto: 'Elegí el proveedor', donde: 'proveedor' });
  if (!e.sucursal) f.push({ texto: 'Elegí la sucursal donde entra la mercadería', donde: 'sucursal' });
  const sinProducto = e.tildadosSinProducto;
  if (sinProducto.length === 1) {
    f.push({ texto: `El renglón ${sinProducto[0] + 1} está tildado y no tiene producto: vinculalo o destildalo`, donde: 'renglon', renglon: sinProducto[0] });
  } else if (sinProducto.length > 1) {
    f.push({ texto: `${sinProducto.length} renglones tildados no tienen producto: vinculalos o destildalos`, donde: 'renglon', renglon: sinProducto[0] });
  } else if (!e.tildadosConProducto) {
    f.push({ texto: 'Tildá al menos un renglón que tenga su producto', donde: null });
  }
  if (e.renglonIncompleto != null) {
    f.push({ texto: `Al renglón ${e.renglonIncompleto + 1} le falta la cantidad o el precio`, donde: 'renglon', renglon: e.renglonIncompleto });
  }
  if (e.cuentaNoCierra) f.push({ texto: 'La cuenta de la factura no cierra', donde: 'cuenta' });
  if (e.iva) {
    if (e.iva.estado === 'no_cierra') f.push({ texto: 'El IVA de los renglones no da el de la factura', donde: 'iva' });
    else if (e.iva.estado === 'falta_pie') f.push({ texto: e.iva.motivo || 'Falta el neto del pie de la factura', donde: 'pie' });
    else if (e.iva.estado === 'alicuota_invalida') f.push({ texto: 'Hay un renglón con una alícuota de IVA que no existe', donde: null });
    else f.push({ texto: 'El IVA no cierra', donde: 'pie' });
  }
  if (e.internosSinMarcar) f.push({ texto: 'Falta marcar qué productos pagan los impuestos internos', donde: 'internos' });
  if (e.renglonesSinCierre === 1) {
    f.push({ texto: 'Un renglón no da el importe del papel: miralo y tildá que lo revisaste', donde: 'sin-cierre' });
  } else if (e.renglonesSinCierre > 1) {
    f.push({ texto: `${e.renglonesSinCierre} renglones no dan el importe del papel: miralos y tildá que los revisaste`, donde: 'sin-cierre' });
  }
  if (e.avisosAntesDeRegistrar === 1) f.push({ texto: 'Mirá el aviso de «Antes de registrar»', donde: 'antes-de-registrar' });
  else if (e.avisosAntesDeRegistrar > 1) f.push({ texto: `Mirá los ${e.avisosAntesDeRegistrar} avisos de «Antes de registrar»`, donde: 'antes-de-registrar' });
  return f;
}

/** registrar solo la factura (para conciliar) o una nota de crédito: no mueve stock */
export function faltaParaConciliar(e: { proveedor: boolean; total: boolean; renglonIncompleto: number | null }): Falta[] {
  const f: Falta[] = [];
  if (!e.proveedor) f.push({ texto: 'Elegí el proveedor', donde: 'proveedor' });
  if (!e.total) f.push({ texto: 'Falta el total de la factura', donde: 'pie' });
  if (e.renglonIncompleto != null) {
    f.push({ texto: `Al renglón ${e.renglonIncompleto + 1} le falta la cantidad o el precio`, donde: 'renglon', renglon: e.renglonIncompleto });
  }
  return f;
}
