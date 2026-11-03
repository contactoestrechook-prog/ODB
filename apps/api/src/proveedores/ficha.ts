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
export const REGIMENES_IIBB = ['local', 'convenio_multilateral', 'exento', 'no_inscripto'] as const;

/**
 * Lo que le falta a la ficha para estar completa, en el orden en que importa:
 * sin CUIT no se cruza la factura, sin WhatsApp no sale el pedido.
 */
export function faltantes(p: {
  cuit?: string | null; telefono?: string | null; direccion?: string | null; condicion_iva?: string | null;
  condicion_pago?: string | null; email?: string | null; lead_time_confirmado?: boolean | null;
  plazo_pago_dias?: number | null; iibb_regimen?: string | null;
}): string[] {
  const f: string[] = [];
  if (!p.cuit) f.push('CUIT');
  if (!p.telefono) f.push('WhatsApp');
  if (!p.direccion) f.push('Dirección');
  if (!p.condicion_iva) f.push('Condición de IVA');
  // al inscripto se le retiene o percibe Ingresos Brutos: hace falta saber cómo está
  if (p.condicion_iva === 'responsable_inscripto' && !p.iibb_regimen) f.push('Ingresos Brutos');
  if (!p.condicion_pago && p.plazo_pago_dias == null) f.push('Condición de pago');
  if (!p.lead_time_confirmado) f.push('Plazo de entrega');
  if (!p.email) f.push('Mail');
  return f;
}

/** Vencimiento de una factura sin vencimiento: la emisión más el plazo de pago del proveedor. */
export function vencimientoPorPlazo(emision: string | null | undefined, plazoDias: number | null | undefined): string | null {
  if (plazoDias == null || !Number.isInteger(plazoDias) || plazoDias < 0) return null;
  const base = emision && /^\d{4}-\d{2}-\d{2}/.test(emision) ? new Date(`${emision.slice(0, 10)}T12:00:00Z`) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + plazoDias);
  return base.toISOString().slice(0, 10);
}

// ---------- ARCA: constancia de inscripción (ws_sr_constancia_inscripcion) ----------

export type DatosArca = {
  razonSocial: string | null;
  estado: string | null;          // ACTIVO, INACTIVO…
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  condicionIva: (typeof CONDICIONES_IVA)[number] | null;
  actividad: string | null;       // la actividad principal (orden 1)
  error: string | null;           // lo que ARCA dice cuando no da la constancia
};

