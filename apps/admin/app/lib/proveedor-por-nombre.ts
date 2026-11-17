// ============================================================
// «EL PROVEEDOR ES BIMBO» (17/11/2026). En una semana Ana le escribió siete
// veces al chat de la factura quién era el proveedor («EL PROVEEDOR ES PABLO
// CAGNOLI», «proveedor: POPH», «el proveedor ees MANGINI»): los remitos no
// traen CUIT y el lector no lo reconoce. La IA no puede elegirlo; la pantalla
// sí, y sin esperar a nadie.
//
// Busca el proveedor por lo que la persona escribió: todas sus palabras tienen
// que estar en el nombre (en cualquier orden, con una letra de diferencia en las
// palabras largas). Si hay uno solo, es ese; si hay varios, se devuelven para
// que elija.
//
// Función pura. La prueba apps/api/src/compras/proveedor-por-articulos.spec.ts.
// ============================================================

export type ProveedorDeLista = { id: string; nombre: string; otro?: string | null };

// «nuevo»: «el proveedor es nuevo» pide darlo de alta, no elegir uno que se llame así
const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'sa', 'srl', 'sas', 'sac', 'saci', 'es', 'proveedor', 'nuevo', 'nueva', 'otro', 'este', 'ese']);
const palabras = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !VACIAS.has(w));

/** ¿Se escribieron igual, con a lo sumo una letra cambiada, de más o de menos? */
function casiIgual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

export function proveedorPorNombre(dicho: string, lista: ProveedorDeLista[]): { elegido: ProveedorDeLista | null; opciones: ProveedorDeLista[] } {
  const buscadas = palabras(dicho);
  if (!buscadas.length) return { elegido: null, opciones: [] };
  const candidatos = (lista ?? [])
    .map((p) => {
      const propias = [...new Set([...palabras(p.nombre), ...palabras(p.otro)])];
      const todas = buscadas.every((b) => propias.some((x) => casiIgual(b, x) || (b.length >= 4 && x.startsWith(b))));
      const exactas = buscadas.filter((b) => propias.includes(b)).length;
      // cuánto del nombre cubre lo que se escribió: «bimbo» es BIMBO antes que «Bimbo Frozen Argentina»
      return todas && propias.length ? { p, puntaje: exactas + buscadas.length / propias.length } : null;
    })
    .filter(Boolean) as { p: ProveedorDeLista; puntaje: number }[];
  if (!candidatos.length) return { elegido: null, opciones: [] };
  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  const [primero, segundo] = candidatos;
  // uno solo, o uno que coincide claramente mejor que el que le sigue
  if (!segundo || primero.puntaje - segundo.puntaje >= 0.5) return { elegido: primero.p, opciones: [] };
  return { elegido: null, opciones: candidatos.slice(0, 8).map((c) => c.p) };
}
