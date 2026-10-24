import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CajaService } from '../caja/caja.service';
import { cantidadDeBalanza, parsearCodigoBalanza } from '../catalogo/balanza';
import { lunesDe, nombrePersona, repartir, semanasDelMes } from './plan-conteo';

// ============================================================
// ARQUEO DE STOCK (24/10/2026). Leandro: «cuando los empleados vayan con la
// app haciendo el stock, hacémelo de la forma más pro».
//
// Tres momentos:
//   1. Gerencia ARMA el arqueo: sucursal, alcance (todo, rubros, un proveedor,
//      una lista), conteo ciego y umbrales de reconteo.
//   2. El equipo CUENTA desde el celular: escanea (lector o cámara), dice
//      dónde está (góndola, depósito, heladera) y la cantidad. Nunca ve lo que
//      dice el sistema. Cada lectura queda registrada con quién y dónde.
//   3. Gerencia REVISA: diferencias valorizadas a costo; lo que pasa el umbral
//      vuelve a contarse; lo que no se contó se deja o se pone en cero; y se
//      aplica en un solo paso con PIN.
// Las cuentas fuertes viven en Postgres (db/migracion-arqueo-stock.sql): la
// diferencia se calcula contra el stock del momento en que se contó.
// ============================================================

export type AlcanceArqueo =
  | { tipo: 'todo' }
  | { tipo: 'categorias'; ids: string[]; nombres?: string[] }
  | { tipo: 'proveedor'; id: string; nombre?: string }
  | { tipo: 'productos'; ids: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fotoDe = (sku: string) =>
  `${process.env.SUPABASE_URL}/storage/v1/object/public/productos/${encodeURIComponent(sku)}.jpg?v=${process.env.FOTOS_VERSION ?? '1'}`;

/** Lo que el error de Postgres le dice a una persona (sin el prefijo técnico). */
export function mensajeDeError(m: string): string {
  return String(m ?? '').replace(/^.*?ERROR:\s*/, '').replace(/^P0001:\s*/, '').trim() || 'No se pudo completar';
}

/** El alcance que manda la pantalla, validado (nunca se guarda lo que venga crudo). */
export function alcanceValido(a: any): AlcanceArqueo {
  const tipo = a?.tipo ?? 'todo';
  if (tipo === 'todo') return { tipo: 'todo' };
  if (tipo === 'categorias') {
    const ids = (Array.isArray(a.ids) ? a.ids : []).filter((x: any) => UUID.test(String(x)));
    if (!ids.length) throw new BadRequestException('Elegí al menos un rubro');
    return { tipo, ids, nombres: Array.isArray(a.nombres) ? a.nombres.map(String).slice(0, 50) : undefined };
  }
  if (tipo === 'proveedor') {
    if (!UUID.test(String(a.id ?? ''))) throw new BadRequestException('Elegí el proveedor');
    return { tipo, id: String(a.id), nombre: a.nombre ? String(a.nombre) : undefined };
  }
  if (tipo === 'productos') {
    const ids = (Array.isArray(a.ids) ? a.ids : []).filter((x: any) => UUID.test(String(x)));
    if (!ids.length) throw new BadRequestException('Elegí al menos un producto');
    return { tipo, ids };
  }
  throw new BadRequestException('Alcance inválido');
}

@Injectable()
export class ArqueoService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly caja: CajaService,
  ) {}

  // ---------- armar ----------

  async crear(dto: { nombre?: string; sucursalId: string; alcance?: any; ciego?: boolean; umbralUnidades?: number; umbralPesos?: number }, usuarioId?: string) {
    if (!UUID.test(String(dto?.sucursalId ?? ''))) throw new BadRequestException('Elegí la sucursal');
    const alcance = alcanceValido(dto.alcance);
    const nombre = String(dto.nombre ?? '').trim().slice(0, 80) || `Arqueo ${new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`;
    const umbralUnidades = Math.max(0, Number(dto.umbralUnidades ?? 2) || 0);
    const umbralPesos = Math.max(0, Number(dto.umbralPesos ?? 10000) || 0);
    const { data, error } = await this.db.from('conteos').insert({
      sucursal_id: dto.sucursalId, nombre, alcance, ciego: dto.ciego !== false,
      umbral_unidades: umbralUnidades, umbral_pesos: umbralPesos, usuario_id: usuarioId ?? null,
      sector: alcance.tipo === 'todo' ? 'Todo el local' : null,
    }).select('id').single();
    if (error) throw new BadRequestException(mensajeDeError(error.message));
    return { id: (data as any).id };
  }

  /** Para armar el alcance: rubros (con su padre) y proveedores con productos. */
  async opciones() {
    const [{ data: cats }, { data: provs }] = await Promise.all([
      this.db.from('categorias').select('id, nombre, padre_id').order('nombre').limit(1000),
      this.db.from('proveedores').select('id, razon_social, productos:proveedor_productos(count)').eq('activo', true).order('razon_social').limit(1000),
    ]);
    const nombres = new Map(((cats ?? []) as any[]).map((c) => [c.id, c.nombre]));
    return {
      categorias: ((cats ?? []) as any[]).map((c) => ({ id: c.id, nombre: c.padre_id && nombres.get(c.padre_id) ? `${nombres.get(c.padre_id)} › ${c.nombre}` : c.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      proveedores: ((provs ?? []) as any[]).map((p) => ({ id: p.id, nombre: p.razon_social, productos: Number(p.productos?.[0]?.count ?? 0) })).filter((p) => p.productos > 0),
    };
  }

  /** Arqueos para la lista: los abiertos y en revisión, y los últimos cerrados. */
  async listar() {
    const { data, error } = await this.db.from('conteos')
      .select('id, nombre, estado, alcance, ciego, creado_en, en_revision_en, aplicado_en, resumen, sucursal:sucursales(id, nombre), usuario:usuarios!conteos_usuario_id_fkey(nombre)')
      .not('nombre', 'is', null)
      .order('creado_en', { ascending: false }).limit(40);
    if (error) throw new BadRequestException(error.message);
    const ids = ((data ?? []) as any[]).filter((c) => c.estado === 'abierto' || c.estado === 'en_revision').map((c) => c.id);
    const avance = new Map<string, { productos: number; lecturas: number; personas: number }>();
    if (ids.length) {
      const { data: regs } = await this.db.from('conteos_registros').select('conteo_id, producto_id, usuario_id').in('conteo_id', ids).is('anulado_en', null).limit(20000);
      const porConteo = new Map<string, { p: Set<string>; u: Set<string>; n: number }>();
      for (const r of (regs ?? []) as any[]) {
        const x = porConteo.get(r.conteo_id) ?? { p: new Set(), u: new Set(), n: 0 };
        x.p.add(r.producto_id); if (r.usuario_id) x.u.add(r.usuario_id); x.n++;
        porConteo.set(r.conteo_id, x);
      }
      for (const [k, x] of porConteo) avance.set(k, { productos: x.p.size, lecturas: x.n, personas: x.u.size });
    }
    return ((data ?? []) as any[]).map((c) => ({
      id: c.id, nombre: c.nombre, estado: c.estado, alcance: c.alcance, ciego: c.ciego,
      sucursal: String(c.sucursal?.nombre ?? '').replace(/^Suc\s+/, ''), sucursalId: c.sucursal?.id ?? null,
      creadoPor: c.usuario?.nombre ?? null, creadoEn: c.creado_en, enRevisionEn: c.en_revision_en, aplicadoEn: c.aplicado_en,
      resumen: c.resumen ?? null, avance: avance.get(c.id) ?? { productos: 0, lecturas: 0, personas: 0 },
    }));
  }

  private async cabecera(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('No existe el arqueo');
    const { data, error } = await this.db.from('conteos')
      .select('id, nombre, estado, alcance, ciego, umbral_unidades, umbral_pesos, creado_en, en_revision_en, aplicado_en, resumen, sucursal_id, sucursal:sucursales(nombre)')
      .eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || !(data as any).nombre) throw new NotFoundException('No existe el arqueo');
    const c = data as any;
    return {
      id: c.id, nombre: c.nombre, estado: c.estado, alcance: c.alcance, ciego: c.ciego,
      umbralUnidades: Number(c.umbral_unidades), umbralPesos: Number(c.umbral_pesos),
      sucursalId: c.sucursal_id, sucursal: String(c.sucursal?.nombre ?? '').replace(/^Suc\s+/, ''),
      creadoEn: c.creado_en, enRevisionEn: c.en_revision_en, aplicadoEn: c.aplicado_en, resumen: c.resumen ?? null,
    };
  }

  // ---------- contar (celular) ----------

  /**
   * Lo que ve el que cuenta: el arqueo, sus últimas lecturas, los lugares ya
   * usados y lo que hay que recontar. Nunca el stock del sistema.
   */
  async paraContar(id: string, usuarioId?: string) {
    const c = await this.cabecera(id);
    const [{ data: mias }, { data: lugares }, { data: rec }] = await Promise.all([
      this.db.from('conteos_registros').select('id, cantidad, ubicacion, es_reconteo, creado_en, anulado_en, producto:productos(sku, nombre)')
        .eq('conteo_id', id).eq('usuario_id', usuarioId ?? '00000000-0000-0000-0000-000000000000').order('creado_en', { ascending: false }).limit(40),
      this.db.from('conteos_registros').select('ubicacion').eq('conteo_id', id).not('ubicacion', 'is', null).limit(2000),
      this.db.from('conteos_reconteos').select('producto_id, motivo, producto:productos(sku, nombre)').eq('conteo_id', id).limit(500),
    ]);
    // lo que ya tiene reconteo cargado sale de la lista
    const recIds = ((rec ?? []) as any[]).map((r) => r.producto_id);
    const { data: hechos } = recIds.length
      ? await this.db.from('conteos_registros').select('producto_id').eq('conteo_id', id).eq('es_reconteo', true).is('anulado_en', null).in('producto_id', recIds)
      : { data: [] as any[] };
    const hechosSet = new Set(((hechos ?? []) as any[]).map((h) => h.producto_id));
    const usos = new Map<string, number>();
    for (const l of (lugares ?? []) as any[]) usos.set(l.ubicacion, (usos.get(l.ubicacion) ?? 0) + 1);
    return {
      ...c,
      // el umbral en pesos es para gerencia; quien cuenta no lo necesita
      umbralPesos: undefined,
      lugares: [...usos.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 30),
      misLecturas: ((mias ?? []) as any[]).map((r) => ({
        id: r.id, sku: r.producto?.sku, nombre: r.producto?.nombre, cantidad: Number(r.cantidad), ubicacion: r.ubicacion,
        reconteo: r.es_reconteo, creadoEn: r.creado_en, anulada: !!r.anulado_en,
      })),
      // sin el motivo: dice la diferencia y el conteo es ciego
      aRecontar: ((rec ?? []) as any[]).filter((r) => !hechosSet.has(r.producto_id))
        .map((r) => ({ sku: r.producto?.sku, nombre: r.producto?.nombre, foto: r.producto?.sku ? fotoDe(r.producto.sku) : null })),
    };
  }

  /**
   * Lo que falta contar, para la segunda pasada del equipo: por rubro, sin
   * cantidades del sistema. «sinCodigo» avisa que se busca por nombre.
   */
  async faltan(id: string) {
    const c = await this.cabecera(id);
    const { data, error } = await this.db.rpc('arqueo_faltan', { p_conteo: id });
    if (error) throw new BadRequestException(error.message);
    const filas = (data ?? []) as any[];
    const porRubro = new Map<string, number>();
    for (const f of filas) porRubro.set(f.categoria, (porRubro.get(f.categoria) ?? 0) + 1);
    return {
      estado: c.estado, total: filas.length,
      rubros: [...porRubro.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
      // tope generoso: el celular filtra por rubro y busca por nombre
      items: filas.slice(0, 3000).map((f) => ({ sku: f.sku, nombre: f.nombre, rubro: f.categoria, sinCodigo: !!f.sin_codigo, porPeso: !!f.por_peso, foto: f.tiene_foto ? fotoDe(f.sku) : null })),
    };
  }

  /**
   * Qué producto es lo que se escaneó o escribió. Con un código exacto viene uno
   * solo; con un nombre, opciones para elegir. Sin stock del sistema.
   */
  async identificar(id: string, q: string, usuarioId?: string) {
    const c = await this.cabecera(id);
    const t = String(q ?? '').trim();
    if (t.length < 2) return { items: [] };
    const balanza = parsearCodigoBalanza(t);
    const { data, error } = await this.db.rpc('pos_buscar', { p_q: balanza ? balanza.plu : t, p_limit: 8, p_sucursal: c.sucursalId });
    if (error) throw new BadRequestException(error.message);
    let filas = (data ?? []) as any[];
    if (balanza) filas = filas.filter((r) => String(r.plu ?? '').replace(/^0+/, '') === balanza.plu).slice(0, 1);
    // un código exacto manda: si coincide con un código de barras, ese y nada más
    const exacto = filas.find((r) => (r.codigos ?? []).includes(t) || r.sku === t || r.codigo === t);
    if (exacto) filas = [exacto];
    const skus = filas.map((r) => r.sku).filter(Boolean);
    if (!skus.length) return { items: [], codigo: t };
    const { data: prods } = await this.db.from('productos').select('id, sku, unidades_pack, vendido_por_peso, tiene_foto, activo').in('sku', skus);
    const porSku = new Map(((prods ?? []) as any[]).map((p) => [p.sku, p]));
    const ids = ((prods ?? []) as any[]).map((p) => p.id);
    const { data: regs } = ids.length
      ? await this.db.from('conteos_registros').select('producto_id, cantidad, usuario_id, es_reconteo').eq('conteo_id', id).is('anulado_en', null).in('producto_id', ids)
      : { data: [] as any[] };
    const { data: rec } = ids.length
      ? await this.db.from('conteos_reconteos').select('producto_id').eq('conteo_id', id).in('producto_id', ids)
      : { data: [] as any[] };
    const aRecontar = new Set(((rec ?? []) as any[]).map((r) => r.producto_id));
    const items = filas.map((r) => {
      const p = porSku.get(r.sku) as any;
      if (!p) return null;
      const reconteo = aRecontar.has(p.id);
      const mios = ((regs ?? []) as any[]).filter((g) => g.producto_id === p.id && g.es_reconteo === reconteo);
      return {
        sku: r.sku, nombre: r.nombre, foto: p.tiene_foto ? fotoDe(r.sku) : null,
        unidadesPack: Number(p.unidades_pack ?? 1) || 1, porPeso: !!p.vendido_por_peso, activo: p.activo !== false,
        // lo que ya se contó en este arqueo (no es el sistema: son cuentas de personas)
        yaContadoPorMi: mios.filter((g) => g.usuario_id === usuarioId).reduce((s, g) => s + Number(g.cantidad), 0),
        yaContadoTotal: mios.reduce((s, g) => s + Number(g.cantidad), 0),
        reconteo,
        cantidadSugerida: balanza ? cantidadDeBalanza(balanza.valor, !!p.vendido_por_peso) : null,
      };
    }).filter(Boolean);
    return { items, codigo: t };
  }

  async registrar(id: string, dto: { id: string; sku: string; cantidad: number; ubicacion?: string; codigo?: string; reconteo?: boolean; contador?: string }, usuarioId?: string) {
    if (!UUID.test(String(dto?.id ?? ''))) throw new BadRequestException('Lectura sin identificador');
    const cantidad = Number(dto.cantidad);
    if (!Number.isFinite(cantidad) || cantidad < 0) throw new BadRequestException('Cantidad inválida');
    const { data: p } = await this.db.from('productos').select('id').eq('sku', String(dto.sku ?? '').trim()).maybeSingle();
    if (!p) throw new BadRequestException('No existe ese producto');
    const { data, error } = await this.db.rpc('arqueo_registrar', {
      p_conteo: id, p_id: dto.id, p_producto: (p as any).id, p_cantidad: cantidad,
      p_ubicacion: dto.ubicacion ? String(dto.ubicacion).slice(0, 60) : null,
      p_codigo: dto.codigo ? String(dto.codigo).slice(0, 60) : null,
      p_reconteo: !!dto.reconteo, p_usuario: usuarioId ?? null,
      p_contador: nombrePersona(dto.contador) || null,
    });
    if (error) throw new BadRequestException(mensajeDeError(error.message));
    return data;
  }

  /** Una lectura equivocada no se borra: se anula (queda quién y cuándo). Solo la propia, salvo gerencia. */
  async anular(id: string, registroId: string, usuarioId: string | undefined, esGerencia: boolean) {
    if (!UUID.test(registroId)) throw new BadRequestException('Lectura inválida');
    const c = await this.cabecera(id);
    if (c.estado !== 'abierto' && c.estado !== 'en_revision') throw new BadRequestException(`El arqueo está ${c.estado}`);
    let q = this.db.from('conteos_registros').update({ anulado_en: new Date().toISOString(), anulado_por: usuarioId ?? null })
      .eq('id', registroId).eq('conteo_id', id).is('anulado_en', null);
    if (!esGerencia) q = q.eq('usuario_id', usuarioId ?? '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q.select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('No encontré esa lectura (o no es tuya)');
    return { anulada: true };
  }

  /** Un código que el sistema no conoce: se anota para resolverlo en la revisión. */
  async noEncontrado(id: string, dto: { codigo: string; descripcion?: string; cantidad?: number; ubicacion?: string }, usuarioId?: string) {
    const c = await this.cabecera(id);
    if (c.estado !== 'abierto' && c.estado !== 'en_revision') throw new BadRequestException(`El arqueo está ${c.estado}`);
    const codigo = String(dto?.codigo ?? '').trim().slice(0, 60);
    if (!codigo) throw new BadRequestException('Falta el código');
    const { error } = await this.db.from('conteos_no_encontrados').insert({
      conteo_id: id, codigo, descripcion: dto.descripcion ? String(dto.descripcion).slice(0, 120) : null,
      cantidad: Number.isFinite(Number(dto.cantidad)) ? Number(dto.cantidad) : null,
      ubicacion: dto.ubicacion ? String(dto.ubicacion).slice(0, 60) : null, usuario_id: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return { anotado: true };
  }

  // ---------- plan de conteo por rubro (la planilla de la pared) ----------

  private hoyAR() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); }

  /**
   * La grilla del mes: rubros (con stock en la sucursal) por semanas. En cada
   * celda, lo que se contó (quién y cuándo, sale de las lecturas) y a quién le
   * toca. Más el último conteo de cada rubro, para ver lo que hace mucho no se cuenta.
   */
  async plan(sucursalId: string, mes?: string) {
    if (!UUID.test(String(sucursalId ?? ''))) throw new BadRequestException('Elegí la sucursal');
    const hoy = this.hoyAR();
    const elMes = /^\d{4}-\d{2}$/.test(String(mes ?? '')) ? String(mes) : hoy.slice(0, 7);
    const semanas = semanasDelMes(elMes);
    const desde = semanas[0];
    const hasta = new Date(new Date(`${semanas[semanas.length - 1]}T12:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const hace180 = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const [{ data: cats }, { data: stock }, { data: hechos, error: e1 }, { data: historia }, { data: plan }] = await Promise.all([
      this.db.from('categorias').select('id, nombre').order('nombre').limit(1000),
      this.db.rpc('arqueo_rubros_con_stock', { p_sucursal: sucursalId }),
      this.db.rpc('arqueo_plan_hechos', { p_sucursal: sucursalId, p_desde: desde, p_hasta: hasta }),
      this.db.rpc('arqueo_plan_hechos', { p_sucursal: sucursalId, p_desde: hace180, p_hasta: hoy }),
      this.db.from('conteos_plan').select('id, categoria_id, semana, persona').eq('sucursal_id', sucursalId).gte('semana', desde).lte('semana', semanas[semanas.length - 1]),
    ]);
    if (e1) throw new BadRequestException(e1.message);
    const porRubro = new Map(((stock ?? []) as any[]).map((r) => [r.categoria_id, { productos: Number(r.productos), valor: Number(r.valor ?? 0) }]));
    const ultimo = new Map<string, { fecha: string; quien: string }>();
    for (const h of (historia ?? []) as any[]) {
      const u = ultimo.get(h.categoria_id);
      if (!u || h.fecha > u.fecha) ultimo.set(h.categoria_id, { fecha: h.fecha, quien: h.quien });
    }
    const dias = (f: string) => Math.round((new Date(`${hoy}T12:00:00Z`).getTime() - new Date(`${f}T12:00:00Z`).getTime()) / 86_400_000);
    const rubros = ((cats ?? []) as any[])
      .filter((c) => porRubro.has(c.id))
      .map((c) => {
        const u = ultimo.get(c.id);
        return { id: c.id, nombre: c.nombre, productos: porRubro.get(c.id)!.productos, valor: Math.round(porRubro.get(c.id)!.valor),
          ultimo: u ? { fecha: u.fecha, quien: u.quien, dias: dias(u.fecha) } : null };
      });
    const celdas = new Map<string, any>();
    const clave = (c: string, s: string) => `${c}|${s}`;
    for (const p of (plan ?? []) as any[]) celdas.set(clave(p.categoria_id, p.semana), { categoriaId: p.categoria_id, semana: p.semana, asignado: p.persona, hechos: [] });
    for (const h of (hechos ?? []) as any[]) {
      const k = clave(h.categoria_id, h.semana);
      const c = celdas.get(k) ?? { categoriaId: h.categoria_id, semana: h.semana, asignado: null, hechos: [] };
      c.hechos.push({ conteoId: h.conteo_id, estado: h.estado, fecha: h.fecha, quien: h.quien, productos: h.productos });
      celdas.set(k, c);
    }
    const personas = new Set<string>();
    for (const p of (plan ?? []) as any[]) personas.add(p.persona);
    for (const h of (historia ?? []) as any[]) if (h.quien && h.quien !== 'Sin nombre') personas.add(h.quien);
    return { mes: elMes, hoy, semanaActual: lunesDe(hoy), semanas, rubros, celdas: [...celdas.values()], personas: [...personas].sort((a, b) => a.localeCompare(b, 'es')) };
  }

  /** Asignar (o sacar, con persona vacía) un rubro a una persona en una semana. */
  async asignar(dto: { sucursalId: string; categoriaId: string; semana: string; persona?: string }, usuarioId?: string) {
    if (!UUID.test(String(dto?.sucursalId ?? '')) || !UUID.test(String(dto?.categoriaId ?? ''))) throw new BadRequestException('Datos incompletos');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dto.semana ?? ''))) throw new BadRequestException('Semana inválida');
    const semana = lunesDe(dto.semana);
    const persona = nombrePersona(dto.persona);
    if (!persona) {
      const { error } = await this.db.from('conteos_plan').delete().eq('sucursal_id', dto.sucursalId).eq('categoria_id', dto.categoriaId).eq('semana', semana);
      if (error) throw new BadRequestException(error.message);
      return { ok: true, persona: null };
    }
    const { error } = await this.db.from('conteos_plan').upsert({ sucursal_id: dto.sucursalId, categoria_id: dto.categoriaId, semana, persona, creado_por: usuarioId ?? null },
      { onConflict: 'sucursal_id,categoria_id,semana' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, persona };
  }

  /**
   * Repartir el mes: los rubros con stock que no tienen a nadie asignado ni se
   * contaron en el mes se reparten entre las semanas que faltan y las personas
   * elegidas, parejo por cantidad de productos y primero lo que hace más que no se cuenta.
   */
  async repartirMes(dto: { sucursalId: string; mes: string; personas: string[]; soloSinContarDias?: number }, usuarioId?: string) {
    const personas = Array.from(new Set((Array.isArray(dto?.personas) ? dto.personas : []).map(nombrePersona).filter(Boolean))).slice(0, 20);
    if (!personas.length) throw new BadRequestException('Elegí al menos una persona');
    const p = await this.plan(dto.sucursalId, dto.mes);
    const semanas = p.semanas.filter((s) => s >= p.semanaActual);
    if (!semanas.length) throw new BadRequestException('Ese mes ya pasó');
    const ocupados = new Set(p.celdas.filter((c: any) => c.asignado || c.hechos.length).map((c: any) => c.categoriaId));
    const pendientes = p.rubros.filter((r) => !ocupados.has(r.id))
      .map((r) => ({ id: r.id, productos: r.productos, diasSinContar: r.ultimo ? r.ultimo.dias : null }))
      .filter((r) => !dto.soloSinContarDias || r.diasSinContar == null || r.diasSinContar >= Number(dto.soloSinContarDias));
    const plan = repartir(pendientes, semanas, personas);
    if (!plan.length) return { asignados: 0 };
    const { error } = await this.db.from('conteos_plan').upsert(plan.map((x) => ({ sucursal_id: dto.sucursalId, categoria_id: x.categoriaId, semana: x.semana, persona: x.persona, creado_por: usuarioId ?? null })),
      { onConflict: 'sucursal_id,categoria_id,semana', ignoreDuplicates: true });
    if (error) throw new BadRequestException(error.message);
    return { asignados: plan.length };
  }

  /** Lo que le toca a una persona esta semana (por el nombre que puso en el celular). */
  async miSemana(sucursalId: string, persona: string) {
    const nombre = nombrePersona(persona);
    if (!UUID.test(String(sucursalId ?? '')) || !nombre) return { semana: lunesDe(this.hoyAR()), rubros: [] };
    const semana = lunesDe(this.hoyAR());
    const { data: plan } = await this.db.from('conteos_plan').select('categoria_id, persona, categoria:categorias(nombre)').eq('sucursal_id', sucursalId).eq('semana', semana).ilike('persona', nombre);
    if (!plan?.length) return { semana, rubros: [] };
    const fin = new Date(new Date(`${semana}T12:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    const { data: hechos } = await this.db.rpc('arqueo_plan_hechos', { p_sucursal: sucursalId, p_desde: semana, p_hasta: fin });
    const contados = new Set(((hechos ?? []) as any[]).map((h) => h.categoria_id));
    return { semana, rubros: (plan as any[]).map((p) => ({ categoriaId: p.categoria_id, nombre: p.categoria?.nombre ?? '—', contado: contados.has(p.categoria_id) })) };
  }

  /** Empezar (o sumarse) a contar un rubro: si ya hay un arqueo abierto de ese rubro, ese. */
  async empezarRubro(dto: { sucursalId: string; categoriaId: string }, usuarioId?: string) {
    if (!UUID.test(String(dto?.sucursalId ?? '')) || !UUID.test(String(dto?.categoriaId ?? ''))) throw new BadRequestException('Datos incompletos');
    const { data: abiertos } = await this.db.from('conteos').select('id, alcance').eq('sucursal_id', dto.sucursalId).eq('estado', 'abierto').not('nombre', 'is', null).limit(50);
    const ya = ((abiertos ?? []) as any[]).find((c) => c.alcance?.tipo === 'categorias' && Array.isArray(c.alcance.ids) && c.alcance.ids.length === 1 && c.alcance.ids[0] === dto.categoriaId);
    if (ya) return { id: ya.id, nuevo: false };
    const { data: cat } = await this.db.from('categorias').select('nombre').eq('id', dto.categoriaId).maybeSingle();
    if (!cat) throw new BadRequestException('No existe ese rubro');
    const semana = lunesDe(this.hoyAR());
    const r = await this.crear({ sucursalId: dto.sucursalId, nombre: `${(cat as any).nombre} · semana del ${semana.slice(8, 10)}/${semana.slice(5, 7)}`,
      alcance: { tipo: 'categorias', ids: [dto.categoriaId], nombres: [(cat as any).nombre] } }, usuarioId);
    return { id: r.id, nuevo: true };
  }

  // ---------- revisar (gerencia) ----------

  async revision(id: string) {
    const c = await this.cabecera(id);
    const [{ data: dif, error }, { data: esperados }, { data: regs }, { data: noEnc }] = await Promise.all([
      this.db.rpc('arqueo_diferencias', { p_conteo: id }),
      this.db.rpc('arqueo_esperados', { p_conteo: id }),
      this.db.from('conteos_registros').select('producto_id, usuario_id, cantidad, ubicacion, creado_en, usuario:usuarios!conteos_registros_usuario_id_fkey(nombre)').eq('conteo_id', id).is('anulado_en', null).limit(20000),
      this.db.from('conteos_no_encontrados').select('id, codigo, descripcion, cantidad, ubicacion, creado_en, usuario:usuarios(nombre)').eq('conteo_id', id).order('creado_en').limit(500),
    ]);
    if (error) throw new BadRequestException(error.message);
    const items = ((dif ?? []) as any[]).map((d) => ({
      productoId: d.producto_id, sku: d.sku, nombre: d.nombre, categoria: d.categoria,
      contado: Number(d.contado), sistema: Number(d.sistema), diferencia: Number(d.diferencia),
      costo: d.costo != null ? Number(d.costo) : null, valor: d.valor_diferencia != null ? Number(d.valor_diferencia) : null,
      ubicaciones: d.ubicaciones, registros: d.registros, contadores: d.contadores, recontado: d.recontado,
      enAlcance: d.en_alcance, reconteoPedido: d.reconteo_pedido, contadoEn: d.contado_en,
      superaUmbral: Math.abs(Number(d.diferencia)) >= c.umbralUnidades || Math.abs(Number(d.valor_diferencia ?? 0)) >= c.umbralPesos,
    }));
    const contados = new Set(items.map((i) => i.productoId));
    const faltan = ((esperados ?? []) as any[]).filter((e) => !contados.has(e.producto_id));
    // lo que falta contar, con nombre y valor (los 300 de más valor; el total va aparte)
    const idsFaltan = faltan.map((f) => f.producto_id);
    const infoFaltan = new Map<string, any>();
    for (let i = 0; i < idsFaltan.length; i += 300) {
      const { data } = await this.db.from('productos').select('id, sku, nombre, costo, categoria:categorias(nombre)').in('id', idsFaltan.slice(i, i + 300));
      for (const p of (data ?? []) as any[]) infoFaltan.set(p.id, p);
    }
    const sinContar = faltan.map((f) => {
      const p = infoFaltan.get(f.producto_id) ?? {};
      const costo = p.costo != null ? Number(p.costo) : null;
      return { productoId: f.producto_id, sku: p.sku, nombre: p.nombre, categoria: p.categoria?.nombre ?? null, sistema: Number(f.stock), valor: costo != null ? Math.round(Number(f.stock) * costo) : null };
    }).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
    // quién contó cuánto
    const porPersona = new Map<string, { nombre: string; lecturas: number; productos: Set<string>; desde: string; hasta: string }>();
    for (const r of (regs ?? []) as any[]) {
      const k = r.usuario_id ?? 'sin';
      const x = porPersona.get(k) ?? { nombre: r.usuario?.nombre ?? 'Sin usuario', lecturas: 0, productos: new Set<string>(), desde: r.creado_en, hasta: r.creado_en };
      x.lecturas++; x.productos.add(r.producto_id);
      if (r.creado_en < x.desde) x.desde = r.creado_en;
      if (r.creado_en > x.hasta) x.hasta = r.creado_en;
      porPersona.set(k, x);
    }
    const conDif = items.filter((i) => i.diferencia !== 0);
    return {
      ...c,
      totales: {
        contados: items.length, esperados: (esperados ?? []).length, sinContar: sinContar.length,
        sinDiferencia: items.length - conDif.length,
        exactitudPct: items.length ? Math.round((1000 * (items.length - conDif.length)) / items.length) / 10 : null,
        valorSobrante: Math.round(conDif.filter((i) => (i.valor ?? 0) > 0).reduce((s, i) => s + (i.valor ?? 0), 0)),
        valorFaltante: Math.round(-conDif.filter((i) => (i.valor ?? 0) < 0).reduce((s, i) => s + (i.valor ?? 0), 0)),
        valorSinContar: Math.round(sinContar.reduce((s, i) => s + (i.valor ?? 0), 0)),
        reconteosPendientes: items.filter((i) => i.reconteoPedido && !i.recontado).length,
      },
      items: items.sort((a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0) || Math.abs(b.diferencia) - Math.abs(a.diferencia)),
      sinContar: sinContar.slice(0, 300),
      noEncontrados: ((noEnc ?? []) as any[]).map((n) => ({ id: n.id, codigo: n.codigo, descripcion: n.descripcion, cantidad: n.cantidad, ubicacion: n.ubicacion, quien: n.usuario?.nombre ?? null, creadoEn: n.creado_en })),
      personas: [...porPersona.values()].map((x) => ({ nombre: x.nombre, lecturas: x.lecturas, productos: x.productos.size, desde: x.desde, hasta: x.hasta }))
        .sort((a, b) => b.lecturas - a.lecturas),
    };
  }

  async aRevision(id: string) {
    await this.cabecera(id);
    const { data, error } = await this.db.rpc('arqueo_a_revision', { p_conteo: id });
    if (error) throw new BadRequestException(mensajeDeError(error.message));
    return data;
  }

  /** Volver a contar: el arqueo se reabre para todos (lo ya contado queda). */
  async reabrir(id: string) {
    const c = await this.cabecera(id);
    if (c.estado !== 'en_revision') throw new BadRequestException('Solo se reabre un arqueo en revisión');
    const { error } = await this.db.from('conteos').update({ estado: 'abierto' }).eq('id', id).eq('estado', 'en_revision');
    if (error) throw new BadRequestException(error.message);
    return { reabierto: true };
  }

  /** Pedir o sacar un reconteo a mano (gerencia). */
  async reconteo(id: string, sku: string, pedir: boolean) {
    const c = await this.cabecera(id);
    if (c.estado !== 'abierto' && c.estado !== 'en_revision') throw new BadRequestException(`El arqueo está ${c.estado}`);
    const { data: p } = await this.db.from('productos').select('id').eq('sku', String(sku ?? '').trim()).maybeSingle();
    if (!p) throw new BadRequestException('No existe ese producto');
    if (pedir) {
      const { error } = await this.db.from('conteos_reconteos').upsert({ conteo_id: id, producto_id: (p as any).id, motivo: 'Pedido por gerencia' }, { onConflict: 'conteo_id,producto_id' });
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.db.from('conteos_reconteos').delete().eq('conteo_id', id).eq('producto_id', (p as any).id);
      if (error) throw new BadRequestException(error.message);
    }
    return { ok: true };
  }

  async aplicar(id: string, dto: { sinContar?: string; autorizacionToken?: string }, autorizadoPor: string | undefined, usuarioId?: string) {
    await this.cabecera(id);
    if (!autorizadoPor && dto?.autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(dto.autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }
    if (!autorizadoPor) throw new BadRequestException('Aplicar el arqueo requiere autorización de un supervisor (PIN)');
    const sinContar = dto?.sinContar === 'cero' ? 'cero' : 'dejar';
    const { data, error } = await this.db.rpc('arqueo_aplicar', { p_conteo: id, p_usuario: usuarioId ?? null, p_autorizado_por: autorizadoPor, p_sin_contar: sinContar });
    if (error) throw new BadRequestException(mensajeDeError(error.message));
    return data;
  }

  async descartar(id: string) {
    const c = await this.cabecera(id);
    if (c.estado !== 'abierto' && c.estado !== 'en_revision') throw new BadRequestException(`El arqueo está ${c.estado}`);
    const { error } = await this.db.from('conteos').update({ estado: 'descartado' }).eq('id', id).in('estado', ['abierto', 'en_revision']);
    if (error) throw new BadRequestException(error.message);
    return { descartado: true };
  }
}
