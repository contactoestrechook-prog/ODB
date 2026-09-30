import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

type Idioma = 'es' | 'pt' | 'en';

// Mensaje corto para avisar que la mesa está por estar lista. Sin API de
// Meta (falta el alta) el envío es manual: el host toca el link de wa.me y
// WhatsApp Web/app abre con el mensaje ya escrito, un toque para mandarlo.
const MENSAJE_AVISO: Record<Idioma, (nombre: string) => string> = {
  es: (n) => `¡Hola ${n}! Tu mesa en Gran Caminito está casi lista 🍽 Volvé cuando puedas.`,
  pt: (n) => `Olá ${n}! Sua mesa no Gran Caminito está quase pronta 🍽 Volte quando puder.`,
  en: (n) => `Hi ${n}! Your table at Gran Caminito is almost ready 🍽 Come back when you can.`,
};

function linkWhatsapp(telefono: string, mensaje: string) {
  const numero = telefono.replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

@Injectable()
export class EsperaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db
      .from('lista_espera')
      .select('*')
      .in('estado', ['esperando', 'avisado'])
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async agregar(nombre: string, telefono: string, personas: number, idioma: Idioma = 'es') {
    const { data, error } = await this.db
      .from('lista_espera')
      .insert({ nombre, telefono, personas, idioma })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async obtener(id: string) {
    const { data, error } = await this.db.from('lista_espera').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No existe ese grupo en la lista de espera');
    return data;
  }

  // Marca "avisado" y devuelve el link de WhatsApp listo para tocar (no envía nada solo).
  async avisar(id: string) {
    const grupo = await this.obtener(id);
    const mensaje = MENSAJE_AVISO[grupo.idioma as Idioma](grupo.nombre);
    const { data, error } = await this.db
      .from('lista_espera')
      .update({ estado: 'avisado', avisado_en: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ...data, waLink: linkWhatsapp(grupo.telefono, mensaje), mensaje };
  }

  async sentar(id: string) {
    await this.obtener(id);
    const { data, error } = await this.db
      .from('lista_espera')
      .update({ estado: 'sentado', resuelto_en: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async abandono(id: string) {
    await this.obtener(id);
    const { data, error } = await this.db
      .from('lista_espera')
      .update({ estado: 'abandono', resuelto_en: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // La tasa de abandono del día: demanda perdida, medida de verdad.
  async resumenHoy() {
    const desde = new Date();
    desde.setUTCHours(0, 0, 0, 0);
    const { data, error } = await this.db.from('lista_espera').select('estado').gte('creado_en', desde.toISOString());
    if (error) throw new BadRequestException(error.message);
    const filas = data ?? [];
    const resueltos = filas.filter((f: any) => f.estado === 'sentado' || f.estado === 'abandono');
    const abandonos = filas.filter((f: any) => f.estado === 'abandono').length;
    return {
      total: filas.length,
      abandonos,
      tasaAbandono: resueltos.length ? Math.round((abandonos / resueltos.length) * 100) : null,
    };
  }
}
