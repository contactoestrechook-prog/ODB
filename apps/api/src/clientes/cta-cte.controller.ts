import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// Tablero de cuentas corrientes: quién debe cuánto, contra qué tope, quién
// paga bien y quién es un riesgo. La foto que el dueño necesita para decidir
// a quién fiarle y a quién cortarle, no solo el número de la deuda.
@Controller('cta-cte')
export class CtaCteController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Roles('gerente', 'dueno')
  @Get('tablero')
  async tablero() {
    const { data: clientes, error } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, telefono, saldo_cta_cte, limite_credito, cta_cte_habilitada')
      .eq('cta_cte_habilitada', true)
      .order('saldo_cta_cte', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const lista = (clientes ?? []) as any[];
    const ids = lista.map((c) => c.id);

    // historia de pagos: cobros aprobados + haberes en la cuenta. Arranca corta
    // (los saldos vinieron de una importación sin fechas) y se enriquece sola
    // con el uso: cada cobro aprobado y cada rendición suman señal.
    const [cobros, movimientos, ventas] = await Promise.all([
      ids.length
        ? this.db.from('cobranzas_pendientes').select('cliente_id, monto, estado, cargada_en, resuelta_en').in('cliente_id', ids)
        : Promise.resolve({ data: [] } as any),
      ids.length
        ? this.db.from('cuenta_corriente').select('cliente_id, debe, haber, creado_en').in('cliente_id', ids).order('creado_en', { ascending: false }).limit(500)
        : Promise.resolve({ data: [] } as any),
      ids.length
        ? this.db.from('ventas').select('cliente_id, total, creado_en').in('cliente_id', ids).order('creado_en', { ascending: false }).limit(1000)
        : Promise.resolve({ data: [] } as any),
    ]);

    const porCliente = new Map<string, any>();
    for (const c of lista) {
      porCliente.set(c.id, { pagos: 0, pagado: 0, ultimoPago: null as string | null, ultimaCompra: null as string | null, compras30: 0 });
    }
    for (const c of (cobros.data ?? []) as any[]) {
      const x = porCliente.get(c.cliente_id);
      if (!x || c.estado !== 'aprobada') continue;
      x.pagos++;
      x.pagado += Number(c.monto);
      if (!x.ultimoPago || c.resuelta_en > x.ultimoPago) x.ultimoPago = c.resuelta_en;
    }
    for (const m of (movimientos.data ?? []) as any[]) {
      const x = porCliente.get(m.cliente_id);
      if (!x || Number(m.haber) <= 0) continue;
      if (!x.ultimoPago || m.creado_en > x.ultimoPago) x.ultimoPago = m.creado_en;
    }
    const hace30 = Date.now() - 30 * 24 * 3600_000;
    for (const v of (ventas.data ?? []) as any[]) {
      const x = porCliente.get(v.cliente_id);
      if (!x) continue;
      if (!x.ultimaCompra || v.creado_en > x.ultimaCompra) x.ultimaCompra = v.creado_en;
      if (new Date(v.creado_en).getTime() > hace30) x.compras30++;
    }

    const dias = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000) : null);

    const cuentas = lista.map((c) => {
      const h = porCliente.get(c.id);
      const saldo = Number(c.saldo_cta_cte ?? 0);
      const limite = Number(c.limite_credito ?? 0);
      const pctConsumido = limite > 0 ? Math.round((saldo / limite) * 100) : null;
      const diasSinPagar = dias(h.ultimoPago);

      // Semáforo. Regla simple y explicable, no una caja negra:
      // ROJO  = tope agotado, o debe y hace 45+ días que no paga nada (o nunca pagó)
      // AMARILLO = 80%+ del tope, o debe y hace 20+ días sin pagos
      // VERDE = el resto
      let riesgo: 'alto' | 'medio' | 'bajo' = 'bajo';
      if ((pctConsumido != null && pctConsumido >= 100) || (saldo > 0 && (diasSinPagar == null || diasSinPagar >= 45))) riesgo = 'alto';
      else if ((pctConsumido != null && pctConsumido >= 80) || (saldo > 0 && diasSinPagar != null && diasSinPagar >= 20)) riesgo = 'medio';

      return {
        id: c.id,
        nombre: c.razon_social || c.nombre,
        telefono: c.telefono,
        saldo,
        limite,
        pctConsumido,
        disponible: limite > 0 ? Math.max(limite - saldo, 0) : null,
        pagos: h.pagos,
        pagado: h.pagado,
        ultimoPago: h.ultimoPago,
        diasSinPagar,
        ultimaCompra: h.ultimaCompra,
        compras30: h.compras30,
        riesgo,
      };
    });

    const conSaldo = cuentas.filter((c) => c.saldo > 0);
    return {
      kpis: {
        enLaCalle: Math.round(conSaldo.reduce((s, c) => s + c.saldo, 0)),
        clientesConSaldo: conSaldo.length,
        clientesHabilitados: cuentas.length,
        sinTope: cuentas.filter((c) => c.limite <= 0).length,
        enRiesgo: cuentas.filter((c) => c.riesgo === 'alto').length,
      },
      cuentas,
    };
  }
}
