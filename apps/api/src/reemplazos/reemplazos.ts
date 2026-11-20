// «TENGO PARECIDO» Y LA CONSULTA AL CLIENTE (Leandro y Jaqui, 20/11/2026).
// Lo que no depende de la base: entender el sí o el no, los textos que salen y
// qué producto se parece más al que falta. Ver reemplazos.service.ts.

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------- ¿Sí o no? ----------

/** Frases que dicen que sí (enteras, al principio de la respuesta). */
const SI = [
  'si', 'sii', 'siii', 'sip', 'sis', 'sisi', 'si si', 'dale', 'ok', 'okey', 'okay', 'oka', 'oki', 'okis', 'va', 'bueno', 'buenisimo',
  'perfecto', 'joya', 'genial', 'listo', 'claro', 'obvio', 'acepto', 'adelante', 'barbaro', 'excelente', 'de una', 'de acuerdo',
  'esta bien', 'ta bien', 'todo bien', 'me sirve', 'sirve', 'me va', 'mandalo', 'mandala', 'mandamelo', 'mandamela', 'manda',
  'por supuesto', 'afirmativo', 'correcto', 'cambialo', 'cambiala', 'reemplazalo', 'reemplazala', 'de 10', 'impecable',
];
/** Frases que dicen que no. */
const NO = [
  'no', 'nop', 'nope', 'nah', 'naa', 'mejor no', 'no gracias', 'no me sirve', 'no quiero', 'no lo quiero', 'no la quiero',
  'sacalo', 'sacala', 'dejalo', 'dejala', 'que no', 'negativo', 'para nada', 'prefiero que no', 'no hace falta', 'no lo mandes',
  'no la mandes', 'ninguno', 'ninguna', 'nada',
];
/** Empiezan con «no» y dicen que sí. */
const NO_PERO_SI = ['no hay problema', 'no pasa nada', 'no hay drama', 'ningun problema', 'sin problema', 'no importa', 'no hay rollo'];
/** Si aparecen, la respuesta pone una condición o pregunta algo: no se decide sola. */
const CONDICION = ['no se', 'ni idea', 'te aviso', 'despues', 'llamame', 'te llamo', 'pero', 'aunque', 'cuanto', 'precio', 'sale', 'otra', 'otro', 'otros', 'otras', 'en vez', 'en lugar', 'si hay', 'si tenes', 'tenes', 'tienen', 'hay de', 'cambio por', 'mejor la', 'mejor el', 'mejor otra', 'mejor otro'];
/** Lo que se saca del final y no cambia la respuesta. */
const CORTESIA = /\b(muchas gracias|mil gracias|gracias|grs|porfa|por favor|xfa|genia|genio|amigo|amiga|bebe|corazon|un beso|besos|saludos|chau|slds)\b/g;
const SALUDO = /^(hola|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|ah|uh|eh|mmm+|ehh+|aja)\b/;

const empiezaCon = (s: string, frases: string[]) => frases.some((f) => s === f || s.startsWith(`${f} `));
const tiene = (s: string, frases: string[]) => frases.some((f) => s === f || s.startsWith(`${f} `) || s.endsWith(` ${f}`) || s.includes(` ${f} `));

/**
 * El sí o el no de una respuesta corta, sin IA. null: no queda claro (pregunta,
 * condición, mezcla de sí y no, o es largo): lo lee la IA o una persona.
 */
export function leerSiNo(texto: string): 'si' | 'no' | null {
  let s = String(texto ?? '');
  if (!s.trim()) return null;
  if (s.includes('?')) return null;
  s = s.replace(/[👍👌✅✔☑💯🙌]/gu, ' si ').replace(/[👎❌✖🚫]/gu, ' no ');
  s = sinTildes(s).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) s = s.replace(SALUDO, '').trim();
  s = s.replace(CORTESIA, ' ').replace(/\s+/g, ' ').trim();
  // «siii», «nooo», «dalee»
  s = s.split(' ').map((w) => w.replace(/(.)\1{2,}/g, '$1$1').replace(/^(si|no|dale|ok)\1*$/, '$1').replace(/^s{1,2}i+$/, 'si').replace(/^no+$/, 'no').replace(/^dale+$/, 'dale')).join(' ');
  if (!s) return null;
  const palabras = s.split(' ');
  if (palabras.length > 7) return null;
  if (tiene(s, CONDICION)) return null;
  if (empiezaCon(s, NO_PERO_SI)) return 'si';
  const si = empiezaCon(s, SI);
  const no = empiezaCon(s, NO);
  // lo que viene después no puede decir lo contrario («sí, no», «no, dale»)
  const resto = (frases: string[]) => palabras.slice(1).some((w) => frases.includes(w));
  if (si && !no && !resto(['no', 'sacalo', 'sacala', 'dejalo', 'dejala', 'nada'])) return 'si';
  if (no && !si && !resto(['si', 'dale', 'ok', 'okey', 'mandalo', 'mandala', 'bueno'])) return 'no';
  return null;
}

// ---------- Cantidades y textos ----------

const cant = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
export const pesos = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

