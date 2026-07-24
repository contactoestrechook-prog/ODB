import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { fetchConTimeout } from '../comun/http';
import { CuentaMP, cuentaDeSucursal, cuentasMP } from './mp-cuentas';

const MP = 'https://api.mercadopago.com';

// Módulo Mercado Pago MULTI-CUENTA (una por razón social): importa los pagos
// REALES de cada cuenta (comisión, neto y fecha de liberación exactos), los
// vincula con las ventas de SUS sucursales y completa las acreditaciones sin
// carga manual. También genera links de pago para cobrar a distancia.
@Injectable()
export class MercadoPagoService {
  private readonly log = new Logger(MercadoPagoService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Estado de todas las cuentas configuradas (incluye las declaradas sin credenciales).
  async estado() {
    const cuentas = await cuentasMP(this.db);
    const { data: declaradas } = await this.db
      .from('sucursales')
      .select('mp_cuenta')
      .not('mp_cuenta', 'is', null);
    const pendientes = [...new Set((declaradas ?? []).map((s: any) => s.mp_cuenta))].filter(
      (slug) => !cuentas.some((c) => c.slug === slug),
    );
    const detalle: any[] = pendientes.map((slug) => ({
      slug,
      vinculado: false,
      error: 'faltan las credenciales en Railway',
    }));
    if (!cuentas.length && !detalle.length) return { vinculado: false, cuentas: [] };
    for (const c of cuentas) {
      const r = await fetchConTimeout(`${MP}/users/me`, { headers: { Authorization: `Bearer ${c.token}` } });
      if (!r.ok) {
        detalle.push({ slug: c.slug, vinculado: false, error: `MP respondió ${r.status} (¿token vencido?)` });
        continue;
      }
      const me: any = await r.json();
      detalle.push({ slug: c.slug, vinculado: true, cuenta: me.nickname, pais: me.site_id, usuarioId: me.id });
      // guardar el user_id para resolver webhooks (a qué cuenta pertenece cada aviso)
      await this.db.from('sucursales').update({ mp_user_id: String(me.id) }).in('id', c.sucursalIds);
    }
    const principal = detalle.find((d) => d.vinculado);
    return { vinculado: !!principal, cuenta: principal?.cuenta, cuentas: detalle };
  }

  // Importa los pagos de los últimos `dias` de TODAS las cuentas configuradas.
  async importar(dias = 30) {
    const cuentas = await cuentasMP(this.db);
    if (!cuentas.length) throw new BadRequestException('Mercado Pago no está vinculado (faltan credenciales)');
    let importados = 0;
    let vinculados = 0;
    let acreditacionesActualizadas = 0;
    const porCuenta: any[] = [];
    for (const cuenta of cuentas) {
      const r = await this.importarCuenta(cuenta, dias);
      importados += r.importados;
      vinculados += r.vinculados;
      acreditacionesActualizadas += r.acreditacionesActualizadas;
      porCuenta.push({ cuenta: cuenta.slug, ...r });
    }
    return { importados, vinculados, acreditacionesActualizadas, porCuenta };
  }

  private async importarCuenta(cuenta: CuentaMP, dias: number) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const hasta = new Date().toISOString();

    const traidos: any[] = [];
    for (let offset = 0; offset < 6000; offset += 30) {
      const url =
        `${MP}/v1/payments/search?sort=date_created&criteria=desc&range=date_created` +
        `&begin_date=${encodeURIComponent(desde)}&end_date=${encodeURIComponent(hasta)}&limit=30&offset=${offset}`;
      const r = await fetchConTimeout(url, { headers: { Authorization: `Bearer ${cuenta.token}` } });
      if (!r.ok) {
        const e: any = await r.json().catch(() => ({}));
        throw new BadRequestException(`MP search (${cuenta.slug}) falló (${r.status}): ${e?.message ?? 'error'}`);
      }
      const d: any = await r.json();
      const lote = d.results ?? [];
      traidos.push(...lote);
      if (lote.length < 30) break;
    }

    // upsert al espejo local en lotes (una cuenta activa trae miles de pagos)
    const ahora = new Date().toISOString();
    const filas = traidos.map((p) => {
      const comision = (p.fee_details ?? []).reduce((s: number, f: any) => s + Number(f.amount ?? 0), 0);
      const liberacion = p.money_release_date ?? null;
      return {
        id: String(p.id),
        cuenta: cuenta.slug,
        estado: String(p.status ?? 'desconocido'),
        estado_detalle: p.status_detail ?? null,
        tipo: p.payment_type_id ?? null,
        medio: p.payment_method_id ?? null,
        origen: p.point_of_interaction?.type ?? null,
        cuotas: Number(p.installments ?? 1),
        bruto: Number(p.transaction_amount ?? 0),
        comision: Math.round(comision * 100) / 100,
        neto: Number(p.transaction_details?.net_received_amount ?? 0),
        liberado:
          p.money_release_status === 'released' ||
          (!!liberacion && new Date(liberacion).getTime() <= Date.now()),
        liberacion_en: liberacion,
        aprobado_en: p.date_approved ?? null,
        creado_en_mp: p.date_created ?? null,
        referencia_externa: p.external_reference ?? null,
        descripcion: p.description ?? null,
        pagador: p.payer?.email ?? null,
        actualizado_en: ahora,
      };
    });
    // el search puede repetir un pago entre páginas: el upsert por lote no admite ids duplicados
    const porId = new Map(filas.map((f) => [f.id, f]));
    const unicas = [...porId.values()];
    for (let d = 0; d < unicas.length; d += 500) {
      const { error } = await this.db.from('mp_pagos').upsert(unicas.slice(d, d + 500), { onConflict: 'id' });
      if (error) throw new BadRequestException(`No pude guardar los pagos (${d}-${d + 500}): ${error.message}`);
    }

    const vinculos = await this.vincular(cuenta);
    return { importados: unicas.length, ...vinculos };
  }

