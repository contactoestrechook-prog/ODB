import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { MODELO_PRINCIPAL } from '../comun/modelos';
import { ProveedoresFichaService, dominioDe } from './proveedores-ficha.service';

// Búsqueda semanal de logos (27/10/2026). Leandro: «poné un agente que una vez
// por semana busque los logos que falten y los descargue».
//
// Los lunes de madrugada toma hasta 25 proveedores activos sin logo, primero
// los que se usan (compras en ODB, más productos). Si tiene web, baja el logo de
// ahí. Si no, le pide a Claude, con búsqueda web, el sitio oficial de esa
// empresa o marca en Argentina: solo si está seguro se guarda la web y se baja
// el logo. Lo que trae el sistema queda marcado (logo_auto) para que una
// persona lo mire en la ficha. Al que no se le encuentra nada se lo vuelve a
// buscar recién al mes, para no gastar en lo mismo cada semana.

const POR_SEMANA = 25;
const REINTENTO_DIAS = 30;

export type SitioOficial = { web: string | null; seguro: boolean; motivo: string };

/** Lo que contesta el modelo: el último objeto JSON del texto. */
export function leerSitio(texto: string): SitioOficial {
  const m = texto.match(/\{[^{}]*"web"[^{}]*\}/g);
  if (!m) return { web: null, seguro: false, motivo: 'sin respuesta' };
  try {
    const j = JSON.parse(m[m.length - 1]);
    const web = typeof j.web === 'string' ? dominioDe(j.web) : null;
    return { web, seguro: j.seguro === true && !!web, motivo: String(j.motivo ?? '').slice(0, 300) };
  } catch {
    return { web: null, seguro: false, motivo: 'respuesta ilegible' };
  }
}

@Injectable()
export class LogosSemanalService {
  private readonly log = new Logger('LogosProveedores');

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly ficha: ProveedoresFichaService,
  ) {}

  /** Pregunta el sitio oficial con búsqueda web. */
  private async sitioOficial(p: { razon_social: string; nombre_fantasia: string | null; cuit: string | null }): Promise<SitioOficial> {
    const claude = new Anthropic();
    const pedido = [
      `Proveedor de un almacén premium de Canning (provincia de Buenos Aires, Argentina): «${p.razon_social}»`,
      p.nombre_fantasia ? `Nombre de fantasía: «${p.nombre_fantasia}».` : '',
      p.cuit ? `CUIT: ${p.cuit}.` : '',
      'Buscá el sitio web oficial de esa empresa o de la marca que vende (no un marketplace, ni Mercado Libre, ni redes sociales, ni un directorio).',
      'Si el nombre es genérico o hay varias empresas posibles y no podés saber cuál es, no adivines: seguro=false.',
      'Terminá tu respuesta con una sola línea JSON: {"web": "dominio.com.ar" o null, "seguro": true|false, "motivo": "en pocas palabras"}',
    ].filter(Boolean).join('\n');
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: pedido }];
    let r: any = null;
    // la búsqueda puede pausar el turno: se continúa hasta dos veces
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      r = await claude.messages.create({
        model: MODELO_PRINCIPAL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'AR' } }],
        messages,
      } as any);
      if (r.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: r.content });
    }
    if (r?.stop_reason === 'refusal') return { web: null, seguro: false, motivo: 'el modelo no respondió' };
    const texto = ((r?.content ?? []) as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return leerSitio(texto);
  }

  // lunes 4:17 (hora de Buenos Aires)
  @Cron('17 4 * * 1', { timeZone: 'America/Argentina/Buenos_Aires' })
  async semanal() {
    try {
      const r = await this.buscar();
      this.log.log(`logos: ${r.traidos} traídos, ${r.sinSitio} sin sitio seguro, ${r.fallidos} sin logo usable (de ${r.revisados})`);
    } catch (e: any) {
      this.log.error(`logos: ${e?.message ?? e}`);
    }
  }

  async buscar(limite = POR_SEMANA) {
    const desde = new Date(Date.now() - REINTENTO_DIAS * 86_400_000).toISOString();
    const [prov, res] = await Promise.all([
      this.db.from('proveedores').select('id, razon_social, nombre_fantasia, cuit, web')
        .eq('activo', true).is('logo_url', null)
        .or(`logo_buscado_en.is.null,logo_buscado_en.lt.${desde}`)
        .range(0, 4999),
      this.db.rpc('proveedores_resumen'),
    ]);
    if (prov.error) throw new Error(prov.error.message);
    const uso = new Map(((res.data ?? []) as any[]).map((x) => [x.proveedor_id, x]));
    const candidatos = ((prov.data ?? []) as any[])
      .map((p) => ({ ...p, act: uso.get(p.id)?.ultima_actividad ?? '', productos: Number(uso.get(p.id)?.productos ?? 0) }))
      .filter((p) => p.productos > 0 || p.act)
      .sort((a, b) => String(b.act).localeCompare(String(a.act)) || b.productos - a.productos)
      .slice(0, limite);

    let traidos = 0, sinSitio = 0, fallidos = 0;
    for (const p of candidatos) {
      await this.db.from('proveedores').update({ logo_buscado_en: new Date().toISOString() }).eq('id', p.id);
      let web = dominioDe(p.web);
      if (!web) {
        try {
          const s = await this.sitioOficial(p);
          if (!s.seguro || !s.web) { sinSitio++; continue; }
          web = s.web;
          await this.db.from('proveedores').update({ web }).eq('id', p.id);
          await this.db.from('auditoria').insert({ usuario_id: null, accion: 'proveedor_web_automatica', entidad: 'proveedores', entidad_id: p.id,
            datos_antes: { web: null }, datos_despues: { web, motivo: s.motivo } }).then(() => null, () => null);
        } catch (e: any) {
          this.log.warn(`logos: no pude buscar el sitio de ${p.razon_social}: ${e?.message ?? e}`);
          sinSitio++;
          continue;
        }
      }
      try {
        await this.ficha.logoDesdeWeb(p.id, null, true);
        traidos++;
      } catch {
        fallidos++;
      }
    }
    return { revisados: candidatos.length, traidos, sinSitio, fallidos };
  }
}
