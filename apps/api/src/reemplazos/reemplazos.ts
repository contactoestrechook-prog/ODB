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
const NO_PERO_SI = ['no hay problema', 'no pasa nada', 'no hay drama', 'ningun problema', 'ningun drama', 'sin problema', 'sin drama', 'no importa', 'no hay rollo', 'no tengo drama', 'no tengo problema', 'no me molesta', 'no me importa'];
/** Si aparecen, la respuesta pone una condición o pregunta algo: no se decide sola. */
const CONDICION = ['no se', 'ni idea', 'te aviso', 'despues', 'llamame', 'te llamo', 'pero', 'aunque', 'cuanto', 'precio', 'sale', 'otra', 'otro', 'otros', 'otras', 'en vez', 'en lugar', 'si hay', 'si tenes', 'tenes', 'tienen', 'hay de', 'cambio por', 'mejor la', 'mejor el', 'mejor otra', 'mejor otro'];
/** Lo que se saca del final y no cambia la respuesta. */
const CORTESIA = /\b(muchas gracias|mil gracias|gracias|grs|porfa|por favor|xfa|genia|genio|amigo|amiga|bebe|corazon|un beso|besos|saludos|chau|slds)\b/g;
const SALUDO = /^(hola|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|ah|uh|eh|mmm+|ehh+|aja)\b/;

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
  if (NO_PERO_SI.some((f) => s === f || s.startsWith(`${f} `))) return 'si';
  // la frase más larga con que empieza («no me sirve» antes que «no»)
  const frase = (frases: string[]) => frases.filter((f) => s === f || s.startsWith(`${f} `)).sort((x, y) => y.length - x.length)[0] ?? null;
  const si = frase(SI);
  const no = frase(NO);
  // lo que viene después no puede decir lo contrario («sí, no», «no, dale»)
  const despues = (f: string, contrarias: string[]) => palabras.slice(f.split(' ').length).some((w) => contrarias.includes(w));
  if (si && !no && !despues(si, ['no', 'sacalo', 'sacala', 'dejalo', 'dejala', 'nada'])) return 'si';
  // «no, está bien» puede ser «no hace falta» o «dale»: no se decide solo
  if (no && !si && !despues(no, ['si', 'dale', 'ok', 'okey', 'mandalo', 'mandala', 'bueno', 'bien', 'perfecto', 'genial', 'joya', 'sirve', 'va'])) return 'no';
  return null;
}

/** Solo un saludo o un gracias («gracias!», «ok gracias» no: «ok» es un sí): no contesta la pregunta. */
export function soloCortesia(texto: string): boolean {
  let s = sinTildes(String(texto ?? '')).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return true;
  for (let i = 0; i < 2; i++) s = s.replace(SALUDO, '').trim();
  return !s.replace(CORTESIA, ' ').replace(/\b(de nada|igualmente|bendiciones|abrazo)\b/g, ' ').trim();
}

// ---------- Cantidades y textos ----------

const cant = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
export const pesos = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

/** «250 g» o «1,5 kg» si se vende por peso; si no, el número. */
export function cantidadLegible(n: number, porPeso?: boolean): string {
  if (!porPeso) return cant(n);
  return n < 1 ? `${Math.round(n * 1000)} g` : `${cant(n)} kg`;
}

/**
 * ¿Se vende por peso? La marca del sistema, y si falta (hay fiambres sin marcar),
 * lo que dice el nombre («x fracción») o una cantidad con decimales (0,2).
 */
export function sePesa(nombre: string, vendidoPorPeso?: boolean | null, cantidad?: number): boolean {
  if (vendidoPorPeso) return true;
  if (/\bfracc?c?i[oó]n\b|\bx\s*kg\b|\bpor kilo\b/i.test(sinTildes(String(nombre ?? '')))) return true;
  return cantidad != null && Number.isFinite(cantidad) && !Number.isInteger(cantidad) && cantidad < 50;
}

