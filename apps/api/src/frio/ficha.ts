// La ficha editable de cada equipo de frío (Leandro, 4/11/2026). Funciones puras:
// qué se acepta al editar o sumar un equipo, y qué número le toca al nuevo.

export const TIPOS_FRIO = ['congelados', 'refrigerados', 'lacteos', 'bebidas', 'otro'] as const;

const texto = (v: unknown, max = 200) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const entero = (v: unknown, min: number, max: number, campo: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${campo}: tiene que ser un número entero entre ${min} y ${max}`);
  return n;
};
const grados = (v: unknown, campo: string) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < -60 || n > 40) throw new Error(`${campo}: tiene que ser una temperatura entre −60 y 40 °C`);
  return Math.round(n * 100) / 100;
};

// Solo los campos que vienen; el rango se valida junto con el que ya tiene.
export function cambiosFicha(dto: any, actual: { minimo: number; maximo: number }) {
  const c: Record<string, unknown> = {};
  if ('nombre' in dto) { const n = texto(dto.nombre, 120); if (!n) throw new Error('El nombre no puede quedar vacío'); c.nombre = n; }
  if ('lugar' in dto) c.lugar = texto(dto.lugar, 80);
  if ('tipo' in dto) {
    const t = texto(dto.tipo, 20);
    if (t && !(TIPOS_FRIO as readonly string[]).includes(t)) throw new Error('Tipo desconocido');
    c.tipo = t;
  }
  if ('minimo' in dto) c.minimo = grados(dto.minimo, 'Mínimo');
  if ('maximo' in dto) c.maximo = grados(dto.maximo, 'Máximo');
  const mn = (c.minimo ?? Number(actual.minimo)) as number, mx = (c.maximo ?? Number(actual.maximo)) as number;
  if (mx <= mn) throw new Error('El máximo tiene que ser mayor que el mínimo');
  if ('demora_min' in dto) c.demora_min = entero(dto.demora_min, 0, 1440, 'Minutos fuera de rango');
  if ('mudo_min' in dto) c.mudo_min = entero(dto.mudo_min, 2, 1440, 'Minutos sin datos');
  if ('avisar' in dto) c.avisar = texto(dto.avisar, 300);
  if ('notas' in dto) c.notas = texto(dto.notas, 1000);
  return c;
}

// El id que figura en el panel de QBIT: solo números
export function idEquipoValido(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^\d{1,9}$/.test(s)) throw new Error('El número de equipo es el que figura en el panel de QBIT: solo números');
  return s;
}

// F-01, F-02…: el siguiente libre
export function siguienteCodigo(codigos: string[]): string {
  const usados = codigos.map((c) => Number(/^F-(\d+)$/.exec(c)?.[1] ?? 0));
  return `F-${String(Math.max(0, ...usados) + 1).padStart(2, '0')}`;
}
