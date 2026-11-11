import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { traspasoPDF } from '../comun/documentos';
import { diferenciaDe, sugerirTraspaso, valorDe, type FilaSugerencia } from './logica';
import { leerAbastecimiento } from '../abastecimiento/motor';

// ============================================================
// TRASPASOS ENTRE LOCALES (Leandro, 10/11/2026: «un módulo para traspaso de
// mercadería entre los locales, bien completo, que no le falte nada»).
// Pedido → preparación y envío → (lo lleva alguien) → recepción → diferencias.
// El stock lo mueven SOLO las funciones de la base (db/migracion-traspasos.sql);
// acá se valida quién puede, se arman los datos y se avisa.
// ============================================================

export type Usuario = { sub?: string; rol?: string; sucursalId?: string | null };
export type RenglonDto = { sku: string; cantidad: number; nota?: string | null };

/** Dueño, gerencia y administración operan cualquier local; el resto, solo el suyo. */
export const VEN_TODO = ['dueno', 'gerente', 'administrativo'];

const SELECT = `id, numero, estado, creado_en, pedida_en, enviada_en, entregada_en, recibida_en, cerrada_en, anulada_en,
  nota, nota_recepcion, motivo_anulacion, sucursal_origen_id, sucursal_destino_id, lleva_id,
  origen:sucursales!transferencias_sucursal_origen_id_fkey(id, nombre),
  destino:sucursales!transferencias_sucursal_destino_id_fkey(id, nombre),
  pidio:usuarios!transferencias_pedida_por_fkey(nombre),
  creador:usuarios!transferencias_creada_por_fkey(nombre),
  envio:usuarios!transferencias_enviada_por_fkey(nombre),
  lleva:usuarios!transferencias_lleva_id_fkey(nombre),
  recibio:usuarios!transferencias_recibida_por_fkey(nombre),
  anulo:usuarios!transferencias_anulada_por_fkey(nombre),
  items:transferencias_items(producto_id, cantidad, cantidad_pedida, cantidad_recibida, costo_unitario, nota, resolucion, resuelta_en,
    producto:productos(sku, nombre))`;