/** «2 × Manteca x 100 gr», «Manteca x 100 gr» (uno), «300 g de Jamón cocido» (por peso). */
export function conCantidad(n: number, nombre: string, porPeso?: boolean): string {
  if (porPeso || sePesa(nombre, false, n)) return `${cantidadLegible(n, true)} de ${nombre}`;
  return n === 1 ? nombre : `${cant(n)} × ${nombre}`;
}

export type CambioParaTexto = {
  nombre_falta: string; pide: number; hay: number;
  nombre_reemplazo: string; cantidad: number; precio: number | null;
  faltaPorPeso?: boolean; reemplazoPorPeso?: boolean;
  /** variedad (20/11/2026): el mismo producto en otra fragancia, sabor o color */
  tipo?: 'parecido' | 'variedad';
  pedida?: string | null; variedades?: string[] | null; elegida?: string | null;
};

// ---------- La variedad (Leandro, 20/11/2026: «no hay ese sabor, y cuáles sí») ----------

/** «lavanda», «lavanda y coco», «lavanda, coco y vainilla». */
export function enLista(xs: string[], marca = ''): string {
  const v = xs.map((x) => `${marca}${x}${marca}`);
  return v.length <= 1 ? v.join('') : `${v.slice(0, -1).join(', ')} y ${v[v.length - 1]}`;
}

