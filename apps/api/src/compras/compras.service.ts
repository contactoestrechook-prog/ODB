import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { ordenDeCompraPDF, remitoRecepcionPDF } from '../comun/documentos';
import { precioDesdeCosto, margenAplicable } from './precio';
import { normalizarAlias } from '../listas/listas.service';

export type CrearOcDto = {
  proveedorId: string;
  sucursalId: string;
  // costoUnitario opcional: si falta, se toma el último costo del proveedor
  items: { sku: string; cantidad: number; costoUnitario?: number }[];
  usuarioId?: string;
  fechaEntrega?: string;
  condicionPago?: string;
  vencimientoPago?: string;
  observaciones?: string;
};

export type AprobarDto = { usuarioId?: string; pin?: string };
export type RecibirDto = {
  // costo opcional por renglón = costo REAL de esta entrada (si falta, usa el de la OC)
  // lote/vencimiento opcionales: si vienen, la recepción crea el lote (panel de vencimientos)
  // margenPct por renglón = remarcación de ESE producto. Se guarda al recibir y
  // vuelve sola la próxima vez que entra el mismo producto del mismo proveedor.
  // fijarMargen = "este % pasa a ser el habitual". Sin eso, un % distinto al
  // aprendido vale SOLO para esta entrada (promoción, oferta puntual).
  items: { sku: string; cantidad: number; costo?: number; lote?: string; vencimiento?: string; margenPct?: number; fijarMargen?: boolean }[];
  usuarioId?: string;
  margenPct?: number; // % general de esta recepción (si falta, el del renglón; si no, el del rubro)
};

export type EntradaDirectaDto = {
  proveedorId: string;
  sucursalId: string;
  numeroRemito?: string;
  // margenPct por renglón = remarcación de ESE producto (editable en la pantalla,
  // default 50%). descripcionLeida = texto que leyó la IA, para aprender el
  // vínculo y traerlo solo la próxima compra (ver aprenderVinculos).
  items: { sku: string; cantidad: number; costo: number; lote?: string; vencimiento?: string; margenPct?: number; fijarMargen?: boolean; descripcionLeida?: string }[];
  margenPct?: number;
  usuarioId?: string;
  // si la mercadería vino con factura, se registra junto con la entrada,
  // con su desglose fiscal y vinculada a la OC/remito (nada de facturas flotantes)
  factura?: {
    numero: string;
    total: number;
    neto?: number;
    iva?: number;
    percepcionIva?: number;
    percepcionIibb?: number;
    impuestosInternos?: number;
    otros?: number;
    letra?: string; // A | B | C
    fechaEmision?: string;
    vencimiento?: string;
    condicionVenta?: string;
    archivoUrl?: string; // comprobante original en el bucket
    pagada?: boolean; // contado en el momento → nace pagada
  };
};

@Injectable()
export class ComprasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async proveedores() {
    const { data, error } = await this.db
      .from('proveedores')
      .select('id, razon_social, cuit, condicion_pago, lead_time_dias, email')
      .eq('activo', true)
      .order('razon_social');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async sugerencias() {
    const { data, error } = await this.db
      .from('sugerencias_compra')
      .select('*');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async ordenes() {
    const { data, error } = await this.db
      .from('ordenes_compra')
      .select(
        `numero, id, estado, total, origen, creado_en, fecha_entrega, condicion_pago, vencimiento_pago, observaciones, descuento, aprobada_en, rechazo_motivo, proveedor_id,
         proveedor:proveedores(razon_social),
         sucursal:sucursales(nombre),
         items:ordenes_compra_items(cantidad, cantidad_recibida, costo_unitario, producto:productos(sku, nombre)),
         creador:usuarios!ordenes_compra_creada_por_fkey(nombre)`,
      )
      .order('numero', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const ids = (data ?? []).map((o: any) => o.id);
    const firmas = new Map<string, string>();
    if (ids.length) {
      const { data: aps } = await this.db
        .from('aprobaciones')
        .select('entidad_id, usuario:usuarios(nombre)')
        .eq('entidad', 'orden_compra')
        .in('entidad_id', ids);
      for (const a of (aps ?? []) as any[]) {
        firmas.set(a.entidad_id, a.usuario?.nombre ?? null);
      }
    }
    return (data ?? []).map((o: any) => ({ ...o, firmadaPor: firmas.get(o.id) ?? null }));
  }

  // Documento formal de la orden de compra, con folio de la casa. El folio lo
  // asigna la base y NO se renumera al reimprimir: si se emitió una vez, la
  // segunda descarga trae el mismo papel. Eso es lo que lo hace trazable.
  async documentoOrdenCompra(id: string, usuarioId?: string) {
    const oc = await this.ordenDetalle(id);
    const { data: doc, error } = await this.db.rpc('emitir_documento', {
      p_tipo: 'orden_compra',
      p_entidad: 'ordenes_compra',
      p_entidad_id: id,
      p_usuario: usuarioId ?? null,
      p_datos: { numero: (oc as any).numero, total: (oc as any).total, proveedor: (oc as any).proveedor?.razon_social ?? null },
    });
    if (error) throw new BadRequestException(error.message);

    const { data: emisor } = usuarioId
      ? await this.db.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle()
      : { data: null as any };

    return ordenDeCompraPDF({
      folio: (doc as any).folio,
      emitidoEn: (doc as any).emitido_en,
      numeroInterno: (oc as any).numero,
      fecha: (oc as any).creado_en,
      proveedor: (oc as any).proveedor ?? null,
      sucursal: (oc as any).sucursal?.nombre ?? null,
      condicionPago: (oc as any).condicion_pago ?? null,
      fechaEntrega: (oc as any).fecha_entrega ?? null,
      observaciones: (oc as any).observaciones ?? null,
      items: ((oc as any).items ?? []).map((i: any) => ({
        nombre: i.producto?.nombre ?? '—',
        sku: i.producto?.sku ?? null,
        cantidad: Number(i.cantidad),
        costo_unitario: Number(i.costo_unitario),
      })),
      total: Number((oc as any).total ?? 0),
      emitidaPor: emisor?.nombre ?? (oc as any).creador?.nombre ?? null,
      aprobadaPor: (oc as any).firmadaPor ?? null,
    });
  }

  // Detalle de una orden: qué se pidió, qué llegó y con qué papeles. Antes la
  // pantalla de Compras mostraba la orden como un renglón muerto — para ver la
  // factura de esa compra había que buscarla a mano en otra pantalla, así que
  // ante una duda nadie la miraba.
  async ordenDetalle(id: string) {
    const { data: oc, error } = await this.db
      .from('ordenes_compra')
      .select(
        `numero, id, estado, total, origen, creado_en, fecha_entrega, condicion_pago, vencimiento_pago, observaciones, descuento, rechazo_motivo,
         proveedor:proveedores(razon_social, cuit),
         sucursal:sucursales(nombre),
         items:ordenes_compra_items(cantidad, cantidad_recibida, costo_unitario, producto:productos(sku, nombre)),
         creador:usuarios!ordenes_compra_creada_por_fkey(nombre)`,
      )
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);

    const [{ data: remitos }, { data: facturas }] = await Promise.all([
      this.db.from('remitos').select('id, numero, estado, creado_en').eq('oc_id', id).order('creado_en'),
      this.db
        .from('facturas_proveedor')
        .select('id, numero, letra, tipo, monto, monto_pagado, estado, fecha_emision, creado_en, archivo_url, cargador:usuarios!facturas_proveedor_cargada_por_fkey(nombre)')
        .eq('oc_id', id)
        .order('creado_en'),
    ]);

    return {
      ...oc,
      remitos: remitos ?? [],
      // tieneComprobante: si hay imagen o PDF escaneado para mirar
      facturas: ((facturas ?? []) as any[]).map(({ archivo_url, ...f }) => ({ ...f, tieneComprobante: !!archivo_url })),
    };
  }

  async crear(dto: CrearOcDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => {
        const productoId = await this.productoIdPorSku(i.sku);
        let costo = i.costoUnitario != null ? Number(i.costoUnitario) : null;
        if (costo == null) {
          const { data: pp } = await this.db
            .from('proveedor_productos')
            .select('ultimo_costo')
            .eq('proveedor_id', dto.proveedorId)
            .eq('producto_id', productoId)
            .maybeSingle();
          costo = pp?.ultimo_costo != null ? Number(pp.ultimo_costo) : null;
          if (costo == null) {
            const { data: prod } = await this.db
              .from('productos')
              .select('costo')
              .eq('id', productoId)
              .single();
            costo = Number(prod?.costo ?? 0);
          }
        }
        return { producto_id: productoId, cantidad: Number(i.cantidad), costo_unitario: costo };
      }),
    );
    const { data, error } = await this.db.rpc('crear_orden_compra', {
      p_proveedor: dto.proveedorId,
      p_sucursal: dto.sucursalId,
      p_items: items,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const ordenCompraId = data;
    const detalle: Record<string, any> = {};
    if (dto.fechaEntrega) detalle.fecha_entrega = dto.fechaEntrega;
    if (dto.condicionPago) detalle.condicion_pago = dto.condicionPago;
    if (dto.vencimientoPago) detalle.vencimiento_pago = dto.vencimientoPago;
    if (dto.observaciones) detalle.observaciones = dto.observaciones;
    if (Object.keys(detalle).length) await this.db.from('ordenes_compra').update(detalle).eq('id', ordenCompraId);
    return { ordenCompraId };
  }

  // Aprobación EXCLUSIVA del dueño (el controller la restringe a rol 'dueno').
  // RPC atómica: la OC nunca queda aprobada sin su registro de auditoría.
  async aprobar(id: string, dto: AprobarDto) {
    const { error } = await this.db.rpc('aprobar_oc_panel', { p_oc: id, p_usuario: dto.usuarioId ?? null });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { aprobada: true };
  }

  async rechazar(id: string, dto: { usuarioId?: string; motivo?: string }) {
    const { data: oc } = await this.db.from('ordenes_compra').select('estado').eq('id', id).maybeSingle();
    if (!oc) throw new BadRequestException('No existe la orden de compra');
    if (!['pendiente_aprobacion', 'borrador'].includes(oc.estado)) throw new BadRequestException(`No se puede rechazar una orden "${oc.estado}"`);
    const { error } = await this.db.from('ordenes_compra')
      .update({ estado: 'cancelada', rechazo_motivo: dto.motivo || 'Rechazada por dirección', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { rechazada: true };
  }

  // Recepción + "regla de oro" (costo real → precio de venta) en UNA transacción
  // (RPC recibir_oc_con_precio): no puede quedar stock ingresado con precios viejos.
  async recibir(id: string, dto: RecibirDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
        lote: i.lote ?? null,
        vencimiento: i.vencimiento ?? null,
      })),
    );
    const itemsPrecio = await this.itemsPrecioRecepcion(id, dto);
    const { data, error } = await this.db.rpc('recibir_oc_con_precio', {
      p_oc: id,
      p_items: items,
      p_items_precio: itemsPrecio,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));

