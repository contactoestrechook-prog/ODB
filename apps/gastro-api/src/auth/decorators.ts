import { SetMetadata } from '@nestjs/common';

// Marca un endpoint como público: lo puede llamar cualquiera (el cliente que
// escaneó el QR de la mesa, sin login). Todo lo que NO tenga @Publico() exige
// el header x-admin-key (ver AdminKeyGuard) — es el panel de Damián.
export const ES_PUBLICO = 'es_publico';
export const Publico = () => SetMetadata(ES_PUBLICO, true);
