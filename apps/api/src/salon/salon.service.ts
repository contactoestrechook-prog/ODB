import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { rolesDe } from '../auth/roles';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { terminosDeBusqueda } from '../comun/busqueda';
import { ComprasService } from '../compras/compras.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { ReemplazosService } from '../reemplazos/reemplazos.service';
import { tiemposPorPreparador } from './tiempos';
import { reservadoDelRenglon } from '../pedidos/sin-stock';
import { aclaracionDe, aclaracionesDeNotas, sinAclaraciones } from '../comun/aclaraciones';
import { resumirLugares, tieneLugar, type FilaStockLugar } from './lugares';

// OP SALÓN (Leandro, 5/11/2026). Tres trabajos del que está en el salón:
//  1. el stock y DÓNDE está cada cosa (stock.ubicacion, por sucursal);
//  2. el ingreso por la puerta de depósito con remito, que espera la factura: no toca
//     el stock hasta que administración lo confirma;
//  3. armar los pedidos que le asigna la caja, sumando al carro desde la app
//     (cada carga queda con la hora: así se mide).

/** Quiénes pueden recibir un pedido para armar (en el selector de la caja). */
const ROLES_PREPARAN = ['op_salon', 'fiambreria', 'deposito'];
/** Los que arman solo en SU sucursal (op salón y fiambrería, 19/11/2026). */
const ROLES_DE_SU_SUCURSAL = ['op_salon', 'fiambreria'];
const deSuSucursal = (rol?: string | null) => ROLES_DE_SU_SUCURSAL.includes(String(rol ?? ''));
/** Todos los roles de una fila de usuarios (con la columna vieja, solo el rol). */
const rolesFila = (u: { rol?: string | null; roles?: unknown }) => rolesDe(u);
/** Qué se muestra al lado del nombre en «Quién lo arma». */
export function areaDeArmado(u: { rol?: string | null; roles?: unknown }): 'salon' | 'fiambreria' | 'deposito' {
  const r = rolesFila(u);
  if (r.includes('fiambreria')) return 'fiambreria';
  if (r.includes('op_salon')) return 'salon';
  return 'deposito';
}

// ---------- Fiambrería (19/11/2026) ----------
// Leandro: «que a las cajas les salga el pop up cada vez que hay un pedido,
// también a fiambrería si es que hay algo de fiambrería, así lo preparan».
/** Las categorías que prepara fiambrería (lo que se corta, se pesa o se arma en el mostrador). */
export const CATEGORIAS_FIAMBRERIA = ['fiambres', 'quesos', 'chacinados'];
const normalizar = (t?: string | null) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export const esDeFiambreria = (categoria?: string | null) => CATEGORIAS_FIAMBRERIA.includes(normalizar(categoria));
/** La ventana de fiambrería: lo de las últimas 12 h (lo de ayer ya no es un pedido que entra). */
const FIAMBRERIA_HASTA_MS = 12 * 3600_000;

/** De un pedido, lo que le toca a fiambrería (null si no trae nada). */
export function parteDeFiambreria(p: any) {
  const items = ((p?.items ?? []) as any[]);
  const suyos = items.filter((it) => esDeFiambreria(it?.producto?.categoria?.nombre));
  if (!suyos.length) return null;
  return {
    id: String(p.id),
    codigo: p.qr_retiro || String(p.id).slice(0, 8).toUpperCase(),
    creadoEn: p.creado_en,
    estado: p.estado,
    canal: p.canal,
    origen: p.origen ?? null,
    cliente: p.cliente?.nombre || p.contacto_nombre || null,
    envio: p.canal === 'domicilio' ? (p.destino_direccion || 'dirección sin cargar') : null,
    notas: p.notas ?? null,
    sucursalId: p.sucursal_id ?? null,
    items: suyos.map((it) => ({
      productoId: it.producto_id ? String(it.producto_id) : null,
      cantidad: Number(it.cantidad) || 0,
      nombre: String(it.producto?.nombre ?? 'Producto'),
      sku: it.producto?.sku ?? null,
      porPeso: it.producto?.vendido_por_peso === true,
    })),
    otros: items.length - suyos.length,
  };
}
/** Los que manejan cualquier pedido (no solo los suyos). */
// Quién ve el armado de TODOS (19/11/2026, Leandro: «todos pueden ver el pedido
// que prepara el resto, está pésimo»): dueños, gerentes y la caja que no arma.
// El que arma (salón, depósito, fiambrería), aunque también sea caja, ve y toca
// solo lo que le asignaron a él.
const ROLES_ARMAN = ['op_salon', 'deposito', 'fiambreria'];
export function veTodoElArmado(u: { rol?: string; roles?: unknown }): boolean {
  const roles = Array.isArray(u.roles) && u.roles.length ? u.roles.map(String) : [String(u.rol ?? '')];
  if (roles.some((r) => r === 'dueno' || r === 'gerente')) return true;
  return roles.includes('cajero') && !roles.some((r) => ROLES_ARMAN.includes(r));
}
const ESTADOS_ABIERTOS = ['recibido', 'pagado', 'en_preparacion'];

