import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// Pagos a cuenta con autorización del dueño. El circuito que pidió Juan Pablo:
// el cliente de cuenta corriente deja un pago en la caja, el cajero lo TOMA
// pero no lo aplica — queda en "cobros a ingresar" y al dueño le llega la
// alerta. Recién cuando él lo aprueba (después de verlo en la caja o el
// posnet) baja la deuda. Así ningún pago vive en la memoria de nadie ni en un
// WhatsApp, y nadie más que el dueño toca la cuenta corriente.
@Controller('cobranzas')
export class CobranzasController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // el cajero (o backoffice) toma el pago; queda pendiente
  @Roles('cajero', 'administrativo', 'gerente', 'dueno')
  @Post()
  async tomar(
    @Body() dto: { clienteId: string; monto: number; medio?: string; nota?: string; comprobanteBase64?: string; comprobanteMime?: string },
    @Req() req: any,
  ) {
    const monto = Number(dto.monto);
    if (!dto.clienteId) throw new BadRequestException('Falta el cliente');
    if (!Number.isFinite(monto) || monto <= 0) throw new BadRequestException('El monto tiene que ser mayor a cero');

    const { data: cliente } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, saldo_cta_cte, cta_cte_habilitada')
      .eq('id', dto.clienteId)
      .maybeSingle();
    if (!cliente) throw new BadRequestException('No existe ese cliente');
    if (!cliente.cta_cte_habilitada) throw new BadRequestException('Ese cliente no tiene cuenta corriente habilitada');

    // comprobante (foto de la transferencia / ticket del posnet): la prueba que
    // después zanja cualquier discusión
    let comprobanteUrl: string | null = null;
    if (dto.comprobanteBase64) {
      const bin = Buffer.from(dto.comprobanteBase64, 'base64');
      if (bin.length > 8 * 1024 * 1024) throw new BadRequestException('El comprobante no puede pasar de 8MB');
      const ext = /pdf/.test(dto.comprobanteMime ?? '') ? 'pdf' : 'jpg';
      const ruta = `cobranzas/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const { error } = await this.db.storage.from('comprobantes').upload(ruta, bin, { contentType: dto.comprobanteMime ?? 'image/jpeg' });
      if (!error) comprobanteUrl = ruta;
    }

    const { data, error } = await this.db
      .from('cobranzas_pendientes')
      .insert({
        cliente_id: dto.clienteId,
        monto,
        medio: dto.medio ?? 'efectivo',
        nota: dto.nota?.trim() || null,
        comprobante_url: comprobanteUrl,
        cargada_por: req.usuario?.sub ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    // la alerta del dueño: "cobros a ingresar"
    const nombre = cliente.razon_social || cliente.nombre;
    await this.db.from('alertas_internas').insert({
      para_usuario: null, // dueños
      tipo: 'cobranza',
      titulo: `Cobro a ingresar: ${nombre} · $${Math.round(monto).toLocaleString('es-AR')}`,
      detalle: `${dto.medio ?? 'efectivo'}${dto.nota ? ` · ${dto.nota}` : ''} · saldo actual $${Math.round(Number(cliente.saldo_cta_cte ?? 0)).toLocaleString('es-AR')}. Aprobalo en Clientes → Cobros a ingresar.`,
      referencia: { cobranzaId: data.id, clienteId: dto.clienteId },
    }).then(() => null, () => null);

    return { id: data.id, estado: 'pendiente' };
  }

  // Bandeja del dueño. Quien carga un cobro ve SOLO los suyos, para saber si
  // ya se aplicaron: la cola completa de cobros pendientes de todo el local es
  // información de la casa, no de una caja.
  @Roles('cajero', 'administrativo', 'gerente', 'dueno')
  @Get()
  async listar(@Query('estado') estado: string | undefined, @Req() req: any) {
    const rol = req.usuario?.rol;
    const soloLosMios = rol !== 'dueno' && rol !== 'gerente';
    let q = this.db
      .from('cobranzas_pendientes')
      .select('id, monto, medio, nota, estado, cargada_en, resuelta_en, respuesta, comprobante_url, cliente:clientes(id, nombre, razon_social, saldo_cta_cte), cargador:usuarios!cobranzas_pendientes_cargada_por_fkey(nombre), aprobador:usuarios!cobranzas_pendientes_resuelta_por_fkey(nombre)')
      .eq('estado', estado || 'pendiente');
    if (soloLosMios) q = q.eq('cargada_por', req.usuario?.sub ?? '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q
      .order('cargada_en', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    // el comprobante sale con enlace firmado (el bucket es privado)
    return Promise.all((data ?? []).map(async (c: any) => {
      let comprobanteUrl: string | null = null;
      if (c.comprobante_url) {
        const { data: firma } = await this.db.storage.from('comprobantes').createSignedUrl(c.comprobante_url, 3600);
        comprobanteUrl = firma?.signedUrl ?? null;
      }
      return { ...c, comprobante_url: undefined, comprobanteUrl };
    }));
  }

  // SOLO el dueño aplica el pago a la cuenta
  @Roles('dueno')
  @Post(':id/aprobar')
  async aprobar(@Param('id') id: string, @Body() dto: { respuesta?: string }, @Req() req: any) {
    const { data, error } = await this.db.rpc('aprobar_cobranza', {
      p_id: id, p_usuario: req.usuario?.sub ?? null, p_respuesta: dto?.respuesta ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Roles('dueno')
  @Post(':id/rechazar')
  async rechazar(@Param('id') id: string, @Body() dto: { respuesta?: string }, @Req() req: any) {
    const { data: c } = await this.db.from('cobranzas_pendientes').select('estado, cargada_por, monto, cliente:clientes(nombre, razon_social)').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('No existe esa cobranza');
    if (c.estado !== 'pendiente') throw new BadRequestException(`Esa cobranza ya fue ${c.estado}`);
    const { error } = await this.db
      .from('cobranzas_pendientes')
      .update({ estado: 'rechazada', resuelta_por: req.usuario?.sub ?? null, resuelta_en: new Date().toISOString(), respuesta: dto?.respuesta?.trim() || null })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    // aviso a quien lo cargó: el pago NO se aplicó, que lo revise con el cliente
    if (c.cargada_por) {
      const nombre = (c as any).cliente?.razon_social || (c as any).cliente?.nombre || 'el cliente';
      await this.db.from('alertas_internas').insert({
        para_usuario: c.cargada_por,
        tipo: 'cobranza',
        titulo: `Cobro rechazado: ${nombre}`,
        detalle: `El pago de $${Math.round(Number(c.monto)).toLocaleString('es-AR')} no se aplicó.${dto?.respuesta ? ` Motivo: ${dto.respuesta}` : ''}`,
        referencia: { cobranzaId: id },
      }).then(() => null, () => null);
    }
    return { ok: true };
  }
}
