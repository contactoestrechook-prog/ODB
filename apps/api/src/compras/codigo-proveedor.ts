// CÓDIGOS DEL PROVEEDOR MAL LEÍDOS (Leandro, 3/11/2026).
//
// El error más común del lector es UN dígito del código de artículo: en las
// facturas de Distri Sur del 7/10, 6 de 52 renglones («9094UU» → «3094UU»).
// Con un dígito cambiado el código no coincide con ninguno, y el renglón cae al
// vínculo por nombre, que es más flojo.
//
// Si el código leído está a UNA letra de distancia de un solo código conocido
// de ese proveedor, es casi seguro ese. Igual se pide que el nombre también
// coincida (lo decide quien llama): un dígito de distancia entre dos productos
// reales del mismo proveedor (1067 y 1068 en Rueda Que Rueda) es normal.

const normal = (c: string) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, '');

// ¿Se pasa de una a la otra cambiando, sacando o agregando UNA letra?
export function aUnaLetra(a: string, b: string): boolean {
  const x = normal(a);
  const y = normal(b);
  if (x === y || !x || !y || Math.abs(x.length - y.length) > 1) return false;
  if (x.length === y.length) {
    let distintas = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++distintas > 1) return false;
    return distintas === 1;
  }
  const [corto, largo] = x.length < y.length ? [x, y] : [y, x];
  for (let i = 0; i < largo.length; i++) {
    if (largo.slice(0, i) + largo.slice(i + 1) === corto) return true;
  }
  return false;
}

// El ÚNICO código conocido a una letra del leído. Con dos o más candidatos no
// se elige ninguno: sería adivinar. Códigos de menos de 4 letras tampoco: en
// «12» contra «13» no hay nada que corregir, son productos distintos.
export function codigoCercano(leido: string | null | undefined, conocidos: string[]): string | null {
  const l = normal(leido ?? '');
  if (l.length < 4) return null;
  const candidatos = [...new Set(conocidos.map(normal))].filter((c) => aUnaLetra(l, c));
  return candidatos.length === 1 ? candidatos[0] : null;
}
