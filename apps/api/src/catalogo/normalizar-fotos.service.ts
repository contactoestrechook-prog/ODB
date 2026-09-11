import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from './catalogo.service';
import { traerTodo } from '../comun/lotes';
import { recorrerConRitmo } from './ritmo';
import { normalizarFoto } from './normalizar-foto';

// Lleva las fotos YA guardadas a la misma medida y margen (ver
// normalizar-foto.ts). Las nuevas salen normalizadas desde el guardado; esto es
// para las que entraron antes. Antes de pisar cada una, guarda el original en
// el depósito privado productos-originales: si un recorte sale mal, se recupera.
@Injectable()
export class NormalizarFotosService {
  private readonly log = new Logger(NormalizarFotosService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient, private readonly catalogo: CatalogoService) {}

  async estado() {
    const [conFoto, hechas] = await Promise.all([
      this.db.from('productos').select('id', { count: 'exact', head: true }).eq('activo', true).eq('tiene_foto', true),
      this.db.from('fotos_normalizadas').select('sku', { count: 'exact', head: true }),
    ]);
    return { conFoto: conFoto.count ?? 0, normalizadas: hechas.count ?? 0 };
  }

  private async pendientes(): Promise<{ id: string; sku: string }[]> {
    const [productos, hechas] = await Promise.all([
      traerTodo<any>((d, h) => this.db.from('productos').select('id, sku').eq('activo', true).eq('tiene_foto', true).order('sku').range(d, h)),
      traerTodo<any>((d, h) => this.db.from('fotos_normalizadas').select('sku').range(d, h)),
    ]);
    const listas = new Set(hechas.map((x: any) => x.sku));
    return productos.filter((p: any) => !listas.has(p.sku));
  }

  private cola: { lista: { id: string; sku: string }[]; ts: number } | null = null;

  async normalizar(limite = 40) {
    if (!this.cola || !this.cola.lista.length || Date.now() - this.cola.ts > 15 * 60_000) {
      this.cola = { lista: await this.pendientes(), ts: Date.now() };
    }
    const lote = this.cola.lista.splice(0, Math.max(1, Math.min(Number(limite) || 40, 200)));
    const res = { procesadas: 0, recortadas: 0, errores: 0, faltan: this.cola.lista.length, detalleErrores: [] as string[] };

    const corrida = await recorrerConRitmo(lote, { paralelo: 6, espaciadoMs: 0 }, async (p) => {
      const nombre = `${p.sku}.jpg`;
      const { data, error } = await this.db.storage.from('productos').download(nombre);
      if (error || !data) throw new Error(`${p.sku}: no se pudo bajar (${error?.message ?? 'vacío'})`);
      const original = Buffer.from(await data.arrayBuffer());
      // copia de seguridad; si ya existe (corrida anterior), se deja la primera
      await this.db.storage.from('productos-originales').upload(nombre, original, { contentType: 'image/jpeg', upsert: false }).catch(() => null);
      const n = await normalizarFoto(original);
      const subida = await this.db.storage.from('productos').upload(nombre, n.buffer, { contentType: 'image/jpeg', upsert: true });
      if (subida.error) throw new Error(`${p.sku}: ${subida.error.message}`);
      await this.db.from('fotos_normalizadas').upsert({
        sku: p.sku, producto_id: p.id, ancho_original: n.original.ancho, alto_original: n.original.alto, recortada: n.recortada,
      });
      res.procesadas++;
      if (n.recortada) res.recortadas++;
    });
    res.errores = corrida.errores.length;
    res.detalleErrores = corrida.errores.slice(0, 10).map((e) => (e.error instanceof Error ? e.error.message : String(e.error)));
    if (res.procesadas) {
      this.catalogo.invalidarFotos();
      this.log.log(`Fotos normalizadas: ${res.procesadas} (faltan ${res.faltan})`);
    }
    return res;
  }
}
