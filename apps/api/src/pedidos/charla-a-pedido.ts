// ============================================================
// PASAR A PEDIDO DESDE LA CHARLA (14/11/2026). Leandro: «que empiecen a salir
// los nuevos». Desde el 9/11 no entraba ningún pedido al sistema: la mayoría
// los cierra una persona desde el teléfono (el bot se pausa) y quedaban solo
// en el chat; el de Liliana (30 sidras para el lunes) no estaba en ningún lado.
// En Pedidos › Charlas de WhatsApp cada charla trae «Pasar a pedido»: la IA lee
// la charla entera, arma el pedido, la persona lo revisa y entra sin tomar, así
// suena en las cajas como cualquier pedido nuevo.
//
// Acá viven las piezas sin base ni IA (con pruebas en charla-a-pedido.spec.ts).
// ============================================================

export type MensajeCharla = { role?: string; content?: unknown; de?: string; en?: string };

/** El texto de un mensaje guardado, sin las marcas internas del bot. */
export function textoDelMensaje(m: MensajeCharla | null | undefined): string {
  const c = m?.content;
  let t = '';
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) t = c.map((b: any) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join(' ');
  return t
    .replace(/\[metadatos:[^\]]*\]/gi, ' ')
    .replace(/\[nota interna:[^\]]*\]/gi, ' ')
    .replace(/\[adjunto sin leer:[^\]]*\]/gi, '[adjunto]')
    .replace(/https?:\/\/\S+/g, (u) => (/supabase\.co\/storage/.test(u) ? '[adjunto]' : u))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Quién escribió: el cliente, una persona de la casa desde el teléfono, o el bot. */
export function autorDe(m: MensajeCharla): 'cliente' | 'persona' | 'bot' {
  if (m.role === 'user') return 'cliente';
  return m.de === 'telefono' ? 'persona' : 'bot';
}

const ROTULO = { cliente: 'Cliente', persona: 'Casa (persona)', bot: 'Casa (bot)' } as const;

/** La charla como la lee la IA: los últimos `max` mensajes, un renglón por mensaje. */
export function transcripcion(mensajes: MensajeCharla[], max = 80, tope = 24_000): string {
  const lineas = (mensajes ?? [])
    .slice(-max)
    .map((m) => ({ quien: ROTULO[autorDe(m)], texto: textoDelMensaje(m) }))
    .filter((x) => x.texto)
    .map((x) => `${x.quien}: ${x.texto}`);
  // si no entra, se queda lo último (lo que se está cerrando)
  let salida = lineas.join('\n');
  while (salida.length > tope && lineas.length > 1) {
    lineas.shift();
    salida = lineas.join('\n');
  }
  return salida;
}

// «• 2 × Fernet», «30 x Sidra», «Total: $45.600», «$3.900»
const RE_PRODUCTOS = /(?:^|\s)\d+(?:[.,]\d+)?\s*[×x]\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]|\btotal\b[^\n]{0,20}\$|\$\s?\d/i;

/** Lo que muestra la lista de charlas, sin mandar la charla entera al panel. */
export function resumenDeCharla(mensajes: MensajeCharla[]) {
  const ms = mensajes ?? [];
  const ultimos = ms.slice(-30);
  const ultimoConTexto = [...ms].reverse().find((m) => textoDelMensaje(m));
  return {
    ultimo: ultimoConTexto ? { texto: textoDelMensaje(ultimoConTexto).slice(0, 160), de: autorDe(ultimoConTexto) } : null,
    mensajesCliente: ultimos.filter((m) => m.role === 'user').length,
    hablaDeProductos: ultimos.some((m) => RE_PRODUCTOS.test(textoDelMensaje(m))),
    atendidaPorPersona: ultimos.some((m) => autorDe(m) === 'persona'),
  };
}

/** El código del pedido, con la misma forma que los del bot (DOM-… / PICKUP-…). */
export function codigoDePedido(id: string, tipo: 'retiro' | 'envio'): string {
  return `${tipo === 'envio' ? 'DOM-' : 'PICKUP-'}${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

/** Una fecha AAAA-MM-DD real, o null. */
export function fechaValida(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

const FORMAS = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago'] as const;
export type FormaDePago = (typeof FORMAS)[number];

const texto = (v: unknown, max = 300): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, max) : null;
};

export type ArmadoDeCharla = {
  items: { producto: string; cantidad: number; precioDicho: number | null }[];
  nombre: string | null;
  tipo: 'retiro' | 'envio' | null;
  direccion: string | null;
  entregaFecha: string | null;
  franja: string | null;
  formaPago: FormaDePago | null;
  recibe: string | null;
  notas: string | null;
  dudas: string[];
};

/** Lo que devolvió la IA, limpio: cantidades positivas, fechas reales, formas de pago conocidas. */
export function normalizarArmado(crudo: any): ArmadoDeCharla {
  const items = (Array.isArray(crudo?.items) ? crudo.items : [])
    .map((i: any) => ({
      producto: texto(i?.producto, 160) ?? '',
      cantidad: Math.round((Number(i?.cantidad) || 0) * 1000) / 1000,
      precioDicho: Number(i?.precioDicho) > 0 ? Math.round(Number(i.precioDicho) * 100) / 100 : null,
    }))
    .filter((i: any) => i.producto && i.cantidad > 0 && i.cantidad <= 9999);
  const tipo = crudo?.tipo === 'envio' || crudo?.tipo === 'retiro' ? crudo.tipo : null;
  const forma = String(crudo?.formaPago ?? '').toLowerCase().replace(/\s+/g, '');
  return {
    items,
    nombre: texto(crudo?.nombre, 120),
    tipo,
    direccion: texto(crudo?.direccion, 300),
    entregaFecha: fechaValida(crudo?.entregaFecha),
    franja: texto(crudo?.franja, 60),
    formaPago: (FORMAS as readonly string[]).includes(forma) ? (forma as FormaDePago) : null,
    recibe: texto(crudo?.recibe, 120),
    notas: texto(crudo?.notas, 500),
    dudas: (Array.isArray(crudo?.dudas) ? crudo.dudas : []).map((d: unknown) => texto(d, 200)).filter(Boolean).slice(0, 4) as string[],
  };
}

/** Las notas del pedido: lo que tiene que saber quien lo prepara y lo entrega. */
export function notasDelPedido(p: {
  recibe?: string | null;
  notas?: string | null;
  sinMatch?: string[];
  preciosDichos?: { producto: string; dicho: number; sistema: number | null }[];
  sinReserva?: boolean;
}): string {
  const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
  return [
    p.recibe ? `Recibe ${p.recibe}` : null,
    p.notas ?? null,
    p.sinMatch?.length ? `No encontrado en el catálogo: ${p.sinMatch.join(', ')}` : null,
    ...(p.preciosDichos ?? []).map((x) => `En la charla se dijo ${pesos(x.dicho)} por ${x.producto}${x.sistema != null ? ` (sistema ${pesos(x.sistema)})` : ''}`),
    p.sinReserva ? 'Sin reserva de stock: no alcanzaba al cargarlo' : null,
  ].filter(Boolean).join(' · ').slice(0, 1000);
}

/** Lo que se cobra en la charla y lo que dice el sistema no coinciden (más de 1 %). */
export function precioDistinto(dicho: number | null | undefined, sistema: number | null | undefined): boolean {
  if (!dicho || !sistema) return false;
  return Math.abs(dicho - sistema) / sistema > 0.01;
}