@Injectable()
export class TraspasosService {
  private readonly log = new Logger(TraspasosService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // ---- leer ----------------------------------------------------------------

  /** Los abiertos (pedidos, en camino, con diferencias) y lo cerrado de los últimos 60 días. */
  async listar(u: Usuario, dias = 60) {
    const desde = new Date(Date.now() - Math.min(365, Math.max(1, dias)) * 86400_000).toISOString();
    const [abiertos, cerrados] = await Promise.all([
      this.db.from('transferencias').select(SELECT).in('estado', ['pedido', 'en_transito', 'con_diferencias']).order('creado_en', { ascending: false }).limit(200),
      this.db.from('transferencias').select(SELECT).in('estado', ['recibida', 'anulada']).gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300),
    ]);
    if (abiertos.error) throw new BadRequestException(abiertos.error.message);
    if (cerrados.error) throw new BadRequestException(cerrados.error.message);
    const todos = [...(abiertos.data ?? []), ...(cerrados.data ?? [])].map((t) => this.armar(t));
    // cada uno ve lo de su local; dueño, gerencia y administración, todo
    const mios = VEN_TODO.includes(String(u.rol)) || !u.sucursalId ? todos : todos.filter((t) => t.origen?.id === u.sucursalId || t.destino?.id === u.sucursalId || t.llevaId === u.sub);
    const [{ data: sucursales }, { data: personas }] = await Promise.all([
      this.db.from('sucursales').select('id, nombre').order('nombre'),
      // quién lo puede llevar: los repartidores primero, después el resto del equipo
      this.db.from('usuarios').select('id, nombre, rol, sucursal_id').eq('activo', true).in('rol', ['repartidor', 'cajero', 'deposito', 'gerente', 'administrativo', 'dueno']).order('nombre'),
    ]);
    const llevan = ((personas ?? []) as any[]).sort((a, b) => Number(b.rol === 'repartidor') - Number(a.rol === 'repartidor')).map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol }));
    return { traspasos: mios, sucursales: sucursales ?? [], personas: llevan, miSucursal: u.sucursalId ?? null, rol: u.rol ?? null, veTodo: VEN_TODO.includes(String(u.rol)), decideDiferencias: ['gerente', 'dueno'].includes(String(u.rol)) };
  }

  async uno(id: string) {
    const { data, error } = await this.db.from('transferencias').select(SELECT).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('No existe ese traspaso');
    return this.armar(data);
  }

  private armar(t: any) {
    const items = ((t.items ?? []) as any[]).map((i) => ({
      productoId: i.producto_id,
      sku: i.producto?.sku ?? null,
      nombre: i.producto?.nombre ?? 'producto',
      pedido: i.cantidad_pedida == null ? null : Number(i.cantidad_pedida),
      enviado: Number(i.cantidad ?? 0),
      recibido: i.cantidad_recibida == null ? null : Number(i.cantidad_recibida),
      diferencia: diferenciaDe(i),
      costo: i.costo_unitario == null ? null : Number(i.costo_unitario),
      nota: i.nota ?? null,
      resolucion: i.resolucion ?? null,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return {
      id: t.id, numero: t.numero, estado: t.estado,
      origen: t.origen, destino: t.destino, llevaId: t.lleva_id ?? null,
      creadoEn: t.creado_en, pedidaEn: t.pedida_en, enviadaEn: t.enviada_en, entregadaEn: t.entregada_en, recibidaEn: t.recibida_en, cerradaEn: t.cerrada_en, anuladaEn: t.anulada_en,
      pidio: t.pidio?.nombre ?? null, envio: t.envio?.nombre ?? t.creador?.nombre ?? null, lleva: t.lleva?.nombre ?? null, recibio: t.recibio?.nombre ?? null, anulo: t.anulo?.nombre ?? null,
      nota: t.nota ?? null, notaRecepcion: t.nota_recepcion ?? null, motivoAnulacion: t.motivo_anulacion ?? null,
      items,
      valor: valorDe((t.items ?? []) as any[]),
      diferencias: items.filter((i) => i.diferencia !== 0).length,
      sinResolver: items.filter((i) => i.diferencia !== 0 && !i.resolucion).length,
    };
  }

  /** Lo que el que lleva tiene encima (para «Mis entregas»). */
  async paraLlevar(u: Usuario) {
    if (!u.sub) return [];
    const { data, error } = await this.db.from('transferencias').select(SELECT).eq('estado', 'en_transito').eq('lleva_id', u.sub).is('entregada_en', null).order('enviada_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((t) => this.armar(t));
  }

  // ---- qué pedir -----------------------------------------------------------

  async sugerencias(origenId: string, destinoId: string) {
    if (!origenId || !destinoId || origenId === destinoId) throw new BadRequestException('Elegí el local al que le pedís');
    const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [stockO, stockD, ventas] = await Promise.all([
      this.todas((a, b) => this.db.from('stock').select('producto_id, cantidad, stock_minimo, punto_reposicion, producto:productos!inner(sku, nombre, activo)').eq('sucursal_id', origenId).gt('cantidad', 0).eq('producto.activo', true).range(a, b)),
      this.todas((a, b) => this.db.from('stock').select('producto_id, cantidad, stock_minimo, punto_reposicion').eq('sucursal_id', destinoId).range(a, b)),
      this.todas((a, b) => this.db.from('movimientos_stock').select('producto_id, sucursal_id, cantidad').eq('tipo', 'venta').gte('creado_en', desde).in('sucursal_id', [origenId, destinoId]).range(a, b)),
    ]);
    const dest = new Map(stockD.map((s: any) => [s.producto_id, s]));
    const vendidas = new Map<string, number>();
    for (const v of ventas as any[]) vendidas.set(`${v.producto_id}|${v.sucursal_id}`, (vendidas.get(`${v.producto_id}|${v.sucursal_id}`) ?? 0) + Math.abs(Number(v.cantidad)));
    // 11/11/2026: los locales venden con el sistema viejo, así que la caja de
    // NÚCLEO casi no tiene ventas y, sin mínimos cargados, «Sugerir» no proponía
    // nada. El ritmo de venta real es el del motor de abastecimiento (el mismo
    // número que ve Compras): se toma el mayor de los dos.
    try {
      for (const f of await leerAbastecimiento(this.db)) {
        const clave = `${f.producto_id}|${f.sucursal_id}`;
        const delMotor = Math.round(Math.max(0, Number(f.ritmo_dia) || 0) * 300) / 10;
        if (delMotor > (vendidas.get(clave) ?? 0)) vendidas.set(clave, delMotor);
      }
    } catch (e: any) {
      this.log.warn(`traspasos: sin el ritmo del motor, la sugerencia sale solo con las ventas de la caja (${e?.message ?? e})`);
    }
    const filas: FilaSugerencia[] = (stockO as any[]).map((s) => {
      const d: any = dest.get(s.producto_id);
      return {
        productoId: s.producto_id, sku: s.producto?.sku, nombre: s.producto?.nombre,
        stockOrigen: Number(s.cantidad), stockDestino: Number(d?.cantidad ?? 0),
        minimoDestino: Math.max(Number(d?.punto_reposicion ?? 0), Number(d?.stock_minimo ?? 0)),
        minimoOrigen: Math.max(Number(s.punto_reposicion ?? 0), Number(s.stock_minimo ?? 0)),
        vendidas30Destino: vendidas.get(`${s.producto_id}|${destinoId}`) ?? 0,
        vendidas30Origen: vendidas.get(`${s.producto_id}|${origenId}`) ?? 0,
      };
    });
    return sugerirTraspaso(filas).slice(0, 150);
  }

  private async todas(pagina: (a: number, b: number) => any): Promise<any[]> {
    const filas: any[] = [];
    for (let a = 0; ; a += 1000) {
      const { data, error } = await pagina(a, a + 999);
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data ?? []));
      if ((data ?? []).length < 1000) return filas;
    }
  }

  // ---- hacer ---------------------------------------------------------------

  private puede(u: Usuario, sucursalId: string, que: string) {
    if (VEN_TODO.includes(String(u.rol)) || !u.sucursalId) return;
    if (u.sucursalId !== sucursalId) throw new ForbiddenException(`Solo podés ${que} en tu local`);
  }

  private async conProductos(items: RenglonDto[], permitirCero = false) {
    const limpios = (items ?? []).map((i) => ({ sku: String(i?.sku ?? '').trim(), cantidad: Number(i?.cantidad), nota: i?.nota ?? null }))
      .filter((i) => i.sku && Number.isFinite(i.cantidad) && (permitirCero ? i.cantidad >= 0 : i.cantidad > 0));
    if (!limpios.length) throw new BadRequestException('No hay productos con cantidad');
    const skus = [...new Set(limpios.map((i) => i.sku))];
    const { data, error } = await this.db.from('productos').select('id, sku').in('sku', skus);
    if (error) throw new BadRequestException(error.message);
    const id = new Map(((data ?? []) as any[]).map((p) => [p.sku, p.id]));
    const falta = skus.filter((s) => !id.has(s));
    if (falta.length) throw new BadRequestException(`No existen: ${falta.join(', ')}`);
    return limpios.map((i) => ({ producto_id: id.get(i.sku), cantidad: i.cantidad, nota: i.nota }));
  }

  private error(e: any): never {
    const m = String(e?.message ?? e);
    if (/Stock insuficiente/i.test(m)) throw new BadRequestException(`No alcanza el stock del local que manda: ${m.replace(/^.*Stock insuficiente:\s*/i, '')}. Revisá el stock o mandá menos.`);
    throw new BadRequestException(m);
  }

  async pedir(u: Usuario, b: { origenId: string; destinoId: string; items: RenglonDto[]; nota?: string }) {
    this.puede(u, b.destinoId, 'pedir mercadería');
    const items = await this.conProductos(b.items);
    const { data, error } = await this.db.rpc('traspaso_pedir', { p_origen: b.origenId, p_destino: b.destinoId, p_items: items, p_usuario: u.sub ?? null, p_nota: b.nota ?? null });
    if (error) this.error(error);
    const t = await this.uno(String(data));
    await this.avisar(t.origen?.id, ['cajero', 'deposito', 'gerente'], u.sub, {
      titulo: `${t.destino?.nombre} te pide mercadería (#${t.numero})`,
      detalle: `${t.items.length} producto(s)${t.nota ? `: «${t.nota}»` : ''}. Preparalo y mandalo desde Traspasos.`,
      traspasoId: t.id,
    });
    return t;
  }

  /** Con pedido (id) o sin pedido (origen y destino). */
  async enviar(u: Usuario, id: string | null, b: { origenId?: string; destinoId?: string; items: RenglonDto[]; llevaId?: string | null; nota?: string }) {
    let origen = b.origenId, destino = b.destinoId;
    if (id) { const t = await this.uno(id); origen = t.origen?.id; destino = t.destino?.id; }
    if (!origen || !destino) throw new BadRequestException('Falta de qué local a qué local');
    this.puede(u, origen, 'mandar mercadería');
    const items = await this.conProductos(b.items, !!id);
    const { data, error } = await this.db.rpc('traspaso_enviar', {
      p_id: id, p_origen: origen, p_destino: destino, p_items: items, p_usuario: u.sub ?? null, p_lleva: b.llevaId || null, p_nota: b.nota ?? null,
    });
    if (error) this.error(error);
    const t = await this.uno(String(data));
    await this.cerrarAvisos(t.id);
    const lista = t.items.filter((i) => i.enviado > 0).slice(0, 4).map((i) => `${i.nombre} × ${i.enviado.toLocaleString('es-AR')}`).join(', ');
    await this.avisar(t.destino?.id, ['cajero', 'deposito', 'gerente'], u.sub, {
      titulo: `Mercadería en camino desde ${t.origen?.nombre} (#${t.numero})`,
      detalle: `${lista}${t.items.length > 4 ? ` y ${t.items.length - 4} más` : ''}.${t.lleva ? ` La lleva ${t.lleva}.` : ''} Cuando llegue, contala y recibila en Traspasos.`,
      traspasoId: t.id,
    });
    if (t.llevaId && t.llevaId !== u.sub) {
      await this.db.from('alertas_internas').insert({ para_usuario: t.llevaId, tipo: 'traspaso', titulo: `Tenés que llevar el traspaso #${t.numero}`, detalle: `De ${t.origen?.nombre} a ${t.destino?.nombre}. Cuando lo dejes, marcalo como entregado en Mis entregas.`, referencia: { traspasoId: t.id, link: '/repartidor' } }).then(() => null, () => null);
    }
    return t;
  }

  async entregado(u: Usuario, id: string) {
    const t = await this.uno(id);
    if (t.llevaId !== u.sub && !VEN_TODO.includes(String(u.rol))) throw new ForbiddenException('Lo marca el que lo lleva');
    const { error } = await this.db.rpc('traspaso_entregar', { p_id: id, p_usuario: u.sub ?? null });
    if (error) this.error(error);
    return this.uno(id);
  }

  /** items null = llegó todo lo que salió. */
  async recibir(u: Usuario, id: string, b: { items?: RenglonDto[] | null; nota?: string }) {
    const antes = await this.uno(id);
    this.puede(u, antes.destino?.id, 'recibir mercadería');
    const items = b.items == null ? null : await this.conProductos(b.items, true);
    const { error } = await this.db.rpc('traspaso_recibir', { p_id: id, p_items: items, p_usuario: u.sub ?? null, p_nota: b.nota ?? null });
    if (error) this.error(error);
    const t = await this.uno(id);
    await this.cerrarAvisos(id);
    if (t.estado === 'con_diferencias') {
      const difs = t.items.filter((i) => i.diferencia !== 0).slice(0, 4).map((i) => `${i.nombre} ${i.diferencia > 0 ? '+' : ''}${i.diferencia.toLocaleString('es-AR')}`).join(', ');
      // a gerencia y dueños: ellos deciden qué pasa con lo que no cerró
      await this.db.from('alertas_internas').insert({ para_usuario: null, tipo: 'traspaso', titulo: `El traspaso #${t.numero} llegó con diferencias`, detalle: `${t.origen?.nombre} → ${t.destino?.nombre}: ${difs}. Decidí cada una en Traspasos › Diferencias.`, referencia: { traspasoId: id, link: '/traspasos' } }).then(() => null, () => null);
    }
    return t;
  }

  async resolver(u: Usuario, id: string, b: { sku: string; resolucion: string }) {
    const [p] = await this.conProductos([{ sku: b.sku, cantidad: 1 }]);
    const { error } = await this.db.rpc('traspaso_resolver', { p_id: id, p_producto: p.producto_id, p_resolucion: b.resolucion, p_usuario: u.sub ?? null });
    if (error) this.error(error);
    const t = await this.uno(id);
    if (t.estado === 'recibida') await this.cerrarAvisos(id);
    return t;
  }

  async anular(u: Usuario, id: string, motivo: string) {
    const t = await this.uno(id);
    // un pedido lo anula quien pidió o el local al que se le pidió; un envío en camino, solo gerencia
    if (t.estado === 'en_transito' && !['gerente', 'dueno'].includes(String(u.rol))) throw new ForbiddenException('Un envío en camino lo anula gerencia o un dueño');
    if (t.estado === 'pedido' && !VEN_TODO.includes(String(u.rol)) && u.sucursalId && ![t.origen?.id, t.destino?.id].includes(u.sucursalId)) throw new ForbiddenException('Ese pedido no es de tu local');
    const { error } = await this.db.rpc('traspaso_anular', { p_id: id, p_usuario: u.sub ?? null, p_motivo: String(motivo ?? '').trim() });
    if (error) this.error(error);
    await this.cerrarAvisos(id);
    return this.uno(id);
  }

  // ---- el remito -----------------------------------------------------------

  async remito(id: string, usuarioId?: string) {
    const t = await this.uno(id);
    if (t.estado === 'pedido') throw new BadRequestException('El remito sale cuando se manda');
    const { data: doc, error } = await this.db.rpc('emitir_documento', { p_tipo: 'traspaso', p_entidad: 'transferencias', p_entidad_id: id, p_usuario: usuarioId ?? null, p_datos: { numero: t.numero } });
    if (error) throw new BadRequestException(error.message);
    const ESTADOS: Record<string, string> = { en_transito: 'En camino', con_diferencias: 'Recibido con diferencias', recibida: 'Recibido', anulada: 'Anulado' };
    return traspasoPDF({
      folio: (doc as any)?.folio ?? `T-${t.numero}`,
      emitidoEn: (doc as any)?.emitido_en,
      numero: t.numero, origen: t.origen?.nombre ?? '—', destino: t.destino?.nombre ?? '—', estado: ESTADOS[t.estado] ?? t.estado,
      pedidoPor: t.pidio, enviadoPor: t.envio, enviadoEn: t.enviadaEn, lleva: t.lleva, recibidoPor: t.recibio, recibidoEn: t.recibidaEn,
      nota: [t.nota, t.notaRecepcion ? `Al recibir: ${t.notaRecepcion}` : null, t.motivoAnulacion ? `Anulado: ${t.motivoAnulacion}` : null].filter(Boolean).join(' · ') || null,
      items: t.items.map((i) => ({ nombre: i.nombre, sku: i.sku, pedido: i.pedido, enviado: i.enviado, recibido: i.recibido, costo: i.costo, nota: i.nota })),
    });
  }

  // ---- avisos --------------------------------------------------------------

  private async avisar(sucursalId: string | undefined, roles: string[], excepto: string | undefined, a: { titulo: string; detalle: string; traspasoId: string }) {
    try {
      const { data: gente } = sucursalId
        ? await this.db.from('usuarios').select('id').eq('activo', true).eq('sucursal_id', sucursalId).in('rol', roles)
        : { data: [] as any[] };
      const para = ((gente ?? []) as any[]).map((x) => x.id as string).filter((x) => x !== excepto);
      const base = { tipo: 'traspaso', titulo: a.titulo, detalle: a.detalle, referencia: { traspasoId: a.traspasoId, link: '/traspasos' } };
      // si en ese local no hay nadie cargado, lo ven los dueños
      const filas: (typeof base & { para_usuario: string | null })[] = para.length ? para.map((p) => ({ ...base, para_usuario: p })) : [{ ...base, para_usuario: null }];
      await this.db.from('alertas_internas').insert(filas);
    } catch (e) {
      this.log.warn(`aviso de traspaso no salió: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async cerrarAvisos(id: string) {
    await this.db.from('alertas_internas').update({ leida_en: new Date().toISOString() })
      .eq('tipo', 'traspaso').filter('referencia->>traspasoId', 'eq', id).is('leida_en', null)
      .then(() => null, () => null);
  }
}
