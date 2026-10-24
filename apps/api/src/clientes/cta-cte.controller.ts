import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { CtaCteResumenesService, DatosCliente, TipoCuenta } from './cta-cte-resumenes.service';
import { celularWhatsapp } from '../comun/whatsapp';
import { resumirPerfil, type PerfilCompras } from './perfil-compras';

/** El celular para «Llamar» y «WhatsApp» de la tarjeta: 549 + 10 dígitos, o null. */
function celularDe(tel: string | null | undefined): string | null {
  const d = celularWhatsapp(String(tel ?? ''));
  return /^549\d{10}$/.test(d) ? d : null;
}

// Tablero de cuentas corrientes: quién debe cuánto, contra qué tope, quién
// paga bien y quién es un riesgo. La foto que el dueño necesita para decidir
// a quién fiarle y a quién cortarle, no solo el número de la deuda.
@Controller('cta-cte')
export class CtaCteController {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly resumenes: CtaCteResumenesService,
  ) {}

  // ---- resumen de saldo por WhatsApp cada 15 días ----

  // la configuración, la próxima fecha, quiénes lo recibirían y las tandas anteriores
  @Roles('gerente', 'dueno')
  @Get('resumenes')
  async resumenesEstado() {
    const config = await this.resumenes.config();
    const [lista, historial] = await Promise.all([this.resumenes.candidatos(config), this.resumenes.historial()]);
    return { config, proxima: this.resumenes.proxima(config), lista, historial };
  }

  @Roles('dueno')
  @Patch('resumenes/config')
  guardarConfig(@Body() dto: { activo?: boolean; plantilla?: string; piso?: number }, @Req() req: any) {
    return this.resumenes.guardarConfig(dto, req.usuario?.sub ?? null);
  }

  @Roles('dueno')
  @Post('resumenes/prueba')
  prueba(@Body() dto: { telefono: string; clienteId?: string }) {
    return this.resumenes.prueba(dto.telefono, dto.clienteId);
  }

  // manda la tanda de hoy ya, aunque lo automático esté pausado
  @Roles('dueno')
  @Post('resumenes/enviar-ahora')
  enviarAhora() {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    return this.resumenes.correrTanda(hoy, true);
  }

  @Roles('gerente', 'dueno')
  @Get('cliente/:id')
  estadoDeCuenta(@Param('id') id: string) {
    return this.resumenes.estadoDeCuenta(id);
  }

  @Roles('gerente', 'dueno')
  @Patch('cliente/:id')
  cambiarCliente(@Param('id') id: string, @Body() dto: DatosCliente & { recibeResumen?: boolean; limite?: number; habilitada?: boolean; tipo?: TipoCuenta }) {
    return this.resumenes.cambiarCliente(id, dto);
  }

  // corregir el saldo con un movimiento y su motivo: solo el dueño
  @Roles('dueno')
  @Post('cliente/:id/ajuste')
  ajustarSaldo(@Param('id') id: string, @Body() dto: { monto: number; motivo: string }) {
    return this.resumenes.ajustarSaldo(id, dto.monto, dto.motivo);
  }

  // sumar una cuenta: cliente existente (clienteId) o nuevo (datos), tope y saldo inicial
  @Roles('gerente', 'dueno')
  @Post('alta')
  abrirCuenta(@Body() dto: { clienteId?: string; datos?: DatosCliente; tope?: number; saldoInicial?: number; nota?: string; tipo?: TipoCuenta }) {
    return this.resumenes.abrirCuenta(dto);
  }

  @Roles('gerente', 'dueno')
  @Get('tablero')
  async tablero(@Query('tipo') tipo?: string) {
    // ?tipo=sponsor: las cuentas de los sponsors del Wine Fest; sin tipo, las de clientes (24/10/2026)
    const { data: clientes, error } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, telefono, sucursal, saldo_cta_cte, limite_credito, cta_cte_habilitada, cta_cte_tipo')
      .eq('cta_cte_habilitada', true)
      .eq('cta_cte_tipo', tipo === 'sponsor' ? 'sponsor_wf' : 'cliente')
      .order('saldo_cta_cte', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const lista = (clientes ?? []) as any[];
    const ids = lista.map((c) => c.id);

    // Una tarjeta por cuenta (Leandro, 24/10/2026: «no hay card por cada cuenta
    // corriente, con detalle de compra, límites disponibles… es una planilla»).
    // Por cuenta: lo último que compró con sus renglones, el último pago, lo
    // del mes, el límite y lo disponible. Los saldos traídos del Crack (saldo
    // inicial y ajustes del corte) no son compras ni pagos: van aparte.
    const [cobros, movimientos] = await Promise.all([
      ids.length
        ? this.db.from('cobranzas_pendientes').select('cliente_id, monto, estado, resuelta_en').in('cliente_id', ids).eq('estado', 'aprobada')
        : Promise.resolve({ data: [] } as any),
      ids.length
        ? this.db.from('cuenta_corriente').select('id, cliente_id, comprobante_id, concepto, debe, haber, creado_en').in('cliente_id', ids).order('creado_en', { ascending: false }).limit(3000)
        : Promise.resolve({ data: [] } as any),
    ]);
    const movs = (movimientos.data ?? []) as any[];

    // los renglones de las facturas a cuenta: «qué compró»
    const compIds = [...new Set(movs.map((m) => m.comprobante_id).filter(Boolean))].slice(0, 800);
    const renglones = new Map<string, { descripcion: string; cantidad: number }[]>();
    for (let i = 0; i < compIds.length; i += 200) {
      const { data } = await this.db.from('comprobantes').select('id, items').in('id', compIds.slice(i, i + 200));
      for (const c of (data ?? []) as any[]) {
        renglones.set(c.id, (Array.isArray(c.items) ? c.items : []).map((it: any) => ({ descripcion: String(it.descripcion ?? ''), cantidad: Number(it.cantidad ?? 1) })));
      }
    }

    const importado = (concepto: string | null) => /sistema anterior/i.test(String(concepto ?? ''));
    const hace30 = Date.now() - 30 * 24 * 3600_000;
    type Mov = { fecha: string; concepto: string; debe: number; haber: number; importado: boolean; renglones: { descripcion: string; cantidad: number }[] };
    const porCliente = new Map<string, {
      movimientos: Mov[]; ultimaCompra: { fecha: string; monto: number } | null; ultimoPago: { fecha: string; monto: number } | null;
      compras30: number; comprado30: number; pagado30: number; traidoDelCrack: number;
    }>();
    for (const c of lista) porCliente.set(c.id, { movimientos: [], ultimaCompra: null, ultimoPago: null, compras30: 0, comprado30: 0, pagado30: 0, traidoDelCrack: 0 });

    for (const m of movs) {
      const x = porCliente.get(m.cliente_id);
      if (!x) continue;
      const debe = Number(m.debe ?? 0);
      const haber = Number(m.haber ?? 0);
      const imp = importado(m.concepto);
      if (x.movimientos.length < 4) {
        x.movimientos.push({ fecha: m.creado_en, concepto: m.concepto ?? (debe > 0 ? 'Compra' : 'Pago'), debe, haber, importado: imp, renglones: (renglones.get(m.comprobante_id) ?? []).slice(0, 4) });
      }
      if (imp) { x.traidoDelCrack += debe - haber; continue; }
      const reciente = new Date(m.creado_en).getTime() > hace30;
      if (debe > 0) {
        if (!x.ultimaCompra) x.ultimaCompra = { fecha: m.creado_en, monto: debe };
        if (reciente) { x.compras30++; x.comprado30 += debe; }
      }
      if (haber > 0) {
        if (!x.ultimoPago) x.ultimoPago = { fecha: m.creado_en, monto: haber };
        if (reciente) x.pagado30 += haber;
      }
    }
    // un cobro aprobado también es un pago (deja su haber en la cuenta, pero
    // por las dudas se toma la fecha de la aprobación)
    for (const c of (cobros.data ?? []) as any[]) {
      const x = porCliente.get(c.cliente_id);
      if (!x || !c.resuelta_en) continue;
      if (!x.ultimoPago || c.resuelta_en > x.ultimoPago.fecha) x.ultimoPago = { fecha: c.resuelta_en, monto: Number(c.monto) };
    }

    const dias = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000) : null);

    // cómo compra cada uno en los últimos 6 meses (ticket promedio, días,
    // productos): sale del Crack y de las ventas de NÚCLEO con cliente
    const perfiles = new Map<string, PerfilCompras>();
    // días de deuda (24/10/2026, «los días de deuda y el día de deuda
    // promedio»): desde cuándo debe y la edad promedio de lo que debe, con las
    // facturas del Crack y las de NÚCLEO (deuda_antiguedad, en la base)
    const antiguedad = new Map<string, { desde: string; dias: number; diasPromedio: number; facturasAbiertas: number }>();
    if (ids.length) {
      const [{ data }, { data: deuda }, { data: pagosCrack }] = await Promise.all([
        this.db.rpc('perfil_compras', { p_clientes: ids, p_meses: 6 }),
        this.db.rpc('deuda_antiguedad', { p_clientes: ids }),
        // el último pago que registró el Crack (en NÚCLEO casi no hay todavía)
        this.db.from('cta_cte_movimientos_crack').select('cliente_id, fecha, importe').in('cliente_id', ids).eq('tipo', 'PAGO').order('fecha', { ascending: false }).limit(5000),
      ]);
      for (const p of (data ?? []) as any[]) perfiles.set(p.cliente_id, resumirPerfil(p, 3));
      for (const d of (deuda ?? []) as any[]) {
        antiguedad.set(d.cliente_id, { desde: d.desde, dias: Number(d.dias), diasPromedio: Number(d.dias_promedio), facturasAbiertas: Number(d.facturas_abiertas) });
      }
      for (const p of (pagosCrack ?? []) as any[]) {
        const x = porCliente.get(p.cliente_id);
        if (x && (!x.ultimoPago || p.fecha > x.ultimoPago.fecha)) x.ultimoPago = { fecha: p.fecha, monto: Math.abs(Number(p.importe)) };
      }
    }

    const cuentas = lista.map((c) => {
      const h = porCliente.get(c.id)!;
      const saldo = Number(c.saldo_cta_cte ?? 0);
      const limite = Number(c.limite_credito ?? 0);
      const pctConsumido = limite > 0 ? Math.round((saldo / limite) * 100) : null;
      const diasSinPagar = dias(h.ultimoPago?.fecha);

      // Semáforo. Regla simple y explicable, no una caja negra. Se mide con
      // los días que lleva la deuda más vieja; sin ese dato, con el último pago.
      // ROJO  = tope agotado, o debe hace 45+ días
      // AMARILLO = 80%+ del tope, o debe hace 20+ días
      // VERDE = el resto
      const ant = antiguedad.get(c.id) ?? null;
      const diasDeuda = saldo > 0 ? (ant?.dias ?? diasSinPagar) : null;
      let riesgo: 'alto' | 'medio' | 'bajo' = 'bajo';
      if ((pctConsumido != null && pctConsumido >= 100) || (saldo > 0 && (diasDeuda == null || diasDeuda >= 45))) riesgo = 'alto';
      else if ((pctConsumido != null && pctConsumido >= 80) || (diasDeuda != null && diasDeuda >= 20)) riesgo = 'medio';

      return {
        id: c.id,
        nombre: c.razon_social || c.nombre,
        telefono: c.telefono,
        celular: celularDe(c.telefono),
        sucursal: c.sucursal ?? null,
        saldo,
        limite,
        pctConsumido,
        disponible: limite > 0 ? Math.max(limite - saldo, 0) : null,
        excedido: limite > 0 && saldo > limite ? saldo - limite : 0,
        ultimaCompra: h.ultimaCompra,
        ultimoPago: h.ultimoPago,
        diasSinPagar,
        compras30: h.compras30,
        comprado30: Math.round(h.comprado30),
        pagado30: Math.round(h.pagado30),
        traidoDelCrack: Math.round(h.traidoDelCrack),
        movimientos: h.movimientos,
        perfil: perfiles.get(c.id) ?? null,
        // desde cuándo debe y la edad promedio de la deuda (null: no debe o no hay facturas)
        deuda: saldo > 0 && ant ? ant : null,
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
        disponibleTotal: Math.round(cuentas.reduce((s, c) => s + (c.disponible ?? 0), 0)),
        excedidas: cuentas.filter((c) => c.excedido > 0).length,
        comprado30: Math.round(cuentas.reduce((s, c) => s + c.comprado30, 0)),
        pagado30: Math.round(cuentas.reduce((s, c) => s + c.pagado30, 0)),
        // días de deuda promedio de la cartera, pesado por lo que debe cada uno
        diasDeudaPromedio: (() => {
          const con = cuentas.filter((c) => c.deuda && c.saldo > 0);
          const plata = con.reduce((s, c) => s + c.saldo, 0);
          return plata ? Math.round(con.reduce((s, c) => s + c.deuda!.diasPromedio * c.saldo, 0) / plata) : null;
        })(),
        deuda90: cuentas.filter((c) => (c.deuda?.dias ?? 0) >= 90).length,
        // lo que compró toda la cartera en 6 meses, ticket por ticket
        ticketPromedio: (() => {
          const t = cuentas.reduce((s, c) => s + (c.perfil?.tickets ?? 0), 0);
          return t ? Math.round(cuentas.reduce((s, c) => s + (c.perfil?.total ?? 0), 0) / t) : 0;
        })(),
        enRiesgo: cuentas.filter((c) => c.riesgo === 'alto').length,
      },
      cuentas,
    };
  }
}

