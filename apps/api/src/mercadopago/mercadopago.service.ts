import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
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

  // KPIs y desglose de los últimos `dias` (desde el espejo local).
  // `cuenta` filtra por empresa ('principal' | 'santa_ines'); sin él, las dos.
  async resumen(dias = 30, cuenta?: string) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    // PostgREST corta cada consulta en 1000 filas: se pagina hasta traer todo
    const todas: any[] = [];
    for (let d = 0; d < 20000; d += 1000) {
      let q = this.db
        .from('mp_pagos')
        .select('cuenta, estado, tipo, bruto, comision, neto, liberado, liberacion_en, aprobado_en, creado_en_mp')
        .gte('creado_en_mp', desde)
        .order('creado_en_mp', { ascending: false })
        .range(d, d + 999);
      if (cuenta) q = q.eq('cuenta', cuenta);
      const { data } = await q;
      todas.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const filas = todas.filter((f) => f.estado === 'approved');

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

    // cobros por día, apilados por cuenta (para el gráfico del panel)
    const porDia = new Map<string, { principal: number; santa_ines: number }>();
    for (let d = dias - 1; d >= 0; d--) {
      porDia.set(new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10), { principal: 0, santa_ines: 0 });
    }
    for (const f of filas) {
      const dia = String(f.creado_en_mp ?? '').slice(0, 10);
      const acc = porDia.get(dia);
      if (!acc) continue;
      if (f.cuenta === 'santa_ines') acc.santa_ines += Number(f.bruto);
      else acc.principal += Number(f.bruto);
    }

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
      porCuenta: [...porCuenta.entries()].map(([c, v]) => ({ cuenta: c, bruto: Math.round(v.bruto), cantidad: v.cantidad })),
      porDia: [...porDia.entries()].map(([fecha, v]) => ({ fecha, principal: Math.round(v.principal), santa_ines: Math.round(v.santa_ines) })),
      proximasLiberaciones: [...proximas.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(0, 10)
        .map(([fecha, neto]) => ({ fecha, neto: Math.round(neto) })),
    };
  }

  // Listado para el panel.
  async pagos(dias = 30, cuenta?: string) {
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    let q = this.db
      .from('mp_pagos')
      .select('id, cuenta, estado, tipo, medio, cuotas, bruto, comision, neto, liberado, liberacion_en, aprobado_en, descripcion, referencia_externa, pago_id, venta_id')
      .gte('creado_en_mp', desde)
      .order('creado_en_mp', { ascending: false })
      .limit(300);
    if (cuenta) q = q.eq('cuenta', cuenta);
    const { data } = await q;
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

  // ───────────── Cobro con QR integrado (2026-09-08) ─────────────
  // ANTES la caja registraba la venta apenas se tocaba "Cobrar" con Mercado Pago
  // y el cliente tenía que tipear el importe en el QR fijo. AHORA la caja manda
  // el importe exacto al QR de SU caja en MP (orden "atribuida"): el cliente
  // escanea el mismo QR del mostrador, ve $X cargado y paga; la venta se registra
  // recién cuando MP confirma el pago aprobado.

  // Las cajas (POS) con QR de la cuenta de MP que usa una sucursal.
  async cajasQR(sucursalId: string) {
    const cuenta = await cuentaDeSucursal(this.db, sucursalId);
    if (!cuenta) return { vinculado: false, cajas: [] as any[] };
    const r = await fetchConTimeout(`${MP}/pos?limit=50`, { headers: { Authorization: `Bearer ${cuenta.token}` } });
    if (!r.ok) throw new BadRequestException(`Mercado Pago respondió ${r.status} al listar las cajas`);
    const d: any = await r.json();
    const cajas = ((d.results ?? []) as any[])
      .filter((p) => p.status !== 'inactive')
      .map((p) => ({ id: String(p.id), nombre: String(p.name ?? '').trim(), externalId: p.external_id ?? null, conQr: !!p.qr }));
    return { vinculado: true, cuenta: cuenta.slug, cajas };
  }

  // Vincula una caja de ODB con una caja/QR de MP (por id de MP). Si ese QR no
  // tiene identificador externo (MP lo exige para direccionar órdenes), se lo asigna.
  async vincularCajaQR(cajaId: string, posId: string | null) {
    const { data: caja } = await this.db.from('cajas').select('id, sucursal_id').eq('id', cajaId).maybeSingle();
    if (!caja) throw new BadRequestException('Caja inexistente');
    if (!posId) {
      await this.db.from('cajas').update({ mp_external_pos_id: null }).eq('id', cajaId);
      return { ok: true, externalId: null };
    }
    const cuenta = await cuentaDeSucursal(this.db, caja.sucursal_id);
    if (!cuenta) throw new BadRequestException('Esta sucursal no tiene Mercado Pago vinculado');
    const { cajas } = await this.cajasQR(caja.sucursal_id);
    const pos = cajas.find((c: any) => c.id === String(posId));
    if (!pos) throw new BadRequestException('Ese QR no pertenece a la cuenta de Mercado Pago de la sucursal');
    let externalId: string = pos.externalId;
    if (!externalId) {
      externalId = `ODB${String(posId).replace(/\D/g, '')}`;
      const r = await fetchConTimeout(`${MP}/pos/${posId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cuenta.token}` },
        body: JSON.stringify({ external_id: externalId }),
      });
      if (!r.ok) throw new BadRequestException(`Mercado Pago no dejó identificar ese QR (${r.status})`);
    }
    await this.db.from('cajas').update({ mp_external_pos_id: externalId }).eq('id', cajaId);
    this.log.log(`caja ${cajaId} vinculada al QR de MP "${pos.nombre}" (${externalId})`);
    return { ok: true, externalId, nombre: pos.nombre };
  }

  private async userIdDe(cuenta: CuentaMP): Promise<string> {
    if (cuenta.userId) return cuenta.userId;
    const r = await fetchConTimeout(`${MP}/users/me`, { headers: { Authorization: `Bearer ${cuenta.token}` } });
    if (!r.ok) throw new BadRequestException(`Mercado Pago respondió ${r.status} (¿token vencido?)`);
    const me: any = await r.json();
    await this.db.from('sucursales').update({ mp_user_id: String(me.id) }).in('id', cuenta.sucursalIds);
    return String(me.id);
  }

  private urlOrden(userId: string, externalPosId: string) {
    return `${MP}/instore/qr/seller/collectors/${userId}/pos/${encodeURIComponent(externalPosId)}/orders`;
  }

  // Manda el importe al QR de la caja. Devuelve el id del cobro para consultar su estado.
  async iniciarCobroQR(dto: { cajaId: string; monto: number; detalle?: string; usuarioId?: string }) {
    const { data: caja } = await this.db
      .from('cajas')
      .select('id, nombre, sucursal_id, mp_external_pos_id')
      .eq('id', dto.cajaId)
      .maybeSingle();
    if (!caja) throw new BadRequestException('Caja inexistente');
    const cuenta = await cuentaDeSucursal(this.db, caja.sucursal_id);
    if (!cuenta) throw new BadRequestException({ codigo: 'sin_mp', message: 'Esta sucursal no tiene Mercado Pago vinculado' });
    if (!caja.mp_external_pos_id) {
      throw new BadRequestException({ codigo: 'sin_qr', message: 'Esta caja no tiene un QR de Mercado Pago asignado' });
    }
    const monto = Math.round(Number(dto.monto) * 100) / 100;
    if (!Number.isFinite(monto) || monto <= 0) throw new BadRequestException('Monto inválido');
    if (monto > 5_000_000) throw new BadRequestException('Monto demasiado alto para cobrar por QR');
    const userId = await this.userIdDe(cuenta);
    const ahora = new Date().toISOString();
    // Un cobro pendiente anterior de esta caja quedó colgado (cerraron la ventana): se da por cancelado.
    await this.db.from('mp_cobros').update({ estado: 'cancelado', resuelto_en: ahora }).eq('caja_id', caja.id).eq('estado', 'pendiente');
    const referencia = `ODB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const { data: cobro, error } = await this.db
      .from('mp_cobros')
      .insert({
        caja_id: caja.id,
        sucursal_id: caja.sucursal_id,
        cuenta: cuenta.slug,
        external_pos_id: caja.mp_external_pos_id,
        referencia,
        monto,
        usuario_id: dto.usuarioId ?? null,
      })
      .select('id')
      .single();
    if (error || !cobro) throw new BadRequestException(`No se pudo registrar el cobro: ${error?.message ?? 'sin datos'}`);
    const detalle = (dto.detalle ?? '').trim() || 'Compra en mostrador';
    const r = await fetchConTimeout(this.urlOrden(userId, caja.mp_external_pos_id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cuenta.token}` },
      body: JSON.stringify({
        external_reference: referencia,
        title: 'O.D.B Premium Market',
        description: detalle,
        total_amount: monto,
        items: [
          {
            sku_number: 'VENTA',
            category: 'marketplace',
            title: 'Compra en O.D.B Premium Market',
            description: detalle,
            unit_price: monto,
            quantity: 1,
            unit_measure: 'unit',
            total_amount: monto,
          },
        ],
      }),
    });
    if (!r.ok) {
      const texto = (await r.text().catch(() => '')).slice(0, 200);
      await this.db.from('mp_cobros').update({ estado: 'fallido', resuelto_en: new Date().toISOString() }).eq('id', cobro.id);
      this.log.warn(`MP rechazó la orden al QR ${caja.mp_external_pos_id}: ${r.status} ${texto}`);
      throw new BadRequestException(`Mercado Pago no aceptó el cobro (${r.status}). ${texto}`);
    }
    this.log.log(`cobro QR iniciado (${cuenta.slug}/${caja.mp_external_pos_id}): $${monto} ref ${referencia}`);
    return { cobroId: cobro.id, referencia, monto, caja: caja.nombre, qr: caja.mp_external_pos_id };
  }

  // Estado del cobro: consulta a MP por la referencia hasta encontrar el pago aprobado.
  async estadoCobroQR(id: string) {
    const { data: c } = await this.db.from('mp_cobros').select('*').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('Cobro inexistente');
    const monto = Number(c.monto);
    if (c.estado !== 'pendiente') return { estado: c.estado, mpPaymentId: c.mp_payment_id, monto };
    const cuenta = (await cuentasMP(this.db)).find((x) => x.slug === c.cuenta);
    if (!cuenta) return { estado: 'pendiente', monto };
    const r = await fetchConTimeout(
      `${MP}/v1/payments/search?external_reference=${encodeURIComponent(c.referencia)}&sort=date_created&criteria=desc`,
      { headers: { Authorization: `Bearer ${cuenta.token}` } },
    );
    let aviso: string | undefined;
    if (r.ok) {
      const d: any = await r.json();
      const pagos: any[] = d.results ?? [];
      const aprobado = pagos.find((p) => p.status === 'approved');
      if (aprobado) {
        await this.db
          .from('mp_cobros')
          .update({ estado: 'aprobado', mp_payment_id: String(aprobado.id), resuelto_en: new Date().toISOString() })
          .eq('id', id)
          .eq('estado', 'pendiente');
        this.log.log(`cobro QR aprobado ref ${c.referencia}: pago ${aprobado.id} ($${aprobado.transaction_amount})`);
        return {
          estado: 'aprobado',
          mpPaymentId: String(aprobado.id),
          monto,
          medio: aprobado.payment_method_id ?? null,
          tipo: aprobado.payment_type_id ?? null,
        };
      }
      if (pagos.some((p) => p.status === 'rejected')) aviso = 'Un intento de pago fue rechazado; el cliente puede volver a intentar.';
    }
    if (Date.now() - new Date(c.creado_en).getTime() > 10 * 60_000) {
      await this.cancelarCobroQR(id, 'vencido');
      return { estado: 'vencido', monto };
    }
    return { estado: 'pendiente', monto, aviso };
  }

  // Cancela el cobro: borra la orden del QR (solo si sigue siendo la nuestra) y lo marca.
  async cancelarCobroQR(id: string, estado: 'cancelado' | 'vencido' = 'cancelado') {
    const { data: c } = await this.db.from('mp_cobros').select('*').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('Cobro inexistente');
    if (c.estado !== 'pendiente') return { estado: c.estado };
    const cuenta = (await cuentasMP(this.db)).find((x) => x.slug === c.cuenta);
    if (cuenta) {
      try {
        const userId = await this.userIdDe(cuenta);
        const url = this.urlOrden(userId, c.external_pos_id);
        const g = await fetchConTimeout(url, { headers: { Authorization: `Bearer ${cuenta.token}` } });
        if (g.ok) {
          const o: any = await g.json().catch(() => null);
          if (o?.external_reference === c.referencia) {
            await fetchConTimeout(url, { method: 'DELETE', headers: { Authorization: `Bearer ${cuenta.token}` } });
          }
        }
      } catch (e: any) {
        this.log.warn(`no se pudo borrar la orden del QR ${c.external_pos_id}: ${e?.message ?? e}`);
      }
    }
    await this.db.from('mp_cobros').update({ estado, resuelto_en: new Date().toISOString() }).eq('id', id).eq('estado', 'pendiente');
    return { estado };
  }

  // Cuando la venta ya quedó registrada: el cobro y el pago de MP apuntan a ella.
  // También se le graba al renglón de pago el id de la operación de MP: sin eso,
  // si después hay que devolver la plata (el cliente cambia el medio de pago),
  // no hay a qué pago pedirle el reembolso hasta que corra el importador.
  async vincularCobroAVenta(id: string, ventaId: string) {
    const { data: c } = await this.db.from('mp_cobros').select('id, mp_payment_id, estado').eq('id', id).maybeSingle();
    if (!c) throw new BadRequestException('Cobro inexistente');
    await this.db.from('mp_cobros').update({ venta_id: ventaId }).eq('id', id);
    if (c.mp_payment_id) {
      await this.db.from('mp_pagos').update({ venta_id: ventaId }).eq('id', c.mp_payment_id).is('venta_id', null);
      await this.db
        .from('pagos')
        .update({ mp_payment_id: String(c.mp_payment_id) })
        .eq('venta_id', ventaId)
        .eq('medio', 'mercadopago')
        .is('mp_payment_id', null);
    }
    return { ok: true };
  }

  // El pago de Mercado Pago de una venta, con su importe real en MP. Mira
  // primero el renglón de pago (camino nuevo) y, para las ventas viejas que
  // todavía no lo tienen grabado, cae al cobro por QR de esa venta.
  async pagoMPDeVenta(ventaId: string): Promise<{ paymentId: string; cuenta: string; monto: number } | null> {
    const { data: pago } = await this.db
      .from('pagos')
      .select('mp_payment_id, monto')
      .eq('venta_id', ventaId)
      .eq('medio', 'mercadopago')
      .not('mp_payment_id', 'is', null)
      .maybeSingle();
    const { data: cobro } = await this.db
      .from('mp_cobros')
      .select('mp_payment_id, cuenta, monto')
      .eq('venta_id', ventaId)
      .eq('estado', 'aprobado')
      .maybeSingle();
    const paymentId = (pago as any)?.mp_payment_id ?? (cobro as any)?.mp_payment_id;
    if (!paymentId) return null;
    // la cuenta sale del cobro; si la venta es vieja y no lo tiene, se busca por sucursal
    let cuenta = (cobro as any)?.cuenta as string | undefined;
    if (!cuenta) {
      const { data: venta } = await this.db.from('ventas').select('sucursal_id').eq('id', ventaId).maybeSingle();
      const c = venta ? await cuentaDeSucursal(this.db, (venta as any).sucursal_id) : null;
      cuenta = c?.slug;
    }
    if (!cuenta) return null;
    return {
      paymentId: String(paymentId),
      cuenta,
      monto: Number((pago as any)?.monto ?? (cobro as any)?.monto ?? 0),
    };
  }

  // Devuelve la plata de un pago de QR. Con `monto` hace un reembolso parcial.
  // MP es idempotente por X-Idempotency-Key: reintentar no devuelve dos veces.
  async reembolsar(paymentId: string, monto?: number, cuentaSlug?: string) {
    const cuentas = await cuentasMP(this.db);
    const cuenta = cuentaSlug ? cuentas.find((c) => c.slug === cuentaSlug) : cuentas[0];
    if (!cuenta) throw new BadRequestException('No hay credenciales de Mercado Pago para devolver el pago');
    const cuerpo = monto && monto > 0 ? JSON.stringify({ amount: Math.round(monto * 100) / 100 }) : '{}';
    const r = await fetchConTimeout(`${MP}/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cuenta.token}`,
        'X-Idempotency-Key': `odb-refund-${paymentId}-${monto ?? 'total'}`,
      },
      body: cuerpo,
    });
    const texto = await r.text().catch(() => '');
    if (!r.ok) {
      this.log.warn(`MP rechazó el reembolso del pago ${paymentId}: ${r.status} ${texto.slice(0, 200)}`);
      throw new BadRequestException(
        `Mercado Pago no pudo devolver el pago (${r.status}). ${texto.slice(0, 200)}`,
      );
    }
    let d: any = null;
    try { d = JSON.parse(texto); } catch {}
    this.log.log(`reembolso MP del pago ${paymentId}: ${d?.id ?? 'sin id'} (${d?.status ?? 'sin estado'})`);
    return { refundId: d?.id ? String(d.id) : null, estado: d?.status ?? 'approved', monto: Number(d?.amount ?? monto ?? 0) };
  }
}
