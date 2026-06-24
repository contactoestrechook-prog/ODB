// Confianza del enriquecimiento — LÓGICA PURA y testeable.
// NO confía solo en el número que reporta la IA: lo cruza con validadores deterministas
// (datos que se pueden VERIFICAR contra el nombre original) y lo topea/eleva en consecuencia.

const norm = (s: string) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// ¿El producto se vende por PESO (gramos/kilos) o "x peso"? Entonces NO tiene volumen_ml.
export function esPorPeso(nombre: string): boolean {
  const s = norm(nombre);
  return /[0-9]+\s*(?:gr|grs|gramos|g|kg|kilo|kilos)\b/.test(s) || /\bx?\s*peso\b/.test(s);
}

// Extrae el volumen si está EN el nombre (750cc, 473ml, 1.5L) → no se adivina, se parsea.
export function volumenEnNombre(nombre: string): number | null {
  const s = norm(nombre);
  let m = s.match(/(\d{2,4})\s*(?:cc|ml)\b/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(\d(?:[.,]\d)?)\s*(?:l|lt|lts|litro|litros)\b/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);
  return null;
}

export type Enriquecido = {
  marca?: string | null;
  varietal_o_tipo?: string | null;
  volumen_ml?: number | null;
  graduacion?: number | null;
  confianza?: number;
};

// Devuelve la confianza VALIDADA (0-1) + qué se pudo verificar + por qué.
export function validarEnriquecimiento(nombreOriginal: string, e: Enriquecido) {
  const o = norm(nombreOriginal);
  const motivos: string[] = [];
  let score = typeof e.confianza === 'number' ? Math.max(0, Math.min(1, e.confianza)) : 0.5;

  // 1) volumen: verificable si está en el nombre y coincide con lo que dijo la IA
  const volumenParseado = volumenEnNombre(nombreOriginal);
  const volumenOk = volumenParseado != null && Number(e.volumen_ml) === volumenParseado;
  if (volumenOk) motivos.push('volumen presente en el nombre');

  // 2) marca: verificable si aparece en el nombre original
  const marcaNorm = norm(e.marca || '');
  const marcaOk = marcaNorm.length >= 3 && o.includes(marcaNorm.split(' ')[0]);
  if (marcaOk) motivos.push('marca presente en el nombre');
  else { score = Math.min(score, 0.6); motivos.push('marca no verificable → tope 0.6'); }

  // 3) varietal / tipo: verificable si alguna palabra significativa aparece en el nombre
  const varOk = !!e.varietal_o_tipo && norm(e.varietal_o_tipo).split(/[ -]+/).some((w) => w.length >= 4 && o.includes(w));
  if (varOk) motivos.push('tipo/varietal presente en el nombre');

  // 4) graduación: si la IA la inventó fuera de rango plausible, no confiar
  if (e.graduacion != null && (Number(e.graduacion) < 0 || Number(e.graduacion) > 60)) {
    score = Math.min(score, 0.4);
    motivos.push('graduación fuera de rango → tope 0.4');
  }

  // 5) si TODO lo objetivo se verifica, elevar el piso
  if (volumenOk && marcaOk && varOk) {
    score = Math.max(score, 0.85);
    motivos.push('volumen + marca + varietal verificados → piso 0.85');
  }

  return {
    score: Math.round(score * 100) / 100,
    volumenOk,
    marcaOk,
    varOk,
    volumenParseado,
    motivos,
  };
}
