import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { StockService } from './stock.service';
import { ProductosAdminService } from '../catalogo/productos-admin.service';
import { alcanzaPara, armarHistorial, errorDeFraccionamiento, leerCantidad, leerPrecio, type FilaMovimiento } from './fracciones';

// ---- FRACCIONAR (caso huevos 3/9/2026; pantalla completa 21/10/2026) ----
// Tres instancias: (1) la mercadería ENTRA al pozo en unidades o kilos (por la
// factura, o a mano desde esta pantalla con las mismas reglas que un ajuste);
// (2) en el local se ARMAN las presentaciones (docena, maple, 1/4 kg) y el
// sistema mueve stock del pozo a la presentación (RPC atómica, auditada);
// (3) la caja VENDE la presentación de su stock armado, sin lógica especial.
//
// El vínculo vive en productos.fraccion_de (el pozo) y
// productos.unidades_por_fraccion (cuánto del pozo lleva cada presentación).
// Antes solo se podía armar; ahora también se arma el grupo desde la pantalla
// (sumar pozo y presentaciones, editar, quitar), se carga el pozo y se ve el
// historial.

export type VincularDto = {
  /** el producto pozo (lo que entra a granel) */
  pozoSku: string;
  /** cuánto del pozo lleva la presentación: unidades o kilos según el pozo */
  unidades: number | string;
  /** presentación que ya existe en el catálogo… */
  sku?: string;
  /** …o una nueva, que se da de alta por el mismo camino que la ficha de productos */
  nuevo?: { nombre: string; precio: number | string };
};

export type EditarPresentacionDto = { nombre?: string; unidades?: number | string; precio?: number | string | null };

export type CargarPozoDto = {
  sucursalId: string;
  cantidad: number | string;
  motivo: string;
  autorizacionToken?: string;
};

const MAX_POR_OPERACION = 1000;

@Injectable()
export class FraccionesService {
  private readonly log = new Logger(FraccionesService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly stock: StockService,
    private readonly productos: ProductosAdminService,
  ) {}

  // Los grupos (pozo + presentaciones) con stock, precio y "alcanza para" por
  // sucursal, y las sucursales para el selector. El costo del pozo (para
  // calcular el de una presentación nueva) solo lo ve quien configura.
  async listar(rol?: string) {
    const veCosto = rol === 'gerente' || rol === 'dueno';
    const [presRes, sucRes] = await Promise.all([
      this.db
        .from('productos')
        .select('id, sku, nombre, fraccion_de, unidades_por_fraccion')
        .not('fraccion_de', 'is', null)
        .eq('activo', true)
        .order('unidades_por_fraccion'),
      this.db.from('sucursales').select('id, nombre').eq('activa', true).order('nombre'),
    ]);
    if (presRes.error) throw new BadRequestException(presRes.error.message);
    const sucursales = (sucRes.data ?? []) as { id: string; nombre: string }[];
    const presentaciones = (presRes.data ?? []) as any[];
    const pozoIds = [...new Set(presentaciones.map((p) => p.fraccion_de as string))];
    if (!pozoIds.length) return { grupos: [], sucursales };

    const ids = [...pozoIds, ...presentaciones.map((p) => p.id as string)];
    const [pozosRes, stockRes, precios] = await Promise.all([
      this.db.from('productos').select('id, sku, nombre, vendido_por_peso, costo, activo').in('id', pozoIds),
      this.db.from('stock').select('producto_id, sucursal_id, cantidad').in('producto_id', ids),
      this.preciosVigentes(ids),
    ]);
    if (pozosRes.error) throw new BadRequestException(pozosRes.error.message);
    if (stockRes.error) throw new BadRequestException(stockRes.error.message);

    const stockDe = (pid: string) => {
      const porSuc: Record<string, number> = {};
      for (const s of sucursales) porSuc[s.id] = 0;
      for (const s of (stockRes.data ?? []) as any[]) if (s.producto_id === pid) porSuc[s.sucursal_id] = Number(s.cantidad);
      return porSuc;
    };

    const grupos = ((pozosRes.data ?? []) as any[])
      .map((m) => {
        const stockPozo = stockDe(m.id);
        return {
          pozo: {
            id: m.id as string,
            sku: m.sku as string,
            nombre: m.nombre as string,
            porPeso: !!m.vendido_por_peso,
            costo: veCosto && m.costo != null ? Number(m.costo) : null,
            activo: m.activo !== false,
            stock: stockPozo,
          },
          presentaciones: presentaciones
            .filter((f) => f.fraccion_de === m.id)
            .map((f) => {
              const unidades = Number(f.unidades_por_fraccion);
              const alcanza: Record<string, number> = {};
              for (const [suc, cant] of Object.entries(stockPozo)) alcanza[suc] = alcanzaPara(cant, unidades);
              return {
                id: f.id as string,
                sku: f.sku as string,
                nombre: f.nombre as string,
                unidades,
                precio: precios.get(f.id) ?? null,
                stock: stockDe(f.id),
                alcanza,
              };
            }),
        };
      })
      .sort((a, b) => a.pozo.nombre.localeCompare(b.pozo.nombre, 'es'));
    return { grupos, sucursales };
  }