/** Las variedades que anotó quien arma: sin vacías, sin repetidas, cortas. */
export function variedadesLimpias(xs: unknown): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const x of Array.isArray(xs) ? xs : []) {
    const t = String(x ?? '').replace(/[«»*;·\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = sinTildes(t).toLowerCase();
    if (t && !vistas.has(k)) { vistas.add(k); salida.push(t); }
  }
  return salida.slice(0, 8);
}

/** «Saphirus Textil VARIOS de limón» o el nombre solo. */
const conPedida = (c: CambioParaTexto) => `*${c.nombre_falta}*${c.pedida ? ` de *${c.pedida}*` : ''}`;

/**
 * ¿Cuál eligió? Por las palabras de la respuesta, sin IA: «lavanda», «la de
 * coco», «mandame vainilla porfa». Un «no» o «ninguno» es que no quiere
 * ninguna; un «sí» solo vale si había una sola. null: no queda claro (la lee la IA).
 */
export function leerVariedad(texto: string, variedades: string[]): { elegida: string } | 'no' | null {
  const norm = (t: string) => sinTildes(String(t ?? '')).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const s = ` ${norm(texto)} `;
  if (!s.trim()) return null;
  const nombradas = variedades.filter((v) => { const n = norm(v); return n && s.includes(` ${n} `); });
  if (nombradas.length === 1) return { elegida: nombradas[0] };
  if (nombradas.length > 1) return null;
  const sn = leerSiNo(texto);
  if (sn === 'no') return 'no';
  if (sn === 'si' && variedades.length === 1) return { elegida: variedades[0] };
  return null;
}

/** El producto de la pregunta: qué falta y qué va en su lugar, con su precio. */
export function renglonDePregunta(c: CambioParaTexto): string {
  if (c.tipo === 'variedad') {
    const hay = c.variedades ?? [];
    return hay.length
      ? `${conPedida(c)} no hay. De ese tenemos: ${enLista(hay, '*')}.`
      : `${conPedida(c)} no hay.`;
  }
  const va = `*${conCantidad(c.cantidad, c.nombre_reemplazo, c.reemplazoPorPeso)}*${c.precio != null ? ` (${pesos(c.cantidad * c.precio)})` : ''}`;
  if (c.hay > 0) {
    const faltan = Math.round((c.pide - c.hay) * 1000) / 1000;
    return `De *${c.nombre_falta}* pediste ${cantidadLegible(c.pide, c.faltaPorPeso)} y hay ${cantidadLegible(c.hay, c.faltaPorPeso)}. Por ${c.faltaPorPeso ? 'lo' : faltan === 1 ? 'la' : 'las'} que falta${!c.faltaPorPeso && faltan !== 1 ? 'n' : ''} va ${va}.`;
  }
  return `*${c.nombre_falta}* no hay. En su lugar va ${va}.`;
}

/** Palabras que no son un nombre («Cliente PedidosYa», «Sr. Pérez», «Distribuidora…»). */
const NO_ES_NOMBRE = /^(cliente|clienta|sr|sra|srta|senor|senora|señor|señora|don|dona|doña|lic|dr|dra|distribuidora|almacen|almacén|kiosco|bar|restaurante|resto|super|supermercado|empresa|odb)$/i;
const primerNombre = (n?: string | null) => {
  const p = String(n ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[a-záéíóúñü]{2,}$/i.test(p) || NO_ES_NOMBRE.test(p)) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
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
  const cierre = c.tipo === 'variedad'
    ? (c.variedades?.length ?? 0) > 1
      ? '¿Cuál querés? Respondé con la que elegís, o *NO* si no querés ninguna.'
      : `¿Te sirve ${c.variedades?.[0] ? `*${c.variedades[0]}*` : 'otra'}? Respondé *SÍ* o *NO*.`
    : '¿Te sirve? Respondé *SÍ* o *NO*.';
  return `${cabeza}\n\n${numero}${renglonDePregunta(c)}\n\n${cierre}`;
}

/**
 * NO HAY Y NO HAY OTRA (20/11/2026): no se le pregunta nada, se le avisa. Sale
 * cuando quien arma saca el producto del pedido con «Avisarle al cliente».
 */
export function textoDeNoHay(o: { cliente?: string | null; codigo: string; nombre: string; pedida?: string | null; total: number | null }): string {
  const nombre = primerNombre(o.cliente);
  return [
    `Hola${nombre ? ` ${nombre}` : ''}, te escribimos de ODB por tu pedido ${o.codigo}.`,
    '',
    `*${o.nombre}*${o.pedida ? ` de *${o.pedida}*` : ''} no hay, así que no va en tu pedido.${o.total != null ? ` El total queda en ${pesos(o.total)}.` : ''}`,
  ].join('\n');
}

export type CambioRespondido = CambioParaTexto & { estado: 'aceptado' | 'rechazado'; error?: string | null };

/** Cada cambio en una línea: ✔ lo que entra, ✖ lo que sale. */
export function lineaDeCambio(c: CambioRespondido, para: 'cliente' | 'equipo'): string {
  if (c.tipo === 'variedad') {
    const de = c.pedida ? ` (${c.pedida})` : '';
    if (c.estado === 'aceptado') {
      return para === 'cliente'
        ? `✔ ${c.nombre_falta}: ${c.elegida ?? 'otra'}${c.pedida ? ` (en lugar de ${c.pedida})` : ''}`
        : `✔ ELIGIÓ ${String(c.elegida ?? 'otra').toUpperCase()}: ${c.nombre_falta}${c.pedida ? ` (no había ${c.pedida})` : ''}`;
    }
    return para === 'cliente' ? `✖ ${c.nombre_falta}${de}: no va` : `✖ NO: ${c.nombre_falta}${de} sale del pedido`;
  }
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

const VACIAS = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'sin', 'y', 'por', 'para', 'a', 'al', 'un', 'una', 'u', 'c', 'cu', 'pack', 'unidad', 'unidades',
  // cómo se vende, no qué es
  'fraccion', 'fracccion', 'fraccionado', 'feteado', 'kilo', 'kg', 'botella', 'lata', 'tetra', 'caja', 'cajita', 'paquete', 'bolsa']);
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
 * Cuántos del parecido equivalen a lo que falta, solo cuando la cuenta es
 * natural: 1 de 200 g → 2 de 100 g; 2 de 500 g → 1 de 1 kg; 1 de 3 L → 3 de 1 L.
 * Si la proporción es rara (24 de 1,75 L → 70 de 600 cc) o más de 4 a 1, la
 * misma cantidad: quien arma la corrige. Entre lo que se pesa y lo que va por
 * unidad, se pasa por los gramos que dice el nombre (300 g → 1 de 250 g;
 * 2 de x 1 kg → 2 kg); sin el tamaño, 1 unidad o lo mismo.
 */
