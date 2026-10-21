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
