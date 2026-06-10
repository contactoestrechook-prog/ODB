import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'es_publico';
export const Publico = () => SetMetadata(ES_PUBLICO, true);

export const ROLES = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