const etiqueta = (xml: string, nombre: string) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`));
  return m ? m[1].trim() : null;
};
const todas = (xml: string, nombre: string) =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, 'g'))].map((m) => m[1]);
const titulo = (s: string | null) => (s ? s.replace(/\s+/g, ' ').trim() : null);

/**
 * Lee la respuesta de getPersona_v2. La condición de IVA sale de los impuestos:
 * 30 es IVA (inscripto), 32 es IVA exento y 20 es el monotributo.
 */
export function leerConstanciaArca(xml: string): DatosArca {
  const generales = etiqueta(xml, 'datosGenerales') ?? '';
  const domicilio = etiqueta(generales, 'domicilioFiscal') ?? '';
  const apellido = etiqueta(generales, 'apellido');
  const nombre = etiqueta(generales, 'nombre');
  const razonSocial = titulo(etiqueta(generales, 'razonSocial') ?? ([apellido, nombre].filter(Boolean).join(' ') || null));
  const impuestos = new Set(todas(xml, 'impuesto').map((i) => Number(etiqueta(i, 'idImpuesto'))));
  const condicionIva = etiqueta(xml, 'datosMonotributo') || impuestos.has(20) ? 'monotributo'
    : impuestos.has(30) ? 'responsable_inscripto'
    : impuestos.has(32) ? 'exento' : null;
  const actividades = todas(xml, 'actividad').map((a) => ({ orden: Number(etiqueta(a, 'orden') ?? 99), texto: etiqueta(a, 'descripcionActividad') }));
  actividades.sort((a, b) => a.orden - b.orden);
  const errores = todas(etiqueta(xml, 'errorConstancia') ?? '', 'error').map((e) => e.trim()).filter(Boolean);
  const provincia = titulo(etiqueta(domicilio, 'descripcionProvincia'));
  return {
    razonSocial,
    estado: etiqueta(generales, 'estadoClave'),
    direccion: titulo(etiqueta(domicilio, 'direccion')),
    localidad: titulo(etiqueta(domicilio, 'localidad')) ?? provincia,
    provincia,
    condicionIva,
    actividad: titulo(actividades[0]?.texto ?? null),
    error: errores.length ? errores.join('. ') : null,
  };
}

// ---------- cuenta corriente ----------

export type Movimiento = { fecha: string; tipo: 'factura' | 'nota_credito' | 'nota_debito' | 'pago'; detalle: string; debe: number; haber: number; saldo: number; facturaId: string };

/**
 * La cuenta corriente con el proveedor: lo que factura suma (debe), las notas
 * de crédito y los pagos restan (haber), con el saldo corrido. Una factura
 * marcada pagada sin el detalle del pago (cargada «ya pagada») lleva un pago
 * por la diferencia en su misma fecha, para que el saldo cierre con la deuda.
 */
export function cuentaCorriente(
  facturas: { id: string; numero: string; tipo: string; letra?: string | null; monto: number; monto_pagado?: number | null; fecha_emision?: string | null; creado_en: string; estado?: string | null }[],
  pagos: { factura_id: string; monto: number; medio?: string | null; creado_en: string }[],
): { movimientos: Movimiento[]; saldo: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const vivas = facturas.filter((f) => f.estado !== 'anulada');
  const tipoDe = new Map(vivas.map((f) => [f.id, f.tipo]));
  const sinSigno: Omit<Movimiento, 'saldo'>[] = [];
  const pagadoDetalle = new Map<string, number>();
  for (const p of pagos) {
    if (!tipoDe.has(p.factura_id)) continue;
    pagadoDetalle.set(p.factura_id, (pagadoDetalle.get(p.factura_id) ?? 0) + Number(p.monto));
  }
  for (const f of vivas) {
    const fecha = (f.fecha_emision ?? f.creado_en).slice(0, 10);
    const nombre = [f.tipo === 'nota_credito' ? 'NC' : f.tipo === 'nota_debito' ? 'ND' : 'Factura', f.letra, f.numero].filter(Boolean).join(' ');
    const monto = Number(f.monto);
    if (f.tipo === 'nota_credito') sinSigno.push({ fecha, tipo: 'nota_credito', detalle: nombre, debe: 0, haber: monto, facturaId: f.id });
    else sinSigno.push({ fecha, tipo: f.tipo === 'nota_debito' ? 'nota_debito' : 'factura', detalle: nombre, debe: monto, haber: 0, facturaId: f.id });
    if (f.tipo === 'nota_credito') continue;
    const falta = Number(f.monto_pagado ?? 0) - (pagadoDetalle.get(f.id) ?? 0);
    if (falta > 0.009) sinSigno.push({ fecha, tipo: 'pago', detalle: `Pago de ${nombre} (sin detalle)`, debe: 0, haber: falta, facturaId: f.id });
  }
  for (const p of pagos) {
    if (!tipoDe.has(p.factura_id) || tipoDe.get(p.factura_id) === 'nota_credito') continue;
    const f = vivas.find((x) => x.id === p.factura_id)!;
    const medio = p.medio ? ` · ${String(p.medio).replace(/_/g, ' ')}` : '';
    sinSigno.push({ fecha: p.creado_en.slice(0, 10), tipo: 'pago', detalle: `Pago de ${f.numero}${medio}`, debe: 0, haber: Number(p.monto), facturaId: p.factura_id });
  }
  // por fecha; el mismo día, primero lo que se debe y después lo que se paga
  sinSigno.sort((a, b) => a.fecha.localeCompare(b.fecha) || (b.debe - a.debe));
  let saldo = 0;
  const movimientos = sinSigno.map((m) => { saldo = r2(saldo + m.debe - m.haber); return { ...m, debe: r2(m.debe), haber: r2(m.haber), saldo }; });
  return { movimientos, saldo };
}

// ---------- cumplimiento de las entregas ----------

/**
 * Cómo cumple el proveedor, con las órdenes de compra recibidas: cuántas
 * llegaron a tiempo (el día pactado o antes), cuántos días tarda de verdad
 * desde que se le manda el pedido y cuántas vinieron con faltantes.
 */
export function cumplimiento(
  ordenes: { creado_en: string; enviada_en?: string | null; recibida_en?: string | null; fecha_entrega?: string | null; entrega_confirmada_para?: string | null; entrega_faltantes?: unknown }[],
): { recibidas: number; conFecha: number; aTiempo: number; diasPromedio: number | null; conFaltantes: number } {
  const recibidas = ordenes.filter((o) => o.recibida_en);
  let conFecha = 0, aTiempo = 0, conFaltantes = 0;
  const dias: number[] = [];
  for (const o of recibidas) {
    const llego = o.recibida_en!.slice(0, 10);
    const pactada = (o.entrega_confirmada_para ?? o.fecha_entrega ?? '').slice(0, 10);
    if (pactada) { conFecha++; if (llego <= pactada) aTiempo++; }
    const desde = new Date(o.enviada_en ?? o.creado_en).getTime();
    const hasta = new Date(o.recibida_en!).getTime();
    if (hasta >= desde) dias.push((hasta - desde) / 86_400_000);
    const f = o.entrega_faltantes;
    if (f && !(Array.isArray(f) && f.length === 0) && String(f).trim() !== '' && String(f).trim() !== '[]') conFaltantes++;
  }
  const diasPromedio = dias.length ? Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10 : null;
  return { recibidas: recibidas.length, conFecha, aTiempo, diasPromedio, conFaltantes };
}
