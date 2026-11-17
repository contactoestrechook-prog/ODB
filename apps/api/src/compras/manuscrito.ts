// ============================================================
// LO AGREGADO A MANO NO CAMBIA LA CARGA (17/11/2026). Leandro: «sí, ignorarlo
// siempre», salvo que quien carga lo pida.
//
// Hasta ese día regía «todo renglón pintado o anotado como devuelto no entra al
// stock, sin preguntar» (4/11, Las Dinas). En los hechos el lector marcaba como
// devuelto lo que no lo era —el sombreado que imprime el proveedor, una raya,
// la tilde de «llegó bien»— y preguntaba por firmas y fechas de vencimiento.
// Entre el 9 y el 16/11 Ana le escribió «no tomes lo manuscrito» a nueve
// proveedores distintos (La Serenísima, DASDA, Tufaro, Surtisur, Cagnoli, CCU,
// Coste Valentina, City, Distri Sur), porque la regla se guardaba por proveedor.
//
// Ahora es al revés: tildes, rayas, tachaduras, firmas, fechas, números sueltos
// y renglones pintados son anotaciones internas y no cambian cantidades,
// precios ni lo que entra al stock. Se transcriben (notasManuscritas) para que
// se vean, y se usan solo si la persona lo pide: por el chat de la factura, o
// en lo que aclara al volver a leer la foto.
//
// Un remito o una planilla que el proveedor completa a mano NO es una
// anotación: es el comprobante, y se lee como cualquier otro.
//
// Funciones puras. Las prueba manuscrito.spec.ts.
// ============================================================

const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// de qué habla quien pide tomar lo anotado: lo escrito o pintado, o lo que no llegó
const HABLA_DE_LO_ANOTADO = /a mano|manuscrit|anotad|anotaci|escrit|pintad|resaltad|marcad|tachad|devuel|devolv|devoluci|no vino|no vinieron|no llego|no llegaron|no ingres|no entr|falt|llegaron|vinieron|ingresaron|entraron/;

/**
 * ¿Las aclaraciones de la persona hablan de lo anotado a mano o de lo que no
 * llegó? Solo entonces el lector puede marcar un renglón como devuelto o como
 * recibido en parte. Sin aclaraciones (la primera lectura) nunca.
 */
export function pideLoManuscrito(aclaraciones: string | null | undefined): boolean {
  const t = normalizar(aclaraciones).trim();
  return !!t && HABLA_DE_LO_ANOTADO.test(t);
}

/**
 * Lo que el lector dice de un renglón por una anotación a mano, pasado por la
 * regla: sin un pedido de la persona, nada vuelve ni llega en parte.
 */
export function marcasAMano(
  leido: { devueltoAMano?: unknown; recibidoAMano?: unknown },
  loPidieron: boolean,
): { devueltoAMano: boolean; recibidoAMano: number | null } {
  if (!loPidieron) return { devueltoAMano: false, recibidoAMano: null };
  return {
    devueltoAMano: leido?.devueltoAMano === true,
    recibidoAMano: Number(leido?.recibidoAMano) > 0 ? Number(leido.recibidoAMano) : null,
  };
}
