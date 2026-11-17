// Tablero de Facturación (17/11/2026, Leandro: «hay que hacer una pantalla
// digna»). La pantalla vieja sumaba solo la tabla `comprobantes` (lo emitido
// desde NÚCLEO: 2 en toda la historia) y mostraba todo en $0. Lo que ODB
// factura de verdad sale todavía del sistema anterior (el Crack), y lo que se
// le factura a clientes con ficha ya está cargado en `compras_cliente_historico`
// (un renglón por producto de cada ticket). Acá se arman los comprobantes de
// las dos fuentes con la misma forma y se resume el mes.
//
// Cálculos PUROS (sin base ni red), probados en tablero.spec.ts.

export type Sucursal = 'st' | 'si';
export type Clase = 'factura' | 'nc' | 'nd' | 'remito' | 'recibo' | 'interno';

export type RenglonCrack = {
  cliente_id: string;
  fecha: string; // YYYY-MM-DD
  sucursal: string;
  ticket: string; // «FAC - A3-00000055», «NCR - R6-212»
  cantidad: number | string;
  precio_unitario: number | string;
  medio_pago: string | null;
};

export type ComprobanteNucleo = {
  id: string;
  tipo: string; // FA, FB, NCA, REM, REC…
  punto_venta: number;
  numero: number | string;
  emitido_en: string;
  total: number | string;
  estado?: string | null;
  condicion_pago?: string | null;
  cliente_id?: string | null;
  receptor?: { nombre?: string } | null;
  cae?: string | null;
};

export type Comprobante = {
  id: string;
  origen: 'crack' | 'nucleo';
  fecha: string; // YYYY-MM-DD (hora de Buenos Aires)
  sucursal: Sucursal | null;
  clase: Clase;
  letra: string | null;
  tipo: string; // «Factura A», «Nota de crédito R»
  numero: string;
  clienteId: string | null;
  receptor: string | null; // nombre suelto cuando no hay ficha (NÚCLEO)
  medio: string;
  total: number; // con signo: las notas de crédito restan
  renglones: number;
  anulado: boolean;
  cae?: string | null;
};

const CLASE_CRACK: Record<string, Clase> = { FAC: 'factura', NCR: 'nc', NDE: 'nd', REM: 'remito', REC: 'recibo' };
const NOMBRE_CLASE: Record<Clase, string> = {
  factura: 'Factura',
  nc: 'Nota de crédito',
  nd: 'Nota de débito',
  remito: 'Remito',
  recibo: 'Recibo',
  interno: 'Comprobante interno',
};