  // Vincula pagos de MP con nuestros pagos/ventas y completa las acreditaciones
  // con los números REALES de MP. SOLO cruza contra ventas de las sucursales de
  // ESTA cuenta (cada razón social tiene la suya).
  private async vincular(cuenta: CuentaMP) {
    const { data: sueltosR } = await this.db
      .from('mp_pagos')
      .select('id, bruto, neto, comision, liberado, liberacion_en, aprobado_en, estado')
      .is('pago_id', null)
      .eq('estado', 'approved')
      .eq('cuenta', cuenta.slug)
      .limit(2000);
    const sueltos = (sueltosR ?? []) as any[];
    if (!sueltos.length) return { vinculados: 0, acreditacionesActualizadas: 0 };

    // 1) match directo: nuestros pagos que ya guardaron el mp_payment_id (auto-checkout)
    const ids = sueltos.map((m) => m.id);
    const porMpId = new Map<string, any>();
    for (let d = 0; d < ids.length; d += 200) {
      const { data } = await this.db
        .from('pagos')
        .select('id, venta_id, monto, mp_payment_id')
        .in('mp_payment_id', ids.slice(d, d + 200));
      for (const p of (data ?? []) as any[]) porMpId.set(String(p.mp_payment_id), p);
    }

    // 2) candidatos para el match heurístico (QR de mostrador): pagos medio
    //    mercadopago sin mp_payment_id, de las sucursales de esta cuenta
    const fechas = sueltos.map((m) => (m.aprobado_en ? new Date(m.aprobado_en).getTime() : 0)).filter(Boolean);
    const margen = 36 * 3600_000;
    const desde = new Date((fechas.length ? Math.min(...fechas) : Date.now()) - margen).toISOString();
    const hasta = new Date((fechas.length ? Math.max(...fechas) : Date.now()) + margen).toISOString();
    const { data: candR } = await this.db
      .from('pagos')
      .select('id, venta_id, monto, creado_en, venta:ventas!inner(sucursal_id)')
      .eq('medio', 'mercadopago')
      .is('mp_payment_id', null)
      .in('venta.sucursal_id', cuenta.sucursalIds.length ? cuenta.sucursalIds : ['00000000-0000-0000-0000-000000000000'])
      .gte('creado_en', desde)
      .lte('creado_en', hasta)
      .limit(3000);
    const candidatos = (candR ?? []) as any[];
    const usados = new Set<string>();

    let vinculados = 0;
    let acreditacionesActualizadas = 0;
    for (const mp of sueltos) {
      let pago: any = porMpId.get(mp.id) ?? null;

      if (!pago && mp.aprobado_en) {
        const centro = new Date(mp.aprobado_en).getTime();
        const posibles = candidatos.filter(
          (c) =>
            !usados.has(c.id) &&
            Number(c.monto) === Number(mp.bruto) &&
            Math.abs(new Date(c.creado_en).getTime() - centro) <= margen,
        );
        if (posibles.length === 1) {
          pago = posibles[0];
          usados.add(pago.id);
          await this.db.from('pagos').update({ mp_payment_id: mp.id }).eq('id', pago.id);
        }
      }
      if (!pago) continue;

      await this.db.from('mp_pagos').update({ pago_id: pago.id, venta_id: pago.venta_id }).eq('id', mp.id);
      vinculados++;

      // completar la acreditación con los números reales de MP
      const fechaLib = mp.liberacion_en ? String(mp.liberacion_en).slice(0, 10) : null;
      const cambio = mp.liberado
        ? {
            estado: 'acreditada',
            neto_real: mp.neto,
            comision_real: mp.comision,
            fecha_real: fechaLib ?? new Date().toISOString().slice(0, 10),
            conciliado_en: new Date().toISOString(),
            nota: 'Conciliado por API de Mercado Pago',
          }
        : {
            comision_estimada: mp.comision,
            neto_estimado: mp.neto,
            ...(fechaLib ? { fecha_estimada: fechaLib } : {}),
            nota: 'Comisión y fecha reales informadas por Mercado Pago (pendiente de liberación)',
          };
      const { error, count } = await this.db
        .from('acreditaciones')
        .update(cambio, { count: 'exact' })
        .eq('pago_id', pago.id)
        .eq('estado', 'pendiente');
      if (!error && (count ?? 0) > 0) acreditacionesActualizadas++;
    }
    return { vinculados, acreditacionesActualizadas };
  }

