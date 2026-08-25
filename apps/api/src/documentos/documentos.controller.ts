import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// Trazabilidad de administración, al estilo de una ISO 9001: para cada compra
// tiene que poder reconstruirse la cadena entera —quién pidió, quién aprobó,
// quién recibió y contó, quién cargó la factura, quién autorizó el pago y
// quién pagó— con la fecha de cada paso y el documento con folio que lo
// respalda.
//
// Acá no se genera nada nuevo: se junta lo que cada módulo ya registra y se
// muestra en una sola línea de tiempo, más el listado de los huecos (pasos que
// quedaron sin cerrar). Los huecos son la parte útil: sin ellos la trazabilidad
// es un archivo que nadie mira.
@Controller('documentos')
export class DocumentosController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private nombres = new Map<string, string>();
  private async quien(ids: (string | null | undefined)[]) {
    const faltan = [...new Set(ids.filter((i): i is string => !!i && !this.nombres.has(i)))];
    if (faltan.length) {
      const { data } = await this.db.from('usuarios').select('id, nombre').in('id', faltan);
      for (const u of (data ?? []) as any[]) this.nombres.set(u.id, u.nombre);
    }
    return (id?: string | null) => (id ? this.nombres.get(id) ?? '—' : null);
  }

  // Libro de documentos emitidos: el índice de todos los papeles con folio.
  @Roles('administrativo', 'comprador', 'gerente', 'dueno')
  @Get()
  async libro(@Query('tipo') tipo?: string, @Query('limite') limite?: string) {
    let q = this.db
      .from('documentos')
      .select('id, tipo, folio, entidad, entidad_id, emitido_en, emitido_por, datos')
      .order('emitido_en', { ascending: false })
      .limit(Math.min(Number(limite) || 100, 300));
    if (tipo) q = q.eq('tipo', tipo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const nombre = await this.quien((data ?? []).map((d: any) => d.emitido_por));
    return (data ?? []).map((d: any) => ({ ...d, emitido_por: undefined, emitidoPor: nombre(d.emitido_por) }));
  }

  // La cadena completa de una compra, de la orden al pago.
  @Roles('administrativo', 'comprador', 'gerente', 'dueno')
  @Get('cadena/:ocId')
  async cadena(@Param('ocId') ocId: string) {
    const { data: oc } = await this.db
      .from('ordenes_compra')
      .select('id, numero, estado, total, creado_en, creada_por, aprobada_por, aprobada_en, rechazo_motivo, proveedor:proveedores(razon_social)')
      .eq('id', ocId)
      .maybeSingle();
    if (!oc) throw new BadRequestException('No existe esa orden');

    const [{ data: remitos }, { data: facturas }, { data: docs }] = await Promise.all([
      this.db.from('remitos').select('id, numero, estado, creado_en, confirmado_por, conciliado_en, conciliado_por').eq('oc_id', ocId).order('creado_en'),
      this.db.from('facturas_proveedor').select('id, numero, monto, monto_pagado, estado, creado_en, cargada_por, fecha_emision').eq('oc_id', ocId).order('creado_en'),
      this.db.from('documentos').select('tipo, folio, entidad_id, emitido_en').in('entidad_id', [ocId]),
    ]);

    const facturaIds = ((facturas ?? []) as any[]).map((f) => f.id);
    const { data: pagos } = facturaIds.length
      ? await this.db.from('facturas_proveedor_pagos').select('id, factura_id, monto, medio, creado_en, usuario_id').in('factura_id', facturaIds)
      : { data: [] as any[] };

    const remitoIds = ((remitos ?? []) as any[]).map((r) => r.id);
    const { data: docsRemito } = remitoIds.length
      ? await this.db.from('documentos').select('tipo, folio, entidad_id, emitido_en').in('entidad_id', remitoIds)
      : { data: [] as any[] };

    const nombre = await this.quien([
      (oc as any).creada_por, (oc as any).aprobada_por,
      ...((remitos ?? []) as any[]).flatMap((r) => [r.confirmado_por, r.conciliado_por]),
      ...((facturas ?? []) as any[]).map((f) => f.cargada_por),
      ...((pagos ?? []) as any[]).map((p) => p.usuario_id),
    ]);

    const folioDe = (id: string) =>
      ([...(docs ?? []), ...(docsRemito ?? [])] as any[]).find((d) => d.entidad_id === id)?.folio ?? null;

    // línea de tiempo: cada paso con su responsable y su papel
    const pasos: any[] = [];
    pasos.push({
      paso: 'Orden de compra', estado: 'hecho', cuando: (oc as any).creado_en,
      quien: nombre((oc as any).creada_por), detalle: `Orden interna #${(oc as any).numero}`, folio: folioDe(ocId),
    });
    pasos.push(
      (oc as any).aprobada_en
        ? { paso: 'Aprobación', estado: 'hecho', cuando: (oc as any).aprobada_en, quien: nombre((oc as any).aprobada_por), detalle: 'Autorizada para enviar al proveedor' }
        : (oc as any).estado === 'rechazada'
          ? { paso: 'Aprobación', estado: 'rechazado', cuando: null, quien: nombre((oc as any).aprobada_por), detalle: (oc as any).rechazo_motivo ?? 'Rechazada' }
          : { paso: 'Aprobación', estado: 'falta', cuando: null, quien: null, detalle: 'Nadie la aprobó todavía' },
    );

    if (!(remitos ?? []).length) {
      pasos.push({ paso: 'Recepción', estado: 'falta', cuando: null, quien: null, detalle: 'No se recibió mercadería contra esta orden' });
    } else {
      for (const r of (remitos ?? []) as any[]) {
        pasos.push({
          paso: 'Recepción', estado: 'hecho', cuando: r.creado_en, quien: nombre(r.confirmado_por),
          detalle: `Remito ${r.numero || 's/n'} · ${r.estado}`, folio: folioDe(r.id), remitoId: r.id,
        });
      }
    }

    if (!(facturas ?? []).length) {
      pasos.push({ paso: 'Factura', estado: 'falta', cuando: null, quien: null, detalle: 'Sin factura del proveedor' });
    } else {
      for (const f of (facturas ?? []) as any[]) {
        pasos.push({
          paso: 'Factura', estado: 'hecho', cuando: f.creado_en, quien: nombre(f.cargada_por),
          detalle: `${f.numero} · $${Math.round(Number(f.monto)).toLocaleString('es-AR')}`, facturaId: f.id,
        });
        const suyos = ((pagos ?? []) as any[]).filter((p) => p.factura_id === f.id);
        if (!suyos.length) {
          pasos.push({ paso: 'Pago', estado: 'falta', cuando: null, quien: null, detalle: `${f.numero} impaga` });
        } else {
          for (const p of suyos) {
            pasos.push({
              paso: 'Pago', estado: 'hecho', cuando: p.creado_en, quien: nombre(p.usuario_id),
              detalle: `$${Math.round(Number(p.monto)).toLocaleString('es-AR')} · ${p.medio ?? '—'}`,
            });
          }
        }
      }
    }

    const faltan = pasos.filter((p) => p.estado === 'falta').length;
    return {
      orden: { id: ocId, numero: (oc as any).numero, estado: (oc as any).estado, total: (oc as any).total, proveedor: (oc as any).proveedor?.razon_social ?? null },
      pasos,
      completa: faltan === 0,
      faltan,
    };
  }

  // Los huecos: dónde se cortó la cadena. Es la pantalla que administración
  // mira todos los días para cerrar lo que quedó abierto.
  @Roles('administrativo', 'comprador', 'gerente', 'dueno')
  @Get('huecos')
  async huecos() {
    const desde = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

    const [{ data: ocs }, { data: remitos }, { data: facturas }] = await Promise.all([
      this.db.from('ordenes_compra').select('id, numero, estado, total, creado_en, proveedor:proveedores(razon_social)').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300),
      this.db.from('remitos').select('id, numero, oc_id, factura_id, estado, creado_en, conciliado_en, proveedor:proveedores(razon_social)').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300),
      this.db.from('facturas_proveedor').select('id, numero, monto, monto_pagado, estado, oc_id, remito_id, creado_en, vencimiento, proveedor:proveedores(razon_social)').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300),
    ]);

    const ocConRemito = new Set(((remitos ?? []) as any[]).map((r) => r.oc_id).filter(Boolean));
    // El vínculo remito↔factura se guarda de los dos lados según por dónde
    // entró: la entrada directa lo escribe en facturas_proveedor.remito_id y la
    // conciliación en remitos.factura_id. Mirar uno solo daba nueve falsos
    // "recibido sin factura" con la factura cargada al lado.
    const remitoConFactura = new Set(((facturas ?? []) as any[]).map((f) => f.remito_id).filter(Boolean));
    const tieneFactura = (r: any) => !!r.factura_id || remitoConFactura.has(r.id);
    const dias = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86400000);

    return {
      // pedimos y nunca llegó (o llegó y nadie lo cargó)
      sinRecepcion: ((ocs ?? []) as any[])
        .filter((o) => ['aprobada', 'enviada'].includes(o.estado) && !ocConRemito.has(o.id))
        .map((o) => ({ id: o.id, numero: o.numero, proveedor: o.proveedor?.razon_social ?? null, total: o.total, dias: dias(o.creado_en) })),
      // entró mercadería y no hay factura: deuda que no está registrada
      sinFactura: ((remitos ?? []) as any[])
        .filter((r) => !tieneFactura(r))
        .map((r) => ({ id: r.id, numero: r.numero, proveedor: r.proveedor?.razon_social ?? null, dias: dias(r.creado_en) })),
      // hay remito y hay factura, pero nadie cruzó una contra la otra: se paga
      // lo que dice el proveedor sin haberlo contrastado con lo que se contó
      sinConciliar: ((remitos ?? []) as any[])
        .filter((r) => tieneFactura(r) && !r.conciliado_en)
        .map((r) => ({ id: r.id, numero: r.numero, proveedor: r.proveedor?.razon_social ?? null, dias: dias(r.creado_en) })),
      // factura cargada sin respaldo de recepción: se paga algo que nadie contó
      sinRespaldo: ((facturas ?? []) as any[])
        .filter((f) => !f.remito_id && !f.oc_id)
        .map((f) => ({ id: f.id, numero: f.numero, proveedor: f.proveedor?.razon_social ?? null, monto: f.monto, dias: dias(f.creado_en) })),
      // vencida e impaga
      vencidas: ((facturas ?? []) as any[])
        .filter((f) => f.vencimiento && new Date(f.vencimiento) < new Date() && Number(f.monto_pagado ?? 0) < Number(f.monto))
        .map((f) => ({ id: f.id, numero: f.numero, proveedor: f.proveedor?.razon_social ?? null, saldo: Number(f.monto) - Number(f.monto_pagado ?? 0), dias: dias(f.vencimiento) })),
    };
  }
}