// «CTA. CTE.» → «Cuenta corriente»: el Crack escribe los medios en mayúsculas
export function medioLegible(m: string | null | undefined): string {
  const t = String(m ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return 'Sin dato';
  if (t.startsWith('CTA')) return 'Cuenta corriente';
  if (t.startsWith('TARJ')) return 'Tarjeta';
  if (t.startsWith('CONTADO') || t.startsWith('EFECT')) return 'Contado';
  if (t.startsWith('MERCADO')) return 'Mercado Pago';
  if (t.startsWith('TRANSF')) return 'Transferencia';
  if (t.startsWith('COMBIN')) return 'Combinada';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

// «FAC - A3-00000055» → factura, letra A, número «A3-00000055»
export function leerTicket(ticket: string): { clase: Clase; letra: string | null; numero: string } {
  const [pre, ...resto] = String(ticket ?? '').split(' - ');
  const numero = resto.join(' - ').trim() || String(ticket ?? '').trim();
  const clase = CLASE_CRACK[pre.trim().toUpperCase()] ?? 'interno';
  const letra = /^[A-Z]/.test(numero) ? numero.charAt(0) : null;
  return { clase, letra, numero };
}

export const tipoLegible = (clase: Clase, letra: string | null) => `${NOMBRE_CLASE[clase]}${letra ? ` ${letra}` : ''}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

// Los renglones del Crack se juntan en su ticket: sucursal + número + día + cliente.
export function ticketsDelCrack(renglones: RenglonCrack[]): Comprobante[] {
  const porTicket = new Map<string, Comprobante>();
  for (const r of renglones ?? []) {
    const suc: Sucursal | null = r.sucursal === 'st' || r.sucursal === 'si' ? r.sucursal : null;
    const clave = `${r.sucursal}|${r.ticket}|${r.fecha}|${r.cliente_id}`;
    let c = porTicket.get(clave);
    if (!c) {
      const { clase, letra, numero } = leerTicket(r.ticket);
      c = {
        id: `crack|${clave}`,
        origen: 'crack',
        fecha: String(r.fecha).slice(0, 10),
        sucursal: suc,
        clase,
        letra,
        tipo: tipoLegible(clase, letra),
        numero,
        clienteId: r.cliente_id ?? null,
        receptor: null,
        medio: medioLegible(r.medio_pago),
        total: 0,
        renglones: 0,
        anulado: false,
      };
      porTicket.set(clave, c);
    }
    c.total += Number(r.cantidad ?? 0) * Number(r.precio_unitario ?? 0);
    c.renglones += 1;
  }
  return [...porTicket.values()].map((c) => {
    const total = r2(c.total);
    // una nota de crédito resta aunque el archivo traiga el renglón en positivo
    return { ...c, total: c.clase === 'nc' ? -Math.abs(total) : total };
  });
}

const CLASE_NUCLEO = (tipo: string): Clase => {
  if (/^F[ABC]$/.test(tipo)) return 'factura';
  if (/^NC[ABC]$/.test(tipo)) return 'nc';
  if (/^ND[ABC]$/.test(tipo)) return 'nd';
  if (tipo === 'REM') return 'remito';
  if (tipo === 'REC' || tipo === 'ANT') return 'recibo';
  return 'interno';
};

// Fecha del día en Buenos Aires (el corte del día es a la medianoche de acá, no de UTC)
export function diaBA(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

export function comprobantesDeNucleo(filas: ComprobanteNucleo[], sucursalDePv: Record<number, Sucursal>): Comprobante[] {
  return (filas ?? []).map((c) => {
    const clase = CLASE_NUCLEO(String(c.tipo));
    const letra = /^(F|NC|ND)([ABC])$/.exec(String(c.tipo))?.[2] ?? null;
    const total = r2(Number(c.total ?? 0));
    return {
      id: c.id,
      origen: 'nucleo' as const,
      fecha: diaBA(c.emitido_en),
      sucursal: sucursalDePv[Number(c.punto_venta)] ?? null,
      clase,
      letra,
      tipo: c.tipo === 'ANT' ? 'Anticipo' : tipoLegible(clase, letra),
      numero: `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`,
      clienteId: c.cliente_id ?? null,
      receptor: c.receptor?.nombre ?? null,
      medio: c.condicion_pago === 'cta_cte' ? 'Cuenta corriente' : 'Contado',
      total: clase === 'nc' ? -Math.abs(total) : total,
      renglones: 0,
      anulado: c.estado === 'anulado',
      cae: c.cae ?? null,
    };
  });
}

// Qué suma a lo facturado: facturas y notas de débito suman, notas de crédito
// restan. Remitos, recibos e internos no son venta facturada; los anulados no cuentan.
export const cuentaComoFacturado = (c: Comprobante) => !c.anulado && (c.clase === 'factura' || c.clase === 'nd' || c.clase === 'nc');

export type Partida = { clave: string; etiqueta: string; total: number; comprobantes: number };

function partidas(lista: Comprobante[], clave: (c: Comprobante) => string, etiqueta: (k: string) => string = (k) => k): Partida[] {
  const m = new Map<string, Partida>();
  for (const c of lista) {
    const k = clave(c);
    const p = m.get(k) ?? { clave: k, etiqueta: etiqueta(k), total: 0, comprobantes: 0 };
    p.total += c.total;
    p.comprobantes += 1;
    m.set(k, p);
  }
  return [...m.values()].map((p) => ({ ...p, total: Math.round(p.total) })).sort((a, b) => b.total - a.total);
}

// Que las partes redondeadas sumen el total redondeado a la vista
// (regla de números claros): el resto va a la parte más grande.
export function cuadrar(partes: Partida[], total: number): Partida[] {
  if (!partes.length) return partes;
  const suma = partes.reduce((s, p) => s + p.total, 0);
  const dif = Math.round(total) - suma;
  if (!dif) return partes;
  const copia = partes.map((p) => ({ ...p }));
  const mayor = copia.reduce((a, b) => (Math.abs(b.total) > Math.abs(a.total) ? b : a));
  mayor.total += dif;
  return copia;
}

export type Cifras = {
  facturado: number; // facturas + notas de débito
  notasCredito: number; // en positivo: cuánto se descontó
  neto: number; // facturado − notas de crédito
  facturas: number; // cantidad de facturas y notas de débito
  notas: number; // cantidad de notas de crédito
  clientes: number;
  ticketPromedio: number;
};

export function cifras(lista: Comprobante[]): Cifras {
  const validos = lista.filter(cuentaComoFacturado);
  const positivos = validos.filter((c) => c.clase !== 'nc');
  const notas = validos.filter((c) => c.clase === 'nc');
  const facturado = positivos.reduce((s, c) => s + c.total, 0);
  const notasCredito = -notas.reduce((s, c) => s + c.total, 0);
  return {
    facturado: Math.round(facturado),
    notasCredito: Math.round(notasCredito),
    neto: Math.round(facturado) - Math.round(notasCredito),
    facturas: positivos.length,
    notas: notas.length,
    clientes: new Set(validos.map((c) => c.clienteId ?? c.receptor ?? c.id)).size,
    ticketPromedio: positivos.length ? Math.round(facturado / positivos.length) : 0,
  };
}

export const diasDelMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export type Dia = { dia: number; fecha: string; neto: number; comprobantes: number };

export function porDia(lista: Comprobante[], mes: string): Dia[] {
  const n = diasDelMes(mes);
  const dias: Dia[] = Array.from({ length: n }, (_, i) => ({
    dia: i + 1,
    fecha: `${mes}-${String(i + 1).padStart(2, '0')}`,
    neto: 0,
    comprobantes: 0,
  }));
  for (const c of lista) {
    if (!cuentaComoFacturado(c) || c.fecha.slice(0, 7) !== mes) continue;
    const d = dias[Number(c.fecha.slice(8, 10)) - 1];
    if (!d) continue;
    d.neto += c.total;
    if (c.clase !== 'nc') d.comprobantes += 1;
  }
  return dias.map((d) => ({ ...d, neto: Math.round(d.neto) }));
}

const NOMBRE_SUC: Record<string, string> = { st: 'Sant Thomas', si: 'Santa Inés', sin: 'Sin sucursal' };

export function resumirMes(lista: Comprobante[]) {
  const validos = lista.filter(cuentaComoFacturado);
  const c = cifras(lista);
  return {
    cifras: c,
    porMedio: cuadrar(partidas(validos, (x) => x.medio), c.neto),
    // por tipo: las notas de crédito van aparte (restan)
    porTipo: partidas(validos.filter((x) => x.clase !== 'nc'), (x) => x.tipo),
    notasPorTipo: partidas(validos.filter((x) => x.clase === 'nc'), (x) => x.tipo),
    porSucursal: cuadrar(partidas(validos, (x) => x.sucursal ?? 'sin', (k) => NOMBRE_SUC[k] ?? k), c.neto),
    porCliente: partidas(validos.filter((x) => x.clienteId), (x) => x.clienteId!),
  };
}

// Antigüedad de lo que se debe: cada cuenta cae entera en el tramo de su
// factura impaga más vieja (deuda_antiguedad.dias).
export type CuentaDeudora = { id: string; saldo: number; dias: number | null };
export const TRAMOS = [
  { clave: '0-30', etiqueta: 'Hasta 30 días', hasta: 30 },
  { clave: '31-60', etiqueta: '31 a 60 días', hasta: 60 },
  { clave: '61-90', etiqueta: '61 a 90 días', hasta: 90 },
  { clave: '90+', etiqueta: 'Más de 90 días', hasta: Infinity },
] as const;

export function tramosDeDeuda(cuentas: CuentaDeudora[]) {
  const tramos = [...TRAMOS.map((t) => ({ clave: t.clave as string, etiqueta: t.etiqueta as string, total: 0, cuentas: 0 })), { clave: 'sin', etiqueta: 'Sin fecha', total: 0, cuentas: 0 }];
  for (const c of cuentas) {
    if (!(c.saldo > 0)) continue;
    const i = c.dias == null ? tramos.length - 1 : TRAMOS.findIndex((t) => c.dias! <= t.hasta);
    tramos[i].total += c.saldo;
    tramos[i].cuentas += 1;
  }
  return tramos.map((t) => ({ ...t, total: Math.round(t.total) })).filter((t) => t.clave !== 'sin' || t.cuentas > 0);
}

// Días de deuda promedio de la cartera, ponderado por lo que debe cada uno
export function diasPromedio(cuentas: CuentaDeudora[]): number | null {
  const con = cuentas.filter((c) => c.saldo > 0 && c.dias != null);
  const peso = con.reduce((s, c) => s + c.saldo, 0);
  if (!peso) return null;
  return Math.round(con.reduce((s, c) => s + c.saldo * (c.dias as number), 0) / peso);
}