  // Armar (cantidad > 0) o abrir y pasar al pozo (cantidad < 0). La
  // conversión, el control de stock (nunca negativo) y la auditoría viven en la
  // RPC fraccionar_producto.
  async fraccionar(dto: { destinoId: string; cantidad: number; sucursalId: string }, usuarioId?: string) {
    const cantidad = Number(dto?.cantidad);
    if (!dto?.destinoId || !dto?.sucursalId) throw new BadRequestException('Faltan el producto o la sucursal');
    if (!Number.isFinite(cantidad) || cantidad === 0 || !Number.isInteger(cantidad)) {
      throw new BadRequestException('La cantidad de presentaciones tiene que ser un entero distinto de 0');
    }
    if (Math.abs(cantidad) > MAX_POR_OPERACION) throw new BadRequestException('Cantidad demasiado grande para una sola operación');
    const { data, error } = await this.db.rpc('fraccionar_producto', {
      p_destino: dto.destinoId,
      p_cantidad: cantidad,
      p_sucursal: dto.sucursalId,
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(errorDeFraccionamiento(error.message, cantidad));
    return data;
  }

  // Cargar el pozo a mano (entró sin factura, corrección): pasa por
  // registrarAjuste, así que tiene el MISMO tope y el mismo PIN de supervisor
  // que un ajuste de stock. Queda marcado como 'carga_pozo' para el historial.
  async cargarPozo(pozoId: string, dto: CargarPozoDto, autorizadoPor: string | undefined, usuarioId?: string) {
    if (!dto?.sucursalId) throw new BadRequestException('Elegí la sucursal');
    const pozo = await this.productoPorId(pozoId, 'id, sku, nombre, vendido_por_peso, fraccion_de');
    if (pozo.fraccion_de) throw new BadRequestException(`"${pozo.nombre}" es una presentación, no un pozo`);
    const { count } = await this.db
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('fraccion_de', pozo.id);
    if (!count) throw new BadRequestException(`"${pozo.nombre}" no es el pozo de ningún fraccionable`);

    const porPeso = !!pozo.vendido_por_peso;
    const leida = leerCantidad(dto.cantidad, porPeso, { que: porPeso ? 'Los kilos' : 'Las unidades', maximo: 100_000 });
    if (!leida.ok) throw new BadRequestException(leida.error);
    const motivo = String(dto.motivo ?? '').trim();
    if (motivo.length < 3) throw new BadRequestException('Escribí el motivo de la carga (por ejemplo: entró sin factura)');

    const res = await this.stock.registrarAjuste(
      {
        sku: pozo.sku,
        sucursalId: dto.sucursalId,
        cantidad: leida.valor,
        motivo: `Carga del pozo: ${motivo}`,
        autorizadoPor,
        autorizacionToken: dto.autorizacionToken,
      },
      'ajuste',
      usuarioId,
      { tipo: 'carga_pozo', id: randomUUID() },
    );
    const { data: fila } = await this.db
      .from('stock')
      .select('cantidad')
      .eq('producto_id', pozo.id)
      .eq('sucursal_id', dto.sucursalId)
      .maybeSingle();
    return { ...res, pozo: pozo.nombre, cargado: leida.valor, stockPozo: Number((fila as any)?.cantidad ?? 0) };
  }

  // Sumar una presentación a un pozo (si el pozo todavía no tenía ninguna,
  // así nace el fraccionable). Vincula un producto que ya existe o da de alta
  // uno nuevo con su precio, por el mismo camino que la ficha de productos.
  async vincular(dto: VincularDto, usuarioId?: string) {
    const pozo = await this.productoPorSku(
      dto?.pozoSku,
      'id, sku, nombre, fraccion_de, vendido_por_peso, costo, categoria_id, alicuota_iva, es_alcohol, activo',
      'el producto pozo',
    );
    if (!pozo.activo) throw new BadRequestException(`"${pozo.nombre}" está dado de baja: activalo antes de usarlo como pozo`);
    if (pozo.fraccion_de) {
      throw new BadRequestException(`"${pozo.nombre}" ya es una presentación de otro pozo: no puede ser pozo a la vez`);
    }
    const porPeso = !!pozo.vendido_por_peso;
    const leida = leerCantidad(dto.unidades, porPeso, { que: porPeso ? 'Los kilos que lleva' : 'Las unidades que lleva', maximo: 10_000 });
    if (!leida.ok) throw new BadRequestException(leida.error);
    const unidades = leida.valor;

    let presentacion: { id: string; sku: string; nombre: string };
    let nuevo = false;
    if (dto.sku?.trim()) {
      const prod = await this.productoPorSku(dto.sku, 'id, sku, nombre, fraccion_de, vendido_por_peso, activo', 'la presentación');
      if (prod.id === pozo.id) throw new BadRequestException('Un producto no puede ser presentación de sí mismo');
      if (!prod.activo) throw new BadRequestException(`"${prod.nombre}" está dado de baja`);
      if (prod.fraccion_de === pozo.id) {
        throw new BadRequestException(`"${prod.nombre}" ya está en este grupo: para cambiarle las unidades, usá Editar`);
      }
      if (prod.fraccion_de) {
        const { data: otro } = await this.db.from('productos').select('nombre').eq('id', prod.fraccion_de).maybeSingle();
        throw new BadRequestException(
          `"${prod.nombre}" ya es presentación de "${(otro as any)?.nombre ?? 'otro pozo'}": quitala de ahí primero`,
        );
      }
      const { count } = await this.db
        .from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('fraccion_de', prod.id);
      if (count) throw new BadRequestException(`"${prod.nombre}" es el pozo de otro fraccionable: no puede ser presentación`);
      if (prod.vendido_por_peso) {
        throw new BadRequestException(
          `"${prod.nombre}" se vende por kilo: una presentación se vende por paquete (sacale "por kilo" en la ficha o creá una nueva)`,
        );
      }
      const { error } = await this.db
        .from('productos')
        .update({ fraccion_de: pozo.id, unidades_por_fraccion: unidades })
        .eq('id', prod.id);
      if (error) throw new BadRequestException(error.message);
      presentacion = { id: prod.id, sku: prod.sku, nombre: prod.nombre };
    } else if (dto.nuevo) {
      const nombre = String(dto.nuevo.nombre ?? '').trim();
      if (!nombre) throw new BadRequestException('Poné el nombre de la presentación nueva');
      const precio = leerPrecio(dto.nuevo.precio);
      if (precio == null) throw new BadRequestException('Poné el precio de venta de la presentación nueva');
      // el costo sale del pozo: una docena cuesta 12 veces el huevo
      const costo = pozo.costo != null && Number(pozo.costo) > 0 ? Math.round(Number(pozo.costo) * unidades * 100) / 100 : null;
      const creado = await this.productos.crear(
        {
          nombre,
          precio,
          costo,
          vendidoPorPeso: false,
          esAlcohol: !!pozo.es_alcohol,
          alicuotaIva: pozo.alicuota_iva != null ? Number(pozo.alicuota_iva) : undefined,
        },
        usuarioId,
      );
      const { error } = await this.db
        .from('productos')
        .update({ fraccion_de: pozo.id, unidades_por_fraccion: unidades, categoria_id: pozo.categoria_id ?? null })
        .eq('id', creado.id);
      if (error) {
        // que no quede un producto suelto que nadie pidió
        await this.db.from('productos').update({ activo: false }).eq('id', creado.id);
        throw new BadRequestException(`Se creó "${nombre}" pero no se pudo sumar al grupo (${error.message}); quedó dado de baja`);
      }
      presentacion = { id: creado.id, sku: creado.sku, nombre };
      nuevo = true;
    } else {
      throw new BadRequestException('Elegí un producto que ya existe o cargá uno nuevo');
    }

    await this.auditar(usuarioId, 'fraccion_vinculada', presentacion.id, null, {
      pozo: pozo.sku,
      presentacion: presentacion.sku,
      unidades,
      nuevo,
    });
    return { ...presentacion, pozo: pozo.nombre, unidades, nuevo };
  }

  // Cambiar nombre, precio o lo que lleva una presentación. Las unidades no se
  // tocan si hay armadas: al abrirlas volverían al pozo con la cuenta nueva y
  // aparecerían o desaparecerían huevos de la nada.
  async editar(id: string, dto: EditarPresentacionDto, usuarioId?: string) {
    const prod = await this.productoPorId(id, 'id, sku, nombre, fraccion_de, unidades_por_fraccion');
    if (!prod.fraccion_de) throw new BadRequestException(`"${prod.nombre}" no es una presentación de ningún pozo`);

    if (dto?.unidades !== undefined && dto.unidades !== null && String(dto.unidades).trim() !== '') {
      const pozo = await this.productoPorId(prod.fraccion_de, 'id, nombre, vendido_por_peso');
      const porPeso = !!pozo.vendido_por_peso;
      const leida = leerCantidad(dto.unidades, porPeso, { que: porPeso ? 'Los kilos que lleva' : 'Las unidades que lleva', maximo: 10_000 });
      if (!leida.ok) throw new BadRequestException(leida.error);
      const antes = Number(prod.unidades_por_fraccion);
      if (leida.valor !== antes) {
        const { data: filas } = await this.db
          .from('stock')
          .select('cantidad, sucursal:sucursales(nombre)')
          .eq('producto_id', prod.id)
          .gt('cantidad', 0);
        const conStock = (filas ?? []) as any[];
        if (conStock.length) {
          const donde = conStock.map((f) => `${Number(f.cantidad).toLocaleString('es-AR')} en ${f.sucursal?.nombre ?? 'otra sucursal'}`).join(' y ');
          throw new BadRequestException(
            `Hay armadas (${donde}): pasalas al pozo antes de cambiar lo que lleva. Si no, al abrirlas volverían con la cuenta nueva.`,
          );
        }
        const { error } = await this.db.from('productos').update({ unidades_por_fraccion: leida.valor }).eq('id', prod.id);
        if (error) throw new BadRequestException(error.message);
        await this.auditar(usuarioId, 'fraccion_editada', prod.id, { unidades: antes }, { unidades: leida.valor });
      }
    }

    const cambios: { nombre?: string; precio?: number } = {};
    if (dto?.nombre !== undefined && String(dto.nombre).trim() !== prod.nombre) {
      if (!String(dto.nombre).trim()) throw new BadRequestException('El nombre no puede quedar vacío');
      cambios.nombre = String(dto.nombre).trim();
    }
    if (dto?.precio != null && String(dto.precio).trim() !== '') {
      const precio = leerPrecio(dto.precio);
      if (precio == null) throw new BadRequestException('El precio tiene que ser mayor que 0');
      cambios.precio = precio;
    }
    // nombre y precio, por el mismo camino que la ficha (el precio es una
    // vigencia nueva en la lista Minorista)
    if (Object.keys(cambios).length) await this.productos.editar(prod.id, cambios, usuarioId);
    return { ok: true };
  }

  // Sacar una presentación del grupo: NO borra el producto. Sigue en el
  // catálogo con su stock armado; solo deja de armarse desde el pozo.
  async quitar(id: string, usuarioId?: string) {
    const prod = await this.productoPorId(id, 'id, sku, nombre, fraccion_de, unidades_por_fraccion');
    if (!prod.fraccion_de) throw new BadRequestException(`"${prod.nombre}" no es una presentación de ningún pozo`);
    const { error } = await this.db
      .from('productos')
      .update({ fraccion_de: null, unidades_por_fraccion: null })
      .eq('id', prod.id);
    if (error) throw new BadRequestException(error.message);
    await this.auditar(
      usuarioId,
      'fraccion_quitada',
      prod.id,
      { pozo: prod.fraccion_de, unidades: Number(prod.unidades_por_fraccion) },
      { pozo: null, unidades: null },
    );
    return { ok: true, nombre: prod.nombre };
  }

  // Lo último que se armó, se abrió o se cargó al pozo en la sucursal, con
  // quién y cuándo (movimientos_stock con referencia 'fraccionamiento' o
  // 'carga_pozo').
  async historial(sucursalId: string, limite = 30) {
    if (!sucursalId) throw new BadRequestException('Elegí la sucursal');
    const tope = Math.min(Math.max(Math.trunc(Number(limite) || 30), 1), 100);
    const { data, error } = await this.db
      .from('movimientos_stock')
      .select(
        'id, cantidad, motivo, referencia_tipo, referencia_id, creado_en, producto:productos(id, sku, nombre, fraccion_de, vendido_por_peso), usuario:usuarios!movimientos_stock_usuario_id_fkey(nombre)',
      )
      .eq('sucursal_id', sucursalId)
      .in('referencia_tipo', ['fraccionamiento', 'carga_pozo'])
      .order('id', { ascending: false })
      // un armado son dos renglones: con 2×tope+2 las primeras `tope` operaciones vienen enteras
      .limit(tope * 2 + 2);
    if (error) throw new BadRequestException(error.message);
    return armarHistorial((data ?? []) as unknown as FilaMovimiento[], tope);
  }

  // ---------------------------------------------------------------- ayudas

  // Precio vigente de la lista base (Minorista), el mismo que fija la ficha.
  private async preciosVigentes(ids: string[]): Promise<Map<string, number>> {
    const salida = new Map<string, number>();
    if (!ids.length) return salida;
    const { data: lista } = await this.db.from('listas_precios').select('id').eq('nombre', 'Minorista').maybeSingle();
    if (!lista) return salida;
    const { data } = await this.db
      .from('precios')
      .select('producto_id, precio, vigente_desde')
      .eq('lista_id', (lista as any).id)
      .in('producto_id', ids)
      .lte('vigente_desde', new Date().toISOString())
      .order('vigente_desde', { ascending: false });
    for (const p of (data ?? []) as any[]) if (!salida.has(p.producto_id)) salida.set(p.producto_id, Number(p.precio));
    return salida;
  }

  private async productoPorSku(sku: string | undefined, columnas: string, que: string): Promise<any> {
    const clave = String(sku ?? '').trim();
    if (!clave) throw new BadRequestException(`Elegí ${que}`);
    const { data, error } = await this.db.from('productos').select(columnas).eq('sku', clave).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`No existe el producto ${clave}`);
    return data;
  }

  private async productoPorId(id: string, columnas: string): Promise<any> {
    if (!id) throw new BadRequestException('Falta el producto');
    const { data, error } = await this.db.from('productos').select(columnas).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('No existe el producto');
    return data;
  }

  private async auditar(usuarioId: string | undefined, accion: string, productoId: string, antes: any, despues: any) {
    const { error } = await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion,
      entidad: 'producto',
      entidad_id: productoId,
      datos_antes: antes,
      datos_despues: despues,
    });
    // la auditoría no frena la operación, pero tampoco se pierde en silencio
    if (error) this.log.warn(`auditoría ${accion} de ${productoId} no se guardó: ${error.message}`);
  }
}
