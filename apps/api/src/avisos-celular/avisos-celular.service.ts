import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { SUPABASE } from '../supabase.provider';
import { AlertaCampanita, Aviso, avisoDe, resumenDeNoche } from './aviso-celular';

// AVISOS AL CELULAR (6/11/2026, Leandro: «que les lleguen a los celulares, como
// una aplicación, lo mismo que hicimos para MetoGroup»).
// Lo importante de la campanita sale al celular o a la computadora aunque el panel
// esté cerrado (Web Push). Qué tipos: configuracion.avisos_celular.tipos, que se
// cambia sin publicar. La base llama a enviarAlerta apenas se guarda un aviso de
// esos tipos (disparador trg_zz_avisos_celular) y a manana() a las 8 (pg_cron).
// A quién: lo mismo que la campanita; quien no activó un aparato no recibe nada.
// Ver db/migracion-avisos-celular.sql.

type Suscripcion = { id: number; usuario_id: string; endpoint: string; p256dh: string; auth: string; fallos: number };
type Envio = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, cuerpo: string, opciones: any) => Promise<unknown>;

const JEFES = ['dueno', 'gerente'];

@Injectable()
export class AvisosCelularService {
  private readonly log = new Logger('AvisosCelular');
  private claves: { publica: string; privada: string } | null = null;
  // se reemplaza en las pruebas
  enviarUno: Envio = (sub, cuerpo, opciones) => webpush.sendNotification(sub, cuerpo, opciones);

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async clavesAvisos() {
    if (this.claves) return this.claves;
    const { data, error } = await this.db.rpc('celular_claves');
    if (error) throw new Error(error.message);
    const c = Array.isArray(data) ? data[0] : data;
    if (!c?.publica || !c?.privada) throw new Error('Faltan las claves de los avisos (scripts/avisos-claves.mjs)');
    this.claves = { publica: c.publica, privada: c.privada };
    return this.claves;
  }

  async config(): Promise<{ activo?: boolean; tipos?: string[] }> {
    const { data } = await this.db.from('configuracion').select('valor').eq('clave', 'avisos_celular').maybeSingle();
    return (data?.valor as any) ?? {};
  }

  async secretoOk(secreto: string): Promise<boolean> {
    if (!secreto) return false;
    const { data } = await this.db.rpc('celular_secreto_ok', { p: secreto });
    return data === true;
  }

  // Quiénes ven ese aviso en la campanita (NovedadesController.alertas): con
  // destinatario, esa persona; sin destinatario, los dueños y gerentes.
  async destinatarios(paraUsuario: string | null): Promise<string[]> {
    let q = this.db.from('usuarios').select('id').eq('activo', true);
    q = paraUsuario ? q.eq('id', paraUsuario) : q.in('rol', JEFES);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((u) => String(u.id));
  }

