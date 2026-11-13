import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { PisoService } from '../piso/piso.service';
import { DerivadoresService } from '../derivadores/derivadores.service';
import { ART_H, fechaArt, limitesDeFecha, linkWhatsapp, sumarDias } from '../lib/fechas';

type Idioma = 'es' | 'pt' | 'en';
export type EstadoReserva = 'pendiente' | 'confirmada' | 'sentada' | 'no_vino' | 'cancelada';
const ORIGENES = ['salon', 'web', 'whatsapp', 'google', 'derivador'];

export type ReservaInput = {
  nombre: string;
  telefono?: string | null;
  personas: number;
  fecha: string; // 'AAAA-MM-DD' en hora de Argentina
  hora: string; // 'HH:MM'
  idioma?: Idioma;
  origen?: string;
  derivadorId?: string | null;
  senaMonto?: number | null;
  senaPagada?: boolean;
  notas?: string | null;
};

const horaArt = (isoUtc: string) => new Date(new Date(isoUtc).getTime() - ART_H * 3_600_000).toISOString().slice(11, 16);

const RECORDATORIO: Record<Idioma, (n: string, hora: string, personas: number) => string> = {
  es: (n, h, p) => `¡Hola ${n}! Te esperamos hoy a las ${h} en Gran Caminito, mesa para ${p}. ¿Nos confirmás que vienen? Si cambió algo, avisanos por acá.`,
  pt: (n, h, p) => `Olá ${n}! Esperamos vocês hoje às ${h} no Gran Caminito, mesa para ${p}. Pode confirmar a presença? Se algo mudou, é só avisar por aqui.`,
  en: (n, h, p) => `Hi ${n}! We're expecting you today at ${h} at Gran Caminito, table for ${p}. Could you confirm you're coming? If anything changed, just let us know here.`,
};

function aFechaHora(fecha: string, hora: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) throw new BadRequestException('Elegí el día de la reserva');
  if (!/^\d{2}:\d{2}$/.test(hora ?? '')) throw new BadRequestException('Elegí la hora de la reserva');
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, d, h + ART_H, min)).toISOString();
}

