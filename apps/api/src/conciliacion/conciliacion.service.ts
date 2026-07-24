import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { fetchConTimeout } from '../comun/http';
import { cuentasMP } from '../mercadopago/mp-cuentas';

@Injectable()
export class ConciliacionService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async resumen() {
    const { data, error } = await this.db.rpc('conciliacion_resumen');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listar(filtros: { estado?: string; medio?: string; dias?: number } = {}) {
    let q = this.db
      .from('acreditaciones')
      .select(
        'id, medio, bruto, comision_estimada, neto_estimado, fecha_estimada, estado, neto_real, comision_real, fecha_real, mp_payment_id, nota, conciliado_en, creado_en, pago:pagos(terminal), venta:ventas(vendida_en, canal, sucursal:sucursales(nombre))',
      )
      .limit(300);
    if (filtros.estado) q = q.eq('estado', filtros.estado);
    if (filtros.medio) q = q.eq('medio', filtros.medio);
    if (filtros.dias) q = q.gte('creado_en', new Date(Date.now() - filtros.dias * 86400_000).toISOString());
    // pendientes: las más próximas a acreditar primero; acreditadas: las últimas
    q = filtros.estado === 'acreditada'
      ? q.order('fecha_real', { ascending: false })
      : q.order('fecha_estimada', { ascending: true });
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Marca una acreditación como acreditada con el neto REAL (carga manual / extracto)
  async marcarAcreditada(id: string, netoReal: number, fechaReal?: string, usuarioId?: string) {
    const { data: ac } = await this.db.from('acreditaciones').select('bruto').eq('id', id).maybeSingle();
    if (!ac) throw new NotFoundException('No existe la acreditación');
    const neto = Number(netoReal);
    if (!Number.isFinite(neto) || neto < 0) throw new BadRequestException('Neto inválido');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaReal ?? '') ? fechaReal : new Date().toISOString().slice(0, 10);
    const { error } = await this.db
      .from('acreditaciones')
      .update({
        estado: 'acreditada',
        neto_real: neto,
        comision_real: Math.round((Number(ac.bruto) - neto) * 100) / 100,
        fecha_real: fecha,
        conciliado_en: new Date().toISOString(),
        conciliado_por: usuarioId ?? null,
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Acredita en lote las pendientes de un medio hasta una fecha, asumiendo el neto
  // estimado (carga rápida cuando llega una liquidación que cubre muchas ventas).
  async acreditarLote(medio: string, hasta: string, usuarioId?: string) {
    if (!['tarjeta', 'mercadopago'].includes(medio)) throw new BadRequestException('Medio inválido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta ?? '')) throw new BadRequestException('Fecha inválida');
    const { data, error } = await this.db.rpc('conciliar_lote', {
      p_medio: medio,
      p_hasta: hasta,
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return { acreditadas: Number(data ?? 0) };
  }

  // Conciliación automática con Mercado Pago: trae el neto real y la fecha de
  // liberación de cada pago pendiente que tenga mp_payment_id.
  async conciliarMP(usuarioId?: string) {
    const cuentas = await cuentasMP(this.db);
    if (!cuentas.length) throw new BadRequestException('Faltan las credenciales de Mercado Pago para conciliar automáticamente');
    // multi-cuenta: el token correcto es el de la sucursal de la venta
    const tokenPorSucursal = new Map<string, string>();
    for (const c of cuentas) for (const s of c.sucursalIds) tokenPorSucursal.set(s, c.token);
    const { data: pend } = await this.db
      .from('acreditaciones')
      .select('id, mp_payment_id, bruto, venta:ventas(sucursal_id)')
      .eq('medio', 'mercadopago')
      .eq('estado', 'pendiente')
      .not('mp_payment_id', 'is', null)
      .limit(200);
    let conciliadas = 0;
    for (const a of (pend ?? []) as any[]) {
      try {
        const token = tokenPorSucursal.get((a.venta as any)?.sucursal_id) ?? cuentas[0].token;
        const r = await fetchConTimeout(`https://api.mercadopago.com/v1/payments/${a.mp_payment_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) continue;
        const p: any = await r.json();
        if (p.status !== 'approved') continue;
        const neto = Number(p.transaction_details?.net_received_amount ?? 0);
        const release = p.money_release_date ?? p.date_approved;
        await this.db
          .from('acreditaciones')
          .update({
            estado: 'acreditada',
            neto_real: neto,
            comision_real: Math.round((Number(a.bruto) - neto) * 100) / 100,
            fecha_real: release ? String(release).slice(0, 10) : new Date().toISOString().slice(0, 10),
            conciliado_en: new Date().toISOString(),
            conciliado_por: usuarioId ?? null,
            nota: 'Conciliado con Mercado Pago',
          })
          .eq('id', a.id);
        conciliadas++;
      } catch {
        // sigue con la próxima
      }
    }
    return { conciliadas, revisados: (pend ?? []).length };
  }

  async comisiones() {
    const { data, error } = await this.db
      .from('comisiones_medios')
      .select('medio, comision_pct, dias_acreditacion, actualizado_en')
      .order('medio');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async guardarComision(medio: string, comisionPct: number, diasAcreditacion: number) {
    if (!['tarjeta', 'mercadopago'].includes(medio)) throw new BadRequestException('Medio inválido');
    const pct = Number(comisionPct);
    const dias = Math.trunc(Number(diasAcreditacion));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new BadRequestException('Comisión inválida');
    if (!Number.isFinite(dias) || dias < 0 || dias > 90) throw new BadRequestException('Días inválidos');
    const { error } = await this.db
      .from('comisiones_medios')
      .upsert({ medio, comision_pct: pct, dias_acreditacion: dias, actualizado_en: new Date().toISOString() });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