export function cantidadEquivalente(faltan: number, falta: string | { nombre: string; porPeso?: boolean }, parecido: string | { nombre: string; porPeso?: boolean }): number {
  const fa = typeof falta === 'string' ? { nombre: falta, porPeso: false } : falta;
  const pa = typeof parecido === 'string' ? { nombre: parecido, porPeso: false } : parecido;
  const a = tamanoDe(fa.nombre);
  const b = tamanoDe(pa.nombre);
  // lo que se pesa (kilos) por algo que va por unidad, o al revés
  if (fa.porPeso && !pa.porPeso) {
    // sin gramos en el nombre, casi siempre es otro fiambre que se pesa y no está marcado: lo mismo
    if (!b || b.tipo !== 'peso') return faltan;
    return Math.max(1, Math.round((faltan * 1000) / b.valor));
  }
  if (!fa.porPeso && pa.porPeso) {
    if (!a || a.tipo !== 'peso') return faltan;
    return Math.round(faltan * a.valor) / 1000;
  }
  if (fa.porPeso && pa.porPeso) return faltan;
  if (!a || !b || a.tipo !== b.tipo || !Number.isInteger(faltan)) return faltan;
  const r = a.valor / b.valor;
  const natural = (x: number) => Math.abs(x - Math.round(x)) < 1e-6 && Math.round(x) >= 2 && Math.round(x) <= 4;
  if (!natural(r) && !natural(1 / r)) return faltan;
  const n = faltan * r;
  return Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) >= 1 ? Math.round(n) : faltan;
}

export type Candidato = { id: string; nombre: string; stock: number; vendidas?: number | null; mismaCategoria?: boolean };

/**
 * Puntaje de parecido: palabras en común (la primera, que dice qué es —
 * «Manteca» —, vale el triple), la misma góndola suma, el mismo tamaño suma y
 * lo que más se vende desempata. Con 0 palabras en común no es parecido.
 */
export function puntajeParecido(falta: string, candidato: string, mismaCategoria = false): number {
  const a = palabrasDe(falta);
  const lista = palabrasDe(candidato);
  const b = new Set(lista);
  if (!a.length || !b.size) return 0;
  // las primeras palabras dicen qué es («Queso Cheddar…»): valen más que la marca
  let p = 0;
  a.forEach((w, i) => { if (b.has(w)) p += i === 0 ? 3 : i === 1 ? 2 : 1; });
  if (!p) return 0;
  // qué es: que el candidato EMPIECE igual («Panceta…», no «Papas… Panceta» ni «Mortadela… Calchaqui»)
  if (!b.has(a[0])) return p / 2;
  if (lista[0] === a[0]) p += 1;
  else p = p * 0.6;
  if (mismaCategoria) p += 1.5;
  const ta = tamanoDe(falta);
  const tb = tamanoDe(candidato);
  if (ta && tb && ta.tipo === tb.tipo && ta.valor === tb.valor) p += 0.5;
  return p;
}

/**
 * Los más parecidos, con stock, primero los de más puntaje. De otra góndola,
 * solo lo que empieza con lo mismo (por la panceta, no las papas sabor panceta).
 */
export function ordenarParecidos(falta: string, candidatos: Candidato[], tope = 6): (Candidato & { puntaje: number })[] {
  const cabeza = palabrasDe(falta)[0];
  return candidatos
    .filter((c) => c.stock > 0)
    .filter((c) => c.mismaCategoria !== false || palabrasDe(c.nombre)[0] === cabeza)
    .map((c) => ({ ...c, puntaje: puntajeParecido(falta, c.nombre, !!c.mismaCategoria) }))
    .filter((c) => c.puntaje >= 1)
    .sort((x, y) => y.puntaje - x.puntaje || (Number(y.vendidas) || 0) - (Number(x.vendidas) || 0) || y.stock - x.stock || x.nombre.localeCompare(y.nombre, 'es'))
    .slice(0, tope);
}
