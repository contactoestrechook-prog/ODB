import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { limitesDeFecha, fechaArt } from '../lib/fechas';
import { leerTodo } from '../lib/leer-todo';

export type Moneda = 'ARS' | 'BRL' | 'USD';
export type Metodo = 'pix' | 'qr' | 'tarjeta' | 'efectivo';
export const MONEDAS: Moneda[] = ['ARS', 'BRL', 'USD'];
export const METODOS: Metodo[] = ['pix', 'qr', 'tarjeta', 'efectivo'];

export type Cambio = { BRL: number | null; USD: number | null; actualizadoEn: string | null; pixModo: 'terminal' | 'api' };

const redondo2 = (n: number) => Math.round(n * 100) / 100;

// Un monto en pesos, visto en las tres monedas con el cambio de la casa.
export function enMonedas(ars: number, cambio: Cambio): Record<Moneda, number | null> {
  return {
    ARS: Math.round(ars),
    BRL: cambio.BRL ? redondo2(ars / cambio.BRL) : null,
    USD: cambio.USD ? redondo2(ars / cambio.USD) : null,
  };
}

// La cuenta se da por pagada si falta menos que esto: al pasar reales o
// dólares a pesos siempre queda una diferencia de centavos.
const tolerancia = (total: number) => Math.max(10, total * 0.002);

// Estados en los que la mesa ya tiene qué cobrar y todavía no pagó.
const COBRABLES = ['comanda_tomada', 'plato_servido', 'terminando', 'pidio_cuenta'];

