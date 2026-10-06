import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CajaService } from '../caja/caja.service';

export type AjusteDto = {
  sku: string;
  sucursalId: string;
  cantidad: number;
  motivo: string;
  // resuelto server-side: por el propio gerente/dueño autenticado (controller)
  // o consumiendo autorizacionToken (deposito) — nunca confiar en un valor del cliente.
  autorizadoPor?: string;
  autorizacionToken?: string;
};

export type TransferenciaDto = {
  origenId: string;
  destinoId: string;
  items: { sku: string; cantidad: number }[];
};

@Injectable()
export class StockService {
  private readonly log = new Logger(StockService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly caja: CajaService,
  ) {}

  async bajoMinimo() {
    const { data, error } = await this.db.from('stock_critico').select('*');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async movimientos(filtros: { limite?: number; tipo?: string; sucursalId?: string; sku?: string; dias?: number } = {}) {
    let query = this.db
      .from('movimientos_stock')
      .select(
        // usuario: quién hizo el movimiento (el dato estaba en usuario_id y no se traía)
        'id, tipo, cantidad, motivo, referencia_tipo, creado_en, producto:productos!inner(sku, nombre), sucursal:sucursales(nombre), usuario:usuarios!movimientos_stock_usuario_id_fkey(nombre)',
      )
      .order('id', { ascending: false })
      .limit(Math.min(filtros.limite ?? 50, 300));
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
    if (filtros.sucursalId) query = query.eq('sucursal_id', filtros.sucursalId);
    if (filtros.sku) query = query.eq('producto.sku', filtros.sku);
    if (filtros.dias) query = query.gte('creado_en', new Date(Date.now() - filtros.dias * 86400_000).toISOString());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------- estadísticas (SQL) ----------
  async resumen() {
    const { data, error } = await this.db.rpc('stock_resumen').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async valorizacion() {
    const [rubros, sucursales] = await Promise.all([
      this.db.rpc('stock_por_rubro'),
      this.db.rpc('stock_por_sucursal'),
    ]);
    if (rubros.error) throw new BadRequestException(rubros.error.message);
    return { rubros: rubros.data ?? [], sucursales: sucursales.data ?? [] };
  }

  async negativos() {
    const { data, error } = await this.db.rpc('stock_negativo');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async abc() {
    const { data, error } = await this.db.rpc('stock_abc');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async sinRotacion(dias = 30) {
    const { data, error } = await this.db.rpc('stock_sin_rotacion', { p_dias: dias });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Motivos tipificados de merma: sin "motivo libre" no hay estadística posible
  // de POR QUÉ se pierde mercadería (rotura vs robo vs vencimiento).
  static readonly MOTIVOS_MERMA = ['Rotura', 'Vencimiento', 'Robo/faltante', 'Error de carga', 'Consumo interno', 'Otro'];
  // Umbral de autorización: ajustes/mermas grandes requieren PIN de supervisor.
  private static TOPE_VALOR = Number(process.env.ODB_TOPE_AJUSTE ?? 50_000);
  private static TOPE_UNIDADES = Number(process.env.ODB_TOPE_AJUSTE_UNIDADES ?? 50);

  async registrarAjuste(dto: AjusteDto, tipo: 'ajuste' | 'merma' = 'ajuste', usuarioId?: string) {
    const productoId = await this.productoIdPorSku(dto.sku);
    const cantidad =
      tipo === 'merma' ? -Math.abs(Number(dto.cantidad)) : Number(dto.cantidad);

    if (tipo === 'merma') {
      const categoria = (dto.motivo ?? '').split(':')[0].trim();
      if (!StockService.MOTIVOS_MERMA.includes(categoria)) {
        throw new BadRequestException(
          `El motivo de la merma tiene que ser uno de: ${StockService.MOTIVOS_MERMA.join(', ')} (opcionalmente "Motivo: detalle")`,
        );
      }
    }

    // tope: un ajuste grande (en plata o en unidades) necesita el PIN de un
    // supervisor — un empleado solo no puede "desaparecer" mercadería cara.
    // Igual que en ventas/caja: si no vino ya autorizado por el propio
    // gerente/dueño (controller), se exige un token de PIN de un solo uso.
    const { data: prod } = await this.db.from('productos').select('costo').eq('id', productoId).maybeSingle();
    const valor = Math.abs(cantidad) * Number(prod?.costo ?? 0);
    const superaTope = valor > StockService.TOPE_VALOR || Math.abs(cantidad) > StockService.TOPE_UNIDADES;
    let autorizadoPor = dto.autorizadoPor;
    if (superaTope && !autorizadoPor && dto.autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(dto.autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }
    if (superaTope && !autorizadoPor) {
      throw new BadRequestException(
        `Este ${tipo} supera el tope (${Math.abs(cantidad)} u. / $${Math.round(valor).toLocaleString('es-AR')}): requiere autorización de un supervisor (PIN)`,
      );
    }

    const { data, error } = await this.db.rpc('registrar_movimiento', {
      p_producto_id: productoId,
      p_sucursal_id: dto.sucursalId,
      p_tipo: tipo,
      p_cantidad: cantidad,
      p_motivo: dto.motivo,
      p_usuario_id: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));

    if (superaTope) {
      await this.db.from('auditoria').insert({
        usuario_id: autorizadoPor,
        accion: `${tipo}_autorizado`,
        entidad: 'movimiento_stock',
        entidad_id: String(data),
        datos_despues: { sku: dto.sku, cantidad, valor: Math.round(valor), motivo: dto.motivo, operador: usuarioId ?? null },
      });
    }
    return { movimientoId: data };
  }

  // ---- FRACCIONAMIENTO (caso huevos, 2026-09-03) ----
  // Tres instancias: (1) la mercadería ENTRA al producto madre en unidades
  // (el pozo); (2) las chicas FRACCIONAN: arman docenas/maples y el sistema
  // mueve stock del pozo al fraccionado (RPC atómica, auditada); (3) la caja
  // VENDE el fraccionado de su stock armado, sin lógica especial.

  // Los grupos madre + fracciones con su stock por sucursal, para la pantalla.
  async fraccionables() {
    const { data: fracciones, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, fraccion_de, unidades_por_fraccion')
      .not('fraccion_de', 'is', null)
      .eq('activo', true)
      .order('unidades_por_fraccion');
    if (error) throw new BadRequestException(error.message);
    const madresIds = Array.from(new Set((fracciones ?? []).map((f: any) => f.fraccion_de)));
    if (!madresIds.length) return { grupos: [], sucursales: [] };
    const [madres, stockRes, sucs] = await Promise.all([
      this.db.from('productos').select('id, sku, nombre').in('id', madresIds),
      this.db.from('stock').select('producto_id, sucursal_id, cantidad').in('producto_id', [...madresIds, ...(fracciones ?? []).map((f: any) => f.id)]),
      this.db.from('sucursales').select('id, nombre').order('nombre'),
    ]);
    const stockDe = (pid: string) => {
      const porSuc: Record<string, number> = {};
      for (const s of (stockRes.data ?? []) as any[]) if (s.producto_id === pid) porSuc[s.sucursal_id] = Number(s.cantidad);
      return porSuc;
    };
    const grupos = ((madres.data ?? []) as any[]).map((m) => ({
      madre: { ...m, stock: stockDe(m.id) },
      fracciones: ((fracciones ?? []) as any[])
        .filter((f) => f.fraccion_de === m.id)
        .map((f) => ({ id: f.id, sku: f.sku, nombre: f.nombre, unidades: Number(f.unidades_por_fraccion), stock: stockDe(f.id) })),
    }));
    return { grupos, sucursales: (sucs.data ?? []) };
  }

  // Armar (cantidad > 0) o desarmar (cantidad < 0) fracciones. La conversión,
  // el control de stock y la auditoría viven en la RPC.
  async fraccionar(dto: { destinoId: string; cantidad: number; sucursalId: string }, usuarioId?: string) {
    const cantidad = Number(dto.cantidad);
    if (!dto.destinoId || !dto.sucursalId) throw new BadRequestException('Faltan el producto o la sucursal');
    if (!Number.isFinite(cantidad) || cantidad === 0 || !Number.isInteger(cantidad)) {
      throw new BadRequestException('La cantidad tiene que ser un entero distinto de 0');
    }
    if (Math.abs(cantidad) > 1000) throw new BadRequestException('Cantidad demasiado grande para una sola operación');
    const { data, error } = await this.db.rpc('fraccionar_producto', {
      p_destino: dto.destinoId,
      p_cantidad: cantidad,
      p_sucursal: dto.sucursalId,
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  // La transferencia se perdió en el camino o se cargó por error: el stock
  // vuelve a la sucursal de origen y queda auditado (RPC atómica).
  async anularTransferencia(id: string, motivo: string | undefined, usuarioId?: string) {
    const { data, error } = await this.db.rpc('anular_transferencia', {
      p_transferencia: id,
      p_usuario: usuarioId ?? null,
      p_motivo: motivo ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    await this.cerrarAvisosTransferencia(id);
    return data;
  }

  // ---------- conteo cíclico de inventario ----------

  async crearConteo(dto: { sucursalId: string; sector?: string }, usuarioId?: string) {
    const { data, error } = await this.db
      .from('conteos')
      .insert({ sucursal_id: dto.sucursalId, sector: dto.sector ?? null, usuario_id: usuarioId ?? null })
      .select('id')
      .single();
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { conteoId: data.id };
  }

  async conteosAbiertos() {
    const { data, error } = await this.db
      .from('conteos')
      .select(`id, sector, estado, creado_en,
        sucursal:sucursales(id, nombre),
        usuario:usuarios(nombre),
        items:conteos_items(producto_id, cantidad_contada, cantidad_sistema, producto:productos(sku, nombre))`)
      .eq('estado', 'abierto')
      .order('creado_en', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async conteoCargarItem(conteoId: string, dto: { sku: string; cantidad: number }) {
    const productoId = await this.productoIdPorSku(dto.sku);
    const { data, error } = await this.db.rpc('conteo_cargar_item', {
      p_conteo: conteoId,
      p_producto: productoId,
      p_cantidad_contada: Number(dto.cantidad),
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  // autorizadoPor: ya resuelto por el controller (gerente/dueño self) o token
  // de PIN consumido acá (deposito) — nunca un valor crudo del cliente.
  async finalizarConteo(conteoId: string, autorizadoPor: string | undefined, autorizacionToken: string | undefined, usuarioId?: string) {
    if (!autorizadoPor && autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }
    if (!autorizadoPor) throw new BadRequestException('Aplicar el conteo requiere autorización de un supervisor (PIN)');
    const { data, error } = await this.db.rpc('finalizar_conteo', {
      p_conteo: conteoId,
      p_usuario: usuarioId ?? null,
      p_autorizado_por: autorizadoPor,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  async descartarConteo(conteoId: string) {
    const { error } = await this.db.from('conteos').update({ estado: 'descartado' }).eq('id', conteoId).eq('estado', 'abierto');
    if (error) throw new BadRequestException(error.message);
    return { descartado: true };
  }

  async transferenciasPendientes() {
    const { data, error } = await this.db
      .from('transferencias')
      .select(`id, estado, creado_en,
        creador:usuarios!transferencias_creada_por_fkey(nombre),
        origen:sucursales!transferencias_sucursal_origen_id_fkey(nombre),
        destino:sucursales!transferencias_sucursal_destino_id_fkey(nombre),
        items:transferencias_items(cantidad, producto:productos(sku, nombre))`)
      .in('estado', ['pendiente', 'en_transito'])
      .order('creado_en', { ascending: false })
      .limit(30);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Quién manda y quién recibe sale del token: antes la API no le pasaba el
  // usuario a la base y creada_por / recibida_por quedaban vacíos siempre.
  async crearTransferencia(dto: TransferenciaDto, usuarioId?: string) {
    const porSku = new Map<string, number>();
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => {
        porSku.set(i.sku, (porSku.get(i.sku) ?? 0) + Number(i.cantidad));
        return { producto_id: await this.productoIdPorSku(i.sku), cantidad: Number(i.cantidad) };
      }),
    );
    const { data, error } = await this.db.rpc('crear_transferencia', {
      p_origen: dto.origenId,
      p_destino: dto.destinoId,
      p_items: items,
      p_usuario_id: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    // la transferencia ya salió: si el aviso falla, no se deshace nada
    await this.avisarTransferencia(String(data), dto, porSku, usuarioId).catch((e) =>
      this.log.warn(`aviso de transferencia ${data} no salió: ${e instanceof Error ? e.message : e}`),
    );
    return { transferenciaId: data };
  }

  // Campanita a los que la tienen que recibir: depósito y gerencia ACTIVOS de
  // la sucursal destino (menos el que la mandó). Si en esa sucursal no hay
  // nadie así cargado, el aviso va sin destinatario y lo ven los dueños.
  private async avisarTransferencia(transferenciaId: string, dto: TransferenciaDto, porSku: Map<string, number>, usuarioId?: string) {
    const skus = [...porSku.keys()];
    const [{ data: sucs }, { data: gente }, { data: prods }, { data: quien }] = await Promise.all([
      this.db.from('sucursales').select('id, nombre').in('id', [dto.origenId, dto.destinoId]),
      this.db.from('usuarios').select('id').eq('activo', true).eq('sucursal_id', dto.destinoId).in('rol', ['deposito', 'gerente']),
      skus.length ? this.db.from('productos').select('sku, nombre').in('sku', skus) : Promise.resolve({ data: [] as any[] }),
      usuarioId ? this.db.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle() : Promise.resolve({ data: null as any }),
    ]);
    const suc = (id: string) => ((sucs ?? []) as any[]).find((s) => s.id === id)?.nombre ?? 'otra sucursal';
    const nombreDe = new Map<string, string>(((prods ?? []) as any[]).map((p) => [p.sku, p.nombre]));
    const renglones = skus.map((sku) => `${nombreDe.get(sku) ?? sku} × ${Number(porSku.get(sku)).toLocaleString('es-AR')}`);
    const lista = renglones.slice(0, 4).join(', ') + (renglones.length > 4 ? ` y ${renglones.length - 4} más` : '');
    const origen = suc(dto.origenId);
    const destino = suc(dto.destinoId);
    const aviso = {
      tipo: 'transferencia',
      titulo: `Mercadería en camino a ${destino}`,
      detalle: `${origen} → ${destino}: ${lista}.${(quien as any)?.nombre ? ` La mandó ${(quien as any).nombre}.` : ''} Cuando llegue, contala y recibila en Stock.`,
      referencia: { transferenciaId, link: '/stock' },
    };
    const destinatarios = ((gente ?? []) as any[]).map((u) => u.id as string).filter((id) => id !== usuarioId);
    const filas: (typeof aviso & { para_usuario: string | null })[] = destinatarios.length
      ? destinatarios.map((para_usuario) => ({ ...aviso, para_usuario }))
      : [{ ...aviso, para_usuario: null }];
    const { error } = await this.db.from('alertas_internas').insert(filas);
    if (error) throw new Error(error.message);
  }

  async recibirTransferencia(id: string, usuarioId?: string) {
    const { error } = await this.db.rpc('recibir_transferencia', {
      p_transferencia: id,
      p_usuario_id: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    await this.cerrarAvisosTransferencia(id);
    return { recibida: true };
  }

  // Recibida o anulada, el "Mercadería en camino" ya no tiene nada que hacer
  // en la campanita de nadie: se cierra solo. Si falla, queda abierto (nada más).
  private async cerrarAvisosTransferencia(id: string) {
    const { error } = await this.db
      .from('alertas_internas')
      .update({ leida_en: new Date().toISOString() })
      .eq('tipo', 'transferencia')
      .filter('referencia->>transferenciaId', 'eq', id)
      .is('leida_en', null);
    if (error) this.log.warn(`no pude cerrar los avisos de la transferencia ${id}: ${error.message}`);
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

  private traducirError(mensaje: string): string {
    if (mensaje.includes('permission denied')) {
      return 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env';
    }
    return mensaje;
  }
}
