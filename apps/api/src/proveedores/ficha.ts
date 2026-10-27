// Reglas de la ficha de proveedor (27/10/2026): qué se acepta en cada campo y
// cuán completa está. Sin base ni Nest, para probarlas sueltas.

/** CUIT: 11 dígitos con el verificador de AFIP. Devuelve los dígitos o null si no es válido. */
export function cuitNormalizado(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(d)) return null;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return null;
  return dv === Number(d[10]) ? d : null;
}

/** 30712345678 → 30-71234567-8 */
export function cuitLegible(d: string | null | undefined): string {
  const s = String(d ?? '').replace(/\D/g, '');
  return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : String(d ?? '');
}

/** CBU: 22 dígitos con los dos verificadores del BCRA. */
export function cbuValido(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length !== 22) return null;
  const verif = (tramo: string, pesos: number[]) => {
    const s = pesos.reduce((acc, p, i) => acc + p * Number(tramo[i]), 0);
    return (10 - (s % 10)) % 10;
  };
  const okBanco = verif(d.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) === Number(d[7]);
  const okCuenta = verif(d.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(d[21]);
  return okBanco && okCuenta ? d : null;
}

/** Alias de CBU: 6 a 20 caracteres, letras, números, punto y guion. */
export function aliasValido(v: unknown): string | null {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z0-9.-]{6,20}$/.test(s) ? s : null;
}

export function emailValido(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

/** Un teléfono cargado a mano: al menos 8 dígitos (con el área). Se guarda como lo escribieron. */
export function telefonoValido(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s.replace(/\D/g, '').length >= 8 ? s : null;
}

export const CONDICIONES_IVA = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'] as const;
export const ROLES_CONTACTO = ['vendedor', 'cobranzas', 'reparto', 'dueno', 'administracion', 'otro'] as const;
export const TIPOS_DOCUMENTO = ['catalogo', 'lista_precios', 'constancia_cuit', 'datos_bancarios', 'contrato', 'otro'] as const;

/**
 * Lo que le falta a la ficha para estar completa, en el orden en que importa:
 * sin CUIT no se cruza la factura, sin WhatsApp no sale el pedido.
 */
export function faltantes(p: {
  cuit?: string | null; telefono?: string | null; direccion?: string | null; condicion_iva?: string | null;
  condicion_pago?: string | null; email?: string | null; lead_time_confirmado?: boolean | null;
}): string[] {
  const f: string[] = [];
  if (!p.cuit) f.push('CUIT');
  if (!p.telefono) f.push('WhatsApp');
  if (!p.direccion) f.push('Dirección');
  if (!p.condicion_iva) f.push('Condición de IVA');
  if (!p.condicion_pago) f.push('Condición de pago');
  if (!p.lead_time_confirmado) f.push('Plazo de entrega');
  if (!p.email) f.push('Mail');
  return f;
}