@Injectable()
export class CuentaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async cambio(): Promise<Cambio> {
    const { data, error } = await this.db
      .from('configuracion')
      .select('cambio_brl, cambio_usd, cambio_actualizado_en, pix_modo')
      .eq('id', true)
      .single();
    if (error) throw new BadRequestException(error.message);
    return {
      BRL: data.cambio_brl != null ? Number(data.cambio_brl) : null,
      USD: data.cambio_usd != null ? Number(data.cambio_usd) : null,
      actualizadoEn: data.cambio_actualizado_en ?? null,
      pixModo: data.pix_modo ?? 'terminal',
    };
  }

  private armar(ciclo: any, items: any[], pagos: any[], cambio: Cambio) {
    const renglones = items.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      cantidad: i.cantidad,
      precioUnitario: Number(i.precio_unitario ?? 0),
      total: Number(i.precio_unitario ?? 0) * i.cantidad,
    }));
    const total = renglones.reduce((s, r) => s + r.total, 0);
    const confirmados = pagos.filter((p) => p.estado === 'confirmado');
    const pagado = confirmados.reduce((s, p) => s + Number(p.monto_ars), 0);
    const saldo = Math.max(0, total - pagado);
    return {
      cicloId: ciclo.id,
      mesaId: ciclo.mesa_id,
      estado: ciclo.estado as string,
      cubiertos: ciclo.cubiertos as number | null,
      renglones,
      total,
      totalEn: enMonedas(total, cambio),
      pagado,
      saldo,
      saldoEn: enMonedas(saldo, cambio),
      pagada: total > 0 && saldo <= tolerancia(total),
      preferido: ciclo.pago_preferido_metodo
        ? { metodo: ciclo.pago_preferido_metodo as Metodo, moneda: (ciclo.pago_preferido_moneda ?? 'ARS') as Moneda }
        : null,
      pagos: confirmados.map((p) => ({
        id: p.id, metodo: p.metodo as Metodo, moneda: p.moneda as Moneda, monto: Number(p.monto),
        montoArs: Number(p.monto_ars), creadoEn: p.creado_en, cargadoPor: p.cargado_por ?? null,
      })),
      cambio,
    };
  }

  private async cicloActivo(mesaId: string) {
    const { data, error } = await this.db.from('mesa_ciclos').select('*').eq('mesa_id', mesaId).neq('estado', 'libre').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Esta mesa no tiene una visita abierta');
    return data;
  }

  private async cuentaDeCiclo(ciclo: any) {
    const [items, pagos, cambio] = await Promise.all([
      this.db.from('comanda_items').select('id, nombre, cantidad, precio_unitario, enviado_en').eq('ciclo_id', ciclo.id).order('enviado_en'),
      this.db.from('pagos').select('*').eq('ciclo_id', ciclo.id).order('creado_en'),
      this.cambio(),
    ]);
    if (items.error) throw new BadRequestException(items.error.message);
    if (pagos.error) throw new BadRequestException(pagos.error.message);
    return this.armar(ciclo, items.data ?? [], pagos.data ?? [], cambio);
  }

  async cuentaDeMesa(mesaId: string) {
    return this.cuentaDeCiclo(await this.cicloActivo(mesaId));
  }

  // ── lo que ve el cliente desde el QR de su mesa ──

  private async mesaPorToken(token: string) {
    const { data, error } = await this.db.from('mesas').select('id, numero, sector, activa').eq('qr_token', token).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || !data.activa) throw new NotFoundException('Mesa no encontrada');
    return data;
  }

  async cuentaPorToken(token: string) {
    const mesa = await this.mesaPorToken(token);
    const { data: ciclo, error } = await this.db.from('mesa_ciclos').select('*').eq('mesa_id', mesa.id).neq('estado', 'libre').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!ciclo) return { mesa: { numero: mesa.numero, sector: mesa.sector }, abierta: false, cambio: await this.cambio() };
    const cuenta = await this.cuentaDeCiclo(ciclo);
    // al cliente no le mostramos quién cargó cada pago
    return {
      mesa: { numero: mesa.numero, sector: mesa.sector },
      abierta: true,
      ...cuenta,
      pagos: cuenta.pagos.map(({ cargadoPor, ...p }) => p),
    };
  }

  // El cliente pide la cuenta y dice cómo quiere pagar. Avisa al mozo (salta
  // al tope de su cola) y adelanta el reloj de la mesa a "pidió la cuenta".
  async pedirCuenta(token: string, metodo?: Metodo, moneda?: Moneda) {
    if (metodo && !METODOS.includes(metodo)) throw new BadRequestException('Medio de pago desconocido');
    if (moneda && !MONEDAS.includes(moneda)) throw new BadRequestException('Moneda desconocida');
    const mesa = await this.mesaPorToken(token);
    const ciclo = await this.cicloActivo(mesa.id);
    if (!COBRABLES.includes(ciclo.estado)) {
      throw new BadRequestException(ciclo.estado === 'pago' ? 'Esta cuenta ya está pagada' : 'Todavía no hay nada cargado en tu mesa');
    }
    const ahora = new Date().toISOString();
    const patch: Record<string, any> = {
      llamado_mozo_en: ahora,
      pago_preferido_metodo: metodo ?? null,
      pago_preferido_moneda: moneda ?? null,
    };
    if (ciclo.estado !== 'pidio_cuenta') {
      patch.estado = 'pidio_cuenta';
      patch.estado_desde = ahora;
      patch.pidio_cuenta_en = ahora;
      if (!ciclo.terminando_en) patch.terminando_en = ahora;
    }
    const { error } = await this.db.from('mesa_ciclos').update(patch).eq('id', ciclo.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── caja: lo que usa el mozo o el encargado ──

  async cuentasAbiertas() {
    const { data: ciclos, error } = await this.db
      .from('mesa_ciclos')
      .select('*, mesa:mesas(numero, sector), mozo:mozos(nombre)')
      .in('estado', COBRABLES)
      .order('sentada_en');
    if (error) throw new BadRequestException(error.message);
    const ids = (ciclos ?? []).map((c: any) => c.id);
    if (!ids.length) return [];
    const [items, pagos, cambio] = await Promise.all([
      this.db.from('comanda_items').select('id, ciclo_id, nombre, cantidad, precio_unitario').in('ciclo_id', ids),
      this.db.from('pagos').select('*').in('ciclo_id', ids),
      this.cambio(),
    ]);
    if (items.error) throw new BadRequestException(items.error.message);
    if (pagos.error) throw new BadRequestException(pagos.error.message);
    return (ciclos ?? []).map((c: any) => ({
      ...this.armar(
        c,
        (items.data ?? []).filter((i: any) => i.ciclo_id === c.id),
        (pagos.data ?? []).filter((p: any) => p.ciclo_id === c.id),
        cambio,
      ),
      mesaNumero: c.mesa?.numero ?? null,
      sector: c.mesa?.sector ?? null,
      mozoNombre: c.mozo?.nombre ?? null,
      minutos: Math.round((Date.now() - new Date(c.sentada_en).getTime()) / 60_000),
      pidioCuentaHaceMin: c.pidio_cuenta_en ? Math.round((Date.now() - new Date(c.pidio_cuenta_en).getTime()) / 60_000) : null,
    }));
  }

  // Registra un cobro. `monto` va en la moneda en que entró la plata; se pasa
  // a pesos con el cambio de la casa de ese momento y queda guardado con ese
  // cambio. Cuando lo cobrado cubre la cuenta, la mesa pasa sola a "pagó".
  async cobrar(mesaId: string, input: { metodo: Metodo; moneda: Moneda; monto: number; cargadoPor?: string; referencia?: string }) {
    if (!METODOS.includes(input.metodo)) throw new BadRequestException('Elegí el medio de pago');
    if (!MONEDAS.includes(input.moneda)) throw new BadRequestException('Elegí la moneda');
    const monto = Number(input.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw new BadRequestException('Poné el monto cobrado');

    const ciclo = await this.cicloActivo(mesaId);
    if (!COBRABLES.includes(ciclo.estado)) {
      throw new BadRequestException(ciclo.estado === 'pago' ? 'Esta mesa ya figura pagada' : 'Esta mesa todavía no tiene comanda');
    }
    const cambio = await this.cambio();
    const tipoCambio = input.moneda === 'ARS' ? 1 : cambio[input.moneda];
    if (!tipoCambio) {
      throw new BadRequestException(`Falta cargar el cambio de hoy para ${input.moneda === 'BRL' ? 'el real' : 'el dólar'} (Caja → Cambio de la casa)`);
    }

    const { error } = await this.db.from('pagos').insert({
      ciclo_id: ciclo.id,
      metodo: input.metodo,
      moneda: input.moneda,
      monto: redondo2(monto),
      tipo_cambio: tipoCambio,
      monto_ars: Math.round(monto * tipoCambio),
      estado: 'confirmado',
      cargado_por: input.cargadoPor?.trim() || null,
      referencia: input.referencia?.trim() || null,
    });
    if (error) throw new BadRequestException(error.message);

    const cuenta = await this.cuentaDeCiclo(ciclo);
    let cerrada = false;
    if (cuenta.pagada) {
      const ahora = new Date().toISOString();
      const patch: Record<string, any> = {
        estado: 'pago', estado_desde: ahora, pago_en: ahora, monto: cuenta.total, llamado_mozo_en: null,
      };
      if (!ciclo.terminando_en) patch.terminando_en = ahora;
      if (!ciclo.pidio_cuenta_en) patch.pidio_cuenta_en = ahora;
      const { error: errUpd } = await this.db.from('mesa_ciclos').update(patch).eq('id', ciclo.id);
      if (errUpd) throw new BadRequestException(errUpd.message);
      cerrada = true;
    }
    const vuelto = Math.max(0, Math.round(cuenta.pagado - cuenta.total));
    return { cuenta: { ...cuenta, estado: cerrada ? 'pago' : cuenta.estado }, cerrada, vuelto };
  }

  // Un cobro mal cargado se anula (no se borra: queda el rastro). Si la mesa
  // había pasado a "pagó" y todavía no se liberó, vuelve a "pidió la cuenta".
  async anularPago(pagoId: string) {
    const { data: pago, error } = await this.db.from('pagos').update({ estado: 'anulado' }).eq('id', pagoId).eq('estado', 'confirmado').select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!pago) throw new NotFoundException('Ese cobro no existe o ya estaba anulado');
    const ahora = new Date().toISOString();
    await this.db
      .from('mesa_ciclos')
      .update({ estado: 'pidio_cuenta', estado_desde: ahora, pago_en: null, monto: null })
      .eq('id', pago.ciclo_id)
      .eq('estado', 'pago');
    return { ok: true };
  }

  // Lo cobrado en un día, separado por medio de pago y por moneda: es lo que
  // tiene que haber en el cajón, en el posnet y en la cuenta al cerrar.
  async cobradoDelDia(fecha = fechaArt()) {
    const { desde, hasta } = limitesDeFecha(fecha);
    const pagos = await leerTodo<any>(() =>
      this.db
        .from('pagos')
        .select('*, ciclo:mesa_ciclos(mesa:mesas(numero))')
        .eq('estado', 'confirmado')
        .gte('creado_en', desde.toISOString())
        .lte('creado_en', hasta.toISOString())
        .order('creado_en', { ascending: false }),
    );
    const grupos = new Map<string, { metodo: Metodo; moneda: Moneda; cobros: number; monto: number; montoArs: number }>();
    for (const p of pagos) {
      const clave = `${p.metodo}|${p.moneda}`;
      const g = grupos.get(clave) ?? { metodo: p.metodo, moneda: p.moneda, cobros: 0, monto: 0, montoArs: 0 };
      g.cobros++;
      g.monto = redondo2(g.monto + Number(p.monto));
      g.montoArs += Number(p.monto_ars);
      grupos.set(clave, g);
    }
    return {
      fecha,
      totalArs: pagos.reduce((s, p) => s + Number(p.monto_ars), 0),
      cobros: pagos.length,
      porMedio: [...grupos.values()].sort((a, b) => b.montoArs - a.montoArs),
      ultimos: pagos.slice(0, 40).map((p) => ({
        id: p.id, mesaNumero: p.ciclo?.mesa?.numero ?? null, metodo: p.metodo, moneda: p.moneda,
        monto: Number(p.monto), montoArs: Number(p.monto_ars), creadoEn: p.creado_en, cargadoPor: p.cargado_por ?? null,
      })),
    };
  }
}
