// La ventana «Llegó un pedido» de las cajas (13/11/2026). Sin imports a
// propósito: la prueba vive en la API (apps/api/src/pedidos/aviso-caja.spec.ts).

/**
 * ¿Este pedido le toca a quien trabaja en esta sucursal? (13/11/2026, antes de
 * que ODB empiece a recibir pedidos en las cajas). El bot, la web y la app
 * mandan todo a la sucursal central (la única con retiro): sin esto, la caja de
 * la otra sucursal también sonaba y podía «tomar» un pedido que no prepara.
 * Quien no tiene sucursal asignada (dueños, cajera que rota) los ve todos, y el
 * pedido sin sucursal le llega a todos.
 */
export const esDeMiSucursal = (p: { sucursal_id?: string | null }, miSucursal: string | null | undefined) =>
  !miSucursal || !p.sucursal_id || p.sucursal_id === miSucursal;

/**
 * Qué hace la ventana de pedidos con la respuesta de la API. Sin sesión (401:
 * la cookie dura 12 h y la PC de la caja queda prendida todo el día) NO se
 * apaga en silencio: avisa que hay que volver a entrar y sigue mirando. Sin
 * permiso (403) se apaga: ese rol no atiende pedidos.
 */
export function lecturaDeLaCola(estado: number): 'ok' | 'sin_sesion' | 'sin_permiso' | 'reintentar' {
  if (estado === 401) return 'sin_sesion';
  if (estado === 403) return 'sin_permiso';
  if (estado >= 200 && estado < 300) return 'ok';
  return 'reintentar';
}
