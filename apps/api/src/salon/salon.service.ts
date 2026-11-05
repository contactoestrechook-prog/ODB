import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { terminosDeBusqueda } from '../comun/busqueda';
import { ComprasService } from '../compras/compras.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { tiemposPorPreparador } from './tiempos';

// OP SALÓN (Leandro, 5/11/2026). Tres trabajos del que está en el salón:
//  1. el stock y DÓNDE está cada cosa (stock.ubicacion, por sucursal);
//  2. el ingreso por puerta trasera con remito, que espera la factura: no toca
//     el stock hasta que administración lo confirma;
//  3. armar los pedidos que le asigna la caja, sumando al carro desde la app
//     (cada carga queda con la hora: así se mide).

/** Quiénes pueden recibir un pedido para armar (en el selector de la caja). */
const ROLES_PREPARAN = ['op_salon', 'deposito'];
/** Los que manejan cualquier pedido (no solo los suyos). */
const ROLES_ENCARGADOS = ['dueno', 'gerente', 'cajero', 'deposito'];
const ESTADOS_ABIERTOS = ['recibido', 'pagado', 'en_preparacion'];

type Usuario = { sub?: string; rol?: string };

@Injectable()
export class SalonService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly compras: ComprasService,
    private readonly pedidos: PedidosService,
  ) {}

  private async sucursalDe(usuarioId?: string): Promise<string | null> {
    if (!usuarioId) return null;
    const { data } = await this.db.from('usuarios').select('sucursal_id').eq('id', usuarioId).maybeSingle();
    return (data as any)?.sucursal_id ?? null;
  }

  private async productoPorSkuOCodigo(texto: string) {
    const limpio = String(texto ?? '').trim();
    if (!limpio) return null;
    const { data: porCodigo } = await this.db.from('codigos_barras').select('producto:productos(id, sku, nombre)').eq('codigo', limpio.toUpperCase()).maybeSingle();
    const p = (porCodigo as any)?.producto;
    if (p) return { ...p, porCodigo: true };
    const { data: porSku } = await this.db.from('productos').select('id, sku, nombre').eq('sku', limpio).maybeSingle();
    return porSku ? { ...(porSku as any), porCodigo: false } : null;
  }

  // ---------- 1. Stock y ubicación ----------

  /** Busca por nombre, SKU o código de barras: stock y lugar en cada sucursal. */
  async buscarStock(q: string) {
    const texto = String(q ?? '').trim();
    if (texto.length < 2) return [];
    const exacto = await this.productoPorSkuOCodigo(texto);
    let ids: string[] = [];
    if (exacto) ids = [exacto.id];
    else {
      const palabras = terminosDeBusqueda(texto).filter((p) => p.length >= 2).slice(0, 4);
      if (!palabras.length) return [];
      let consulta = this.db.from('productos').select('id').eq('activo', true).limit(30);
      for (const p of palabras) consulta = consulta.like('texto_busqueda', `%${p}%`);
      const { data, error } = await consulta;
      if (error) throw new BadRequestException(error.message);
      ids = ((data ?? []) as any[]).map((x) => x.id);
    }
    if (!ids.length) return [];
    const [{ data: prods, error }, { data: sucs }] = await Promise.all([
      this.db.from('productos').select('id, sku, nombre, stock(sucursal_id, cantidad, ubicacion, ubicacion_en)').in('id', ids),
      this.db.from('sucursales').select('id, nombre'),
    ]);
    if (error) throw new BadRequestException(error.message);
    const nombreSuc = new Map(((sucs ?? []) as any[]).map((s) => [s.id, s.nombre]));
    return ((prods ?? []) as any[])
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        sucursales: ((p.stock ?? []) as any[]).map((s) => ({
          sucursalId: s.sucursal_id,
          sucursal: nombreSuc.get(s.sucursal_id) ?? '—',
          cantidad: Number(s.cantidad) || 0,
          ubicacion: s.ubicacion ?? null,
        })),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async guardarUbicacion(dto: { productoId: string; sucursalId: string; ubicacion?: string }, usuarioId?: string) {
    if (!dto.productoId || !dto.sucursalId) throw new BadRequestException('Faltan el producto o la sucursal');
    const ubicacion = String(dto.ubicacion ?? '').trim().slice(0, 80) || null;
    const { data, error } = await this.db
      .from('stock')
      .update({ ubicacion, ubicacion_por: usuarioId ?? null, ubicacion_en: new Date().toISOString() })
      .eq('producto_id', dto.productoId)
      .eq('sucursal_id', dto.sucursalId)
      .select('producto_id');
    if (error) throw new BadRequestException(error.message);
    // sin fila de stock en esa sucursal: se crea en cero, solo para guardar el lugar
    if (!data?.length) {
      const { error: e2 } = await this.db.from('stock').insert({
        producto_id: dto.productoId, sucursal_id: dto.sucursalId, cantidad: 0,
        ubicacion, ubicacion_por: usuarioId ?? null, ubicacion_en: new Date().toISOString(),
      });
      if (e2) throw new BadRequestException(e2.message);
    }
    return { ok: true, ubicacion };
  }

  async codigo(codigo: string) {
    const p = await this.productoPorSkuOCodigo(codigo);
    return p ? { encontrado: true, sku: p.sku, nombre: p.nombre } : { encontrado: false };
  }

  // ---------- 2. Ingreso por puerta trasera ----------

  async crearIngreso(dto: { proveedorId: string; sucursalId?: string; numeroRemito: string; notas?: string; items: { sku: string; cantidad: number; lote?: string; vencimiento?: string }[] }, usuarioId?: string) {
    if (!usuarioId) throw new BadRequestException('No sé quién sos: volvé a entrar al sistema');
    if (!dto.proveedorId) throw new BadRequestException('Elegí el proveedor');
    const remito = String(dto.numeroRemito ?? '').trim();
    if (!remito) throw new BadRequestException('Falta el número de remito');
    const sucursalId = dto.sucursalId || (await this.sucursalDe(usuarioId));
    if (!sucursalId) throw new BadRequestException('Elegí la sucursal');
    if (!dto.items?.length) throw new BadRequestException('Escaneá al menos un producto');

    const porProducto = new Map<string, { producto_id: string; cantidad: number; lote: string | null; vencimiento: string | null }>();
    for (const i of dto.items) {
      const cantidad = Number(i.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new BadRequestException(`Cantidad inválida en ${i.sku}`);
      const p = await this.productoPorSkuOCodigo(i.sku);
      if (!p) throw new BadRequestException(`No encuentro el producto ${i.sku}`);
      const previo = porProducto.get(p.id);
      porProducto.set(p.id, {
        producto_id: p.id,
        cantidad: (previo?.cantidad ?? 0) + cantidad,
        lote: i.lote?.trim() || previo?.lote || null,
        vencimiento: i.vencimiento || previo?.vencimiento || null,
      });
    }

    const { data: ingreso, error } = await this.db
      .from('ingresos_puerta')
      .insert({ proveedor_id: dto.proveedorId, sucursal_id: sucursalId, numero_remito: remito, notas: dto.notas?.trim() || null, creado_por: usuarioId })
      .select('id, numero')
      .single();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    const { error: e2 } = await this.db.from('ingresos_puerta_items').insert([...porProducto.values()].map((i) => ({ ...i, ingreso_id: (ingreso as any).id })));
    if (e2) {
      await this.db.from('ingresos_puerta').delete().eq('id', (ingreso as any).id);
      throw new BadRequestException(e2.message);
    }
    return { ok: true, id: (ingreso as any).id, numero: (ingreso as any).numero };
  }

  async ingresos(estado = 'espera_factura') {
    let q = this.db
      .from('ingresos_puerta')
      .select(`id, numero, numero_remito, notas, estado, creado_en, creado_por, confirmado_en, confirmado_por, numero_factura, motivo_rechazo, sucursal_id,
        proveedor:proveedores(id, nombre), sucursal:sucursales(nombre),
        items:ingresos_puerta_items(cantidad, cantidad_confirmada, lote, vencimiento, producto:productos(id, sku, nombre))`)
      .order('creado_en', { ascending: false })
      .limit(100);
    if (estado !== 'todos') q = q.eq('estado', estado);
    const [{ data, error }, nombres] = await Promise.all([q, this.nombres()]);
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    return ((data ?? []) as any[]).map((i) => ({
      ...i,
      creadoPorNombre: nombres.get(i.creado_por) ?? null,
      confirmadoPorNombre: i.confirmado_por ? nombres.get(i.confirmado_por) ?? null : null,
    }));
  }

  /**
   * Administración confirma con la factura: recién ahí entra al stock. Las
   * cantidades se pueden corregir contra la factura (lo que no vino, en 0).
   * Entra como la recepción de siempre: remito + stock, y el remito queda
   * pendiente de conciliar con la factura de compra.
   */
  async confirmarIngreso(id: string, dto: { numeroFactura: string; items?: { sku: string; cantidad: number }[] }, usuarioId?: string) {
    const factura = String(dto.numeroFactura ?? '').trim();
    if (!factura) throw new BadRequestException('Falta el número de factura');
    // se toma el ingreso (el segundo que confirme ve que ya estaba)
    const { data: tomado, error } = await this.db
      .from('ingresos_puerta')
      .update({ estado: 'ingresado', confirmado_por: usuarioId ?? null, confirmado_en: new Date().toISOString(), numero_factura: factura })
      .eq('id', id)
      .eq('estado', 'espera_factura')
      .select('id, proveedor_id, sucursal_id, numero_remito, items:ingresos_puerta_items(producto_id, cantidad, lote, vencimiento, producto:productos(sku))')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!tomado) throw new BadRequestException('Ese ingreso ya fue confirmado o rechazado');
    const ing = tomado as any;

    const corregidas = new Map((dto.items ?? []).map((i) => [String(i.sku), Number(i.cantidad)]));
    const items = ((ing.items ?? []) as any[])
      .map((i) => ({
        producto_id: i.producto_id,
        sku: i.producto?.sku as string,
        cantidad: corregidas.has(i.producto?.sku) ? corregidas.get(i.producto?.sku)! : Number(i.cantidad),
        lote: i.lote ?? undefined,
        vencimiento: i.vencimiento ?? undefined,
      }));
    if (items.some((i) => !Number.isFinite(i.cantidad) || i.cantidad < 0)) {
      await this.devolverAEspera(id);
      throw new BadRequestException('Hay una cantidad inválida');
    }
    const entran = items.filter((i) => i.cantidad > 0);
    if (!entran.length) {
      await this.devolverAEspera(id);
      throw new BadRequestException('No queda nada para ingresar: si no vino nada, rechazá el ingreso');
    }
    try {
      const r = await this.compras.recepcionPistola({
        proveedorId: ing.proveedor_id,
        sucursalId: ing.sucursal_id,
        numeroRemito: ing.numero_remito,
        items: entran.map((i) => ({ sku: i.sku, cantidad: i.cantidad, lote: i.lote, vencimiento: i.vencimiento })),
        usuarioId,
      });
      await Promise.all([
        this.db.from('ingresos_puerta').update({ remito_id: r.remitoId ?? null }).eq('id', id),
        ...items.map((i) => this.db.from('ingresos_puerta_items').update({ cantidad_confirmada: i.cantidad }).eq('ingreso_id', id).eq('producto_id', i.producto_id)),
      ]);
      return { ok: true, remitoId: r.remitoId ?? null, productos: entran.length };
    } catch (e) {
      await this.devolverAEspera(id);
      throw e;
    }
  }

  private async devolverAEspera(id: string) {
    await this.db.from('ingresos_puerta').update({ estado: 'espera_factura', confirmado_por: null, confirmado_en: null, numero_factura: null }).eq('id', id);
  }

  async rechazarIngreso(id: string, motivo: string, usuarioId?: string) {
    const m = String(motivo ?? '').trim();
    if (!m) throw new BadRequestException('Contá por qué se rechaza');
    const { data, error } = await this.db
      .from('ingresos_puerta')
      .update({ estado: 'rechazado', motivo_rechazo: m.slice(0, 300), confirmado_por: usuarioId ?? null, confirmado_en: new Date().toISOString() })
      .eq('id', id)
      .eq('estado', 'espera_factura')
      .select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('Ese ingreso ya fue confirmado o rechazado');
    return { ok: true };
  }

  // ---------- 3. Armado de pedidos ----------

  async preparadores() {
    const { data, error } = await this.db.from('usuarios').select('id, nombre, rol, sucursal_id').in('rol', ROLES_PREPARAN).eq('activo', true).order('nombre');
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    // op salón primero: es el que arma
    return ((data ?? []) as any[]).sort((a, b) => Number(a.rol !== 'op_salon') - Number(b.rol !== 'op_salon'));
  }

  /** La caja (o quien tenga el pedido) le asigna el armado a alguien. */
  async asignar(pedidoId: string, usuarioId: string, quien: Usuario) {
    if (!usuarioId) throw new BadRequestException('Elegí a quién se lo asignás');
    const { data: elegido } = await this.db.from('usuarios').select('id, nombre, rol, activo').eq('id', usuarioId).maybeSingle();
    if (!elegido || (elegido as any).activo === false) throw new BadRequestException('Esa persona no está activa');
    if (!ROLES_PREPARAN.includes((elegido as any).rol)) throw new BadRequestException('Solo se asigna a alguien de salón o depósito');
    const { data: pedido, error } = await this.db.from('pedidos').select('id, estado, asignado_a').eq('id', pedidoId).maybeSingle();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    if (!pedido) throw new BadRequestException('No existe el pedido');
    if (!ESTADOS_ABIERTOS.includes((pedido as any).estado)) throw new BadRequestException('Ese pedido ya está armado');

    const ahora = new Date().toISOString();
    // queda en preparación a nombre de quien lo arma (la eficiencia lo cuenta)
    if ((pedido as any).estado !== 'en_preparacion') await this.pedidos.avanzar(pedidoId, 'en_preparacion', usuarioId);
    const { error: e2 } = await this.db
      .from('pedidos')
      .update({ asignado_a: usuarioId, asignado_en: ahora, asignado_por: quien.sub ?? null, preparado_por: usuarioId, armado_terminado_en: null })
      .eq('id', pedidoId);
    if (e2) throw new BadRequestException(e2.message);
    return { ok: true, asignadoA: usuarioId, nombre: (elegido as any).nombre, asignadoEn: ahora };
  }

  /** Los pedidos que tiene para armar, con el lugar de cada producto y lo que ya cargó. */
  async misPedidos(quien: Usuario, todos = false) {
    let q = this.db
      .from('pedidos')
      .select(`id, estado, canal, origen, qr_retiro, notas, creado_en, asignado_a, asignado_en, sucursal_id, contacto_nombre,
        cliente:clientes(nombre), sucursal:sucursales(nombre),
        items:pedidos_items(producto_id, cantidad, producto:productos(sku, nombre))`)
      .in('estado', ESTADOS_ABIERTOS)
      .not('asignado_a', 'is', null)
      .order('asignado_en');
    if (!todos || !ROLES_ENCARGADOS.includes(String(quien.rol))) q = q.eq('asignado_a', quien.sub ?? '');
    const { data, error } = await q;
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    const pedidos = (data ?? []) as any[];
    if (!pedidos.length) return [];
    const ids = pedidos.map((p) => p.id);
    const productos = [...new Set(pedidos.flatMap((p) => (p.items ?? []).map((i: any) => i.producto_id)))];
    const [{ data: carro }, { data: lugares }, nombres] = await Promise.all([
      this.db.from('pedidos_carro').select('id, pedido_id, producto_id, cantidad, creado_en').in('pedido_id', ids).order('creado_en'),
      this.db.from('stock').select('producto_id, sucursal_id, ubicacion').in('producto_id', productos),
      this.nombres(),
    ]);
    const lugar = new Map(((lugares ?? []) as any[]).map((l) => [`${l.producto_id}|${l.sucursal_id}`, l.ubicacion]));
    return pedidos.map((p) => {
      const cargas = ((carro ?? []) as any[]).filter((c) => c.pedido_id === p.id);
      const items = ((p.items ?? []) as any[]).map((i) => {
        const enCarro = cargas.filter((c) => c.producto_id === i.producto_id).reduce((a, c) => a + Number(c.cantidad), 0);
        return {
          productoId: i.producto_id,
          sku: i.producto?.sku ?? null,
          nombre: i.producto?.nombre ?? 'Producto',
          cantidad: Number(i.cantidad),
          enCarro,
          ubicacion: lugar.get(`${i.producto_id}|${p.sucursal_id}`) ?? null,
        };
      });
      // en el orden de recorrido: por lugar (lo sin lugar al final)
      items.sort((a, b) => (a.ubicacion ?? '￿').localeCompare(b.ubicacion ?? '￿', 'es', { numeric: true }) || a.nombre.localeCompare(b.nombre, 'es'));
      return {
        id: p.id,
        estado: p.estado,
        canal: p.canal,
        origen: p.origen,
        codigo: p.qr_retiro ?? p.id.slice(0, 6).toUpperCase(),
        cliente: p.cliente?.nombre?.trim() || p.contacto_nombre?.trim() || null,
        notas: p.notas ?? null,
        sucursal: p.sucursal?.nombre ?? null,
        asignadoA: p.asignado_a,
        asignadoNombre: nombres.get(p.asignado_a) ?? null,
        asignadoEn: p.asignado_en,
        primeraCarga: cargas[0]?.creado_en ?? null,
        ultimaCarga: cargas[cargas.length - 1]?.creado_en ?? null,
        cargas: cargas.map((c) => ({ id: c.id, productoId: c.producto_id, cantidad: Number(c.cantidad), creadoEn: c.creado_en })),
        items,
      };
    });
  }

  private async pedidoDelArmado(pedidoId: string, quien: Usuario) {
    const { data, error } = await this.db
      .from('pedidos')
      .select('id, estado, asignado_a, items:pedidos_items(producto_id, cantidad)')
      .eq('id', pedidoId)
      .maybeSingle();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    if (!data) throw new BadRequestException('No existe el pedido');
    const p = data as any;
    if (p.asignado_a !== quien.sub && !ROLES_ENCARGADOS.includes(String(quien.rol))) {
      throw new ForbiddenException('Ese pedido no te lo asignaron a vos');
    }
    if (!ESTADOS_ABIERTOS.includes(p.estado)) throw new BadRequestException('Ese pedido ya no se está armando');
    return p;
  }

  /** Suma al carro: por código escaneado o tocando el producto. */
  async sumarAlCarro(pedidoId: string, dto: { codigo?: string; productoId?: string; cantidad?: number }, quien: Usuario) {
    const p = await this.pedidoDelArmado(pedidoId, quien);
    let productoId = dto.productoId ?? null;
    let porCodigo = false;
    if (!productoId && dto.codigo) {
      const prod = await this.productoPorSkuOCodigo(dto.codigo);
      if (!prod) throw new BadRequestException('Ese código no está en el sistema');
      productoId = prod.id;
      porCodigo = prod.porCodigo;
    }
    const item = ((p.items ?? []) as any[]).find((i) => i.producto_id === productoId);
    if (!item) throw new BadRequestException('Ese producto no está en el pedido');
    const cantidad = Number(dto.cantidad ?? 1);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000) throw new BadRequestException('Cantidad inválida');
    const { data, error } = await this.db
      .from('pedidos_carro')
      .insert({ pedido_id: pedidoId, producto_id: productoId, cantidad, usuario_id: quien.sub ?? null, por_codigo: porCodigo })
      .select('id, creado_en')
      .single();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    return { ok: true, id: (data as any).id, productoId, cantidad, creadoEn: (data as any).creado_en };
  }

  /** «Me equivoqué»: saca la última carga de ese producto. */
  async sacarDelCarro(pedidoId: string, cargaId: string, quien: Usuario) {
    await this.pedidoDelArmado(pedidoId, quien);
    const { error } = await this.db.from('pedidos_carro').delete().eq('id', cargaId).eq('pedido_id', pedidoId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  /** «Terminé»: queda la hora y el pedido pasa a listo. */
  async terminar(pedidoId: string, quien: Usuario) {
    const p = await this.pedidoDelArmado(pedidoId, quien);
    const ahora = new Date().toISOString();
    const { error } = await this.db.from('pedidos').update({ armado_terminado_en: ahora }).eq('id', pedidoId);
    if (error) throw new BadRequestException(error.message);
    if (p.estado !== 'en_preparacion') await this.pedidos.avanzar(pedidoId, 'en_preparacion', p.asignado_a ?? quien.sub);
    await this.pedidos.avanzar(pedidoId, 'listo', quien.sub);
    return { ok: true, terminadoEn: ahora };
  }

  /** La medición: por preparador, los últimos N días. */
  async tiempos(dias = 7) {
    const d = Math.min(Math.max(Math.round(Number(dias) || 7), 1), 90);
    const desde = new Date(Date.now() - d * 86400_000).toISOString();
    const { data, error } = await this.db
      .from('pedidos')
      .select('id, asignado_a, asignado_en, armado_terminado_en, carro:pedidos_carro(creado_en, cantidad)')
      .gte('asignado_en', desde)
      .not('asignado_a', 'is', null)
      .limit(2000);
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    const nombres = await this.nombres();
    return tiemposPorPreparador((data ?? []) as any[]).map((t) => ({ ...t, nombre: nombres.get(t.usuarioId) ?? 'Sin nombre' }));
  }

  private async nombres(): Promise<Map<string, string>> {
    const { data } = await this.db.from('usuarios').select('id, nombre');
    return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.nombre ?? '')]));
  }

  private faltaMigracion(mensaje: string) {
    return /ingresos_puerta|pedidos_carro|asignado_a|ubicacion|op_salon/.test(mensaje)
      ? 'Falta aplicar la migración de op salón (db/migracion-op-salon.sql)'
      : mensaje;
  }
}