/** «250 g» o «1,5 kg» si se vende por peso; si no, el número. */
export function cantidadLegible(n: number, porPeso?: boolean): string {
  if (!porPeso) return cant(n);
  return n < 1 ? `${Math.round(n * 1000)} g` : `${cant(n)} kg`;
}

/** «2 × Manteca x 100 gr», «Manteca x 100 gr» (uno), «300 g de Jamón cocido» (por peso). */
export function conCantidad(n: number, nombre: string, porPeso?: boolean): string {
  if (porPeso) return `${cantidadLegible(n, true)} de ${nombre}`;
  return n === 1 ? nombre : `${cant(n)} × ${nombre}`;
}

export type CambioParaTexto = {
  nombre_falta: string; pide: number; hay: number;
  nombre_reemplazo: string; cantidad: number; precio: number | null;
  faltaPorPeso?: boolean; reemplazoPorPeso?: boolean;
};

/** El producto de la pregunta: qué falta y qué va en su lugar, con su precio. */
export function renglonDePregunta(c: CambioParaTexto): string {
  const va = `*${conCantidad(c.cantidad, c.nombre_reemplazo, c.reemplazoPorPeso)}*${c.precio != null ? ` (${pesos(c.cantidad * c.precio)})` : ''}`;
  if (c.hay > 0) {
    const faltan = Math.round((c.pide - c.hay) * 1000) / 1000;
    return `De *${c.nombre_falta}* pediste ${cantidadLegible(c.pide, c.faltaPorPeso)} y hay ${cantidadLegible(c.hay, c.faltaPorPeso)}. Por ${c.faltaPorPeso ? 'lo' : faltan === 1 ? 'la' : 'las'} que falta${!c.faltaPorPeso && faltan !== 1 ? 'n' : ''} va ${va}.`;
  }
  return `*${c.nombre_falta}* no hay. En su lugar va ${va}.`;
}

const primerNombre = (n?: string | null) => {
  const p = String(n ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[a-záéíóúñü]{2,}$/i.test(p) ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
};

/**
 * La pregunta de UN producto (Jaqui: «Manteca La Serenísima por 200 no hay,
 * reemplazamos por Manteca La Serenísima por 100. Responder sí o no»). Salen de
 * a uno: la primera saluda y dice cuántas son; las que siguen arrancan con
 * «Anotado».
 */
export function textoDePregunta(c: CambioParaTexto, o: { cliente?: string | null; codigo: string; numero: number; total: number; anotado?: boolean }): string {
  const nombre = primerNombre(o.cliente);
  const cabeza = o.numero === 1 && !o.anotado
    ? `Hola${nombre ? ` ${nombre}` : ''}, te escribimos de ODB por tu pedido ${o.codigo}.${o.total > 1 ? ` Nos faltan ${o.total} productos y te consultamos de a uno.` : ''}`
    : 'Anotado ✔';
  const numero = o.total > 1 ? `(${o.numero} de ${o.total}) ` : '';
  return `${cabeza}\n\n${numero}${renglonDePregunta(c)}\n\n¿Te sirve? Respondé *SÍ* o *NO*.`;
}

export type CambioRespondido = CambioParaTexto & { estado: 'aceptado' | 'rechazado'; error?: string | null };

/** Cada cambio en una línea: ✔ lo que entra, ✖ lo que sale. */
export function lineaDeCambio(c: CambioRespondido, para: 'cliente' | 'equipo'): string {
  if (c.estado === 'aceptado') {
    const va = conCantidad(c.cantidad, c.nombre_reemplazo, c.reemplazoPorPeso);
    return para === 'cliente' ? `✔ ${va} (en lugar de ${c.nombre_falta})` : `✔ SÍ: ${va} (por ${c.nombre_falta})`;
  }
  const soloLoQueHay = `va solo ${cantidadLegible(c.hay, c.faltaPorPeso)}`;
  return para === 'cliente'
    ? `✖ ${c.nombre_falta}: ${c.hay > 0 ? soloLoQueHay : 'no va'}`
    : `✖ NO: ${c.nombre_falta}${c.hay > 0 ? `: ${soloLoQueHay} (lo que hay)` : ' sale del pedido'}`;
}

/** Al cliente, después de la última respuesta: cómo queda el pedido. */
export function textoDeCierre(cambios: CambioRespondido[], o: { cliente?: string | null; codigo: string; total: number | null }): string {
  const nombre = primerNombre(o.cliente);
  return [
    `Anotado ✔ ¡Gracias${nombre ? `, ${nombre}` : ''}! Tu pedido ${o.codigo} queda así:`,
    ...cambios.map((c) => lineaDeCambio(c, 'cliente')),
    o.total != null ? `Total: ${pesos(o.total)}.` : null,
  ].filter(Boolean).join('\n');
}

/** A quien arma (WhatsApp y pantalla): lo que se confirmó. */
export function textoParaQuienArma(cambios: CambioRespondido[], o: { cliente?: string | null; codigo: string; total: number | null; totalAntes?: number | null; pagado?: boolean; link?: string | null }): string {
  const quien = String(o.cliente ?? '').trim() || 'El cliente';
  const errores = cambios.filter((c) => c.error);
  const cambioTotal = o.totalAntes != null && o.total != null && Math.round(o.totalAntes) !== Math.round(o.total);
  return [
    `CAMBIOS CONFIRMADOS · ${o.codigo}`,
    `${quien} contestó:`,
    ...cambios.map((c) => lineaDeCambio(c, 'equipo')),
    o.total != null ? `Total ahora: ${pesos(o.total)}${cambioTotal ? ` (antes ${pesos(o.totalAntes!)})` : ''}.` : null,
    ...errores.map((c) => `⚠ ${c.nombre_falta}: no pude cambiarlo en el sistema (${c.error}). Corregilo a mano.`),
    o.pagado && cambioTotal ? 'Ya estaba pagado: avisale a la caja la diferencia.' : null,
    cambios.some((c) => c.estado === 'aceptado') ? 'Sumá lo nuevo al carro y terminá el pedido.' : 'Ya podés terminar el pedido.',
    o.link ?? null,
  ].filter(Boolean).join('\n');
}

// ---------- Horario (regla de Leandro, 18/11/2026: nada sale de 22 a 8) ----------

export function horaAR(ahora = new Date()): number {
  return Number(ahora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })) % 24;
}
export const enHorarioDeMensajes = (ahora = new Date()) => { const h = horaAR(ahora); return h >= 8 && h < 22; };

