import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class RepartosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar(dias = 7) {
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
    const { data, error } = await this.db
      .from('repartos')
      .select('id, numero, fecha, zona, estado, total_estimado, total_cobrado, salio_en, rendido_en, chofer:usuarios!repartos_chofer_id_fkey(nombre), paradas:repartos_paradas(estado, monto, cobrado)')
      .gte('fecha', desde)
      .order('numero', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r: any) => {
      const ps = r.paradas ?? [];
      return {
        ...r, paradas: undefined,
        totalParadas: ps.length,
        entregadas: ps.filter((p: any) => p.estado === 'entregado').length,
        estimado: ps.reduce((s: number, p: any) => s + Number(p.monto || 0), 0),
        cobrado: ps.reduce((s: number, p: any) => s + Number(p.cobrado || 0), 0),
      };
    });
  }

  // Numeración de la casa: primer dígito = día de la semana (lunes 1 … domingo
  // 7), después el orden del día arrancando en 0. El primer reparto de un
  // viernes es 50, el segundo 51; si un día hubiera 11, sería 510 — es el código
  // que el equipo ya usa de memoria para cuadrar la caja ("saqué el 51"), así
  // que el sistema habla en ese idioma y no al revés.
  async crear(b: { fecha?: string; choferId?: string; zona?: string; usuarioId?: string }) {
    const fecha = b.fecha || new Date().toISOString().slice(0, 10);
    // getUTCDay con fecha pura: 0=domingo → 7
    const diaJs = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    const dia = diaJs === 0 ? 7 : diaJs;
    const { count } = await this.db.from('repartos').select('id', { count: 'exact', head: true }).eq('fecha', fecha);
    const numero = Number(`${dia}${count ?? 0}`);

    const { data, error } = await this.db.from('repartos')
      .insert({ numero, fecha, chofer_id: b.choferId || null, zona: b.zona || null, creado_por: b.usuarioId || null })
      .select('id, numero').single();
    if (error) {
      // dos personas creando a la vez chocan en el número: se reintenta una vez
      if (error.code === '23505') {
        const { count: c2 } = await this.db.from('repartos').select('id', { count: 'exact', head: true }).eq('fecha', fecha);
        const { data: d2, error: e2 } = await this.db.from('repartos')
          .insert({ numero: Number(`${dia}${c2 ?? 0}`), fecha, chofer_id: b.choferId || null, zona: b.zona || null, creado_por: b.usuarioId || null })
          .select('id, numero').single();
        if (e2) throw new BadRequestException(e2.message);
        return d2;
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async detalle(id: string) {
    const { data: r, error } = await this.db.from('repartos')
      .select('*, chofer:usuarios!repartos_chofer_id_fkey(id, nombre)')
      .eq('id', id).single();
    if (error || !r) throw new BadRequestException('No existe el reparto');
    const { data: paradas } = await this.db.from('repartos_paradas')
      .select('*, cliente:clientes(nombre, razon_social, dni, domicilio, telefono, zona_reparto)')
      .eq('reparto_id', id).order('orden').order('creado_en');
    const ps = paradas ?? [];
    const totales = {
      estimado: ps.reduce((s, p: any) => s + Number(p.monto || 0), 0),
      cobrado: ps.reduce((s, p: any) => s + Number(p.cobrado || 0), 0),
      efectivo: ps.filter((p: any) => p.medio_pago === 'efectivo').reduce((s, p: any) => s + Number(p.cobrado || 0), 0),
      entregadas: ps.filter((p: any) => p.estado === 'entregado').length,
      noEntregadas: ps.filter((p: any) => ['no_estaba', 'rechazado'].includes(p.estado)).length,
      pendientes: ps.filter((p: any) => p.estado === 'pendiente').length,
    };
    return { ...r, paradas: ps, totales };
  }

  async agregarParada(id: string, b: { clienteId?: string; clienteNombre?: string; monto?: number }) {
    const { error } = await this.db.from('repartos_paradas').insert({
      reparto_id: id, cliente_id: b.clienteId || null, cliente_nombre: b.clienteNombre || null, monto: Number(b.monto) || 0,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Arma la ruta trayendo todos los clientes de una zona.
  async traerZona(id: string, zona: string) {
    if (!zona?.trim()) throw new BadRequestException('Indicá la zona');
    const { data: clientes } = await this.db.from('clientes')
      .select('id, nombre, razon_social, dni').eq('zona_reparto', zona).limit(200);
    const filas = (clientes ?? []).map((c: any) => ({ reparto_id: id, cliente_id: c.id, cliente_nombre: c.nombre ?? c.razon_social ?? c.dni, monto: 0 }));
    if (!filas.length) return { agregadas: 0 };
    const { error } = await this.db.from('repartos_paradas').insert(filas);
    if (error) throw new BadRequestException(error.message);
    return { agregadas: filas.length };
  }

  async marcarParada(pid: string, b: { estado?: string; cobrado?: number; medioPago?: string; observacion?: string }) {
    const patch: any = {};
    if (b.estado) patch.estado = b.estado;
    if (b.cobrado !== undefined) patch.cobrado = Number(b.cobrado) || 0;
    if (b.medioPago !== undefined) patch.medio_pago = b.medioPago || null;
    if (b.observacion !== undefined) patch.observacion = b.observacion || null;
    const { error } = await this.db.from('repartos_paradas').update(patch).eq('id', pid);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async cambiarEstado(id: string, estado: string, usuarioId?: string) {
    if (!['armado', 'en_calle', 'rendido'].includes(estado)) throw new BadRequestException('Estado inválido');
    const patch: any = { estado };
    if (estado === 'en_calle') patch.salio_en = new Date().toISOString();

    let resumenCtaCte: { deudas: number; cobros: number } | null = null;
    if (estado === 'rendido') {
      const d = await this.detalle(id);
      // rendir dos veces duplicaría deudas y cobros: se corta acá
      if (d.estado === 'rendido') throw new BadRequestException('Ese reparto ya está rendido');
      patch.rendido_en = new Date().toISOString();
      patch.total_estimado = Math.round(d.totales.estimado);
      patch.total_cobrado = Math.round(d.totales.cobrado);
      patch.efectivo = Math.round(d.totales.efectivo);
      resumenCtaCte = await this.aplicarRendicion(d, usuarioId);
    }

    const { error } = await this.db.from('repartos').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, ctaCte: resumenCtaCte ?? undefined };
  }

  // Lo que deja la rendición en las cuentas corrientes. Dos mitades con reglas
  // distintas, a propósito:
  // - Lo NO cobrado a un cliente de cuenta corriente se anota como DEUDA al
  //   instante: es el registro de que la mercadería quedó entregada sin pagar,
  //   y sin eso el "no pagó" del repartidor muere en la planilla.
  // - Lo COBRADO no baja la deuda solo: entra como "cobro a ingresar" y lo
  //   aprueba el dueño, el mismo circuito que la caja. La plata que viene de la
  //   calle pasa por la misma puerta que la del mostrador.
  private async aplicarRendicion(d: any, usuarioId?: string): Promise<{ deudas: number; cobros: number }> {
    const paradas = (d.paradas ?? []).filter((p: any) => p.cliente_id && p.estado === 'entregado');
    const resumen = { deudas: 0, cobros: 0 };
    if (!paradas.length) return resumen;

    const { data: clientes } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, cta_cte_habilitada')
      .in('id', paradas.map((p: any) => p.cliente_id));
    const conCta = new Map(((clientes ?? []) as any[]).filter((c) => c.cta_cte_habilitada).map((c) => [c.id, c]));

    for (const p of paradas) {
      const cliente = conCta.get(p.cliente_id);
      if (!cliente) continue;
      const monto = Number(p.monto) || 0;
      const cobrado = Number(p.cobrado) || 0;

      const debe = Math.round((monto - cobrado) * 100) / 100;
      if (debe > 0) {
        await this.db.from('cuenta_corriente').insert({
          cliente_id: p.cliente_id, concepto: `Reparto Nº ${d.numero}: entregado sin cobrar`, debe, haber: 0,
        });
        await this.db.rpc('sumar_saldo_cta_cte', { p_cliente: p.cliente_id, p_monto: debe }).then(
          (r: any) => r,
          // si la RPC no existe todavía, actualización directa (sin carrera real:
          // rendir es una acción de una persona)
          async () => this.db.from('clientes').select('saldo_cta_cte').eq('id', p.cliente_id).single()
            .then(({ data: c }) => this.db.from('clientes').update({ saldo_cta_cte: Number(c?.saldo_cta_cte ?? 0) + debe }).eq('id', p.cliente_id)),
        );
        resumen.deudas++;
      }

      if (cobrado > 0) {
        await this.db.from('cobranzas_pendientes').insert({
          cliente_id: p.cliente_id, monto: cobrado, medio: p.medio_pago || 'efectivo',
          nota: `Reparto Nº ${d.numero}${p.observacion ? ` · ${p.observacion}` : ''}`,
          cargada_por: usuarioId ?? null,
        });
        resumen.cobros++;
      }
    }

    if (resumen.deudas || resumen.cobros) {
      await this.db.from('alertas_internas').insert({
        para_usuario: null, tipo: 'cobranza',
        titulo: `Reparto Nº ${d.numero} rendido`,
        detalle: `${resumen.cobros} cobro(s) esperan tu aprobación en Clientes → Cobros a ingresar · ${resumen.deudas} entrega(s) quedaron anotadas como deuda.`,
        referencia: { repartoId: d.id },
      }).then(() => null, () => null);
    }
    return resumen;
  }

  async choferes() {
    const { data, error } = await this.db.from('usuarios').select('id, nombre, rol').in('rol', ['repartidor', 'cajero', 'deposito']).order('nombre');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async clientesZona(zona?: string) {
    let q = this.db.from('clientes').select('id, nombre, razon_social, dni, zona_reparto, dia_reparto').limit(50);
    if (zona) q = q.eq('zona_reparto', zona);
    const { data } = await q;
    return data ?? [];
  }

  // --- Flota en vivo ---
  async reportarPosicion(repartidorId: string, lat: number, lng: number, repartoId?: string) {
    if (!repartidorId) throw new BadRequestException('Falta el repartidor');
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) throw new BadRequestException('Ubicación inválida');
    const { error } = await this.db.from('repartidor_posicion').upsert({
      repartidor_id: repartidorId, lat: la, lng: ln, reparto_id: repartoId || null, actualizado_en: new Date().toISOString(),
    }, { onConflict: 'repartidor_id' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async flota() {
    const { data, error } = await this.db.from('repartidor_posicion')
      .select('lat, lng, actualizado_en, repartidor:usuarios(id, nombre), reparto:repartos(id, numero, zona, estado)');
    if (error) throw new BadRequestException(error.message);
    const { data: suc } = await this.db.from('sucursales').select('nombre, lat, lng').not('lat', 'is', null).order('nombre').limit(1).maybeSingle();
    const ahora = Date.now();
    const repartidores = (data ?? []).map((p: any) => ({
      id: p.repartidor?.id, nombre: p.repartidor?.nombre, lat: p.lat, lng: p.lng,
      reparto: p.reparto, hace_min: Math.round((ahora - new Date(p.actualizado_en).getTime()) / 60000),
      activo: (ahora - new Date(p.actualizado_en).getTime()) < 10 * 60000,
    }));
    return { central: suc ?? null, repartidores };
  }
}
