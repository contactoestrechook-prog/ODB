import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from '../mensajes/notificar.service';
import { generarPresupuesto } from './presupuesto';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const TIPO_LABEL: Record<string, string> = {
  cumpleanos: 'cumpleaños', casamiento: 'casamiento', corporativo: 'evento corporativo',
  fin_de_ano: 'fiesta de fin de año', otro: 'evento',
};

export type ItemPropuesta = { producto_id?: string | null; descripcion: string; cantidad: number; precio_unitario: number };

@Injectable()
export class EventosService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  // Oportunidades: cumpleaños dentro de N días (60 por defecto)
  async oportunidades(dias = 60) {
    const { data, error } = await this.db.rpc('cumpleanos_proximos', { p_dias: dias });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listar(filtros: { estado?: string; tipo?: string }) {
    let q = this.db
      .from('eventos')
      .select('*, cliente:clientes(nombre, dni, tipo)')
      .order('fecha', { ascending: true, nullsFirst: false })
      .limit(200);
    if (filtros.estado) q = q.eq('estado', filtros.estado);
    if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async crear(dto: any, usuarioId?: string) {
    if (!dto?.nombre?.trim()) throw new BadRequestException('Falta el nombre del evento');
    const { data, error } = await this.db
      .from('eventos')
      .insert({
        cliente_id: dto.clienteId ?? null,
        tipo: dto.tipo ?? 'otro',
        nombre: dto.nombre.trim(),
        fecha: dto.fecha ?? null,
        invitados: dto.invitados ?? null,
        notas: dto.notas ?? null,
        estado: 'prospecto',
        creado_por: usuarioId ?? null,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizar(id: string, dto: any) {
    const patch: any = { actualizado_en: new Date().toISOString() };
    for (const k of ['tipo', 'nombre', 'fecha', 'invitados', 'estado', 'notas', 'clienteId']) {
      if (dto[k] !== undefined) patch[k === 'clienteId' ? 'cliente_id' : k] = dto[k];
    }
    const { error } = await this.db.from('eventos').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async detalle(id: string) {
    const { data: evento, error } = await this.db
      .from('eventos')
      .select('*, cliente:clientes(nombre, dni, tipo)')
      .eq('id', id)
      .single();
    if (error || !evento) throw new BadRequestException('No existe el evento');
    const { data: items } = await this.db
      .from('eventos_items')
      .select('id, producto_id, descripcion, cantidad, precio_unitario')
      .eq('evento_id', id)
      .order('descripcion');
    return { ...evento, items: items ?? [] };
  }

  async guardarPropuesta(id: string, items: ItemPropuesta[]) {
    await this.db.from('eventos_items').delete().eq('evento_id', id);
    const limpios = (items ?? []).filter((i) => i.descripcion && Number(i.cantidad) > 0);
    if (limpios.length) {
      await this.db.from('eventos_items').insert(
        limpios.map((i) => ({
          evento_id: id,
          producto_id: i.producto_id ?? null,
          descripcion: i.descripcion,
          cantidad: Number(i.cantidad),
          precio_unitario: Number(i.precio_unitario) || 0,
        })),
      );
    }
    const total = limpios.reduce((s, i) => s + Number(i.cantidad) * (Number(i.precio_unitario) || 0), 0);
    const { data: ev } = await this.db.from('eventos').select('estado').eq('id', id).single();
    const patch: any = { presupuesto: total, actualizado_en: new Date().toISOString() };
    if (ev?.estado === 'prospecto') patch.estado = 'propuesta';
    await this.db.from('eventos').update(patch).eq('id', id);
    return { total, items: limpios.length };
  }

  async enviarPropuesta(id: string) {
    const ev = await this.detalle(id);
    if (!ev.cliente_id) throw new BadRequestException('El evento no tiene un cliente asociado para notificar');
    const total = (ev.items ?? []).reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
    await this.notificar.aCliente(
      ev.cliente_id,
      'Te armamos una propuesta para tu evento 🍷',
      `Para "${ev.nombre}" preparamos una propuesta de bebidas por ${pesos(total)}. Escribinos para confirmarla o ajustarla.`,
      'evento',
    );
    if (ev.estado === 'prospecto' || ev.estado === 'propuesta') {
      await this.db.from('eventos').update({ estado: 'propuesta', actualizado_en: new Date().toISOString() }).eq('id', id);
    }
    return { ok: true, total };
  }

  // Sugerencia de bebidas con IA, según tipo de evento e invitados
  async sugerir(dto: { tipo?: string; invitados?: number }) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta ANTHROPIC_API_KEY para la sugerencia con IA');
    }
    const invitados = Math.max(Number(dto.invitados) || 0, 1);
    const tipo = TIPO_LABEL[dto.tipo ?? 'otro'] ?? 'evento';
    const catalogo = await this.catalogoBebidas();
    if (!catalogo.length) throw new BadRequestException('No hay bebidas con precio y stock para sugerir');

    const lista = catalogo.map((p) => `${p.sku} · ${p.nombre} · $${p.precio} · stock ${p.stock}`).join('\n');
    const claude = new Anthropic();
    const resp = await claude.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      system: `Sos el organizador de eventos de O.D.B Premium Market. Armás propuestas de bebidas equilibradas y realistas para eventos en Argentina.
Reglas:
- Usá SOLO productos de la lista que te paso (por SKU). Nunca inventes.
- Calculá cantidades razonables para la cantidad de invitados (regla práctica: ~1 bebida cada 1,5 horas por persona; mezclá categorías: espumante para brindis, vino, cerveza, gaseosas/agua sin alcohol, y algún destilado si corresponde).
- No superes el stock disponible de cada producto.
- Respondé SOLO con un JSON array, sin texto adicional, con esta forma exacta:
[{"sku":"123","cantidad":24,"motivo":"brindis"}]`,
      messages: [
        {
          role: 'user',
          content: `Evento: ${tipo}. Invitados: ${invitados}.\n\nBebidas disponibles (sku · nombre · precio · stock):\n${lista}\n\nArmá la propuesta. Solo el JSON array.`,
        },
      ],
    });
    const texto = resp.content.find((b) => b.type === 'text');
    const raw = texto && 'text' in texto ? texto.text : '[]';
    const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    let sugeridos: { sku: string; cantidad: number }[] = [];
    try { sugeridos = JSON.parse(json); } catch { throw new BadRequestException('No pude interpretar la sugerencia, probá de nuevo'); }

    const porSku = new Map(catalogo.map((p) => [String(p.sku), p]));
    const items: ItemPropuesta[] = [];
    for (const s of sugeridos) {
      const p = porSku.get(String(s.sku));
      if (!p) continue;
      items.push({
        producto_id: p.id,
        descripcion: p.nombre,
        cantidad: Math.max(Math.min(Math.round(Number(s.cantidad) || 0), p.stock), 1),
        precio_unitario: p.precio,
      });
    }
    const total = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0);
    return { items, total };
  }

  async presupuestoPdf(id: string): Promise<Buffer> {
    const ev = await this.detalle(id);
    return generarPresupuesto({
      folio: 'PRESU-' + String(id).slice(0, 8).toUpperCase(),
      fecha: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }),
      cliente: ev.cliente ? { nombre: ev.cliente.nombre, dni: ev.cliente.dni } : null,
      evento: { nombre: ev.nombre, tipo: ev.tipo, fecha: ev.fecha, invitados: ev.invitados },
      items: (ev.items ?? []).map((i: any) => ({
        descripcion: i.descripcion, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario),
      })),
    });
  }

  async resumen() {
    const [eventos, oport] = await Promise.all([
      this.db.from('eventos').select('estado, presupuesto'),
      this.oportunidades(60),
    ]);
    const filas = (eventos.data ?? []) as any[];
    const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
    const pipeline = filas
      .filter((f) => ['prospecto', 'propuesta', 'confirmado'].includes(f.estado))
      .reduce((s, f) => s + Number(f.presupuesto || 0), 0);
    return {
      oportunidades: (oport as any[]).length,
      prospectos: cuenta('prospecto'),
      propuestas: cuenta('propuesta'),
      confirmados: cuenta('confirmado'),
      realizados: cuenta('realizado'),
      pipeline,
    };
  }

  private async catalogoBebidas() {
    const { data } = await this.db
      .from('productos')
      .select('id, sku, nombre, stock(cantidad)')
      .eq('activo', true)
      .or(
        'nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champ%,nombre.ilike.cerveza%,nombre.ilike.whisky%,nombre.ilike.fernet%,nombre.ilike.gaseosa%,nombre.ilike.aperitivo%,nombre.ilike.vodka%,nombre.ilike.gin%,nombre.ilike.agua%,nombre.ilike.sidra%',
      );
    const conStock = (data ?? [])
      .map((p: any) => ({ ...p, stock: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) }))
      .filter((p: any) => p.stock > 0)
      .sort((a: any, b: any) => b.stock - a.stock)
      .slice(0, 90);
    if (!conStock.length) return [];
    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: conStock.map((p: any) => p.id) });
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));
    return conStock
      .map((p: any) => ({ id: p.id, sku: p.sku, nombre: p.nombre, stock: p.stock, precio: Math.round(Number(precioPor.get(p.id)?.precio_final ?? 0)) }))
      .filter((p: any) => p.precio >= 100) // descarta precios corruptos del import
      .slice(0, 80);
  }
}
