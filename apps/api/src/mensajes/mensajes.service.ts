import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { NotificarService } from './notificar.service';

const ETIQUETA: Record<string, string> = {
  devolucion: 'devolución',
  consulta: 'consulta',
  pedido: 'pedido especial',
  reclamo: 'reclamo',
};

export type ResponderDto = { estado?: string; respuesta?: string };
export type EnviarDto = {
  destino: 'cliente' | 'segmento' | 'todos';
  clienteId?: string;
  segmento?: string;
  titulo: string;
  cuerpo: string;
};

@Injectable()
export class MensajesService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly notificar: NotificarService,
  ) {}

  // ---------- Bandeja de solicitudes (cliente -> negocio) ----------
  async solicitudes(filtros: { estado?: string; tipo?: string }) {
    let q = this.db
      .from('solicitudes')
      .select('*, cliente:clientes(nombre, dni, tipo)')
      .order('creado_en', { ascending: false })
      .limit(200);
    if (filtros.estado) q = q.eq('estado', filtros.estado);
    if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async responder(id: string, dto: ResponderDto, usuarioId?: string) {
    const { data: sol, error: e1 } = await this.db
      .from('solicitudes')
      .select('cliente_id, tipo')
      .eq('id', id)
      .single();
    if (e1 || !sol) throw new BadRequestException('No existe la solicitud');

    const patch: any = { actualizado_en: new Date().toISOString() };
    if (dto.estado) patch.estado = dto.estado;
    if (dto.respuesta != null && dto.respuesta.trim()) {
      patch.respuesta = dto.respuesta.trim();
      patch.respondido_por = usuarioId ?? null;
      patch.respondido_en = new Date().toISOString();
    }
    const { error } = await this.db.from('solicitudes').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);

    if (patch.respuesta) {
      await this.notificar.aCliente(
        sol.cliente_id,
        `Respondimos tu ${ETIQUETA[sol.tipo] ?? 'mensaje'}`,
        patch.respuesta,
        'solicitud',
      );
    }
    return { ok: true };
  }

  // ---------- Envío manual (negocio -> cliente) ----------
  async enviar(dto: EnviarDto) {
    if (!dto.titulo?.trim() || !dto.cuerpo?.trim()) {
      throw new BadRequestException('Faltan título y cuerpo del mensaje');
    }
    let ids: string[] = [];
    if (dto.destino === 'cliente') {
      if (!dto.clienteId) throw new BadRequestException('Falta el cliente');
      ids = [dto.clienteId];
    } else {
      // segmento o todos: respetamos el opt-out de marketing
      let q = this.db.from('clientes').select('id').neq('acepta_marketing', false);
      if (dto.destino === 'segmento') {
        if (!dto.segmento) throw new BadRequestException('Falta el segmento');
        q = q.eq('tipo', dto.segmento);
      }
      const { data, error } = await q.limit(5000);
      if (error) throw new BadRequestException(error.message);
      ids = (data ?? []).map((r: any) => r.id);
    }
    const enviados = await this.notificar.aClientes(ids, dto.titulo.trim(), dto.cuerpo.trim(), 'manual');
    return { enviados };
  }

  // ---------- Resumen / historial ----------
  async resumen() {
    const [abiertas, enProceso, totalSol, noLeidas, totalNotif] = await Promise.all([
      this.cuenta('solicitudes', (q) => q.eq('estado', 'abierta')),
      this.cuenta('solicitudes', (q) => q.eq('estado', 'en_proceso')),
      this.cuenta('solicitudes'),
      this.cuenta('notificaciones', (q) => q.eq('leida', false)),
      this.cuenta('notificaciones'),
    ]);
    const leidas = totalNotif - noLeidas;
    return {
      solicitudes: { abiertas, enProceso, total: totalSol },
      notificaciones: {
        total: totalNotif,
        noLeidas,
        leidas,
        pctLeidas: totalNotif > 0 ? Math.round((leidas / totalNotif) * 100) : 0,
      },
    };
  }

  async historial() {
    const { data, error } = await this.db
      .from('notificaciones')
      .select('id, titulo, cuerpo, tipo, leida, creado_en, cliente:clientes(nombre, dni)')
      .order('id', { ascending: false })
      .limit(80);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async segmentos() {
    const { data } = await this.db.from('clientes').select('tipo').neq('acepta_marketing', false);
    const conteo = new Map<string, number>();
    for (const r of (data ?? []) as any[]) {
      const t = r.tipo ?? 'sin_segmento';
      conteo.set(t, (conteo.get(t) ?? 0) + 1);
    }
    return [...conteo.entries()].map(([tipo, total]) => ({ tipo, total }));
  }

  private async cuenta(tabla: string, filtro?: (q: any) => any) {
    let q = this.db.from(tabla).select('id', { count: 'exact', head: true });
    if (filtro) q = filtro(q);
    const { count } = await q;
    return count ?? 0;
  }
}
