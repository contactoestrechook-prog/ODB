import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class EnvasesService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async resumen() {
    const { data, error } = await this.db.rpc('envases_resumen');
    if (error) throw new BadRequestException(error.message);
    const tipos = (data ?? []) as any[];
    const enCalleTotal = tipos.reduce((s, t) => s + Number(t.en_calle || 0), 0);
    const valorTotal = tipos.reduce((s, t) => s + Number(t.en_calle || 0) * Number(t.valor || 0), 0);
    const { data: saldos } = await this.db.rpc('envases_saldos_cliente');
    return { tipos, enCalleTotal, valorTotal: Math.round(valorTotal), clientesConSaldo: (saldos ?? []).length };
  }

  async saldos() {
    const { data, error } = await this.db.rpc('envases_saldos_cliente');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((s: any) => ({ ...s, valor: Math.round(Number(s.valor || 0)) }));
  }

  async tipos() {
    const { data, error } = await this.db.from('tipos_envase').select('id, nombre, valor, activo').eq('activo', true).order('nombre');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async crearTipo(b: { nombre: string; valor?: number }) {
    if (!b.nombre?.trim()) throw new BadRequestException('El nombre del envase es obligatorio');
    const { error } = await this.db.from('tipos_envase').insert({ nombre: b.nombre.trim(), valor: Number(b.valor) || 0 });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // entrega: el cliente se lleva envases (+) · devolucion: los trae (-)
  async movimiento(b: { clienteId: string; tipoId: string; cantidad: number; sentido: 'entrega' | 'devolucion'; motivo?: string; usuarioId?: string }) {
    if (!b.clienteId || !b.tipoId) throw new BadRequestException('Elegí cliente y tipo de envase');
    const cant = Math.abs(Number(b.cantidad) || 0);
    if (!cant) throw new BadRequestException('Cantidad inválida');
    const signed = b.sentido === 'devolucion' ? -cant : cant;
    const { error } = await this.db.from('movimientos_envase').insert({
      cliente_id: b.clienteId, tipo_id: b.tipoId, cantidad: signed,
      motivo: b.motivo || (b.sentido === 'devolucion' ? 'Devolución' : 'Entrega'),
      usuario_id: b.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async detalleCliente(clienteId: string) {
    const { data, error } = await this.db
      .from('movimientos_envase')
      .select('cantidad, motivo, creado_en, tipo:tipos_envase(nombre, valor)')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    const porTipo: Record<string, { nombre: string; saldo: number; valor: number }> = {};
    for (const m of (data ?? []) as any[]) {
      const n = m.tipo?.nombre ?? '?';
      (porTipo[n] ||= { nombre: n, saldo: 0, valor: Number(m.tipo?.valor || 0) }).saldo += Number(m.cantidad);
    }
    return { movimientos: data ?? [], saldos: Object.values(porTipo).filter((t) => t.saldo !== 0) };
  }
}
