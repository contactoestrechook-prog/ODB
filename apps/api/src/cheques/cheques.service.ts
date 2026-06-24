import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Cartera de valores. Dos circuitos:
//   terceros (recibidos de clientes): cartera → depositado → acreditado | rechazado ; cartera → aplicado (endoso)
//   propios  (entregados a proveedores): emitido → debitado | rechazado
// Cualquiera puede ir a 'anulado'.
export type CrearChequeDto = {
  tipo: 'terceros' | 'propio';
  numero: string;
  banco?: string;
  titular?: string;
  cuitLibrador?: string;
  importe: number;
  fechaEmision?: string;
  fechaCobro?: string;
  diferido?: boolean;
  clienteId?: string; // terceros: de quién lo recibimos
  proveedorId?: string; // propio / aplicado: a quién se lo damos
  ordenPagoId?: string;
  observaciones?: string;
  usuarioId?: string;
};

@Injectable()
export class ChequesService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar(q: { tipo?: string; estado?: string; buscar?: string; limite?: number }) {
    let query = this.db
      .from('cheques')
      .select('*, cliente:clientes(id, nombre, razon_social), proveedor:proveedores(id, razon_social)')
      .order('fecha_cobro', { ascending: true, nullsFirst: false })
      .order('creado_en', { ascending: false })
      .limit(Math.min(q.limite ?? 200, 500));
    if (q.tipo) query = query.eq('tipo', q.tipo);
    if (q.estado) query = query.in('estado', q.estado.split(','));
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    let filas = data ?? [];
    if (q.buscar?.trim()) {
      const t = q.buscar.trim().toLowerCase();
      filas = filas.filter(
        (c: any) =>
          String(c.numero).toLowerCase().includes(t) ||
          (c.banco ?? '').toLowerCase().includes(t) ||
          (c.titular ?? '').toLowerCase().includes(t) ||
          (c.cliente?.razon_social ?? c.cliente?.nombre ?? '').toLowerCase().includes(t) ||
          (c.proveedor?.razon_social ?? '').toLowerCase().includes(t),
      );
    }
    return filas;
  }

  async detalle(id: string) {
    const { data, error } = await this.db
      .from('cheques')
      .select('*, cliente:clientes(id, nombre, razon_social), proveedor:proveedores(id, razon_social), recibo:comprobantes(tipo, punto_venta, numero)')
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException('No existe el cheque');
    return data;
  }

  // Tablero: cartera de terceros, depósitos, rechazos y propios pendientes.
  async resumen() {
    const { data, error } = await this.db.from('cheques').select('tipo, estado, importe, fecha_cobro');
    if (error) throw new BadRequestException(error.message);
    const hoy = new Date().toISOString().slice(0, 10);
    const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const a = {
      carteraCantidad: 0, carteraImporte: 0,
      depositadosImporte: 0,
      aplicadosImporte: 0,
      rechazadosCantidad: 0, rechazadosImporte: 0,
      propiosPendientesImporte: 0,
      venceEn7Cantidad: 0, venceEn7Importe: 0,
      vencidosCartera: 0,
    };
    for (const c of (data ?? []) as any[]) {
      const imp = Number(c.importe);
      if (c.tipo === 'terceros' && c.estado === 'cartera') {
        a.carteraCantidad += 1;
        a.carteraImporte += imp;
        if (c.fecha_cobro && c.fecha_cobro <= en7) { a.venceEn7Cantidad += 1; a.venceEn7Importe += imp; }
        if (c.fecha_cobro && c.fecha_cobro < hoy) a.vencidosCartera += 1;
      }
      if (c.estado === 'depositado') a.depositadosImporte += imp;
      if (c.estado === 'aplicado') a.aplicadosImporte += imp;
      if (c.estado === 'rechazado') { a.rechazadosCantidad += 1; a.rechazadosImporte += imp; }
      if (c.tipo === 'propio' && c.estado === 'emitido') a.propiosPendientesImporte += imp;
    }
    const r = (n: number) => Math.round(n);
    return {
      carteraCantidad: a.carteraCantidad, carteraImporte: r(a.carteraImporte),
      depositadosImporte: r(a.depositadosImporte),
      aplicadosImporte: r(a.aplicadosImporte),
      rechazadosCantidad: a.rechazadosCantidad, rechazadosImporte: r(a.rechazadosImporte),
      propiosPendientesImporte: r(a.propiosPendientesImporte),
      venceEn7Cantidad: a.venceEn7Cantidad, venceEn7Importe: r(a.venceEn7Importe),
      vencidosCartera: a.vencidosCartera,
    };
  }

  async crear(dto: CrearChequeDto) {
    if (!dto.tipo || !['terceros', 'propio'].includes(dto.tipo)) throw new BadRequestException('Tipo de cheque inválido');
    if (!dto.numero?.trim()) throw new BadRequestException('El número de cheque es obligatorio');
    if (!(Number(dto.importe) > 0)) throw new BadRequestException('El importe debe ser mayor a cero');
    const estado = dto.tipo === 'propio' ? 'emitido' : 'cartera';
    const { data, error } = await this.db
      .from('cheques')
      .insert({
        tipo: dto.tipo,
        numero: String(dto.numero).trim(),
        banco: dto.banco ?? null,
        titular: dto.titular ?? null,
        cuit_librador: dto.cuitLibrador ?? null,
        importe: Number(dto.importe),
        fecha_emision: dto.fechaEmision ?? null,
        fecha_cobro: dto.fechaCobro ?? null,
        es_diferido: !!dto.diferido || !!dto.fechaCobro,
        estado,
        cliente_id: dto.clienteId ?? null,
        proveedor_id: dto.proveedorId ?? null,
        orden_pago_id: dto.ordenPagoId ?? null,
        observaciones: dto.observaciones ?? null,
        usuario_id: dto.usuarioId ?? null,
      })
      .select('id, tipo, numero, estado, importe')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------- transiciones de estado ----------

  async depositar(id: string, dto: { banco?: string }) {
    const c = await this.exigir(id, ['cartera'], 'terceros');
    await this.set(c.id, { estado: 'depositado', banco_deposito: dto.banco ?? c.banco_deposito ?? null });
    return { ok: true, estado: 'depositado' };
  }

  async acreditar(id: string) {
    await this.exigir(id, ['depositado'], 'terceros');
    await this.set(id, { estado: 'acreditado' });
    return { ok: true, estado: 'acreditado' };
  }

  // Rechazo (rebote). Si el cheque venía de un recibo, la cobranza se cae:
  // se reabre la deuda del cliente con un débito en cuenta corriente.
  async rechazar(id: string, dto: { motivo?: string }) {
    const c = await this.exigir(id, ['cartera', 'depositado', 'aplicado', 'emitido'], null);
    await this.set(c.id, { estado: 'rechazado', motivo_rechazo: dto.motivo ?? 'Rechazado por el banco' });
    if (c.tipo === 'terceros' && c.cliente_id) {
      await this.db.from('cuenta_corriente').insert({
        cliente_id: c.cliente_id,
        concepto: `Cheque rechazado Nº ${c.numero}${c.banco ? ` (${c.banco})` : ''}`,
        debe: Number(c.importe),
      });
    }
    return { ok: true, estado: 'rechazado' };
  }

  // Endoso: entregar un cheque de terceros a un proveedor (sale de cartera).
  async aplicar(id: string, dto: { proveedorId?: string; ordenPagoId?: string }) {
    const c = await this.exigir(id, ['cartera'], 'terceros');
    if (!dto.proveedorId && !dto.ordenPagoId) throw new BadRequestException('Indicá el proveedor o la orden de pago');
    await this.set(c.id, { estado: 'aplicado', proveedor_id: dto.proveedorId ?? c.proveedor_id ?? null, orden_pago_id: dto.ordenPagoId ?? null });
    return { ok: true, estado: 'aplicado' };
  }

  // Cheque propio efectivamente debitado de la cuenta del banco.
  async debitar(id: string) {
    await this.exigir(id, ['emitido'], 'propio');
    await this.set(id, { estado: 'debitado' });
    return { ok: true, estado: 'debitado' };
  }

  async anular(id: string, dto: { motivo?: string }) {
    const c = await this.exigir(id, ['cartera', 'depositado', 'emitido'], null);
    await this.set(c.id, { estado: 'anulado', motivo_rechazo: dto.motivo ?? null });
    return { ok: true, estado: 'anulado' };
  }

  // ---------- internos ----------

  private async exigir(id: string, estados: string[], tipo: 'terceros' | 'propio' | null) {
    const { data: c } = await this.db.from('cheques').select('*').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('No existe el cheque');
    if (tipo && c.tipo !== tipo) throw new BadRequestException(`Esta acción es solo para cheques ${tipo === 'propio' ? 'propios' : 'de terceros'}`);
    if (!estados.includes(c.estado)) throw new BadRequestException(`El cheque está "${c.estado}" y no admite esta acción`);
    return c;
  }

  private async set(id: string, cambios: Record<string, any>) {
    const { error } = await this.db.from('cheques').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }
}