type Usuario = { sub?: string; rol?: string; roles?: unknown };

/** El op salón y fiambrería arman solo en su sucursal; depósito sin sucursal fija sirve en todas. */
export function sirveEnSucursal(u: { rol: string; roles?: unknown; sucursal_id?: string | null }, sucursalId: string) {
  if (!u.sucursal_id && rolesFila(u).some(deSuSucursal)) return false;
  return !u.sucursal_id || u.sucursal_id === sucursalId;
}

@Injectable()
export class SalonService {
  private readonly log = new Logger(SalonService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly compras: ComprasService,
    private readonly pedidos: PedidosService,
    // «Tengo parecido» y la consulta al cliente (20/11/2026)
    private readonly reemplazos: ReemplazosService,
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
  async buscarStock(q: string, quien: Usuario = {}) {
    // op salón: solo su sucursal (Leandro, 5/11/2026: «separarlos por sucursal»)
    const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
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
        sucursales: ((p.stock ?? []) as any[]).filter((s) => !propia || s.sucursal_id === propia).map((s) => ({
          sucursalId: s.sucursal_id,
          sucursal: nombreSuc.get(s.sucursal_id) ?? '—',
          cantidad: Number(s.cantidad) || 0,
          ubicacion: s.ubicacion ?? null,
        })),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async guardarUbicacion(dto: { productoId: string; sucursalId: string; ubicacion?: string }, quien: Usuario = {}) {
    const usuarioId = quien.sub;
    if (!dto.productoId || !dto.sucursalId) throw new BadRequestException('Faltan el producto o la sucursal');
    if (deSuSucursal(quien.rol) && dto.sucursalId !== (await this.sucursalDe(usuarioId))) {
      throw new ForbiddenException('Solo cargás lugares de tu sucursal');
    }
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

  /**
   * Cuánto del stock tiene su lugar (17/11/2026): por sucursal, por categoría de
   * la sucursal elegida y los lugares ya usados. El op salón ve solo la suya.
   */
  async lugares(sucursalId: string | undefined, quien: Usuario = {}) {
    const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
    const [{ data: sucs }, { data: cats }] = await Promise.all([
      this.db.from('sucursales').select('id, nombre'),
      this.db.from('categorias').select('id, nombre'),
    ]);
    const sucursales = ((sucs ?? []) as any[]).filter((s) => !propia || s.id === propia);
    // PostgREST devuelve de a 1.000: la primera página trae el total y el resto
    // se pide junto (17/11/2026: 9.000 filas, 10 páginas; de a una tardaba 2,5 s)
    const pagina = (desde: number, contar = false) => {
      let q = this.db
        .from('stock')
        .select('sucursal_id, cantidad, ubicacion, productos!inner(activo, categoria_id)', contar ? { count: 'exact' } : undefined)
        .eq('productos.activo', true)
        .order('producto_id')
        .order('sucursal_id')
        .range(desde, desde + 999);
      if (propia) q = q.eq('sucursal_id', propia);
      return q;
    };
    const primera = await pagina(0, true);
    if (primera.error) throw new BadRequestException(this.faltaMigracion(primera.error.message));
    const total = Math.min(primera.count ?? 0, 60_000);
    const resto = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / 1000) - 1) }, (_, i) => pagina((i + 1) * 1000)));
    const filas: FilaStockLugar[] = [];
    for (const r of [primera, ...resto]) {
      if (r.error) throw new BadRequestException(r.error.message);
      for (const f of (r.data ?? []) as any[]) {
        filas.push({ sucursal_id: f.sucursal_id, cantidad: f.cantidad, ubicacion: f.ubicacion, categoria_id: f.productos?.categoria_id ?? null });
      }
    }
    const base = resumirLugares(filas, null);
    const elegida = propia ?? (sucursales.some((s) => s.id === sucursalId) ? sucursalId! : base.sucursales[0]?.sucursalId ?? sucursales[0]?.id ?? null);
    const r = resumirLugares(filas, elegida);
    const nombreSuc = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreCat = new Map(((cats ?? []) as any[]).map((c) => [c.id, c.nombre]));
    return {
      sucursalId: elegida,
      sucursales: sucursales.map((s) => {
        const c = r.sucursales.find((x) => x.sucursalId === s.id);
        return { sucursalId: s.id, sucursal: s.nombre, conStock: c?.conStock ?? 0, conLugar: c?.conLugar ?? 0 };
      }).sort((a, b) => b.conStock - a.conStock),
      categorias: r.categorias.map((c) => ({ ...c, categoria: c.categoriaId ? nombreCat.get(c.categoriaId) ?? 'Sin nombre' : 'Sin categoría' })),
      lugaresUsados: r.lugaresUsados,
      sucursal: elegida ? nombreSuc.get(elegida) ?? null : null,
    };
  }

  /** Lo que tiene stock y no tiene lugar, de una categoría (o de todas, los primeros 200). */
  async sinLugar(sucursalId: string, categoriaId: string | undefined, quien: Usuario = {}) {
    const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
    const suc = propia ?? sucursalId;
    if (!suc) throw new BadRequestException('Falta la sucursal');
    let q = this.db
      .from('stock')
      .select('producto_id, cantidad, ubicacion, productos!inner(id, sku, nombre, activo, categoria_id)')
      .eq('sucursal_id', suc)
      .gt('cantidad', 0)
      .eq('productos.activo', true)
      .or('ubicacion.is.null,ubicacion.eq.')
      .limit(categoriaId ? 1000 : 200);
    if (categoriaId === 'sin') q = q.is('productos.categoria_id', null);
    else if (categoriaId) q = q.eq('productos.categoria_id', categoriaId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    return ((data ?? []) as any[])
      .filter((f) => !tieneLugar(f.ubicacion))
      .map((f) => ({ productoId: f.producto_id, sku: f.productos?.sku ?? null, nombre: f.productos?.nombre ?? 'Producto', cantidad: Number(f.cantidad) || 0 }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /**
   * Toda una categoría al mismo lugar («los Malbec están en la góndola 3»). Solo
   * a los que no tienen lugar: no pisa lo que ya se afinó a mano.
   */
  async lugarDeCategoria(dto: { sucursalId: string; categoriaId: string; ubicacion?: string }, quien: Usuario = {}) {
    const usuarioId = quien.sub;
    if (!dto.sucursalId || !dto.categoriaId) throw new BadRequestException('Faltan la sucursal o la categoría');
    if (deSuSucursal(quien.rol) && dto.sucursalId !== (await this.sucursalDe(usuarioId))) {
      throw new ForbiddenException('Solo cargás lugares de tu sucursal');
    }
    const ubicacion = String(dto.ubicacion ?? '').trim().slice(0, 80);
    if (!ubicacion) throw new BadRequestException('Escribí el lugar');
    const pendientes = await this.sinLugar(dto.sucursalId, dto.categoriaId, quien);
    const ids = pendientes.map((p) => p.productoId);
    const ahora = new Date().toISOString();
    // de a 100: la lista de ids va en la dirección del pedido
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await this.db
        .from('stock')
        .update({ ubicacion, ubicacion_por: usuarioId ?? null, ubicacion_en: ahora })
        .eq('sucursal_id', dto.sucursalId)
        .in('producto_id', ids.slice(i, i + 100));
      if (error) throw new BadRequestException(error.message);
    }
    return { ok: true, ubicacion, actualizados: ids.length };
  }

  async codigo(codigo: string) {
    const p = await this.productoPorSkuOCodigo(codigo);
    return p ? { encontrado: true, sku: p.sku, nombre: p.nombre } : { encontrado: false };
  }

  // ---------- 2. Ingreso por la puerta de depósito ----------

  async crearIngreso(dto: { proveedorId: string; sucursalId?: string; numeroRemito: string; notas?: string; items: { sku: string; cantidad: number; lote?: string; vencimiento?: string }[] }, quien: Usuario = {}) {
    const usuarioId = quien.sub;
    if (!usuarioId) throw new BadRequestException('No sé quién sos: volvé a entrar al sistema');
    if (!dto.proveedorId) throw new BadRequestException('Elegí el proveedor');
    const remito = String(dto.numeroRemito ?? '').trim();
    if (!remito) throw new BadRequestException('Falta el número de remito');
    // op salón: siempre a su sucursal, diga lo que diga el pedido
    const sucursalId = deSuSucursal(quien.rol) ? await this.sucursalDe(usuarioId) : dto.sucursalId || (await this.sucursalDe(usuarioId));
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
        proveedor:proveedores(id, nombre:razon_social), sucursal:sucursales(nombre),
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

  // ---------- Fiambrería: la ventana de lo que tiene que preparar ----------

  /** Pedidos abiertos con algo de fiambrería que nadie de fiambrería tomó todavía (de SU sucursal). */
  async fiambreriaPendientes(quien: Usuario) {
    const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
    let q = this.db
      .from('pedidos')
      .select(`id, estado, canal, origen, qr_retiro, notas, creado_en, sucursal_id, contacto_nombre, destino_direccion, fiambreria_por,
        cliente:clientes(nombre),
        items:pedidos_items(producto_id, cantidad, producto:productos(sku, nombre, vendido_por_peso, categoria:categorias(nombre)))`)
      .in('estado', ESTADOS_ABIERTOS)
      .gte('creado_en', new Date(Date.now() - FIAMBRERIA_HASTA_MS).toISOString())
      .order('creado_en', { ascending: false });
    // los que nadie tomó y (19/11/2026) los que tomé yo: si al cortar falta
    // algo, desde la ventana se corrige («No hay»). Los míos no suenan.
    q = quien.sub ? q.or(`fiambreria_en.is.null,fiambreria_por.eq.${quien.sub}`) : q.is('fiambreria_en', null);
    // el pedido sin sucursal le llega a todos (igual que la ventana de la caja)
    if (propia) q = q.or(`sucursal_id.eq.${propia},sucursal_id.is.null`);
    const { data, error } = await q;
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    return ((data ?? []) as any[])
      .map((p) => { const parte = parteDeFiambreria(p); return parte && { ...parte, mio: !!quien.sub && p.fiambreria_por === quien.sub }; })
      .filter(Boolean);
  }

  /** «Lo preparo»: el primero de fiambrería que lo toca queda a cargo y la ventana se va para todos. */
  async fiambreriaPreparo(pedidoId: string, quien: Usuario) {
    if (!pedidoId) throw new BadRequestException('Falta el pedido');
    const { data, error } = await this.db
      .from('pedidos')
      .update({ fiambreria_por: quien.sub, fiambreria_en: new Date().toISOString() })
      .eq('id', pedidoId)
      .is('fiambreria_en', null)
      .select('id');
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    if (data?.length) return { tomado: true };
    const { data: ya } = await this.db.from('pedidos').select('fiambreria_por, usuario:usuarios!pedidos_fiambreria_por_fkey(nombre)').eq('id', pedidoId).maybeSingle();
    return { tomado: false, nombre: (ya as any)?.usuario?.nombre ?? null };
  }

  /**
   * «No hay» desde la ventana de fiambrería (Leandro, 19/11/2026: «sumalo»). Lo
   * mismo que en el armado (resolver_falta_armado), pero solo para lo de
   * fiambrería (fiambres, quesos, chacinados), de su sucursal, y si nadie más
   * de fiambrería tomó ese pedido.
   */
  async fiambreriaFalta(pedidoId: string, dto: { productoId?: string; hay?: number; reemplazoId?: string | null; cantidad?: number | null }, quien: Usuario) {
    if (!pedidoId || !dto.productoId) throw new BadRequestException('Falta decir qué producto');
    const { data, error } = await this.db
      .from('pedidos')
      .select('id, estado, sucursal_id, fiambreria_por, items:pedidos_items(producto_id, producto:productos(categoria:categorias(nombre)))')
      .eq('id', pedidoId)
      .maybeSingle();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    if (!data) throw new BadRequestException('No existe el pedido');
    const p = data as any;
    if (!ESTADOS_ABIERTOS.includes(p.estado)) throw new BadRequestException('Ese pedido ya no se está armando');
    if (!veTodoElArmado(quien)) {
      const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
      if (propia && p.sucursal_id && p.sucursal_id !== propia) throw new ForbiddenException('Ese pedido es de otra sucursal');
      if (p.fiambreria_por && p.fiambreria_por !== quien.sub) throw new ForbiddenException('Ese pedido lo está preparando otra persona de fiambrería');
    }
    const item = ((p.items ?? []) as any[]).find((i) => i.producto_id === dto.productoId);
    if (!item) throw new BadRequestException('Ese producto ya no está en el pedido: actualizá la pantalla');
    if (!esDeFiambreria(item.producto?.categoria?.nombre)) throw new BadRequestException('Ese producto no es de fiambrería: lo arma la caja');
    const hay = Number(dto.hay ?? 0);
    if (!Number.isFinite(hay) || hay < 0 || hay > 1000) throw new BadRequestException('Cantidad inválida');
    const cantidad = dto.cantidad == null || String(dto.cantidad) === '' ? null : Number(dto.cantidad);
    if (cantidad != null && (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000)) throw new BadRequestException('Cantidad inválida');
    // con un parecido, se le consulta al cliente (20/11/2026): lo consulta quien arma el pedido
    if (dto.reemplazoId) {
      const r = await this.reemplazos.proponer(pedidoId, { productoId: dto.productoId, hay, reemplazoId: dto.reemplazoId, cantidad }, quien.sub ?? null);
      return { ...(r as any), propuesto: true };
    }
    const { data: r, error: e2 } = await this.db.rpc('resolver_falta_armado', {
      p_pedido: pedidoId, p_producto: dto.productoId, p_hay: hay, p_reemplazo: null, p_cantidad: null, p_usuario: quien.sub ?? null,
    });
    if (e2) throw new BadRequestException(this.faltaMigracion(e2.message));
    return r;
  }

  /** Los parecidos para «Tengo parecido» desde la ventana de fiambrería (mismos permisos que su «No hay»). */
  async fiambreriaParecidos(pedidoId: string, productoId: string, faltan: number | undefined, quien: Usuario) {
    const { data } = await this.db.from('pedidos').select('estado, sucursal_id, fiambreria_por').eq('id', pedidoId).maybeSingle();
    if (!data) throw new BadRequestException('No existe el pedido');
    if (!veTodoElArmado(quien)) {
      const propia = deSuSucursal(quien.rol) ? await this.sucursalDe(quien.sub) : null;
      if (propia && (data as any).sucursal_id && (data as any).sucursal_id !== propia) throw new ForbiddenException('Ese pedido es de otra sucursal');
      if ((data as any).fiambreria_por && (data as any).fiambreria_por !== quien.sub) throw new ForbiddenException('Ese pedido lo está preparando otra persona de fiambrería');
    }
    return this.reemplazos.parecidos(pedidoId, productoId, faltan);
  }

  // ---------- 3. Armado de pedidos ----------

  /** Con el pedido: solo la gente de SU sucursal (o de depósito sin sucursal fija). */
  async preparadores(pedidoId?: string) {
    // por CUALQUIERA de sus roles: el cajero que también arma figura (19/11/2026)
    const { data, error } = await this.db.from('usuarios').select('id, nombre, rol, roles, sucursal_id').overlaps('roles', ROLES_PREPARAN).eq('activo', true).order('nombre');
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    let gente = ((data ?? []) as any[]).map((u) => ({ ...u, area: areaDeArmado(u) }));
    if (pedidoId) {
      const { data: ped } = await this.db.from('pedidos').select('sucursal_id').eq('id', pedidoId).maybeSingle();
      const suc = (ped as any)?.sucursal_id;
      if (suc) gente = gente.filter((u) => sirveEnSucursal(u, suc));
    }
    // salón y fiambrería primero: son los que arman
    return gente.sort((a, b) => Number(a.area === 'deposito') - Number(b.area === 'deposito'));
  }

  /** La caja (o quien tenga el pedido) le asigna el armado a alguien. */
  async asignar(pedidoId: string, usuarioId: string, quien: Usuario) {
    if (!usuarioId) throw new BadRequestException('Elegí a quién se lo asignás');
    const { data: elegido } = await this.db.from('usuarios').select('id, nombre, rol, roles, activo, sucursal_id').eq('id', usuarioId).maybeSingle();
    if (!elegido || (elegido as any).activo === false) throw new BadRequestException('Esa persona no está activa');
    if (!rolesFila(elegido as any).some((r) => ROLES_PREPARAN.includes(r))) throw new BadRequestException('Solo se asigna a alguien de salón, fiambrería o depósito');
    const { data: pedido, error } = await this.db.from('pedidos').select('id, estado, asignado_a, sucursal_id').eq('id', pedidoId).maybeSingle();
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    if (!pedido) throw new BadRequestException('No existe el pedido');
    if ((pedido as any).sucursal_id && !sirveEnSucursal(elegido as any, (pedido as any).sucursal_id)) {
      throw new BadRequestException(`${(elegido as any).nombre} es de otra sucursal`);
    }
    if (!ESTADOS_ABIERTOS.includes((pedido as any).estado)) throw new BadRequestException('Ese pedido ya está armado');

    const ahora = new Date().toISOString();
    // queda en preparación a nombre de quien lo arma (la eficiencia lo cuenta)
    if ((pedido as any).estado !== 'en_preparacion') await this.pedidos.avanzar(pedidoId, 'en_preparacion', usuarioId);
    const { error: e2 } = await this.db
      .from('pedidos')
      .update({ asignado_a: usuarioId, asignado_en: ahora, asignado_por: quien.sub ?? null, preparado_por: usuarioId, armado_terminado_en: null })
      .eq('id', pedidoId);
    if (e2) throw new BadRequestException(e2.message);
    // CADA PEDIDO, AL CELULAR DE QUIEN LO ARMA (Leandro, 16/11/2026): sale por la
    // cola de avisos de pedidos, que reintenta y mira el chat antes de repetir.
    // Si no se pudo encolar, la asignación vale igual (tiene la comanda en la mano).
    await this.encolarAvisoAsignado(pedidoId, usuarioId, (elegido as any).nombre ?? null)
      .catch((e) => this.log.error(`no pude encolar el WhatsApp del pedido ${pedidoId} a ${(elegido as any).nombre}: ${e instanceof Error ? e.message : e}`));
    return { ok: true, asignadoA: usuarioId, nombre: (elegido as any).nombre, asignadoEn: ahora };
  }

  /** Un aviso por pedido: si se reasigna, se rearma para la persona nueva; a la misma no se le repite. */
  async encolarAvisoAsignado(pedidoId: string, usuarioId: string, nombre: string | null) {
    const detalle = { usuario_id: usuarioId, nombre };
    const { data: previo, error } = await this.db.from('avisos_pedidos').select('id, detalle')
      .eq('pedido_id', pedidoId).eq('tipo', 'pedido_asignado').maybeSingle();
    if (error) throw new Error(error.message);
    if (!previo) {
      const { error: e } = await this.db.from('avisos_pedidos').insert({ pedido_id: pedidoId, tipo: 'pedido_asignado', detalle });
      if (e && (e as any).code !== '23505') throw new Error(e.message);
      return;
    }
    if (String((previo as any).detalle?.usuario_id ?? '') === usuarioId) return;
    const ahora = new Date().toISOString();
    const { error: e } = await this.db.from('avisos_pedidos').update({
      detalle, estado: 'pendiente', pendiente_desde: ahora, proximo_intento: ahora, intentos: 0, tomado_hasta: null,
      destino: null, waha_id: null, waha_ids: [], enviado_en: null, entregado_en: null, ack: null, incierto: false,
      ultimo_error: null, motivo: null,
    }).eq('id', (previo as any).id);
    if (e) throw new Error(e.message);
  }

  /** Los pedidos que tiene para armar, con el lugar de cada producto y lo que ya cargó. */
  async misPedidos(quien: Usuario, todos = false) {
    let q = this.db
      .from('pedidos')
      .select(`id, estado, canal, origen, qr_retiro, notas, creado_en, asignado_a, asignado_en, sucursal_id, contacto_nombre, reserva_stock,
        cliente:clientes(nombre), sucursal:sucursales(nombre),
        items:pedidos_items(producto_id, cantidad, reservado, producto:productos(sku, nombre))`)
      .in('estado', ESTADOS_ABIERTOS)
      .not('asignado_a', 'is', null)
      .order('asignado_en');
    if (!todos || !veTodoElArmado(quien)) q = q.eq('asignado_a', quien.sub ?? '');
    const { data, error } = await q;
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    const pedidos = (data ?? []) as any[];
    if (!pedidos.length) return [];
    const ids = pedidos.map((p) => p.id);
    const productos = [...new Set(pedidos.flatMap((p) => (p.items ?? []).map((i: any) => i.producto_id)))];
    const [{ data: carro }, { data: lugares }, nombres, cambios] = await Promise.all([
      this.db.from('pedidos_carro').select('id, pedido_id, producto_id, cantidad, creado_en').in('pedido_id', ids).order('creado_en'),
      this.db.from('stock').select('producto_id, sucursal_id, ubicacion, cantidad').in('producto_id', productos),
      this.nombres(),
      // «Tengo parecido» (20/11/2026): lo propuesto, lo consultado y lo que contestó el cliente
      this.reemplazos.dePedidos(ids),
    ]);
    const lugar = new Map(((lugares ?? []) as any[]).map((l) => [`${l.producto_id}|${l.sucursal_id}`, l.ubicacion]));
    // lo que dice el sistema que hay (20/11/2026): si no alcanza, el armado lo marca
    const enSistema = new Map(((lugares ?? []) as any[]).map((l) => [`${l.producto_id}|${l.sucursal_id}`, Number(l.cantidad) || 0]));
    return pedidos.map((p) => {
      const cargas = ((carro ?? []) as any[]).filter((c) => c.pedido_id === p.id);
      // lo que aclaró el cliente de cada renglón («limón» del Saphirus VARIOS, 20/11/2026)
      const aclaraciones = aclaracionesDeNotas(p.notas);
      const items = ((p.items ?? []) as any[]).map((i) => {
        const enCarro = cargas.filter((c) => c.producto_id === i.producto_id).reduce((a, c) => a + Number(c.cantidad), 0);
        return {
          productoId: i.producto_id,
          sku: i.producto?.sku ?? null,
          nombre: i.producto?.nombre ?? 'Producto',
          aclaracion: aclaracionDe(String(i.producto?.nombre ?? ''), aclaraciones),
          cantidad: Number(i.cantidad),
          enCarro,
          ubicacion: lugar.get(`${i.producto_id}|${p.sucursal_id}`) ?? null,
          // lo que el sistema da para este pedido (si reservó, lo suyo ya está descontado)
          hayEnSistema: Math.max(0, (enSistema.get(`${i.producto_id}|${p.sucursal_id}`) ?? 0) + reservadoDelRenglon(p.reserva_stock, Number(i.cantidad), i.reservado)),
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
        // las aclaraciones ya van en su renglón: en la nota no se repiten
        notas: sinAclaraciones(p.notas) || null,
        sucursal: p.sucursal?.nombre ?? null,
        sucursalId: p.sucursal_id ?? null,
        asignadoA: p.asignado_a,
        asignadoNombre: nombres.get(p.asignado_a) ?? null,
        asignadoEn: p.asignado_en,
        primeraCarga: cargas[0]?.creado_en ?? null,
        ultimaCarga: cargas[cargas.length - 1]?.creado_en ?? null,
        cargas: cargas.map((c) => ({ id: c.id, productoId: c.producto_id, cantidad: Number(c.cantidad), creadoEn: c.creado_en })),
        items,
        cambios: cambios.get(p.id) ?? [],
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
    if (p.asignado_a !== quien.sub && !veTodoElArmado(quien)) {
      throw new ForbiddenException('Ese pedido no te lo asignaron a vos');
    }
    if (!ESTADOS_ABIERTOS.includes(p.estado)) throw new BadRequestException('Ese pedido ya no se está armando');
    return p;
  }

  /** Suma al carro: por código escaneado o tocando el producto. */
  async sumarAlCarro(pedidoId: string, dto: { codigo?: string; productoId?: string; cantidad?: number; aprender?: boolean }, quien: Usuario) {
    const p = await this.pedidoDelArmado(pedidoId, quien);
    let productoId = dto.productoId ?? null;
    let porCodigo = false;
    // UN CÓDIGO QUE EL SISTEMA NO CONOCE (Leandro, 20/11/2026: «estoy escaneando el
    // código del Saphirus sabor bebé y me dice que el código no está en el
    // sistema»). Los VARIOS tienen cargado un solo código y cada fragancia trae
    // el suyo. Quien arma dice cuál del pedido es; el código queda aprendido
    // (también para la caja) y en el historial del pedido.
    if (dto.aprender === true && dto.codigo && productoId) {
      await this.aprenderCodigo(pedidoId, p, String(dto.codigo), productoId, quien);
      porCodigo = true;
    } else if (!productoId && dto.codigo) {
      const prod = await this.productoPorSkuOCodigo(dto.codigo);
      if (!prod) throw new BadRequestException({ statusCode: 400, codigo: 'CODIGO_DESCONOCIDO', message: 'Ese código no está en el sistema', leido: String(dto.codigo).trim().toUpperCase() });
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

  /** Asocia un código de barras nuevo a un producto DEL PEDIDO (nunca le saca el código a otro). */
  private async aprenderCodigo(pedidoId: string, p: any, codigo: string, productoId: string, quien: Usuario) {
    const limpio = codigo.trim().toUpperCase();
    if (!/^[0-9A-Z-]{6,32}$/.test(limpio)) throw new BadRequestException('Ese código no se leyó bien: escanealo de nuevo');
    const item = ((p.items ?? []) as any[]).find((i) => i.producto_id === productoId);
    if (!item) throw new BadRequestException('Ese producto no está en el pedido');
    const { data: ya } = await this.db.from('codigos_barras').select('producto_id, producto:productos(nombre)').eq('codigo', limpio).maybeSingle();
    if (ya && (ya as any).producto_id !== productoId) throw new BadRequestException(`Ese código ya es de ${(ya as any).producto?.nombre ?? 'otro producto'}: no es este`);
    if (!ya) {
      const { error } = await this.db.from('codigos_barras').insert({ codigo: limpio, producto_id: productoId });
      if (error && (error as any).code !== '23505') throw new BadRequestException(error.message);
    }
    const { data: prod } = await this.db.from('productos').select('nombre, sku').eq('id', productoId).maybeSingle();
    await this.db.from('pedidos_historial').insert({
      pedido_id: pedidoId, evento: 'codigo', usuario_id: quien.sub ?? null,
      detalle: { codigo: limpio, producto: (prod as any)?.nombre ?? null, sku: (prod as any)?.sku ?? null, aprendido: !ya },
    }).then(() => null, () => null);
    this.log.log(`código ${limpio} ${ya ? 'ya era' : 'aprendido para'} ${(prod as any)?.nombre ?? productoId} (pedido ${pedidoId}, ${quien.sub ?? 'sin usuario'})`);
  }

  /**
   * Falta stock al armar (Leandro, 19/11/2026: «el que arma el pedido tiene que
   * poder modificar artículos por falta de stock»). El que arma dice cuánto hay
   * en la góndola (0 = nada) y, si quiere, qué producto va en su lugar. El
   * pedido se corrige con su total (resolver_falta_armado) y en el historial
   * queda cuánto había y cuánto decía el sistema.
   */
  async faltaEnArmado(pedidoId: string, dto: { productoId?: string; hay?: number; reemplazoId?: string | null; cantidad?: number | null; variedades?: unknown; pedida?: string | null; avisar?: boolean }, quien: Usuario) {
    await this.pedidoDelArmado(pedidoId, quien);
    if (!dto.productoId) throw new BadRequestException('Falta decir qué producto');
    const hay = Number(dto.hay ?? 0);
    if (!Number.isFinite(hay) || hay < 0 || hay > 1000) throw new BadRequestException('Cantidad inválida');
    const cantidad = dto.cantidad == null || String(dto.cantidad) === '' ? null : Number(dto.cantidad);
    if (cantidad != null && (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000)) throw new BadRequestException('Cantidad inválida');
    // «TENGO PARECIDO» (Leandro y Jaqui, 20/11/2026): el parecido no entra
    // solo; queda propuesto y se le consulta al cliente al terminar.
    if (dto.reemplazoId) {
      const r = await this.reemplazos.proponer(pedidoId, { productoId: dto.productoId, hay, reemplazoId: dto.reemplazoId, cantidad }, quien.sub ?? null);
      return { ...(r as any), propuesto: true };
    }
    // «NO HAY ESE SABOR; DE ESE HAY ESTOS» (Leandro, 20/11/2026): el mismo
    // producto en otra variedad, consultado como un parecido
    if (Array.isArray(dto.variedades) && dto.variedades.some((v) => String(v ?? '').trim())) {
      if (hay > 0) throw new BadRequestException('Para ofrecerle otra variedad, poné 0 en cuánto hay');
      const r = await this.reemplazos.proponerVariedad(pedidoId, { productoId: dto.productoId, pedida: dto.pedida ?? null, variedades: dto.variedades }, quien.sub ?? null);
      return { ...(r as any), propuesto: true };
    }
    // no hay y no hay otra: sale del pedido y al cliente se le avisa en el momento
    if (dto.avisar === true && hay === 0) return this.reemplazos.sacarYAvisar(pedidoId, dto.productoId, quien.sub ?? null);
    const { data, error } = await this.db.rpc('resolver_falta_armado', {
      p_pedido: pedidoId,
      p_producto: dto.productoId,
      p_hay: hay,
      p_reemplazo: null,
      p_cantidad: null,
      p_usuario: quien.sub ?? null,
    });
    if (error) throw new BadRequestException(this.faltaMigracion(error.message));
    return data;
  }

  /** Lo que se parece al que falta y hay en la sucursal (con su precio en este pedido). */
  async parecidos(pedidoId: string, productoId: string, faltan: number | undefined, quien: Usuario) {
    await this.pedidoDelArmado(pedidoId, quien);
    if (!productoId) throw new BadRequestException('Falta decir qué producto');
    return this.reemplazos.parecidos(pedidoId, productoId, faltan);
  }

  /** «Consultar al cliente»: sale el WhatsApp del primer cambio (los demás, de a uno, con cada respuesta). */
  async consultarCambios(pedidoId: string, quien: Usuario) {
    await this.pedidoDelArmado(pedidoId, quien);
    return this.reemplazos.consultar(pedidoId, quien.sub ?? null);
  }

  /** «Lo llamé y dijo que sí / que no»: lo anota quien arma, sin esperar el WhatsApp. */
  async decidirCambio(pedidoId: string, cambioId: string, acepta: boolean, quien: Usuario, elegida?: string | null) {
    await this.pedidoDelArmado(pedidoId, quien);
    return this.reemplazos.decidir(cambioId, acepta, {
      usuarioId: quien.sub ?? null, pedidoId, elegida: elegida ?? null,
      texto: `Lo anotó quien arma: ${acepta ? (elegida ? `eligió ${elegida}` : 'sí') : 'no'}`,
    });
  }

  /** Se arrepintió del parecido antes de consultar. */
  async anularCambio(pedidoId: string, cambioId: string, quien: Usuario) {
    await this.pedidoDelArmado(pedidoId, quien);
    return this.reemplazos.anular(pedidoId, cambioId);
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
    // con cambios sin contestar, el pedido todavía puede cambiar (20/11/2026)
    const abiertos = ((await this.reemplazos.dePedidos([pedidoId])).get(pedidoId) ?? []).filter((c: any) => ['propuesto', 'en_cola', 'preguntado'].includes(c.estado));
    if (abiertos.some((c: any) => c.estado === 'propuesto')) throw new BadRequestException('Antes de terminar, consultale al cliente los cambios (o anotá lo que te dijo)');
    if (abiertos.length) throw new BadRequestException(`Falta que el cliente conteste ${abiertos.length === 1 ? 'un cambio' : `${abiertos.length} cambios`}. Si te contestó por otro lado, anotalo en cada uno.`);
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
    return /ingresos_puerta|pedidos_carro|asignado_a|ubicacion|op_salon|fiambreria_/.test(mensaje)
      ? 'Falta aplicar la migración de op salón (db/migracion-op-salon.sql)'
      : mensaje;
  }
}