// ---------- ¿Qué se parece más? ----------

const VACIAS = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'sin', 'y', 'por', 'para', 'a', 'al', 'un', 'una', 'u', 'c', 'cu', 'pack', 'unidad', 'unidades']);
const UNIDAD = /^\d+([.,]\d+)?(g|gr|grs|gramos|kg|kgs|kilo|kilos|ml|cc|l|lt|lts|litro|litros|cm|mts|m|u|un|uds)?$/;

/** Las palabras que dicen QUÉ es (sin números, medidas, ni el código). */
export function palabrasDe(nombre: string): string[] {
  return sinTildes(String(nombre ?? '')).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !VACIAS.has(w) && !UNIDAD.test(w) && !/^l\d{2,}$/.test(w));
}

/** El tamaño que dice el nombre, en gramos o mililitros (null si no dice). */
export function tamanoDe(nombre: string): { valor: number; tipo: 'peso' | 'volumen' } | null {
  const t = sinTildes(String(nombre ?? '')).toLowerCase();
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilos?|grs?|gramos|g|ml|cc|lts?|litros?|l)\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2];
  if (/^k/.test(u)) return { valor: n * 1000, tipo: 'peso' };
  if (/^g/.test(u)) return { valor: n, tipo: 'peso' };
  if (u === 'ml' || u === 'cc') return { valor: n, tipo: 'volumen' };
  return { valor: n * 1000, tipo: 'volumen' };
}

/**
 * Cuántos del parecido equivalen a lo que falta: 1 de 200 g → 2 de 100 g;
 * 2 de 200 g → 1 de 400 g. Si no da justo, la misma cantidad (quien arma la
 * corrige).
 */
export function cantidadEquivalente(faltan: number, nombreFalta: string, nombreParecido: string): number {
  const a = tamanoDe(nombreFalta);
  const b = tamanoDe(nombreParecido);
  if (!a || !b || a.tipo !== b.tipo || !Number.isInteger(faltan)) return faltan;
  const total = faltan * a.valor;
  const n = total / b.valor;
  if (Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) >= 1 && Math.round(n) <= faltan * 6) return Math.round(n);
  return faltan;
}

export type Candidato = { id: string; nombre: string; stock: number; vendidas?: number | null };

/**
 * Puntaje de parecido: palabras en común (la primera, que dice qué es —
 * «Manteca» —, vale el triple), el mismo tamaño suma y lo que más se vende
 * desempata. Con 0 palabras en común no es parecido.
 */
export function puntajeParecido(falta: string, candidato: string): number {
  const a = palabrasDe(falta);
  const b = new Set(palabrasDe(candidato));
  if (!a.length || !b.size) return 0;
  let p = 0;
  a.forEach((w, i) => { if (b.has(w)) p += i === 0 ? 3 : 1; });
  if (!p) return 0;
  // sin la primera palabra (qué es), apenas parecido
  if (!b.has(a[0])) p = p / 2;
  const ta = tamanoDe(falta);
  const tb = tamanoDe(candidato);
  if (ta && tb && ta.tipo === tb.tipo && ta.valor === tb.valor) p += 0.5;
  return p;
}

/** Los más parecidos, con stock, primero los de más puntaje. */
export function ordenarParecidos(falta: string, candidatos: Candidato[], tope = 6): (Candidato & { puntaje: number })[] {
  return candidatos
    .filter((c) => c.stock > 0)
    .map((c) => ({ ...c, puntaje: puntajeParecido(falta, c.nombre) }))
    .filter((c) => c.puntaje >= 1)
    .sort((x, y) => y.puntaje - x.puntaje || (Number(y.vendidas) || 0) - (Number(x.vendidas) || 0) || y.stock - x.stock || x.nombre.localeCompare(y.nombre, 'es'))
    .slice(0, tope);
}
