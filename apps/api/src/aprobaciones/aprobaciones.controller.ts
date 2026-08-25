import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { ComprasService } from '../compras/compras.service';
import { MesaComprasService } from '../compras/mesa-compras.service';

// Todo lo que espera la firma del dueño, en una sola bandeja.
//
// Hasta ahora cada circuito tenía su pantalla: las órdenes de compra en
// Compras, las órdenes de pago abajo de todo, los cobros a cuenta en Clientes,
// los cambios de factura en otra pestaña y las propuestas de costo en Mesa de
// compras. Nadie mira cinco pantallas todos los días, así que lo que quedaba
// sin firmar se enteraba el proveedor antes que la dirección.
//
// Acá no hay lógica nueva: cada aprobación termina llamando al mismo circuito
// de siempre, con sus validaciones y su auditoría. Lo único que cambia es que
// están todas juntas y ordenadas por lo que más cuesta dejar esperando.
type Pendiente = {
  tipo: 'orden_compra' | 'orden_pago' | 'cobranza' | 'cambio_factura' | 'propuesta_costo';
  id: string;
  titulo: string;
  detalle: string;
  monto: number | null;
  pidio: string | null;
  cuando: string;
  dias: number;
};

const NOMBRE_TIPO: Record<Pendiente['tipo'], string> = {
  orden_compra: 'Orden de compra',
  orden_pago: 'Orden de pago',
  cobranza: 'Cobro a cuenta',
  cambio_factura: 'Cambio en factura',
  propuesta_costo: 'Cambio de costos',
};

