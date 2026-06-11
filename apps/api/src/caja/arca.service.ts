import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Worker de facturación: toma comprobantes pendientes y les pide CAE a ARCA.
// La conexión real (WSFE) requiere certificado digital del CUIT de ODB:
//   1. Generar certificado en ARCA (clave fiscal -> Certificados digitales)
//   2. Configurar ARCA_CUIT, ARCA_CERT_PATH y ARCA_KEY_PATH en .env
//   3. Implementar la emisión con afipsdk (https://afipsdk.com) en emitirUno()
@Injectable()
export class ArcaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async pendientes() {
    const { data, error } = await this.db
      .from('comprobantes_arca')
      .select('id, tipo, punto_venta, estado, creado_en, venta:ventas(total, vendida_en, canal)')
      .eq('estado', 'pendiente')
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return {
      total: data?.length ?? 0,
      configurado: this.estaConfigurado(),
      comprobantes: data,
    };
  }

  async emitirPendientes() {
    if (!this.estaConfigurado()) {
      throw new BadRequestException(
        'Facturación ARCA sin configurar: faltan ARCA_CUIT, ARCA_CERT_PATH y ARCA_KEY_PATH en apps/api/.env (requiere el certificado digital del CUIT de ODB)',
      );
    }
    // TODO(arca): emisión real con afipsdk — numeración por punto de venta,
    // CAE + vencimiento, y estado 'emitido' / 'error' por comprobante.
    throw new BadRequestException('Emisión ARCA pendiente de implementación con el certificado real');
  }

  private estaConfigurado(): boolean {
    return Boolean(
      process.env.ARCA_CUIT && process.env.ARCA_CERT_PATH && process.env.ARCA_KEY_PATH,
    );
  }
}
