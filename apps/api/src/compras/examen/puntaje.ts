// ============================================================
// EL PUNTAJE DEL EXAMEN DEL CHAT (18/11/2026). Leandro: «Sí, que frene».
//
// El examen (examen-chat.ts) le toma a una versión nueva las charlas reales del
// chat de la factura. Acá está la cuenta que decide si APRUEBA, separada para
// poder probarla sin IA:
//
//  · un caso fundador que falla → no aprueba;
//  · el chat da por hecho algo que la pantalla rechaza → no aprueba;
//  · «rinde peor»: en las charlas grabadas se compara, renglón por renglón,
//    cómo deja la factura la versión nueva contra cómo la dejó la versión que
//    estaba publicada cuando la persona escribió (sus cambios quedaron
//    guardados), y las dos contra lo que al final se registró. Si la nueva
//    acierta menos en más charlas de las que mejora, no aprueba.
//
// Funciones puras; se prueban en puntaje.spec.ts.
// ============================================================
import { aplicarCambiosIA, cantidadQueEntra, type CambioIA } from '../panel/tabla-factura';

/** renglón (desde 1) → lo que entró al stock cuando la factura se registró */
export type Verdad = Map<number, number>;
const cerca = (a: number, b: number) => Math.abs(a - b) <= 0.002 * Math.max(1, Math.abs(b));
const esDescuento = (f: any) => !!f?._esDescuento;

/** Cómo deja la factura un juego de cambios, con la cuenta de la pantalla. */
export function resultadoDe(filas: any[], cambios: any[]): { items: any[]; tocados: number[]; rechazos: { renglon: number; campo: string; porque: string }[] } {
  // los renglones agregados y el producto vinculado los resuelve la pantalla aparte
  const aplicables = (cambios ?? []).filter((c) => c && c.renglon != null && c.campo !== 'producto' && c.campo !== 'renglonNuevo') as CambioIA[];
  const r = aplicarCambiosIA(filas, aplicables, esDescuento);
  return {
    items: r.items,
    tocados: [...new Set(r.registros.map((g) => g.renglon))],
    rechazos: r.descartados.map((d) => ({ renglon: Number(d.renglon), campo: String(d.campo), porque: String(d.porque ?? '') })),
  };
}

/** De los renglones mirados que tienen respuesta correcta, cuántos quedaron como se registraron. */
export function renglonesBien(items: any[], renglones: Iterable<number>, verdad: Verdad): { bien: number; conVerdad: number } {
  let bien = 0;
  let conVerdad = 0;
  for (const n of new Set(renglones)) {
    const v = verdad.get(n);
    const fila = items[n - 1];
    if (v == null || !fila) continue;
    conVerdad++;
    // un renglón juntado en otro no entra por sí mismo: se compara su destino, no él
    if (fila.juntadoEn) { conVerdad--; continue; }
    if (cerca(cantidadQueEntra(fila), v)) bien++;
  }
  return { bien, conVerdad };
}

export type Charla = { bienNuevo: number; bienProd: number; conVerdad: number };
export type Comparacion = { charlas: number; peores: number; mejores: number; iguales: number; bienNuevo: number; bienProd: number; conVerdad: number };

/**
 * Una charla grabada: la versión nueva contra lo que hizo la publicada, mirando
 * los renglones que tocó cualquiera de las dos.
 */
export function compararCharla(filas: any[], cambiosProd: any[], cambiosNuevo: any[], verdad: Verdad): Charla {
  const prod = resultadoDe(filas, cambiosProd);
  const nuevo = resultadoDe(filas, cambiosNuevo);
  const mirados = [...new Set([...prod.tocados, ...nuevo.tocados])];
  const p = renglonesBien(prod.items, mirados, verdad);
  const n = renglonesBien(nuevo.items, mirados, verdad);
  return { bienNuevo: n.bien, bienProd: p.bien, conVerdad: Math.max(p.conVerdad, n.conVerdad) };
}

export function comparar(charlas: Charla[]): Comparacion {
  const t: Comparacion = { charlas: charlas.length, peores: 0, mejores: 0, iguales: 0, bienNuevo: 0, bienProd: 0, conVerdad: 0 };
  for (const c of charlas) {
    if (c.bienNuevo < c.bienProd) t.peores++; else if (c.bienNuevo > c.bienProd) t.mejores++; else t.iguales++;
    t.bienNuevo += c.bienNuevo; t.bienProd += c.bienProd; t.conVerdad += c.conVerdad;
  }
  return t;
}

export type Examen = {
  /** casos fundadores que no quedaron como tenían que quedar (o que no se pudieron tomar) */
  fundadoresQueFallan: string[];
  /** casos donde la pantalla rechaza algo que el chat mandó como hecho */
  mentiras: string[];
  comparacion: Comparacion;
};

/** ¿Se publica? Con los motivos, en palabras. */
export function veredicto(e: Examen): { aprueba: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (e.fundadoresQueFallan.length) motivos.push(`${e.fundadoresQueFallan.length === 1 ? 'falló un caso fundador' : `fallaron ${e.fundadoresQueFallan.length} casos fundadores`}: ${e.fundadoresQueFallan.join(' · ')}`);
  if (e.mentiras.length) motivos.push(`el chat dio por hecho algo que la pantalla rechaza: ${e.mentiras.join(' · ')}`);
  const c = e.comparacion;
  if (c.peores > c.mejores && c.bienNuevo < c.bienProd) {
    motivos.push(`rinde peor que lo publicado: en ${c.peores} de ${c.charlas} charlas reales deja peor la factura (mejora ${c.mejores}); renglones como se registraron ${c.bienNuevo} de ${c.conVerdad}, y lo publicado había dejado ${c.bienProd}`);
  }
  return { aprueba: !motivos.length, motivos };
}