@Controller('aprobaciones')
export class AprobacionesController {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly compras: ComprasService,
    private readonly mesa: MesaComprasService,
  ) {}

  private dias(s: string) {
    return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  }

  @Roles('gerente', 'dueno')
  @Get()
  async pendientes(): Promise<{ items: Pendiente[]; total: number; porTipo: Record<string, number> }> {
    const [ocs, ops, cobros, cambios, propuestas] = await Promise.all([
      this.db.from('ordenes_compra')
        .select('id, numero, total, creado_en, proveedor:proveedores(razon_social), autor:usuarios!ordenes_compra_creada_por_fkey(nombre)')
        .eq('estado', 'pendiente_aprobacion').order('creado_en'),
      this.db.from('ordenes_pago')
        .select('id, numero, total, medio_pago, vencimiento, creado_en, proveedor:proveedores(razon_social), autor:usuarios!ordenes_pago_creada_por_fkey(nombre)')
        .eq('estado', 'pendiente').order('creado_en'),
      this.db.from('cobranzas_pendientes')
        .select('id, monto, medio, nota, cargada_en, cliente:clientes(nombre, razon_social), cargador:usuarios!cobranzas_pendientes_cargada_por_fkey(nombre)')
        .eq('estado', 'pendiente').order('cargada_en'),
      this.db.from('facturas_proveedor_cambios')
        .select('id, tipo, motivo, creado_en, factura:facturas_proveedor(numero, monto), solicitante:usuarios!facturas_proveedor_cambios_solicitado_por_fkey(nombre)')
        .eq('estado', 'pendiente').order('creado_en'),
      this.db.from('propuestas_costo')
        .select('id, titulo, creada_en, proveedor:proveedores(razon_social), autor:usuarios!propuestas_costo_creada_por_fkey(nombre), items:propuestas_costo_items(costo_nuevo)')
        .eq('estado', 'pendiente').order('creada_en'),
    ]);

    // Una consulta rota NO puede leerse como "no hay nada que firmar": esta
    // pantalla se mira para confiar en que está todo al día. Si una falla,
    // falla la pantalla entera y se ve el error.
    for (const r of [ocs, ops, cobros, cambios, propuestas]) {
      if (r.error) throw new BadRequestException(`No pude leer la cola de aprobaciones: ${r.error.message}`);
    }

    const items: Pendiente[] = [];

    for (const o of ((ocs.data ?? []) as any[])) {
      items.push({
        tipo: 'orden_compra', id: o.id,
        titulo: `OC #${o.numero} · ${o.proveedor?.razon_social ?? 'sin proveedor'}`,
        detalle: 'Sin aprobar no se le puede mandar el pedido al proveedor.',
        monto: Number(o.total ?? 0), pidio: o.autor?.nombre ?? null, cuando: o.creado_en, dias: this.dias(o.creado_en),
      });
    }
    for (const o of ((ops.data ?? []) as any[])) {
      items.push({
        tipo: 'orden_pago', id: o.id,
        titulo: `OP #${o.numero} · ${o.proveedor?.razon_social ?? 'varios proveedores'}`,
        detalle: `${o.medio_pago ?? 'transferencia'}${o.vencimiento ? ` · vence ${new Date(o.vencimiento).toLocaleDateString('es-AR')}` : ''}`,
        monto: Number(o.total ?? 0), pidio: o.autor?.nombre ?? null, cuando: o.creado_en, dias: this.dias(o.creado_en),
      });
    }
    for (const c of ((cobros.data ?? []) as any[])) {
      items.push({
        tipo: 'cobranza', id: c.id,
        titulo: `${c.cliente?.razon_social || c.cliente?.nombre || 'Cliente'} dejó un pago`,
        detalle: `${c.medio ?? 'efectivo'}${c.nota ? ` · ${c.nota}` : ''} · la deuda no baja hasta aprobarlo`,
        monto: Number(c.monto ?? 0), pidio: c.cargador?.nombre ?? null, cuando: c.cargada_en, dias: this.dias(c.cargada_en),
      });
    }
    for (const c of ((cambios.data ?? []) as any[])) {
      items.push({
        tipo: 'cambio_factura', id: c.id,
        titulo: `${c.tipo === 'anulacion' ? 'Anular' : 'Corregir'} factura ${c.factura?.numero ?? ''}`.trim(),
        detalle: c.motivo || 'Sin motivo declarado',
        monto: c.factura?.monto != null ? Number(c.factura.monto) : null,
        pidio: c.solicitante?.nombre ?? null, cuando: c.creado_en, dias: this.dias(c.creado_en),
      });
    }
    for (const p of ((propuestas.data ?? []) as any[])) {
      items.push({
        tipo: 'propuesta_costo', id: p.id,
        titulo: p.titulo || `Costos de ${p.proveedor?.razon_social ?? 'un proveedor'}`,
        detalle: `${(p.items ?? []).length} producto(s) cambian de costo y de precio de venta`,
        monto: null, pidio: p.autor?.nombre ?? null, cuando: p.creada_en, dias: this.dias(p.creada_en),
      });
    }

    // Lo que más tiempo lleva esperando va arriba: lo urgente no es lo caro,
    // es lo que hace días que frena a alguien.
    items.sort((a, b) => b.dias - a.dias || (b.monto ?? 0) - (a.monto ?? 0));

    const porTipo: Record<string, number> = {};
    for (const i of items) porTipo[i.tipo] = (porTipo[i.tipo] ?? 0) + 1;
    return { items, total: items.length, porTipo };
  }

  // Firmar. El que firma sale del token; el cuerpo solo puede traer el motivo.
  @Roles('dueno')
  @Post(':tipo/:id/:decision')
  async resolver(
    @Param('tipo') tipo: string,
    @Param('id') id: string,
    @Param('decision') decision: string,
    @Body() body: { motivo?: string },
    @Req() req: any,
  ) {
    if (decision !== 'aprobar' && decision !== 'rechazar') throw new BadRequestException('Decisión inválida');
    const usuarioId: string | undefined = req.usuario?.sub;
    // sin firmante no hay firma: mejor rebotar que registrar "aprobó nadie"
    if (!usuarioId) throw new BadRequestException('No pude identificar quién aprueba');
    const motivo = body?.motivo?.trim() || undefined;
    const aprueba = decision === 'aprobar';

    let resultado: any;
    switch (tipo) {
      case 'orden_compra':
        resultado = aprueba
          ? await this.compras.aprobar(id, { usuarioId })
          : await this.compras.rechazar(id, { usuarioId, motivo });
        break;
      case 'orden_pago':
        resultado = aprueba
          ? await this.compras.aprobarOrdenPago(id, { usuarioId })
          : await this.compras.rechazarOrdenPago(id, { usuarioId, motivo });
        break;
      case 'cobranza': {
        if (aprueba) {
          const { data, error } = await this.db.rpc('aprobar_cobranza', { p_id: id, p_usuario: usuarioId ?? null, p_respuesta: motivo ?? null });
          if (error) throw new BadRequestException(error.message);
          resultado = data;
          // el recibo nace con el pago aplicado, no cuando alguien se acuerda
          const saldoNuevo = Number((data as any)?.saldoNuevo ?? 0);
          const monto = Number((data as any)?.monto ?? 0);
          await this.db.rpc('emitir_documento', {
            p_tipo: 'recibo_cobranza', p_entidad: 'cobranzas_pendientes', p_entidad_id: id,
            p_usuario: usuarioId ?? null,
            p_datos: { monto, saldo_anterior: saldoNuevo + monto, saldo_nuevo: saldoNuevo },
          }).then(() => null, () => null);
        } else {
          const { error } = await this.db.from('cobranzas_pendientes')
            .update({ estado: 'rechazada', resuelta_por: usuarioId ?? null, resuelta_en: new Date().toISOString(), respuesta: motivo ?? null })
            .eq('id', id).eq('estado', 'pendiente');
          if (error) throw new BadRequestException(error.message);
          resultado = { rechazada: true };
        }
        break;
      }
      case 'cambio_factura':
        resultado = await this.compras.resolverCambioFactura(id, aprueba ? 'aprobar' : 'rechazar', motivo, usuarioId);
        break;
      case 'propuesta_costo':
        resultado = aprueba
          ? await this.mesa.aprobar(id, usuarioId)
          : await this.mesa.rechazar(id, motivo ?? '', usuarioId);
        break;
      default:
        throw new BadRequestException('Tipo de aprobación desconocido');
    }

    // La firma queda registrada aunque el circuito de origen no audite: es lo
    // que después contesta "¿quién autorizó esto?".
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: aprueba ? 'aprobacion_firmada' : 'aprobacion_rechazada',
      entidad: tipo,
      entidad_id: id,
      datos_despues: { decision, motivo: motivo ?? null, desde: 'bandeja de aprobaciones' },
    }).then(() => null, () => null);

    return { ok: true, tipo: NOMBRE_TIPO[tipo as Pendiente['tipo']] ?? tipo, ...resultado };
  }
}
