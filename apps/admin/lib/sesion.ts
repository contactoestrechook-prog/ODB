// La sesión del equipo NO vence (Leandro, 24/11/2026: «después de un tiempo se
// cierra la sesión todo el tiempo y hay que volver a loguearse. Eso hay que
// desactivarlo, ya»). Antes la cookie duraba 12 h y el token 24 h: a mitad del
// turno los mandaba al login.
// 400 días es lo máximo que guarda Chrome; el middleware la renueva en cada
// pantalla y en cada consulta del panel, así que con el uso no llega nunca.
// Quien sí queda afuera es el dado de baja: lo controla la API (AuthGuard).
export const SESION_MAX_AGE = 60 * 60 * 24 * 400;

// Cookies de la sesión que se renuevan con el uso, con sus mismas opciones.
export const COOKIES_DE_SESION: { nombre: string; httpOnly: boolean }[] = [
  { nombre: 'odb_token', httpOnly: true },
  { nombre: 'odb_usuario', httpOnly: false },
  { nombre: 'odb_cambiar', httpOnly: true },
];

// Estas rutas escriben o borran las cookies de la sesión: el middleware no las
// toca ahí, para no pisar el token nuevo (entrar, cambiar la clave) ni revivir
// el que se está borrando (salir).
export const RUTAS_QUE_ESCRIBEN_LA_SESION = ['/api/sesion', '/api/cambiar-clave', '/api/salir'];
