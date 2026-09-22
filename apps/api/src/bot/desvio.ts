// ============================================================
// ¿EL PRODUCTO COTIZADO ES EL QUE PIDIÓ EL CLIENTE? (22/9/2026)
//
// Este control existía dentro de bot.service y comparaba cada renglón contra
// TODO el mensaje del cliente. Con "2 fernet branca de 750 y 3 coca zero de
// 1.75" veía la palabra "zero" y marcaba al fernet como "el cliente pidió zero
// y este producto no lo es": el total quedaba bloqueado, el bot decía que no
// podía cerrarlo y derivaba la charla. Cualquier pedido de varios productos con
// una variedad (zero, light, ipa…) moría así. Resultado: cero pedidos por
// WhatsApp en dos semanas.
//
// Ahora cada producto se compara solo con el FRAGMENTO del mensaje que habla de
// él (el que comparte marca, medida o variedad). Si no se puede atribuir ningún
// fragmento, no se bloquea nada.
// ============================================================

const norm = (t: string) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// "x1.75L" → "x 1.75l": el nombre del catálogo pega la medida a la x y el límite de palabra no la encontraba
const normProd = (t: string) => norm(t).replace(/\bx(?=\d)/g, 'x ');

const GENERICAS = new Set(['botella', 'botellas', 'lata', 'latas', 'pack', 'packs', 'caja', 'cajas', 'unidad', 'unidades', 'para', 'con', 'sin', 'por', 'del', 'los', 'las', 'una', 'uno', 'quiero', 'necesito', 'dame', 'mandame', 'llevo', 'retiro', 'envio', 'domicilio', 'nombre', 'tambien', 'ademas', 'grande', 'chica', 'chico', 'comun', 'normal']);
const VARIEDADES = ['ipa', 'stout', 'zero', 'light', 'clasica', 'red lager', 'bock', 'sin alcohol', 'negra', 'rubia'];

// Medidas en mililitros. Con unidad ("750 cc", "1,5 l") o sin ella, que es
// como escribe la gente: "coca de 1.75", "fernet de 750". Un decimal suelto
// con un dígito adelante son litros; un número de 3 o 4 cifras son cc. Los
// precios ("$4.700", "4700 pesos") no cuentan.
const medidasDe = (t: string, minDigitos = 2) => {
  const out: number[] = [];
  for (const m of t.matchAll(new RegExp(`\\b(\\d{${minDigitos},4})\\s?(?:cc|ml)\\b|\\b(\\d(?:[.,]\\d{1,2})?)\\s?(?:l\\b|lt|lts|litros?)\\b`, 'g'))) {
    out.push(m[1] ? Number(m[1]) : Math.round(Number(String(m[2]).replace(',', '.')) * 1000));
  }
  for (const m of t.matchAll(/(?<![\d.,$])\b(\d)[.,](\d{1,2})\b(?![.,]?\d)(?!\s?(?:cc|ml|kg|gr?|l\b|lt|litros?|pesos|\$))/g)) {
    out.push(Math.round(Number(`${m[1]}.${m[2]}`) * 1000));
  }
  for (const m of t.matchAll(/(?<![\d.,$])\b(\d{3,4})\b(?![.,]\d)(?!\s?(?:cc|ml|kg|gr?|l\b|lt|litros?|pesos|\$|un|u\b|unidades))/g)) {
    const n = Number(m[1]);
    if (n >= 200 && n <= 5000) out.push(n);
  }
  return [...new Set(out)].filter((n) => n >= 100);
};

/** Palabras que identifican al producto: la marca y sus partes, no "botella" ni "x750cc". */
function palabrasClave(nombreProducto: string): string[] {
  return norm(nombreProducto)
    .replace(/\bx\s*\d[\d.,]*\s*(?:cc|ml|l|lt|lts|kg|g|gr|un|u)?\b/g, ' ')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !GENERICAS.has(w) && !/^\d+$/.test(w) && !VARIEDADES.includes(w));
}

/** El pedazo del mensaje del cliente que se refiere a este producto ('' si no se puede saber). */
export function fragmentoDelProducto(nombreProducto: string, textoCliente: string): string {
  const cli = norm(textoCliente);
  const segmentos = cli.split(/\n|[,;+\/]|\.\s+|\s+(?:y|e|mas|tambien|ademas)\s+/).map((s) => s.trim()).filter(Boolean);
  if (segmentos.length <= 1) return cli;
  const claves = palabrasClave(nombreProducto);
  const prod = normProd(nombreProducto);
  const medProd = medidasDe(prod, 3);
  const varProd = VARIEDADES.filter((v) => new RegExp(`\\b${v}\\b`).test(prod));
  const puntaje = (seg: string) => {
    let p = 0;
    for (const k of claves) if (seg.includes(k.slice(0, 4))) p += 1; // "malboro" ≈ "marlboro"
    if (p === 0) return 0;
    const medSeg = medidasDe(seg);
    if (medSeg.length && medProd.length && medSeg.some((a) => medProd.some((b) => Math.abs(a - b) <= 30))) p += 1;
    for (const v of VARIEDADES) {
      if (!new RegExp(`\\b${v}\\b`).test(seg)) continue;
      p += varProd.includes(v) ? 1 : -1;
    }
    return p;
  };
  const puntuados = segmentos.map((s) => ({ s, p: puntaje(s) })).filter((x) => x.p > 0);
  if (!puntuados.length) return '';
  const max = Math.max(...puntuados.map((x) => x.p));
  return puntuados.filter((x) => x.p === max).map((x) => x.s).join(' y ');
}

/** Motivo del desvío entre lo pedido y el producto elegido, o null si coincide. */
export function desvioDeLoPedido(nombreProducto: string, textoCliente: string): string | null {
  const prod = normProd(nombreProducto);
  const cli = fragmentoDelProducto(nombreProducto, textoCliente);
  if (!cli) return null;
  // medidas que el cliente nombró (1.5 / 1,5 l / 750 / 473 / 2 litros…)
  const medidaCli = medidasDe(cli);
  if (medidaCli.length) {
    const medidaProd = medidasDe(prod, 3);
    if (medidaProd.length && !medidaProd.some((mp) => medidaCli.some((mc) => Math.abs(mp - mc) <= 30))) {
      const f = (n: number) => (n >= 1000 ? (n / 1000).toString().replace('.', ',') + ' L' : n + 'cc');
      return `el cliente pidió ${f(medidaCli[0])} y este producto es de ${f(medidaProd[0])}`;
    }
  }
  // variedades que se confunden entre sí dentro de una misma marca
  const pidio = VARIEDADES.filter((v) => new RegExp(`\\b${v}\\b`).test(cli));
  const tiene = VARIEDADES.filter((v) => new RegExp(`\\b${v}\\b`).test(prod));
  // "clásica" en el cliente = la común: cualquier variedad en el producto es un desvío
  if (pidio.includes('clasica') && tiene.length) return `el cliente pidió la clásica y este producto es ${tiene[0]}`;
  if (pidio.length && !pidio.some((v) => tiene.includes(v)) && (tiene.length || pidio.some((v) => v !== 'clasica'))) {
    return `el cliente pidió ${pidio[0]} y este producto ${tiene.length ? `es ${tiene[0]}` : 'no lo es'}`;
  }
  return null;
}