  // KPIs y desglose de los últimos `dias` (desde el espejo local, todas las cuentas).
  async resumen(dias = 30) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data } = await this.db
      .from('mp_pagos')
      .select('cuenta, estado, tipo, bruto, comision, neto, liberado, liberacion_en, aprobado_en')
      .gte('creado_en_mp', desde)
      .limit(10000);
    const filas = ((data ?? []) as any[]).filter((f) => f.estado === 'approved');

    const suma = (sel: (f: any) => number) => Math.round(filas.reduce((s, f) => s + sel(f), 0));
    const porLiberar = filas.filter((f) => !f.liberado);
    const porTipo = new Map<string, { bruto: number; cantidad: number }>();
    const porCuenta = new Map<string, { bruto: number; cantidad: number }>();
    for (const f of filas) {
      const k = f.tipo ?? 'otro';
      const acc = porTipo.get(k) ?? { bruto: 0, cantidad: 0 };
      acc.bruto += Number(f.bruto);
      acc.cantidad++;
      porTipo.set(k, acc);
      const c = f.cuenta ?? 'principal';
      const accC = porCuenta.get(c) ?? { bruto: 0, cantidad: 0 };
      accC.bruto += Number(f.bruto);
      accC.cantidad++;
      porCuenta.set(c, accC);
    }
    const proximas = porLiberar
      .filter((f) => f.liberacion_en)
      .reduce((m: Map<string, number>, f) => {
        const dia = String(f.liberacion_en).slice(0, 10);
        m.set(dia, (m.get(dia) ?? 0) + Number(f.neto));
        return m;
      }, new Map<string, number>());

    return {
      periodo: `${dias} días`,
      cobros: filas.length,
      bruto: suma((f) => Number(f.bruto)),
      comision: suma((f) => Number(f.comision)),
      neto: suma((f) => Number(f.neto)),
      comisionPromedioPct: filas.length
        ? Math.round((filas.reduce((s, f) => s + Number(f.comision), 0) / Math.max(1, filas.reduce((s, f) => s + Number(f.bruto), 0))) * 1000) / 10
        : 0,
      liberado: suma((f) => (f.liberado ? Number(f.neto) : 0)),
      porLiberar: Math.round(porLiberar.reduce((s, f) => s + Number(f.neto), 0)),
      porTipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, bruto: Math.round(v.bruto), cantidad: v.cantidad })),
      porCuenta: [...porCuenta.entries()].map(([cuenta, v]) => ({ cuenta, bruto: Math.round(v.bruto), cantidad: v.cantidad })),
      proximasLiberaciones: [...proximas.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(0, 10)
        .map(([fecha, neto]) => ({ fecha, neto: Math.round(neto) })),
    };
  }

  // Listado para el panel.
  async pagos(dias = 30) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    const { data } = await this.db
      .from('mp_pagos')
      .select('id, cuenta, estado, tipo, medio, cuotas, bruto, comision, neto, liberado, liberacion_en, aprobado_en, descripcion, referencia_externa, pago_id, venta_id')
      .gte('creado_en_mp', desde)
      .order('creado_en_mp', { ascending: false })
      .limit(300);
    return data ?? [];
  }

  // Link de pago: cobra a distancia (WhatsApp, teléfono). Con sucursalId usa la
  // cuenta de ESA sucursal; sin él, la cuenta principal.
  async crearLink(dto: { monto: number; concepto?: string; sucursalId?: string }) {
    let cuenta: CuentaMP | null = null;
    if (dto.sucursalId) {
      cuenta = await cuentaDeSucursal(this.db, dto.sucursalId);
      if (!cuenta) throw new BadRequestException('Esa sucursal no tiene cuenta de Mercado Pago vinculada');
    } else {
      cuenta = (await cuentasMP(this.db)).find((c) => c.slug === 'principal') ?? (await cuentasMP(this.db))[0] ?? null;
      if (!cuenta) throw new BadRequestException('Mercado Pago no está vinculado (faltan credenciales)');
    }
    const monto = Math.round(Number(dto.monto) * 100) / 100;
    if (!Number.isFinite(monto) || monto <= 0) throw new BadRequestException('Monto inválido');
    if (monto > 5_000_000) throw new BadRequestException('Monto demasiado alto para un link de pago');
    const concepto = (dto.concepto ?? '').trim() || 'Compra O.D.B Premium Market';
    const r = await fetchConTimeout(`${MP}/checkout/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cuenta.token}` },
      body: JSON.stringify({
        items: [{ title: concepto, quantity: 1, unit_price: monto, currency_id: 'ARS' }],
        external_reference: `LINK-${Date.now()}`,
        statement_descriptor: 'O.D.B',
      }),
    });
    const d: any = await r.json();
    if (!r.ok) throw new BadRequestException(d?.message ?? 'MP no pudo crear el link');
    this.log.log(`link de pago creado (${cuenta.slug}): $${monto} (${concepto})`);
    return { url: d.init_point, monto, concepto, cuenta: cuenta.slug };
  }
}
