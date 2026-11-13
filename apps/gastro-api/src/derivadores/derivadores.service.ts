import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { fechaArt, limitesDeMes, linkWhatsapp, mesActual } from '../lib/fechas';
import { leerTodo } from '../lib/leer-todo';

export const TIPOS = ['hotel', 'guia', 'agencia', 'remis', 'otro'] as const;
export type TipoDerivador = (typeof TIPOS)[number];

export type DerivadorInput = {
  nombre: string;
  tipo?: TipoDerivador;
  contacto?: string | null;
  telefono?: string | null;
  comisionPct?: number;
  codigo?: string;
  activo?: boolean;
  notas?: string | null;
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreDeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;

function aCodigo(texto: string) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Hoteles, guías, agencias y remises que mandan gente. Cada uno tiene un
// código: va en su QR y en su link (/r/<código>). La mesa que el encargado
// sienta «por» uno de ellos queda anotada, y de ahí sale la comisión del mes.
@Injectable()
export class DerivadoresService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private validarMes(mes: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new BadRequestException('El mes va como AAAA-MM');
  }

  private async visitasDelMes(mes: string, derivadorId?: string) {
    const { desde, hasta } = limitesDeMes(mes);
    return leerTodo<any>(() => {
      let q = this.db
        .from('mesa_ciclos')
        .select('id, derivador_id, monto, cubiertos, libre_en, mesa:mesas(numero)')
        .eq('estado', 'libre')
        .not('derivador_id', 'is', null)
        .gte('libre_en', desde.toISOString())
        .lte('libre_en', hasta.toISOString())
        .order('libre_en', { ascending: false });
      if (derivadorId) q = q.eq('derivador_id', derivadorId);
      return q;
    });
  }

  private resumir(d: any, visitas: any[], liquidacion: any | null) {
    const ventas = visitas.reduce((s, v) => s + Number(v.monto ?? 0), 0);
    const pct = Number(d.comision_pct ?? 0);
    return {
      id: d.id, nombre: d.nombre, tipo: d.tipo as TipoDerivador, contacto: d.contacto, telefono: d.telefono,
      comisionPct: pct, codigo: d.codigo, activo: d.activo, notas: d.notas,
      mesas: visitas.length,
      cubiertos: visitas.reduce((s, v) => s + (v.cubiertos ?? 0), 0),
      ventas,
      comision: Math.round((ventas * pct) / 100),
      liquidacion: liquidacion ? { monto: Number(liquidacion.monto), pagadoEn: liquidacion.pagado_en, nota: liquidacion.nota } : null,
    };
  }

  async listar(mes = mesActual()) {
    this.validarMes(mes);
    const [ders, liqs, visitas] = await Promise.all([
      this.db.from('derivadores').select('*').order('nombre'),
      this.db.from('derivador_liquidaciones').select('*').eq('mes', mes),
      this.visitasDelMes(mes),
    ]);
    if (ders.error) throw new BadRequestException(ders.error.message);
    if (liqs.error) throw new BadRequestException(liqs.error.message);
    const filas = (ders.data ?? []).map((d: any) =>
      this.resumir(d, visitas.filter((v) => v.derivador_id === d.id), (liqs.data ?? []).find((l: any) => l.derivador_id === d.id) ?? null),
    );
    return {
      mes,
      derivadores: filas.sort((a, b) => b.ventas - a.ventas),
      total: {
        mesas: filas.reduce((s, f) => s + f.mesas, 0),
        cubiertos: filas.reduce((s, f) => s + f.cubiertos, 0),
        ventas: filas.reduce((s, f) => s + f.ventas, 0),
        comision: filas.reduce((s, f) => s + f.comision, 0),
        pagado: filas.reduce((s, f) => s + (f.liquidacion?.monto ?? 0), 0),
      },
    };
  }

  private async obtener(id: string) {
    const { data, error } = await this.db.from('derivadores').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese hotel, guía o agencia');
    return data;
  }

  async detalle(id: string, mes = mesActual()) {
    this.validarMes(mes);
    const d = await this.obtener(id);
    const [visitas, liqs] = await Promise.all([
      this.visitasDelMes(mes, id),
      this.db.from('derivador_liquidaciones').select('*').eq('derivador_id', id).order('mes', { ascending: false }),
    ]);
    if (liqs.error) throw new BadRequestException(liqs.error.message);
    const pct = Number(d.comision_pct ?? 0);
    return {
      mes,
      ...this.resumir(d, visitas, (liqs.data ?? []).find((l: any) => l.mes === mes) ?? null),
      visitas: visitas.map((v) => ({
        id: v.id, fecha: fechaArt(v.libre_en), mesaNumero: v.mesa?.numero ?? null, cubiertos: v.cubiertos ?? null,
        monto: Number(v.monto ?? 0), comision: Math.round((Number(v.monto ?? 0) * pct) / 100),
      })),
      pagosAnteriores: (liqs.data ?? []).map((l: any) => ({ mes: l.mes, monto: Number(l.monto), pagadoEn: l.pagado_en, nota: l.nota })),
    };
  }

  async crear(input: DerivadorInput) {
    if (!input.nombre?.trim()) throw new BadRequestException('Falta el nombre');
    if (input.tipo && !TIPOS.includes(input.tipo)) throw new BadRequestException('Tipo desconocido');
    const pct = Number(input.comisionPct ?? 0);
    if (!(pct >= 0 && pct <= 50)) throw new BadRequestException('La comisión va entre 0 y 50 %');
    const codigo = aCodigo(input.codigo || input.nombre);
    if (!codigo) throw new BadRequestException('No se pudo armar el código del link: poné uno a mano');
    const { data, error } = await this.db
      .from('derivadores')
      .insert({
        nombre: input.nombre.trim(), tipo: input.tipo ?? 'hotel', contacto: input.contacto?.trim() || null,
        telefono: input.telefono?.replace(/\D/g, '') || null, comision_pct: pct, codigo, notas: input.notas?.trim() || null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException(`Ya hay otro con el código «${codigo}». Cambiá el código.`);
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async actualizar(id: string, input: Partial<DerivadorInput>) {
    const fila: Record<string, any> = {};
    if (input.nombre !== undefined) fila.nombre = input.nombre.trim();
    if (input.tipo !== undefined) {
      if (!TIPOS.includes(input.tipo)) throw new BadRequestException('Tipo desconocido');
      fila.tipo = input.tipo;
    }
    if (input.contacto !== undefined) fila.contacto = input.contacto?.trim() || null;
    if (input.telefono !== undefined) fila.telefono = input.telefono?.replace(/\D/g, '') || null;
    if (input.comisionPct !== undefined) {
      const pct = Number(input.comisionPct);
      if (!(pct >= 0 && pct <= 50)) throw new BadRequestException('La comisión va entre 0 y 50 %');
      fila.comision_pct = pct;
    }
    if (input.activo !== undefined) fila.activo = input.activo;
    if (input.notas !== undefined) fila.notas = input.notas?.trim() || null;
    const { data, error } = await this.db.from('derivadores').update(fila).eq('id', id).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese hotel, guía o agencia');
    return data;
  }

  // Deja asentado que la comisión del mes se pagó. El monto se calcula acá,
  // con las ventas y el porcentaje de ese momento, y queda fijo.
  async pagarComision(id: string, mes: string, nota?: string) {
    this.validarMes(mes);
    const det = await this.detalle(id, mes);
    if (det.liquidacion) throw new BadRequestException('La comisión de ese mes ya figura pagada');
    if (det.comision <= 0) throw new BadRequestException('No hay comisión para pagar en ese mes');
    const { error } = await this.db.from('derivador_liquidaciones').insert({ derivador_id: id, mes, monto: det.comision, nota: nota?.trim() || null });
    if (error) throw new BadRequestException(error.message);
    return this.detalle(id, mes);
  }

  async deshacerPago(id: string, mes: string) {
    this.validarMes(mes);
    const { error } = await this.db.from('derivador_liquidaciones').delete().eq('derivador_id', id).eq('mes', mes);
    if (error) throw new BadRequestException(error.message);
    return this.detalle(id, mes);
  }

  // El resumen del mes para mandarle por WhatsApp al que trajo gente. No lo
  // manda solo: devuelve el link listo, un toque para abrir WhatsApp.
  async resumenWhatsapp(id: string, mes = mesActual()) {
    const det = await this.detalle(id, mes);
    const mensaje =
      `Hola${det.contacto ? ` ${det.contacto}` : ''}, te paso el resumen de ${nombreDeMes(mes)} con Gran Caminito:\n` +
      `• Mesas que mandaste: ${det.mesas} (${det.cubiertos} personas)\n` +
      `• Consumo: ${pesos(det.ventas)}\n` +
      `• Tu comisión (${det.comisionPct} %): ${pesos(det.comision)}` +
      (det.liquidacion ? ' — ya pagada' : '') +
      `\n¡Gracias por recomendarnos!`;
    return { mensaje, waLink: det.telefono ? linkWhatsapp(det.telefono, mensaje) : null };
  }

  // Lo que ve quien abre el link o escanea el QR del hotel o del guía.
  async publico(codigo: string) {
    const { data, error } = await this.db.from('derivadores').select('nombre, tipo, activo').eq('codigo', aCodigo(codigo)).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || !data.activo) throw new NotFoundException('Ese link ya no está activo');
    return { nombre: data.nombre, tipo: data.tipo };
  }

  async idPorCodigo(codigo?: string | null): Promise<string | null> {
    if (!codigo) return null;
    const { data } = await this.db.from('derivadores').select('id, activo').eq('codigo', aCodigo(codigo)).maybeSingle();
    return data?.activo ? data.id : null;
  }
}
