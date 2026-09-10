import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from './catalogo.service';
import { traerTodo } from '../comun/lotes';
import { recorrerConRitmo } from './ritmo';
import { INSTRUCCION, leerVeredicto, tipoDeImagen } from './calidad-fotos';

// Control de calidad de las fotos de la tienda: el modelo mira cada foto y la
// que no sirve se saca. Una foto casera (mesa de madera, una mano sosteniendo,
// la góndola de fondo) queda peor que no tener foto.
const MODELO = process.env.CALIDAD_FOTOS_MODELO ?? 'claude-haiku-4-5';
const PARALELO = Math.max(1, Math.min(Number(process.env.CALIDAD_FOTOS_PARALELO ?? 6), 16));

@Injectable()
export class CalidadFotosService {
  private readonly log = new Logger(CalidadFotosService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient, private readonly catalogo: CatalogoService) {}

  private ia() {
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
    if (!apiKey) throw new BadRequestException('Falta ANTHROPIC_API_KEY');
    return new Anthropic({ apiKey });
  }

  async estado() {
    const [total, revisadas, sacadas] = await Promise.all([
      this.db.from('productos').select('id', { count: 'exact', head: true }).eq('activo', true).eq('tiene_foto', true),
      this.db.from('fotos_calidad').select('id', { count: 'exact', head: true }),
      this.db.from('fotos_calidad').select('id', { count: 'exact', head: true }).eq('sirve', false),
    ]);
    return {
      conFoto: total.count ?? 0,
      revisadas: revisadas.count ?? 0,
      sacadas: sacadas.count ?? 0,
      sinRevisar: Math.max(0, (total.count ?? 0) - ((revisadas.count ?? 0) - (sacadas.count ?? 0))),
      modelo: MODELO,
    };
  }

  // Las que tienen foto y todavía no se miraron.
  private async pendientes(): Promise<{ id: string; sku: string }[]> {
    const [productos, vistas] = await Promise.all([
      traerTodo<any>((desde, hasta) =>
        this.db.from('productos').select('id, sku').eq('activo', true).eq('tiene_foto', true).order('sku').range(desde, hasta)),
      traerTodo<any>((desde, hasta) => this.db.from('fotos_calidad').select('sku').range(desde, hasta)),
    ]);
    const yaVistas = new Set(vistas.map((v: any) => v.sku));
    return productos.filter((p: any) => !yaVistas.has(p.sku));
  }

  private cola: { lista: { id: string; sku: string }[]; ts: number } | null = null;

  async revisar(limite = 40) {
    if (!this.cola || !this.cola.lista.length || Date.now() - this.cola.ts > 15 * 60_000) {
      this.cola = { lista: await this.pendientes(), ts: Date.now() };
    }
    const lote = this.cola.lista.splice(0, Math.max(1, Math.min(Number(limite) || 40, 200)));
    const res = { revisadas: 0, sirven: 0, sacadas: 0, errores: 0, faltan: this.cola.lista.length, detalle: [] as any[] };

    const corrida = await recorrerConRitmo(lote, { paralelo: PARALELO, espaciadoMs: 0 }, async (p) => {
      const veredicto = await this.mirar(p.sku);
      if (!veredicto) { res.errores++; return; }
      res.revisadas++;
      await this.db.from('fotos_calidad').upsert(
        { producto_id: p.id, sku: p.sku, sirve: veredicto.sirve, motivo: veredicto.motivo, modelo: MODELO },
        { onConflict: 'sku' },
      );
      if (veredicto.sirve) { res.sirven++; return; }
      // No sirve: se saca de Storage y el producto vuelve al fondo de la góndola.
      await this.db.storage.from('productos').remove([`${p.sku}.jpg`]);
      await this.catalogo.marcarFoto(p.sku, false);
      res.sacadas++;
      if (res.detalle.length < 40) res.detalle.push({ sku: p.sku, motivo: veredicto.motivo });
    });
    res.errores += corrida.errores.length;
    if (res.sacadas) this.catalogo.invalidarFotos();
    if (res.revisadas) this.log.log(`Calidad de fotos: ${res.sacadas} sacadas de ${res.revisadas} miradas (faltan ${res.faltan})`);
    return res;
  }

  private async mirar(sku: string) {
    const { data, error } = await this.db.storage.from('productos').download(`${sku}.jpg`);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    const tipo = tipoDeImagen(buf);
    if (!tipo) return { sirve: false, motivo: 'el archivo no es una imagen' };
    try {
      const r = await this.ia().messages.create({
        model: MODELO,
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: tipo, data: buf.toString('base64') } },
            { type: 'text', text: INSTRUCCION },
          ],
        }],
      });
      const texto = r.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
      return leerVeredicto(texto);
    } catch (e) {
      this.log.warn(`No se pudo mirar ${sku}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  // Qué se sacó y por qué (para la tarjeta de Productos).
  async sacadas(limite = 60) {
    const { data, error } = await this.db
      .from('fotos_calidad')
      .select('sku, motivo, creado_en, producto:productos(nombre)')
      .eq('sirve', false)
      .order('creado_en', { ascending: false })
      .limit(Math.min(Math.max(Number(limite) || 60, 1), 200));
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((d: any) => ({ sku: d.sku, nombre: d.producto?.nombre ?? d.sku, motivo: d.motivo, creadoEn: d.creado_en }));
  }
}
