import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'es_publico';
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const ROLES = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

// Con @SinHerencia, los roles de @Roles se cumplen tal cual: un rol compuesto
// (administrativo, que hereda comprador y depósito) no entra por herencia.
// Para lo que es del local y no de backoffice: envíos, entregas, faltantes al
// entregar (revisión del 21/10/2026: administrativo los recibía sin tener
// ninguna pantalla, y «Se entregó» le sumaba efectivo a la caja abierta).
export const SIN_HERENCIA = 'sin_herencia';
export const SinHerencia = () => SetMetadata(SIN_HERENCIA, true);

// Op salón (Leandro, 5/11/2026: «que no accedan ni a cajas ni a administración
// ni a nada, solo a esto»). Ese rol entra SOLO donde @Roles lo nombra; lo que no
// declara roles (abierto a cualquier logueado) le queda cerrado, salvo lo que
// lleve @ParaCualquierRol (cambiar su propia clave).
export const PARA_CUALQUIER_ROL = 'para_cualquier_rol';
export const ParaCualquierRol = () => SetMetadata(PARA_CUALQUIER_ROL, true);
export const ROLES_ENCERRADOS = ['op_salon'];
