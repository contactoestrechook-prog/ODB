// ¿La ficha que devolvió el catálogo externo es de ESTE producto?
//
// El 9/9/2026, con las primeras 263 fotos traídas por código de barras,
// aparecieron fichas equivocadas: al código de un Viña Cobos Chardonnay el
// catálogo le devolvía "POLACRIN TALENTO LATEX" (pintura), a un Luigi Bosca
// Magnum un taladro, a una sal saborizada una creatina. El código que devuelve
// es el mismo que pedimos: el dato de origen está mal. Una foto de pintura en
// una botella de vino la ve el cliente en la web, así que antes de guardar se
// compara el nombre; lo que no se parece queda para que una persona lo mire.

const SIN_VALOR = new Set([
  'con', 'sin', 'para', 'los', 'las', 'del', 'por', 'una', 'uno', 'the', 'and',
  'grs', 'gramos', 'kgs', 'kilo', 'kilos', 'lts', 'litro', 'litros', 'unid', 'unidad', 'unidades',
  'pack', 'caja', 'estuche', 'botella', 'lata', 'sachet', 'paquete', 'bolsa', 'frasco', 'pote',
  'gluten', 'free', 'light', 'ligth', 'diet', 'original', 'clasico', 'clasica', 'classic',
]);

export function palabras(texto: string | null | undefined): Set<string> {
  const limpio = (texto ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const out = new Set<string>();
  for (const w of limpio.match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3) continue;
    if (/^\d+$/.test(w)) continue; // números sueltos: gramajes, códigos
    if (/^\d/.test(w)) continue; // 750cc, 500g
    if (SIN_VALOR.has(w)) continue;
    out.add(w);
  }
  return out;
}

// Un nombre que arranca con un código de barras es basura del catálogo
// ("7792951118967 POLACRIN TALENTO LATEX"): esa ficha no es de nadie.
export function esBasura(nombreExterno: string | null | undefined): boolean {
  return /^\s*\d{8,14}\b/.test(nombreExterno ?? '');
}

export type Veredicto = { parecido: boolean; motivo: string };

export function pareceElMismoProducto(
  nombreNuestro: string | null | undefined,
  nombreExterno: string | null | undefined,
  marcaExterna?: string | null,
): Veredicto {
  if (esBasura(nombreExterno)) return { parecido: false, motivo: 'la ficha del catálogo arranca con otro código de barras' };
  const nuestras = palabras(nombreNuestro);
  const suyas = palabras(nombreExterno);
  if (!nuestras.size || !suyas.size) return { parecido: false, motivo: 'falta el nombre de un lado' };

  const comunes = [...nuestras].filter((w) => suyas.has(w));
  if (comunes.length) return { parecido: true, motivo: `coincide en ${comunes.slice(0, 3).join(', ')}` };

  // La marca del catálogo alcanza: "Philadelphia Queso Crema" contra "Cream Cheese" de marca Philadelphia.
  for (const m of palabras(marcaExterna)) {
    if (nuestras.has(m)) return { parecido: true, motivo: `coincide la marca (${m})` };
  }

  // La misma palabra escrita distinto cuenta: "pasatta"/"passata",
  // "fetuccini"/"fettucine", "sky"/"skyy". Con la distancia de edición, no con
  // el prefijo: "choco" y "chocotorta" empiezan igual y son cosas distintas.
  for (const a of nuestras) {
    for (const b of suyas) {
      if (Math.min(a.length, b.length) < 3) continue;
      if (semejanza(a, b) >= 0.7) return { parecido: true, motivo: `coincide en ${a} / ${b}` };
    }
  }
  // Nombres pegados: "Dececco" contra la marca "De Cecco".
  const pegado = [...nuestras].join('');
  for (const m of palabras(marcaExterna)) {
    if (m.length >= 4 && pegado.includes(m)) return { parecido: true, motivo: `coincide la marca (${m})` };
  }
  return { parecido: false, motivo: 'el nombre del catálogo no tiene nada que ver con el nuestro' };
}

// 1 = idénticas, 0 = nada que ver.
export function semejanza(a: string, b: string): number {
  const largo = Math.max(a.length, b.length);
  if (!largo) return 1;
  return 1 - distancia(a, b) / largo;
}

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardar = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardar;
    }
  }
  return fila[b.length];
}