    // recibir por OC también deja aprendida la remarcación de cada producto:
    // antes solo la aprendía la entrada directa, así que la misma mercadería
    // pedía el porcentaje de nuevo según por dónde hubiera entrado
    const { data: oc } = await this.db.from('ordenes_compra').select('proveedor_id').eq('id', id).maybeSingle();
    if (oc?.proveedor_id) {
      await this.aprenderVinculos(
        oc.proveedor_id,
        (dto.items ?? [])
          .filter((i) => i.margenPct != null)
          .map((i) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: Number(i.costo) || 0, margenPct: i.margenPct, fijarMargen: i.fijarMargen })),
      );
    }
    return { estado: (data as any).estado, repreciados: Number((data as any).repreciados) || 0 };
  }

  // Entrada directa: la mercadería llegó SIN orden de compra previa (caso diario:
  // compra de oportunidad, reparto que pasa, emergencia). La RPC crea la OC
  // retroactiva con origen 'directa' + remito + stock + lotes + regla de oro,
  // todo en una transacción — con trazabilidad real, sin OC "truchas" a mano.
  async entradaDirecta(dto: EntradaDirectaDto) {
    if (!dto.items?.length) throw new BadRequestException('La entrada no tiene renglones');

    // Los renglones se revisan ACÁ, uno por uno y nombrándolos. Antes bajaban
    // crudos a la RPC: una cantidad que no era número (el lector de facturas
    // devuelve "2 x 6", o alguien borra el casillero) reventaba contra la base y
    // el panel mostraba un error de Postgres que no le dice nada a nadie. La
    // guardia de la RPC tampoco lo agarra: comparar NULL contra cero no da ni
    // verdadero ni falso, así que pasaba de largo.
    const malos: string[] = [];
    dto.items.forEach((i, n) => {
      const cual = i.descripcionLeida?.trim() || i.sku || `renglón ${n + 1}`;
      const cantidad = Number(i.cantidad);
      const costo = Number(i.costo);
      if (!Number.isFinite(cantidad) || cantidad <= 0) malos.push(`${cual}: la cantidad tiene que ser un número mayor a cero`);
      else if (i.costo != null && (!Number.isFinite(costo) || costo < 0)) malos.push(`${cual}: el costo no es un número válido`);
      else if (!i.sku) malos.push(`${cual}: falta elegir a qué producto corresponde`);
    });
    if (malos.length) {
      throw new BadRequestException(
        malos.length === 1
          ? `No pude registrar la entrada — ${malos[0]}.`
          : `No pude registrar la entrada. Revisá estos renglones: ${malos.join(' · ')}.`,
      );
    }

    const items = await Promise.all(
      dto.items.map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
        costo_unitario: Number(i.costo) || 0,
        lote: i.lote ?? null,
        vencimiento: i.vencimiento ?? null,
      })),
    );

    // regla de oro con el margen del rubro de cada producto (o el % indicado)
    const skus = dto.items.map((i) => i.sku);
    const { data: prods } = await this.db
      .from('productos')
      .select('sku, categoria:categorias(margen_sugerido)')
      .in('sku', skus);
    const margenPor = new Map<string, number | null>(
      ((prods ?? []) as any[]).map((p) => [p.sku, p.categoria?.margen_sugerido ?? null]),
    );
    // Remarcación por renglón (lo que el usuario editó en la pantalla), con
    // fallback al override general → margen del rubro → default.
    const itemsPrecio = dto.items
      .filter((i) => Number(i.costo) > 0)
      .map((i) => {
        const margen = margenAplicable(i.margenPct ?? dto.margenPct, margenPor.get(i.sku) ?? null);
        return { sku: i.sku, costo: Number(i.costo), precio: precioDesdeCosto(Number(i.costo), margen) };
      });

    const { data, error } = await this.db.rpc('recibir_compra_directa', {
      p_proveedor: dto.proveedorId,
      p_sucursal: dto.sucursalId,
      p_items: items,
      p_numero_remito: dto.numeroRemito ?? null,
      p_usuario: dto.usuarioId ?? null,
      p_items_precio: itemsPrecio,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const resultado = data as any;

    // Aprende el vínculo renglón→producto y la remarcación, para que la próxima
    // compra del mismo proveedor matchee sola y traiga el margen anterior.
    await this.aprenderVinculos(dto.proveedorId, dto.items);

    // factura del proveedor: nace vinculada a la OC y al remito de esta entrada,
    // con el desglose de impuestos (IVA, percepciones) para el libro IVA compras
    if (dto.factura?.numero && Number(dto.factura.total) > 0) {
      const f = dto.factura;
      // empresa fiscal: la de la sucursal que recibió (para el libro IVA correcto)
      let empresa: string | null = null;
      const { data: suc } = await this.db.from('sucursales').select('arca_emisor').eq('id', dto.sucursalId).maybeSingle();
      empresa = (suc as any)?.arca_emisor ?? null;
      const { data: dataF, error: errF } = await this.db.from('facturas_proveedor').insert({
        proveedor_id: dto.proveedorId,
        numero: f.numero,
        tipo: 'factura',
        letra: f.letra ?? null,
        monto: Number(f.total),
        neto: f.neto != null ? Number(f.neto) : null,
        iva: f.iva != null ? Number(f.iva) : null,
        percepcion_iva: Number(f.percepcionIva ?? 0),
        percepcion_iibb: Number(f.percepcionIibb ?? 0),
        impuestos_internos: Number(f.impuestosInternos ?? 0),
        otros_impuestos: Number(f.otros ?? 0),
        fecha_emision: f.fechaEmision ?? null,
        vencimiento: f.vencimiento ?? null,
        condicion_venta: f.condicionVenta ?? null,
        empresa,
        archivo_url: f.archivoUrl ?? null,
        estado: f.pagada ? 'pagada' : 'pendiente',
        monto_pagado: f.pagada ? Number(f.total) : 0,
        oc_id: resultado.oc_id,
        remito_id: resultado.remito_id,
        cargada_por: dto.usuarioId ?? null,
      })
        .select('id')
        .single();
      if (!errF && dataF?.id) {
        // renglones de la factura con el precio LEÍDO del papel (no el costo
        // prorrateado): son la base del cruce contra remitos
        await this.guardarItemsFactura(dataF.id, dto.items.map((i) => ({
          sku: i.sku,
          descripcion: i.descripcionLeida ?? i.sku,
          cantidad: i.cantidad,
          precio: (i as any).precioLeido ?? i.costo,
        }))).catch(() => {});
      }
      if (errF) {
        // la entrada ya está registrada (stock movido): no se revierte por la
        // factura — se avisa y se puede cargar desde Compras → Registrar factura
        resultado.facturaError = errF.message;
      } else {
        resultado.factura = { numero: f.numero, total: Number(f.total), estado: f.pagada ? 'pagada' : 'pendiente' };
      }
    }
    return resultado;
  }

  // Calcula los renglones {sku, costo, precio} para la regla de oro. Solo lee la OC
  // (no escribe): la escritura la hace la RPC transaccional junto con la recepción.
  private async itemsPrecioRecepcion(ocId: string, dto: RecibirDto): Promise<{ sku: string; costo: number; precio: number }[]> {
    const { data: oc } = await this.db
      .from('ordenes_compra')
      .select('proveedor_id, items:ordenes_compra_items(costo_unitario, producto:productos(sku, categoria:categorias(margen_sugerido)))')
      .eq('id', ocId)
      .single();
    if (!oc?.proveedor_id) return [];

    const info = new Map<string, { costo: number; margenRubro: number | null }>();
    for (const it of (oc.items ?? []) as any[]) {
      const sku = it.producto?.sku;
      if (sku) info.set(sku, { costo: Number(it.costo_unitario) || 0, margenRubro: it.producto?.categoria?.margen_sugerido ?? null });
    }

    const items: { sku: string; costo: number; precio: number }[] = [];
    for (const r of dto.items ?? []) {
      const i = info.get(r.sku);
      if (!i) continue;
      const costo = r.costo != null && Number(r.costo) > 0 ? Number(r.costo) : i.costo;
      if (!(costo > 0)) continue;
      const margen = margenAplicable(r.margenPct ?? dto.margenPct, i.margenRubro);
      items.push({ sku: r.sku, costo, precio: precioDesdeCosto(costo, margen) });
    }
    return items;
  }

  // Qué remarcación usar para estos productos con este proveedor. Devuelve la
  // aprendida en la última entrada (la que se editó a mano) y, como respaldo, la
  // sugerida del rubro. Con esto la pantalla propone el porcentaje en lugar de
  // pedirlo de nuevo cada vez que entra la misma mercadería.
  async remarcacionDe(proveedorId: string, skus: string[]) {
    const limpios = (skus ?? []).map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 200);
    if (!limpios.length) return {};

    const { data: prods } = await this.db
      .from('productos')
      .select('id, sku, categoria:categorias(margen_sugerido)')
      .in('sku', limpios);

    const porId = new Map<string, any>(((prods ?? []) as any[]).map((p) => [p.id, p]));
    let aprendidas: any[] = [];
    if (proveedorId && porId.size) {
      const { data } = await this.db
        .from('proveedor_productos')
        .select('producto_id, margen_pct, ultimo_costo')
        .eq('proveedor_id', proveedorId)
        .in('producto_id', [...porId.keys()]);
      aprendidas = data ?? [];
    }
    const porProducto = new Map<string, any>(aprendidas.map((a) => [a.producto_id, a]));

    const salida: Record<string, { margenPct: number | null; margenRubro: number | null; ultimoCosto: number | null }> = {};
    for (const p of (prods ?? []) as any[]) {
      const a = porProducto.get(p.id);
      salida[p.sku] = {
        margenPct: a?.margen_pct != null ? Number(a.margen_pct) : null,
        margenRubro: p.categoria?.margen_sugerido != null ? Number(p.categoria.margen_sugerido) : null,
        ultimoCosto: a?.ultimo_costo != null ? Number(a.ultimo_costo) : null,
      };
    }
    return salida;
  }

  // ---------- resumen (KPIs) ----------
  async resumen() {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const [ocs, sug, facturas] = await Promise.all([
      this.db.from('ordenes_compra').select('estado, total, creado_en'),
      this.db.from('sugerencias_compra').select('sku'),
      this.db.from('facturas_proveedor').select('monto, estado'),
    ]);
    const o = (ocs.data ?? []) as any[];
    const compradoMes = o
      .filter((x) => !['borrador', 'cancelada'].includes(x.estado) && new Date(x.creado_en) >= inicioMes)
      .reduce((s, x) => s + Number(x.total), 0);
    const deuda = ((facturas.data ?? []) as any[])
      .filter((f) => f.estado !== 'pagada')
      .reduce((s, f) => s + Number(f.monto), 0);
    return {
      compradoMes: Math.round(compradoMes),
      pendientesAprobacion: o.filter((x) => x.estado === 'pendiente_aprobacion').length,
      porRecibir: o.filter((x) => ['aprobada', 'enviada', 'recibida_parcial'].includes(x.estado)).length,
      sugerencias: (sug.data ?? []).length,
      deudaProveedores: Math.round(deuda),
    };
  }

  // ---------- proveedores CRUD ----------
  async crearProveedor(dto: any) {
    if (!dto.razonSocial?.trim()) throw new BadRequestException('La razón social es obligatoria');
    const { data, error } = await this.db
      .from('proveedores')
      .insert({
        razon_social: dto.razonSocial.trim(),
        cuit: dto.cuit || null,
        condicion_pago: dto.condicionPago || null,
        lead_time_dias: Number(dto.leadTimeDias) || 7,
        email: dto.email || null,
        telefono: dto.telefono || null,
      })
      .select('id')
      .single();
    if (error) {
      throw new BadRequestException(error.code === '23505' ? 'Ya existe un proveedor con ese CUIT' : error.message);
    }
    return { id: data.id };
  }

  async editarProveedor(id: string, dto: any) {
    const cambios: Record<string, any> = {};
    if (dto.razonSocial !== undefined) cambios.razon_social = dto.razonSocial;
    if (dto.cuit !== undefined) cambios.cuit = dto.cuit || null;
    if (dto.condicionPago !== undefined) cambios.condicion_pago = dto.condicionPago;
    if (dto.leadTimeDias !== undefined) cambios.lead_time_dias = Number(dto.leadTimeDias) || 7;
    if (dto.email !== undefined) cambios.email = dto.email;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (!Object.keys(cambios).length) return { ok: true };
    const { error } = await this.db.from('proveedores').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---------- órdenes de pago (cuentas a pagar) ----------
  async deudaProveedores() {
    const { data, error } = await this.db
      .from('facturas_proveedor')
      .select('id, numero, tipo, monto, monto_pagado, vencimiento, estado, creado_en, proveedor:proveedores(id, razon_social)')
      .not('estado', 'in', '("pagada","en_pago","anulada")')
      .order('vencimiento', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const porProv = new Map<string, any>();
    for (const f of (data ?? []) as any[]) {
      const id = f.proveedor?.id ?? 'sin';
      const acc = porProv.get(id) ?? { proveedor: f.proveedor, total: 0, facturas: [] };
      // deuda real: saldo pendiente (monto - pagos parciales); las NC restan
      const saldo = Math.max(Number(f.monto) - Number(f.monto_pagado || 0), 0) * (f.tipo === 'nota_credito' ? -1 : 1);
      acc.total += saldo;
      acc.facturas.push({ id: f.id, numero: f.numero, tipo: f.tipo, monto: Math.abs(saldo), vencimiento: f.vencimiento, estado: f.estado });
      porProv.set(id, acc);
    }
    return [...porProv.values()].map((p) => ({ ...p, total: Math.round(p.total) })).sort((a, b) => b.total - a.total);
  }

  // Detalle completo de una factura de proveedor: encabezado + desglose fiscal +
  // los renglones del remito de esa entrada. Para poder abrirla y revisarla.
  async facturaDetalle(id: string) {
    const { data: f, error } = await this.db
      .from('facturas_proveedor')
      .select('id, numero, tipo, letra, monto, monto_pagado, neto, iva, percepcion_iva, percepcion_iibb, impuestos_internos, otros_impuestos, fecha_emision, vencimiento, estado, empresa, categoria_gasto, condicion_venta, archivo_url, notas, creado_en, remito_id, oc_id, cargada_por, cargador:usuarios!facturas_proveedor_cargada_por_fkey(nombre), proveedor:proveedores(razon_social, cuit)')
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);

    // pagos parciales registrados sobre esta factura
    const { data: pagos } = await this.db
      .from('facturas_proveedor_pagos')
      .select('monto, medio, nota, creado_en')
      .eq('factura_id', id)
      .order('creado_en', { ascending: true });

    // comprobante original: URL firmada temporal (el bucket es privado)
    let comprobanteUrl: string | null = null;
    if (f.archivo_url) {
      const { data: firma } = await this.db.storage.from('comprobantes').createSignedUrl(f.archivo_url, 3600);
      comprobanteUrl = firma?.signedUrl ?? null;
    }
    (f as any).pagos = pagos ?? [];
    (f as any).comprobanteUrl = comprobanteUrl;
    (f as any).saldo = Math.max(Number(f.monto) - Number((f as any).monto_pagado || 0), 0);
    let items: any[] = [];
    if (f.remito_id) {
      const { data: ri } = await this.db
        .from('remitos_items')
        .select('cantidad, lote, vencimiento, producto:productos(sku, nombre, costo)')
        .eq('remito_id', f.remito_id);
      items = ((ri ?? []) as any[]).map((x) => ({
        sku: x.producto?.sku ?? null,
        nombre: x.producto?.nombre ?? '(producto eliminado)',
        cantidad: Number(x.cantidad),
        costo: x.producto?.costo != null ? Number(x.producto.costo) : null,
        lote: x.lote ?? null,
        vencimiento: x.vencimiento ?? null,
      }));
    }
    return { ...f, items };
  }

  // Carga manual completa: facturas de mercadería, GASTOS (sin stock, con
  // categoría) y notas de crédito/débito, con desglose fiscal y multi-empresa.
  async registrarFactura(dto: any, usuarioId?: string) {
    if (!dto.proveedorId || !dto.numero || !(Number(dto.monto) > 0)) {
      throw new BadRequestException('Proveedor, número y monto son obligatorios');
    }
    const tipo = ['factura', 'nota_credito', 'nota_debito'].includes(dto.tipo) ? dto.tipo : 'factura';
    // aviso de duplicado: mismo proveedor + mismo número (no bloquea NC sobre la misma numeración)
    const { data: dup } = await this.db
      .from('facturas_proveedor')
      .select('id')
      .eq('proveedor_id', dto.proveedorId)
      .eq('numero', String(dto.numero))
      .eq('tipo', tipo)
      .neq('estado', 'anulada')
      .limit(1);
    if (dup?.length && !dto.permitirDuplicado) {
      throw new BadRequestException('Ya existe un comprobante con ese número para este proveedor. Si es correcto, marcá "cargar igual".');
    }
    const n = (v: any) => (v != null && v !== '' ? Number(v) : null);
    // sin empresa explícita pero con sucursal: la empresa fiscal sale de ahí
    let empresa = dto.empresa || null;
    if (!empresa && dto.sucursalId) {
      const { data: suc } = await this.db.from('sucursales').select('arca_emisor').eq('id', dto.sucursalId).maybeSingle();
      empresa = (suc as any)?.arca_emisor ?? null;
    }
    const { data, error } = await this.db
      .from('facturas_proveedor')
      .insert({
        proveedor_id: dto.proveedorId,
        numero: String(dto.numero),
        tipo,
        letra: dto.letra || null,
        monto: Number(dto.monto),
        neto: n(dto.neto),
        iva: n(dto.iva),
        percepcion_iva: Number(dto.percepcionIva ?? 0),
        percepcion_iibb: Number(dto.percepcionIibb ?? 0),
        impuestos_internos: Number(dto.impuestosInternos ?? 0),
        otros_impuestos: Number(dto.otros ?? 0),
        fecha_emision: dto.fechaEmision || null,
        vencimiento: dto.vencimiento || null,
        empresa,
        categoria_gasto: dto.categoriaGasto || null,
        condicion_venta: dto.condicionVenta || null,
        notas: dto.notas || null,
        archivo_url: dto.archivoUrl || null,
        estado: dto.pagada ? 'pagada' : 'pendiente',
        monto_pagado: dto.pagada ? Number(dto.monto) : 0,
        cargada_por: usuarioId ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    // renglones de la factura: alimentan el cruce contra remitos y el detalle
    if (Array.isArray(dto.items) && dto.items.length) {
      await this.guardarItemsFactura(data.id, dto.items);
    }
    return { ok: true, id: data.id };
  }

  // Listado completo con filtros para el back office
  async listarFacturas(q: any) {
    const pagina = Math.max(Number(q.pagina) || 1, 1);
    const porPagina = Math.min(Math.max(Number(q.porPagina) || 50, 1), 200);
    let query = this.db
      .from('facturas_proveedor')
      .select(
        'id, numero, tipo, letra, monto, monto_pagado, neto, iva, percepcion_iva, percepcion_iibb, impuestos_internos, otros_impuestos, fecha_emision, vencimiento, estado, empresa, categoria_gasto, condicion_venta, archivo_url, notas, creado_en, cargada_por, cargador:usuarios!facturas_proveedor_cargada_por_fkey(nombre), proveedor:proveedores(id, razon_social)',
        { count: 'exact' },
      );
    if (q.estado === 'vencidas') {
      query = query.not('estado', 'in', '("pagada","anulada")').lt('vencimiento', new Date().toISOString().slice(0, 10));
    } else if (q.estado && q.estado !== 'todas') {
      query = query.eq('estado', q.estado);
    }
    if (q.proveedorId) query = query.eq('proveedor_id', q.proveedorId);
    if (q.empresa) query = query.eq('empresa', q.empresa);
    if (q.tipo) query = query.eq('tipo', q.tipo);
    if (q.categoria === 'mercaderia') query = query.is('categoria_gasto', null);
    else if (q.categoria === 'gastos') query = query.not('categoria_gasto', 'is', null);
    else if (q.categoria) query = query.eq('categoria_gasto', q.categoria);
    if (q.desde) query = query.gte('creado_en', q.desde);
    if (q.hasta) query = query.lte('creado_en', q.hasta + 'T23:59:59');
    if (q.buscar) query = query.ilike('numero', `%${String(q.buscar).trim()}%`);
    if (q.cargadaPor) query = query.eq('cargada_por', String(q.cargadaPor)); // "Mis facturas"
    const orden = ['vencimiento', 'monto', 'creado_en', 'fecha_emision'].includes(q.orden) ? q.orden : 'creado_en';
    query = query.order(orden, { ascending: q.dir === 'asc', nullsFirst: false });
    query = query.range((pagina - 1) * porPagina, pagina * porPagina - 1);

    const { data, count, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const hoy = new Date().toISOString().slice(0, 10);
    const items = ((data ?? []) as any[]).map((f) => ({
      ...f,
      saldo: Math.max(Number(f.monto) - Number(f.monto_pagado || 0), 0),
      vencida: !!f.vencimiento && f.vencimiento < hoy && !['pagada', 'anulada'].includes(f.estado),
    }));
    return { items, total: count ?? items.length, pagina, porPagina };
  }

  // Tablero: cuánto se debe, qué está vencido y qué vence pronto (por empresa)
  async resumenFacturas() {
    const { data, error } = await this.db
      .from('facturas_proveedor')
      .select('tipo, monto, monto_pagado, vencimiento, estado, empresa')
      .not('estado', 'in', '("pagada","anulada")');
    if (error) throw new BadRequestException(error.message);
    const hoy = new Date();
    const d = (dias: number) => new Date(hoy.getTime() + dias * 86400000).toISOString().slice(0, 10);
    const hoyS = hoy.toISOString().slice(0, 10);
    let total = 0, vencido = 0, sem = 0, mes = 0;
    const porEmpresa: Record<string, number> = {};
    for (const f of (data ?? []) as any[]) {
      const saldo = Math.max(Number(f.monto) - Number(f.monto_pagado || 0), 0) * (f.tipo === 'nota_credito' ? -1 : 1);
      total += saldo;
      const emp = f.empresa || 'sin_asignar';
      porEmpresa[emp] = (porEmpresa[emp] || 0) + saldo;
      if (f.vencimiento) {
        if (f.vencimiento < hoyS) vencido += saldo;
        else if (f.vencimiento <= d(7)) sem += saldo;
        else if (f.vencimiento <= d(30)) mes += saldo;
      }
    }
    const r = (x: number) => Math.round(x);
    return { total: r(total), vencido: r(vencido), venceSemana: r(sem), venceMes: r(mes), porEmpresa: Object.fromEntries(Object.entries(porEmpresa).map(([k, v]) => [k, r(v)])) };
  }

  // Edición del encabezado y el desglose fiscal (con auditoría)
  async editarFactura(id: string, dto: any, usuarioId?: string) {
    const { data: f } = await this.db.from('facturas_proveedor').select('estado').eq('id', id).maybeSingle();
    if (!f) throw new BadRequestException('Factura inexistente');
    if (f.estado === 'anulada') throw new BadRequestException('La factura está anulada: no se puede editar');
    const n = (v: any) => (v != null && v !== '' ? Number(v) : null);
    const cambios: Record<string, any> = {};
    if (dto.numero !== undefined) cambios.numero = String(dto.numero);
    if (dto.letra !== undefined) cambios.letra = dto.letra || null;
    if (dto.monto !== undefined && Number(dto.monto) > 0) cambios.monto = Number(dto.monto);
    for (const [k, col] of [['neto', 'neto'], ['iva', 'iva']] as const) {
      if (dto[k] !== undefined) cambios[col] = n(dto[k]);
    }
    for (const [k, col] of [['percepcionIva', 'percepcion_iva'], ['percepcionIibb', 'percepcion_iibb'], ['impuestosInternos', 'impuestos_internos'], ['otros', 'otros_impuestos']] as const) {
      if (dto[k] !== undefined) cambios[col] = Number(dto[k] ?? 0);
    }
    if (dto.fechaEmision !== undefined) cambios.fecha_emision = dto.fechaEmision || null;
    if (dto.vencimiento !== undefined) cambios.vencimiento = dto.vencimiento || null;
    if (dto.empresa !== undefined) cambios.empresa = dto.empresa || null;
    if (dto.categoriaGasto !== undefined) cambios.categoria_gasto = dto.categoriaGasto || null;
    if (dto.condicionVenta !== undefined) cambios.condicion_venta = dto.condicionVenta || null;
    if (dto.notas !== undefined) cambios.notas = dto.notas || null;
    if (!Object.keys(cambios).length) return { ok: true };
    const { error } = await this.db.from('facturas_proveedor').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.db.from('auditoria').insert({ usuario_id: usuarioId ?? null, accion: 'editar_factura_proveedor', entidad: 'facturas_proveedor', entidad_id: id, datos_despues: { campos: Object.keys(cambios) } });
    return { ok: true };
  }

  // ---- Solicitudes de cambio sobre facturas (backoffice → dueño) ----
  // Quien carga no edita ni anula: pide el cambio con motivo, queda pendiente, y un
  // dueño (Juan Pablo) lo aprueba o rechaza por sistema. Al aprobar se aplica con
  // la misma lógica que la edición directa. Todo queda trazado: quién pidió,
  // quién resolvió, cuándo, y la auditoría de la edición resultante.
  async solicitarCambioFactura(facturaId: string, dto: { cambios?: Record<string, any>; motivo?: string; tipo?: 'editar' | 'anular' }, usuarioId?: string) {
    const { data: f } = await this.db.from('facturas_proveedor').select('id, numero, estado, proveedor:proveedores(razon_social)').eq('id', facturaId).maybeSingle();
    if (!f) throw new BadRequestException('Factura inexistente');
    if (f.estado === 'anulada') throw new BadRequestException('La factura está anulada');
    const tipo = dto.tipo === 'anular' ? 'anular' : 'editar';
    const cambios = tipo === 'anular' ? {} : Object.fromEntries(Object.entries(dto.cambios ?? {}).filter(([, v]) => v !== undefined));
    if (tipo === 'editar' && !Object.keys(cambios).length) throw new BadRequestException('No hay ningún cambio pedido');
    const motivo = String(dto.motivo ?? '').trim();
    if (!motivo) throw new BadRequestException('Indique el motivo del cambio');
    // una sola pendiente por factura y tipo: si ya hay, se actualiza
    const { data: prev } = await this.db.from('facturas_proveedor_cambios').select('id').eq('factura_id', facturaId).eq('tipo', tipo).eq('estado', 'pendiente').maybeSingle();
    let id: string;
    if (prev?.id) {
      await this.db.from('facturas_proveedor_cambios').update({ cambios, motivo, solicitado_por: usuarioId ?? null, creado_en: new Date().toISOString() }).eq('id', prev.id);
      id = prev.id;
    } else {
      const { data, error } = await this.db.from('facturas_proveedor_cambios').insert({ factura_id: facturaId, solicitado_por: usuarioId ?? null, cambios, motivo, tipo }).select('id').single();
      if (error) throw new BadRequestException(error.message);
      id = data.id;
    }
    // aviso a los dueños (campanita): Juan Pablo aprueba
    const { data: duenos } = await this.db.from('usuarios').select('id').eq('rol', 'dueno').eq('activo', true);
    const { data: quien } = usuarioId ? await this.db.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle() : { data: null as any };
    const prov = (f as any).proveedor?.razon_social ?? '';
    const titulo = tipo === 'anular' ? `Pide anular la factura ${f.numero} (${prov})` : `Pide cambiar la factura ${f.numero} (${prov})`;
    const detalle = `${quien?.nombre ?? 'Un usuario'}: ${motivo}${tipo === 'editar' ? ` · campos: ${Object.keys(cambios).join(', ')}` : ''}. Se aprueba desde Facturas de compra → Cambios pendientes.`;
    for (const d of (duenos ?? []) as any[]) {
      await this.db.from('alertas_internas').insert({ para_usuario: d.id, tipo: 'cambio_factura', titulo, detalle, referencia: { facturaId, solicitudId: id } }).then(() => null, () => null);
    }
    return { ok: true, id, estado: 'pendiente' };
  }

  async listarCambiosFactura(q: { estado?: string; facturaId?: string } = {}) {
    let query = this.db
      .from('facturas_proveedor_cambios')
      .select('id, factura_id, tipo, cambios, motivo, estado, respuesta, creado_en, resuelto_en, solicitante:usuarios!facturas_proveedor_cambios_solicitado_por_fkey(nombre), resolutor:usuarios!facturas_proveedor_cambios_resuelto_por_fkey(nombre), factura:facturas_proveedor(numero, letra, tipo, monto, estado, proveedor:proveedores(razon_social))')
      .order('creado_en', { ascending: false })
      .limit(200);
    if (q.estado) query = query.eq('estado', q.estado);
    if (q.facturaId) query = query.eq('factura_id', q.facturaId);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async resolverCambioFactura(id: string, decision: 'aprobar' | 'rechazar', respuesta: string | undefined, usuarioId?: string) {
    const { data: c } = await this.db.from('facturas_proveedor_cambios').select('id, factura_id, tipo, cambios, estado, solicitado_por, factura:facturas_proveedor(numero)').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('Solicitud inexistente');
    if (c.estado !== 'pendiente') throw new BadRequestException(`La solicitud ya está ${c.estado}`);
    if (decision === 'aprobar') {
      if (c.tipo === 'anular') await this.anularFactura(c.factura_id, `Solicitud aprobada: ${respuesta ?? ''}`.trim(), usuarioId);
      else await this.editarFactura(c.factura_id, c.cambios ?? {}, usuarioId);
    }
    const estado = decision === 'aprobar' ? 'aprobada' : 'rechazada';
    const { error } = await this.db.from('facturas_proveedor_cambios').update({ estado, resuelto_por: usuarioId ?? null, resuelto_en: new Date().toISOString(), respuesta: respuesta || null }).eq('id', id).eq('estado', 'pendiente');
    if (error) throw new BadRequestException(error.message);
    // aviso al que lo pidió
    if (c.solicitado_por) {
      const numero = (c as any).factura?.numero ?? '';
      await this.db.from('alertas_internas').insert({
        para_usuario: c.solicitado_por,
        tipo: 'cambio_factura',
        titulo: `${estado === 'aprobada' ? 'Aprobado' : 'Rechazado'}: ${c.tipo === 'anular' ? 'anulación' : 'cambio'} de la factura ${numero}`,
        detalle: respuesta || (estado === 'aprobada' ? 'El cambio ya está aplicado.' : 'Sin detalle.'),
        referencia: { facturaId: c.factura_id, solicitudId: id },
      }).then(() => null, () => null);
    }
    return { ok: true, estado };
  }

  // Anulación lógica: nunca se borra, queda trazable. Pagadas/en pago no se anulan.
  async anularFactura(id: string, motivo: string, usuarioId?: string) {
    const { data: f } = await this.db.from('facturas_proveedor').select('estado').eq('id', id).maybeSingle();
    if (!f) throw new BadRequestException('Factura inexistente');
    if (f.estado === 'pagada' || f.estado === 'en_pago') {
      throw new BadRequestException('No se puede anular una factura pagada o en una orden de pago. Primero anulá el pago.');
    }
    if (f.estado === 'anulada') return { ok: true };
    const { error } = await this.db.from('facturas_proveedor').update({ estado: 'anulada' }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.db.from('auditoria').insert({ usuario_id: usuarioId ?? null, accion: 'anular_factura_proveedor', entidad: 'facturas_proveedor', entidad_id: id, datos_despues: { motivo: motivo || null } });
    return { ok: true };
  }

  // Pago parcial directo (transferencia/efectivo/etc). Cuando completa el monto,
  // la factura pasa a pagada. Convive con el circuito de órdenes de pago.
  async pagoFactura(id: string, dto: { monto: number; medio?: string; nota?: string }, usuarioId?: string) {
    const monto = Number(dto.monto);
    if (!(monto > 0)) throw new BadRequestException('El monto del pago debe ser mayor a cero');
    // Todo el pago vive en una RPC con lock de fila: dos pagos concurrentes por
    // el mismo saldo se serializan y el segundo rebota contra el saldo real.
    const { data, error } = await this.db.rpc('registrar_pago_factura', {
      p_factura: id,
      p_monto: monto,
      p_medio: dto.medio || 'transferencia',
      p_nota: dto.nota || null,
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Acta de recepción con folio: el papel que firma el depósito contra lo que
  // bajó del camión. Compara contra lo pedido en la OC cuando la recepción
  // venía de una orden; si fue entrada directa, la columna "pedido" va vacía.
  async documentoRecepcion(remitoId: string, usuarioId?: string) {
    const { data: r } = await this.db
      .from('remitos')
      .select('id, numero, creado_en, oc_id, confirmado_por, proveedor:proveedores(razon_social, cuit), sucursal:sucursales(nombre)')
      .eq('id', remitoId)
      .maybeSingle();
    if (!r) throw new BadRequestException('No existe ese remito');

    const { data: items } = await this.db
      .from('remitos_items')
      .select('cantidad, producto:productos(sku, nombre)')
      .eq('remito_id', remitoId);

    // lo pedido, para poner las dos columnas al lado
    const pedidoPorSku = new Map<string, number>();
    if ((r as any).oc_id) {
      const { data: oci } = await this.db
        .from('ordenes_compra_items')
        .select('cantidad, producto:productos(sku)')
        .eq('oc_id', (r as any).oc_id);
      for (const i of (oci ?? []) as any[]) {
        if (i.producto?.sku) pedidoPorSku.set(i.producto.sku, Number(i.cantidad));
      }
    }

    const { data: doc, error } = await this.db.rpc('emitir_documento', {
      p_tipo: 'recepcion', p_entidad: 'remitos', p_entidad_id: remitoId,
      p_usuario: usuarioId ?? null, p_datos: { remito: (r as any).numero, oc_id: (r as any).oc_id },
    });
    if (error) throw new BadRequestException(error.message);

    const { data: quien } = (r as any).confirmado_por
      ? await this.db.from('usuarios').select('nombre').eq('id', (r as any).confirmado_por).maybeSingle()
      : { data: null as any };

    let numeroOc: number | null = null;
    if ((r as any).oc_id) {
      const { data: oc } = await this.db.from('ordenes_compra').select('numero').eq('id', (r as any).oc_id).maybeSingle();
      numeroOc = (oc as any)?.numero ?? null;
    }

    return remitoRecepcionPDF({
      folio: (doc as any).folio,
      emitidoEn: (doc as any).emitido_en,
      numeroRemito: (r as any).numero,
      fecha: (r as any).creado_en,
      proveedor: (r as any).proveedor ?? null,
      sucursal: (r as any).sucursal?.nombre ?? null,
      ordenCompra: numeroOc,
      items: ((items ?? []) as any[]).map((i) => ({
        nombre: i.producto?.nombre ?? '—',
        sku: i.producto?.sku ?? null,
        pedido: i.producto?.sku ? (pedidoPorSku.get(i.producto.sku) ?? null) : null,
        recibido: Number(i.cantidad),
      })),
      recibidoPor: quien?.nombre ?? null,
    });
  }

  // ---------- recepción con pistola + cruce remito↔factura ----------

  // El depósito escanea lo que baja del camión: el remito digital nace con lo
  // REALMENTE ingresado (mueve stock, sin tocar precios) y queda en la bandeja
  // de administración esperando la factura para el cruce.
  async recepcionPistola(dto: { proveedorId: string; sucursalId: string; numeroRemito?: string; items: { sku: string; cantidad: number; lote?: string; vencimiento?: string }[]; usuarioId?: string }) {
    if (!dto.proveedorId || !dto.sucursalId) throw new BadRequestException('Faltan proveedor o sucursal');
    const resultado: any = await this.entradaDirecta({
      proveedorId: dto.proveedorId,
      sucursalId: dto.sucursalId,
      numeroRemito: dto.numeroRemito,
      // costo 0: la recepción física no define precios; eso llega con la factura
      items: dto.items.map((i) => ({ sku: i.sku, cantidad: Number(i.cantidad), costo: 0, lote: i.lote, vencimiento: i.vencimiento })),
      usuarioId: dto.usuarioId,
    });
    if (resultado?.remito_id) {
      await this.db.from('remitos').update({ estado: 'pendiente_conciliar' }).eq('id', resultado.remito_id);
    }
    return { ok: true, remitoId: resultado?.remito_id, ocId: resultado?.oc_id };
  }

  // Lookup del escáner: código de barras → producto
  async productoPorCodigo(codigo: string) {
    const limpio = String(codigo ?? '').trim();
    if (!limpio) throw new BadRequestException('Código vacío');
    const { data } = await this.db
      .from('codigos_barras')
      .select('producto:productos(id, sku, nombre, activo)')
      .eq('codigo', limpio)
      .maybeSingle();
    const p: any = (data as any)?.producto;
    if (!p) return { encontrado: false };
    // el código existe pero su producto está dado de baja: se avisa cuál es, si
    // no el operario ve "no existe" y después el alta le rebota sin explicación
    if (p.activo === false) return { encontrado: false, deBaja: true, sku: p.sku, nombre: p.nombre };
    return { encontrado: true, sku: p.sku, nombre: p.nombre };
  }

  // El código que no está en el sistema se aprende acá mismo: el depósito escanea,
  // dice a qué producto pertenece y queda vinculado para siempre. Así cada camión
  // deja el catálogo mejor que como lo encontró, sin pasar por Productos.
  async vincularCodigo(dto: { codigo: string; sku: string; usuarioId?: string }) {
    if (dto.codigo != null && typeof dto.codigo !== 'string' && typeof dto.codigo !== 'number') {
      throw new BadRequestException('Código de barras inválido');
    }
    const codigo = String(dto.codigo ?? '').trim().toUpperCase();
    const sku = String(dto.sku ?? '').trim();
    if (!codigo) throw new BadRequestException('Falta el código de barras');
    if (!sku) throw new BadRequestException('Elegí a qué producto pertenece');

    const { data: producto } = await this.db
      .from('productos')
      .select('id, sku, nombre, activo')
      .eq('sku', sku)
      .maybeSingle();
    if (!producto) throw new BadRequestException(`No existe el producto ${sku}`);
    if (producto.activo === false) throw new BadRequestException(`El producto ${sku} está dado de baja`);

    // Un código tiene que apuntar a un solo producto: si ya está tomado, se avisa
    // de quién es en vez de dejar que la pistola traiga cualquier cosa en la caja.
    const { data: tomado } = await this.db
      .from('codigos_barras')
      .select('producto:productos(id, sku, nombre, activo)')
      .eq('codigo', codigo)
      .maybeSingle();
    const duenoActual: any = (tomado as any)?.producto;
    if (duenoActual) {
      if (duenoActual.id === producto.id) {
        return { ok: true, yaEstaba: true, sku: producto.sku, nombre: producto.nombre };
      }
      // si el dueño del código está dado de baja, el código se muda al vigente
      // (es el caso normal: el producto se reemplazó o se cargó de nuevo)
      if (duenoActual.activo === false) {
        const { error: errMudanza } = await this.db
          .from('codigos_barras')
          .update({ producto_id: producto.id })
          .eq('codigo', codigo);
        if (errMudanza) throw new BadRequestException(errMudanza.message);
        await this.db.from('auditoria').insert({
          usuario_id: dto.usuarioId ?? null,
          accion: 'mudar_codigo_barras',
          entidad: 'productos',
          entidad_id: producto.id,
          datos_despues: { codigo, desde: duenoActual.sku, hacia: producto.sku },
        });
        return { ok: true, mudado: true, desde: duenoActual.nombre, sku: producto.sku, nombre: producto.nombre };
      }
      throw new BadRequestException(
        `Ese código ya es de ${duenoActual.nombre} (${duenoActual.sku}). Si está mal, corregilo desde Productos.`,
      );
    }

    const { error } = await this.db.from('codigos_barras').insert({ codigo, producto_id: producto.id });
    if (error) throw new BadRequestException(error.message);

    await this.db.from('auditoria').insert({
      usuario_id: dto.usuarioId ?? null,
      accion: 'vincular_codigo_barras',
      entidad: 'productos',
      entidad_id: producto.id,
      datos_despues: { codigo, sku: producto.sku },
    });

    return { ok: true, sku: producto.sku, nombre: producto.nombre };
  }

  // Bandeja de administración: remitos escaneados sin factura + facturas sin remito
  async bandejaConciliacion() {
    const [{ data: remitos }, { data: conciliados }] = await Promise.all([
      this.db
        .from('remitos')
        .select('id, numero, estado, creado_en, oc_id, proveedor:proveedores(id, razon_social), sucursal:sucursales(nombre)')
        .eq('estado', 'pendiente_conciliar')
        .order('creado_en', { ascending: false }),
      this.db.from('remitos').select('factura_id').not('factura_id', 'is', null),
    ]);
    const facturasVinculadas = new Set(((conciliados ?? []) as any[]).map((r) => r.factura_id));
    const { data: facturas } = await this.db
      .from('facturas_proveedor')
      .select('id, numero, letra, monto, creado_en, remito_id, proveedor:proveedores(id, razon_social)')
      .eq('tipo', 'factura')
      .not('estado', 'in', '("anulada")')
      .is('remito_id', null) // las de entrada-por-foto ya nacieron atadas a su remito
      .order('creado_en', { ascending: false })
      .limit(100);
    // cantidad de renglones por remito (viven en la OC retroactiva)
    const ocIds = ((remitos ?? []) as any[]).map((r) => r.oc_id).filter(Boolean);
    const porOc = new Map<string, number>();
    if (ocIds.length) {
      const { data: itemsOc } = await this.db.from('ordenes_compra_items').select('oc_id').in('oc_id', ocIds);
      for (const it of (itemsOc ?? []) as any[]) porOc.set(it.oc_id, (porOc.get(it.oc_id) ?? 0) + 1);
    }
    return {
      remitos: ((remitos ?? []) as any[]).map((r) => ({ ...r, renglones: porOc.get(r.oc_id) ?? 0 })),
      facturas: ((facturas ?? []) as any[]).filter((f) => !facturasVinculadas.has(f.id)),
    };
  }

  // Renglones físicos de un remito (recepción directa: viven en la OC retroactiva)
  private async itemsDeRemitos(remitoIds: string[]) {
    const { data: remitos } = await this.db.from('remitos').select('id, oc_id').in('id', remitoIds);
    const porProducto = new Map<string, number>();
    for (const r of (remitos ?? []) as any[]) {
      const { data: ri } = await this.db.from('remitos_items').select('producto_id, cantidad').eq('remito_id', r.id);
      let filas = (ri ?? []) as any[];
      if (!filas.length && r.oc_id) {
        const { data: oi } = await this.db.from('ordenes_compra_items').select('producto_id, cantidad_recibida').eq('oc_id', r.oc_id);
        filas = ((oi ?? []) as any[]).map((x) => ({ producto_id: x.producto_id, cantidad: x.cantidad_recibida }));
      }
      for (const f of filas) porProducto.set(f.producto_id, (porProducto.get(f.producto_id) ?? 0) + Number(f.cantidad || 0));
    }
    return porProducto;
  }

  // El cruce: facturado vs recibido, producto por producto
  async cruceRemitosFactura(facturaId: string, remitoIds: string[]) {
    if (!facturaId || !remitoIds?.length) throw new BadRequestException('Elegí la factura y al menos un remito');
    const [{ data: itemsFac }, recibido] = await Promise.all([
      this.db.from('facturas_proveedor_items').select('producto_id, descripcion, cantidad, precio').eq('factura_id', facturaId),
      this.itemsDeRemitos(remitoIds),
    ]);
    const facturado = new Map<string, { cantidad: number; descripcion: string; precio: number }>();
    const sinMatch: any[] = [];
    for (const it of (itemsFac ?? []) as any[]) {
      if (!it.producto_id) { sinMatch.push({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio: Number(it.precio) }); continue; }
      const prev = facturado.get(it.producto_id);
      facturado.set(it.producto_id, { cantidad: (prev?.cantidad ?? 0) + Number(it.cantidad), descripcion: it.descripcion, precio: Number(it.precio) });
    }
    const ids = [...new Set([...facturado.keys(), ...recibido.keys()])];
    const nombres = new Map<string, any>();
    if (ids.length) {
      const { data: prods } = await this.db.from('productos').select('id, sku, nombre').in('id', ids);
      for (const p of (prods ?? []) as any[]) nombres.set(p.id, p);
    }
    const filas = ids.map((id) => {
      const f = facturado.get(id)?.cantidad ?? 0;
      const r = recibido.get(id) ?? 0;
      const p = nombres.get(id);
      return {
        productoId: id,
        sku: p?.sku ?? null,
        nombre: p?.nombre ?? facturado.get(id)?.descripcion ?? '(producto)',
        facturado: f,
        recibido: r,
        diferencia: r - f, // negativo = te facturaron más de lo que entró
        precio: facturado.get(id)?.precio ?? null,
      };
    }).sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
    const conDiferencia = filas.filter((x) => x.diferencia !== 0);
    return {
      filas,
      sinMatch, // renglones de factura sin producto identificado: revisar a mano
      coincide: conDiferencia.length === 0 && sinMatch.length === 0,
      resumen: {
        renglones: filas.length,
        conDiferencia: conDiferencia.length,
        faltanteFacturado: conDiferencia.filter((x) => x.diferencia < 0).length,
        recibidoNoFacturado: filas.filter((x) => x.facturado === 0 && x.recibido > 0).length,
      },
    };
  }

  // Administración confirma el cruce: el remito queda atado a la factura, con
  // las diferencias registradas (si las hay) para el reclamo al proveedor.
  async confirmarConciliacion(facturaId: string, remitoIds: string[], usuarioId?: string) {
    const cruce = await this.cruceRemitosFactura(facturaId, remitoIds);
    const diferencias = cruce.coincide ? null : { filas: cruce.filas.filter((x) => x.diferencia !== 0), sinMatch: cruce.sinMatch };
    const estado = cruce.coincide ? 'conciliado' : 'con_diferencias';
    const { error } = await this.db
      .from('remitos')
      .update({ factura_id: facturaId, estado, conciliado_en: new Date().toISOString(), conciliado_por: usuarioId ?? null, diferencias })
      .in('id', remitoIds)
      .eq('estado', 'pendiente_conciliar');
    if (error) throw new BadRequestException(error.message);
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: 'conciliar_remito_factura',
      entidad: 'facturas_proveedor',
      entidad_id: facturaId,
      datos_despues: { remitos: remitoIds, estado, diferencias: cruce.resumen },
    });
    return { ok: true, estado, resumen: cruce.resumen };
  }

  // Guarda los renglones de la factura (para el cruce y el detalle)
  private async guardarItemsFactura(facturaId: string, items: { sku?: string; descripcion?: string; cantidad: number; precio?: number }[]) {
    if (!items?.length) return;
    const filas = await Promise.all(items.map(async (i) => ({
      factura_id: facturaId,
      producto_id: i.sku ? await this.productoIdPorSku(i.sku).catch(() => null) : null,
      descripcion: i.descripcion || i.sku || '(renglón)',
      cantidad: Number(i.cantidad) || 1,
      precio: Number(i.precio) || 0,
    })));
    await this.db.from('facturas_proveedor_items').insert(filas);
  }

  // 1) Crear orden de pago: queda PENDIENTE de aprobación del dueño (no paga todavía).
  // RPC atómica con lock de facturas: dos OP simultáneas no pueden tomar la misma factura.
  async crearOrdenPago(dto: { facturaIds: string[]; medioPago?: string; vencimiento?: string; fechaProgramada?: string; observaciones?: string; usuarioId?: string }) {
    if (!dto.facturaIds?.length) throw new BadRequestException('Elegí al menos una factura');
    const { data, error } = await this.db.rpc('crear_orden_pago', {
      p_facturas: dto.facturaIds,
      p_medio: dto.medioPago || 'transferencia',
      p_vencimiento: dto.vencimiento || null,
      p_programada: dto.fechaProgramada || null,
      p_observaciones: dto.observaciones || null,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const r = data as any;
    return { ordenPagoId: r.orden_pago_id, numero: r.numero, total: Math.round(Number(r.total)) };
  }

  // 2) Aprobar OP — EXCLUSIVO del dueño. RPC atómica (estado + auditoría juntos).
  async aprobarOrdenPago(id: string, dto: { usuarioId?: string }) {
    const { error } = await this.db.rpc('aprobar_op_panel', { p_op: id, p_usuario: dto.usuarioId ?? null });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { aprobada: true };
  }

  // 3) Rechazar OP — devuelve las facturas a pendiente.
  async rechazarOrdenPago(id: string, dto: { usuarioId?: string; motivo?: string }) {
    const { data: items } = await this.db.from('ordenes_pago_items').select('factura_id').eq('orden_pago_id', id);
    await this.db.from('ordenes_pago').update({ estado: 'rechazada', rechazo_motivo: dto.motivo || 'Rechazada por dirección', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() }).eq('id', id);
    const fids = (items ?? []).map((i: any) => i.factura_id);
    if (fids.length) {
      // vuelven a su estado real: 'parcial' si ya tenían pagos, si no 'pendiente'
      await this.db.from('facturas_proveedor').update({ estado: 'pendiente' }).in('id', fids).eq('monto_pagado', 0);
      await this.db.from('facturas_proveedor').update({ estado: 'parcial' }).in('id', fids).gt('monto_pagado', 0);
    }
    return { rechazada: true };
  }

  // 4) Pagar OP — sólo si está aprobada por el dueño.
  // Opcional: emitir cheques propios y/o endosar cheques de terceros de cartera.
  async pagarOrdenPago(
    id: string,
    dto: {
      usuarioId?: string;
      chequesPropios?: { numero: string; banco?: string; importe: number; fechaCobro?: string; titular?: string }[];
      chequesTercerosIds?: string[];
    },
  ) {
    // RPC atómica: cheques emitidos/endosados + OP pagada + facturas pagadas,
    // todo o nada (no más OP "pagada" con cheques a medias o deuda fantasma).
    const { error } = await this.db.rpc('pagar_orden_pago', {
      p_op: id,
      p_cheques_propios: (dto.chequesPropios ?? []).map((ch) => ({
        numero: String(ch.numero ?? ''),
        banco: ch.banco ?? null,
        titular: ch.titular ?? null,
        importe: Number(ch.importe),
        fechaCobro: ch.fechaCobro ?? null,
      })),
      p_cheques_terceros: dto.chequesTercerosIds ?? [],
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { pagada: true };
  }

  async ordenesPago() {
    const { data, error } = await this.db
      .from('ordenes_pago')
      .select('id, numero, total, medio_pago, estado, vencimiento, fecha_programada, observaciones, aprobada_en, pagada_en, creado_en, proveedor:proveedores(razon_social)')
      .order('numero', { ascending: false })
      .limit(80);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async productoIdPorSku(sku: string): Promise<string> {
    const { data, error } = await this.db
      .from('productos')
      .select('id')
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`No existe el producto ${sku}`);
    return data.id;
  }

  // Guarda, por cada renglón confirmado, el alias (texto leído), la remarcación
  // y el último costo en proveedor_productos, para que la próxima compra del
  // mismo proveedor matchee sola y traiga la misma remarcación (upsert por PK
  // proveedor_id+producto_id). No frena la entrada si algo falla acá.
  private async aprenderVinculos(proveedorId: string, items: EntradaDirectaDto['items']) {
    try {
      const conAlias = items.filter((i) => i.descripcionLeida || i.margenPct != null);
      if (!conAlias.length) return;

      const productoIds = await Promise.all(conAlias.map((i) => this.productoIdPorSku(i.sku)));
      // Qué remarcación había aprendida antes de esta entrada. Hace falta para
      // no pisarla: si La Serenísima saca una promoción y se remarca al 40% por
      // única vez, el 61% de siempre tiene que seguir estando la próxima.
      const { data: previas } = await this.db
        .from('proveedor_productos')
        .select('producto_id, margen_pct')
        .eq('proveedor_id', proveedorId)
        .in('producto_id', productoIds);
      const previoDe = new Map<string, number | null>(
        ((previas ?? []) as any[]).map((p) => [p.producto_id, p.margen_pct != null ? Number(p.margen_pct) : null]),
      );

      const filas = conAlias.map((i, n) => {
        const productoId = productoIds[n];
        const previo = previoDe.get(productoId) ?? null;
        const puesto = i.margenPct != null ? Number(i.margenPct) : null;
        // 1) nunca se había fijado → lo que se puso ahora pasa a ser el habitual
        // 2) lo marcaron como fijo → reemplaza al habitual
        // 3) cualquier otro caso → se conserva el habitual (el % de hoy solo
        //    afecta el precio de esta entrada, que ya se calculó aparte)
        const margen = previo == null ? puesto : i.fijarMargen && puesto != null ? puesto : previo;
        return {
          proveedor_id: proveedorId,
          producto_id: productoId,
          alias_descripcion: i.descripcionLeida ? normalizarAlias(i.descripcionLeida) : null,
          margen_pct: margen,
          ultimo_costo: Number(i.costo) || null,
          actualizado_en: new Date().toISOString(),
        };
      });
      await this.db.from('proveedor_productos').upsert(filas, { onConflict: 'proveedor_id,producto_id' });
    } catch {
      // aprender el vínculo es best-effort: nunca debe tirar la entrada ya registrada
    }
  }

  private traducirError(mensaje: string): string {
    if (mensaje.includes('permission denied')) {
      return 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env';
    }
    return mensaje;
  }
}
