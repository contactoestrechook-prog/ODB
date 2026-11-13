import { Module } from '@nestjs/common';
import { CuentaController } from './cuenta.controller';
import { CuentaService } from './cuenta.service';
import { supabaseProvider } from '../supabase.provider';

// Tres monedas, la cuenta de cada mesa y el cobro.
//
// PIX: hoy se cobra por la terminal (configuracion.pix_modo = 'terminal'): el
// brasileño paga con el QR del posnet y el mozo registra el cobro acá. El modo
// 'api' (un QR por mesa y la mesa que se cierra sola) queda para cuando haya
// contrato con un procesador: se suma su cliente en este módulo y un webhook
// firmado que llame a CuentaService.cobrar(). No se escribió contra ninguna
// API de proveedor todavía porque no hay credenciales ni documentación firmada.
@Module({
  controllers: [CuentaController],
  providers: [CuentaService, supabaseProvider],
  exports: [CuentaService],
})
export class CuentaModule {}