// Reservas, gente sin reserva y lista de espera en un solo lugar: la agenda
// del día que mira el anfitrión de la puerta.
@Injectable()
export class ReservasService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly piso: PisoService,
    private readonly derivadores: DerivadoresService,
  ) {}

  private mapear(r: any) {
    return {
      id: r.id, nombre: r.nombre, telefono: r.telefono, personas: r.personas,
      fechaHora: r.fecha_hora, fecha: fechaArt(r.fecha_hora), hora: horaArt(r.fecha_hora),
      idioma: r.idioma as Idioma, estado: r.estado as EstadoReserva, origen: r.origen,
      derivadorId: r.derivador_id, derivadorNombre: r.derivador?.nombre ?? null,
      mesaNumero: r.mesa?.numero ?? null,
      senaMonto: r.sena_monto != null ? Number(r.sena_monto) : null, senaPagada: !!r.sena_pagada,
      notas: r.notas, recordatorioEn: r.recordatorio_en,
    };
  }

  // Todo lo que pasa en la puerta en un día: reservas, espera y mesas libres.
  async agenda(fecha = fechaArt()) {
    const { desde, hasta } = limitesDeFecha(fecha);
    const [res, espera, mesas, abiertas] = await Promise.all([
      this.db
        .from('reservas')
        .select('*, derivador:derivadores(nombre), mesa:mesas(numero)')
        .gte('fecha_hora', desde.toISOString())
        .lte('fecha_hora', hasta.toISOString())
        .order('fecha_hora'),
      this.db.from('lista_espera').select('*').in('estado', ['esperando', 'avisado']).order('creado_en'),
      this.db.from('mesas').select('id, numero, sector').eq('activa', true).order('numero'),
      this.db.from('mesa_ciclos').select('mesa_id').neq('estado', 'libre'),
    ]);
    if (res.error) throw new BadRequestException(res.error.message);
    if (espera.error) throw new BadRequestException(espera.error.message);
    if (mesas.error) throw new BadRequestException(mesas.error.message);

    const reservas = (res.data ?? []).map((r: any) => this.mapear(r));
    const ocupadas = new Set((abiertas.data ?? []).map((c: any) => c.mesa_id));
    const vivas = reservas.filter((r) => r.estado === 'pendiente' || r.estado === 'confirmada');
    return {
      fecha,
      esHoy: fecha === fechaArt(),
      reservas,
      espera: (espera.data ?? []).map((e: any) => ({
        id: e.id, nombre: e.nombre, telefono: e.telefono, personas: e.personas, idioma: e.idioma, estado: e.estado,
        minutos: Math.round((Date.now() - new Date(e.creado_en).getTime()) / 60_000),
      })),
      mesasLibres: (mesas.data ?? []).filter((m: any) => !ocupadas.has(m.id)),
      resumen: {
        reservas: vivas.length,
        personas: vivas.reduce((s, r) => s + r.personas, 0),
        sinConfirmar: vivas.filter((r) => r.estado === 'pendiente').length,
        senasPendientes: vivas.filter((r) => r.senaMonto && !r.senaPagada).length,
        mesasLibres: (mesas.data ?? []).length - ocupadas.size,
        mesasTotal: (mesas.data ?? []).length,
      },
    };
  }

  // Cuántas reservas hay por día en los próximos días (para elegir el día).
  async proximosDias(dias = 7) {
    const hoy = fechaArt();
    const { desde } = limitesDeFecha(hoy);
    const { hasta } = limitesDeFecha(sumarDias(hoy, dias - 1));
    const { data, error } = await this.db
      .from('reservas')
      .select('fecha_hora, personas, estado')
      .gte('fecha_hora', desde.toISOString())
      .lte('fecha_hora', hasta.toISOString());
    if (error) throw new BadRequestException(error.message);
    return Array.from({ length: dias }, (_, i) => {
      const fecha = sumarDias(hoy, i);
      const delDia = (data ?? []).filter((r: any) => fechaArt(r.fecha_hora) === fecha && ['pendiente', 'confirmada'].includes(r.estado));
      return { fecha, reservas: delDia.length, personas: delDia.reduce((s: number, r: any) => s + r.personas, 0) };
    });
  }

  async crear(input: ReservaInput) {
    if (!input.nombre?.trim()) throw new BadRequestException('Falta el nombre');
    const personas = Number(input.personas);
    if (!(personas >= 1 && personas <= 80)) throw new BadRequestException('¿Para cuántas personas?');
    const fechaHora = aFechaHora(input.fecha, input.hora);
    const { data, error } = await this.db
      .from('reservas')
      .insert({
        nombre: input.nombre.trim(),
        telefono: input.telefono?.replace(/\D/g, '') || null,
        personas,
        fecha_hora: fechaHora,
        idioma: input.idioma ?? 'es',
        origen: ORIGENES.includes(input.origen ?? '') ? input.origen : 'salon',
        derivador_id: input.derivadorId || null,
        sena_monto: input.senaMonto ? Number(input.senaMonto) : null,
        sena_pagada: !!input.senaPagada,
        notas: input.notas?.trim() || null,
      })
      .select('*, derivador:derivadores(nombre), mesa:mesas(numero)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.mapear(data);
  }

  // Reserva que carga el cliente desde la web (o desde el link de un hotel).
  // Entra como "pendiente": la confirma alguien del salón.
  async crearPublica(body: { nombre: string; telefono: string; personas: number; fecha: string; hora: string; idioma?: Idioma; notas?: string; derivador?: string }) {
    const tel = (body.telefono ?? '').replace(/\D/g, '');
    if (tel.length < 8) throw new BadRequestException('Dejanos un WhatsApp para confirmarte la mesa');
    const fechaHora = aFechaHora(body.fecha, body.hora);
    if (new Date(fechaHora).getTime() < Date.now() - 10 * 60_000) throw new BadRequestException('Ese horario ya pasó');
    if (new Date(fechaHora).getTime() > Date.now() + 90 * 86_400_000) throw new BadRequestException('Reservamos hasta con 90 días de anticipación');
    if (Number(body.personas) > 12) throw new BadRequestException('Para más de 12 personas escribinos por WhatsApp y te armamos la mesa');
    const derivadorId = await this.derivadores.idPorCodigo(body.derivador);
    const reserva = await this.crear({
      nombre: body.nombre, telefono: tel, personas: body.personas, fecha: body.fecha, hora: body.hora,
      idioma: body.idioma, notas: body.notas, origen: derivadorId ? 'derivador' : 'web', derivadorId,
    });
    return { ok: true, fecha: reserva.fecha, hora: reserva.hora, personas: reserva.personas };
  }

  private async obtener(id: string) {
    const { data, error } = await this.db.from('reservas').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe esa reserva');
    return data;
  }

  async actualizar(id: string, input: Partial<ReservaInput>) {
    const actual = await this.obtener(id);
    const fila: Record<string, any> = {};
    if (input.nombre !== undefined) fila.nombre = input.nombre.trim();
    if (input.telefono !== undefined) fila.telefono = input.telefono?.replace(/\D/g, '') || null;
    if (input.personas !== undefined) fila.personas = Number(input.personas);
    if (input.fecha !== undefined || input.hora !== undefined) {
      fila.fecha_hora = aFechaHora(input.fecha ?? fechaArt(actual.fecha_hora), input.hora ?? horaArt(actual.fecha_hora));
    }
    if (input.idioma !== undefined) fila.idioma = input.idioma;
    if (input.derivadorId !== undefined) fila.derivador_id = input.derivadorId || null;
    if (input.senaMonto !== undefined) fila.sena_monto = input.senaMonto ? Number(input.senaMonto) : null;
    if (input.senaPagada !== undefined) fila.sena_pagada = !!input.senaPagada;
    if (input.notas !== undefined) fila.notas = input.notas?.trim() || null;
    const { data, error } = await this.db.from('reservas').update(fila).eq('id', id).select('*, derivador:derivadores(nombre), mesa:mesas(numero)').single();
    if (error) throw new BadRequestException(error.message);
    return this.mapear(data);
  }

  async cambiarEstado(id: string, estado: EstadoReserva) {
    if (!['pendiente', 'confirmada', 'no_vino', 'cancelada'].includes(estado)) throw new BadRequestException('Estado desconocido');
    const actual = await this.obtener(id);
    if (actual.estado === 'sentada') throw new BadRequestException('Esa reserva ya está sentada');
    const { data, error } = await this.db.from('reservas').update({ estado }).eq('id', id).select('*, derivador:derivadores(nombre), mesa:mesas(numero)').single();
    if (error) throw new BadRequestException(error.message);
    return this.mapear(data);
  }

  // Llegó la reserva: se abre la mesa en el Piso Vivo con su gente, su mozo y,
  // si vino por un hotel o guía, a nombre de quién.
  async sentar(id: string, mesaId: string, mozoId?: string) {
    const r = await this.obtener(id);
    if (r.estado === 'sentada') throw new BadRequestException('Esa reserva ya está sentada');
    if (!mesaId) throw new BadRequestException('Elegí la mesa');
    await this.piso.abrir(mesaId, r.personas, mozoId, r.derivador_id, r.id);
    const { data, error } = await this.db
      .from('reservas')
      .update({ estado: 'sentada', mesa_id: mesaId })
      .eq('id', id)
      .select('*, derivador:derivadores(nombre), mesa:mesas(numero)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.mapear(data);
  }

  // Mensaje de recordatorio en el idioma del cliente. No lo manda solo:
  // devuelve el link de WhatsApp listo y anota que se abrió.
  async recordatorio(id: string) {
    const r = await this.obtener(id);
    if (!r.telefono) throw new BadRequestException('Esta reserva no tiene teléfono');
    const mensaje = RECORDATORIO[(r.idioma as Idioma) ?? 'es'](r.nombre, horaArt(r.fecha_hora), r.personas);
    await this.db.from('reservas').update({ recordatorio_en: new Date().toISOString() }).eq('id', id);
    return { mensaje, waLink: linkWhatsapp(r.telefono, mensaje) };
  }
}
