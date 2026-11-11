import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { armarLista, compararListas, csvItegra, foto, nombreArchivo, type CambioBalanza, type FilaBalanza, type FotoItem } from './itegra';

// Cada bajada queda en auditoría con la lista completa de ese momento: así la
// pantalla sabe qué cambió desde la última vez que se cargó en iTegra.
const ACCION_BAJADA = 'balanza_lista_bajada';

export type UltimaBajada = { fecha: string; quien: string | null; modo: 'completo' | 'cambios'; cantidad: number };

@Injectable()
export class BalanzasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  private async filas(): Promise<FilaBalanza[] | null> {
    const { data, error } = await this.db.rpc('balanza_lista');
    if (error) {
      // sin db/migracion-balanzas.sql aplicada: la pantalla lo dice y no se cae
      if (/balanza_lista|function|does not exist|schema cache/i.test(error.message)) return null;
      throw new BadRequestException(error.message);
    }
    return (data ?? []) as FilaBalanza[];
  }

  private async ultima(): Promise<{ bajada: UltimaBajada; foto: FotoItem[] } | null> {
    const { data } = await this.db.from('auditoria')
      .select('usuario_id, creado_en, datos_despues')
      .eq('accion', ACCION_BAJADA).eq('entidad', 'balanzas')
      .order('creado_en', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const d: any = (data as any).datos_despues ?? {};
    let quien: string | null = null;
    if ((data as any).usuario_id) {
      const { data: u } = await this.db.from('usuarios').select('nombre').eq('id', (data as any).usuario_id).maybeSingle();
      quien = (u as any)?.nombre ?? null;
    }
    return {
      bajada: { fecha: (data as any).creado_en, quien, modo: d.modo === 'cambios' ? 'cambios' : 'completo', cantidad: Number(d.cantidad) || 0 },
      foto: Array.isArray(d.items) ? d.items : [],
    };
  }

  async lista() {
    const filas = await this.filas();
    if (!filas) return { faltaMigracion: true, items: [], problemas: [], cambios: [], ultima: null, resumen: { total: 0, porPeso: 0, porUnidad: 0 } };
    const { items, problemas } = armarLista(filas);
    const ultima = await this.ultima();
    const cambios: CambioBalanza[] = ultima ? compararListas(foto(items), ultima.foto) : [];
    return {
      faltaMigracion: false,
      items,
      problemas,
      cambios,
      ultima: ultima?.bajada ?? null,
      resumen: {
        total: items.length,
        porPeso: items.filter((i) => i.tipo === 'P').length,
        porUnidad: items.filter((i) => i.tipo === 'N').length,
      },
    };
  }

  // modo 'cambios': solo las altas y lo que cambió de precio, nombre o tipo
  // desde la última bajada (las bajas no van: iTegra no borra al importar).
  async archivo(modo: 'completo' | 'cambios', usuarioId?: string) {
    const filas = await this.filas();
    if (!filas) throw new BadRequestException('Falta aplicar la migración de balanzas (db/migracion-balanzas.sql)');
    const { items } = armarLista(filas);
    let salen = items;
    if (modo === 'cambios') {
      const ultima = await this.ultima();
      if (!ultima) throw new BadRequestException('Todavía no se bajó la lista completa: bajá esa primero');
      const cambiados = new Set(compararListas(foto(items), ultima.foto).filter((c) => !c.cambios.includes('baja')).map((c) => c.plu));
      salen = items.filter((i) => cambiados.has(i.plu));
      if (!salen.length) throw new BadRequestException('No cambió nada desde la última vez');
    }
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: ACCION_BAJADA,
      entidad: 'balanzas',
      entidad_id: 'itegra',
      datos_despues: { modo, cantidad: salen.length, items: foto(items) },
    });
    return { csv: csvItegra(salen), nombre: nombreArchivo(modo), cantidad: salen.length };
  }

  // Un producto por unidad que sale con etiqueta de la balanza (la torta matera)
  async marcar(sku: string, enBalanza: boolean, usuarioId?: string) {
    const s = String(sku ?? '').trim();
    if (!s) throw new BadRequestException('Falta el producto');
    const { data: prod, error } = await this.db.from('productos').select('id, nombre, vendido_por_peso, en_balanza').eq('sku', s).maybeSingle();
    if (error) {
      if (/en_balanza/i.test(error.message)) throw new BadRequestException('Falta aplicar la migración de balanzas (db/migracion-balanzas.sql)');
      throw new BadRequestException(error.message);
    }
    if (!prod) throw new NotFoundException('No encontré ese producto');
    if ((prod as any).vendido_por_peso && enBalanza) return { ok: true, sku: s, enBalanza: true, porPeso: true };
    const { error: e2 } = await this.db.from('productos').update({ en_balanza: !!enBalanza }).eq('id', (prod as any).id);
    if (e2) throw new BadRequestException(e2.message);
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: 'balanza_producto',
      entidad: 'producto',
      entidad_id: (prod as any).id,
      datos_antes: { en_balanza: !!(prod as any).en_balanza },
      datos_despues: { en_balanza: !!enBalanza },
    }).then(() => null, () => null);
    return { ok: true, sku: s, enBalanza: !!enBalanza, porPeso: false };
  }
}