  /** Manda un aviso a todos los aparatos de esas personas. Un aparato que ya no existe (404/410) se borra. */
  async enviarAvisos(usuarioIds: string[], aviso: Aviso): Promise<{ enviados: number; aparatos: number }> {
    const ids = [...new Set(usuarioIds.filter(Boolean))];
    if (!ids.length) return { enviados: 0, aparatos: 0 };
    const { data, error } = await this.db.from('push_suscripciones').select('id, usuario_id, endpoint, p256dh, auth, fallos').in('usuario_id', ids);
    if (error) throw new Error(error.message);
    const subs = (data ?? []) as Suscripcion[];
    if (!subs.length) return { enviados: 0, aparatos: 0 };
    const c = await this.clavesAvisos();
    const opciones = {
      vapidDetails: { subject: 'https://sistema.odbpremiummarket.com.ar', publicKey: c.publica, privateKey: c.privada },
      TTL: 60 * 60 * 24,
      urgency: 'high',
    };
    const cuerpo = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo ?? '', url: aviso.url ?? '/inicio', tag: aviso.tag });
    let enviados = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await this.enviarUno({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, opciones);
        enviados++;
        await this.db.from('push_suscripciones').update({ ultimo_ok_en: new Date().toISOString(), fallos: 0 }).eq('id', s.id);
      } catch (e: any) {
        const st = e?.statusCode;
        this.log.warn(`aviso al aparato ${s.id} no salió: ${st ?? ''} ${String(e?.body ?? e?.message ?? e).slice(0, 160)}`);
        if (st === 404 || st === 410) await this.db.from('push_suscripciones').delete().eq('id', s.id);
        else await this.db.from('push_suscripciones').update({ fallos: (s.fallos || 0) + 1 }).eq('id', s.id);
      }
    }));
    return { enviados, aparatos: subs.length };
  }

  /** Un aviso nuevo de la campanita (lo pide la base apenas se guarda). Sale una sola vez. */
  async enviarAlerta(alertaId: string) {
    const cfg = await this.config();
    if (cfg.activo === false) return { salteado: 'apagado' };
    const tipos = new Set(cfg.tipos ?? []);
    const { data: a } = await this.db.from('alertas_internas')
      .select('id, para_usuario, tipo, titulo, detalle, referencia, leida_en, celular_en').eq('id', alertaId).maybeSingle();
    if (!a || a.celular_en || a.leida_en || !tipos.has(a.tipo)) return { salteado: true };
    // se marca ANTES de mandar: si la base llama dos veces, sale una sola
    const { data: marcada } = await this.db.from('alertas_internas').update({ celular_en: new Date().toISOString() })
      .eq('id', a.id).is('celular_en', null).select('id');
    if (!marcada?.length) return { salteado: 'ya salió' };
    return this.enviarAvisos(await this.destinatarios(a.para_usuario), avisoDe(a as AlertaCampanita));
  }

  /** A las 8: lo importante que llegó entre las 22 y las 8 (y nadie cerró), en un solo aviso por persona. */
  async manana() {
    const cfg = await this.config();
    if (cfg.activo === false) return { salteado: 'apagado' };
    const tipos = cfg.tipos ?? [];
    if (!tipos.length) return { personas: 0 };
    const { data: subs, error: e1 } = await this.db.from('push_suscripciones').select('usuario_id');
    if (e1) throw new Error(e1.message);
    const conAparato = new Set(((subs ?? []) as any[]).map((s) => String(s.usuario_id)));
    if (!conAparato.size) return { personas: 0 };
    const desde = new Date(Date.now() - 10.25 * 3600_000).toISOString(); // corre a las 8: desde las 21:45
    const { data: alertas, error: e2 } = await this.db.from('alertas_internas')
      .select('id, para_usuario, tipo, titulo, detalle, referencia, creada_en')
      .in('tipo', tipos).is('celular_en', null).is('leida_en', null).gte('creada_en', desde).order('creada_en');
    if (e2) throw new Error(e2.message);
    if (!alertas?.length) return { personas: 0 };
    const jefes = await this.destinatarios(null);
    const porPersona = new Map<string, AlertaCampanita[]>();
    for (const a of alertas as AlertaCampanita[]) {
      for (const uid of a.para_usuario ? [a.para_usuario] : jefes) {
        if (conAparato.has(uid)) porPersona.set(uid, [...(porPersona.get(uid) ?? []), a]);
      }
    }
    await this.db.from('alertas_internas').update({ celular_en: new Date().toISOString() }).in('id', (alertas as any[]).map((a) => a.id));
    let enviados = 0;
    for (const [uid, lista] of porPersona) enviados += (await this.enviarAvisos([uid], resumenDeNoche(lista))).enviados;
    return { personas: porPersona.size, enviados };
  }

  // ---- lo que hace cada persona desde la pantalla «Avisos en el celular» ----

  async suscribir(usuarioId: string, s: any, dispositivo?: string) {
    if (!String(s?.endpoint ?? '').startsWith('https://') || !s?.keys?.p256dh || !s?.keys?.auth) {
      throw new Error('El navegador no mandó los datos del aparato');
    }
    const { error } = await this.db.from('push_suscripciones').upsert({
      usuario_id: usuarioId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
      dispositivo: String(dispositivo ?? '').slice(0, 80) || null, fallos: 0,
    }, { onConflict: 'endpoint' });
    if (error) throw new Error(error.message);
  }

  async quitar(usuarioId: string, filtro: { endpoint?: string; id?: number }) {
    let q = this.db.from('push_suscripciones').delete().eq('usuario_id', usuarioId);
    q = filtro.endpoint ? q.eq('endpoint', filtro.endpoint) : q.eq('id', filtro.id ?? -1);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async aparatos(usuarioId: string) {
    const { data, error } = await this.db.from('push_suscripciones')
      .select('id, dispositivo, creada_en, ultimo_ok_en, endpoint').eq('usuario_id', usuarioId).order('creada_en');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  probar(usuarioId: string) {
    return this.enviarAvisos([usuarioId], {
      titulo: 'O.D.B',
      cuerpo: 'Así te van a llegar los avisos importantes. Tocalo para abrir el sistema.',
      url: '/avisos',
      tag: 'prueba',
    });
  }
}
