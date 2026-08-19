import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { BotService } from './bot.service';

// La app de RESPONDE (la de MetoGroup, con su estética y sus funciones) habla
// con UN endpoint: GET ?data=1 y POST {accion}. Este adaptador le da exactamente
// ese contrato, con los datos de ODB detrás. La app no se toca: es la misma
// para todos los clientes de MetoGroup; lo que cambia es de dónde salen los datos.
//
// Contrato que espera la app (sacado del HTML):
//   contacts[]:  id, nombre, whatsapp_id, etapa, modo_humano, bloqueado, origen,
//                nota_interna, info_extraida, fase_descubrimiento, created_at
//   messages[]:  contact_id, role ('user'|'assistant'), content, created_at,
//                message_type, metadata{media_url}
//   programados[]: id, contact_id, texto, enviar_at
//   analisis{contact_id → {...}}
//   POST accion: enviar | enviar_media | bot | nota | analizar | programar |
//                cancelar_programado | importar | difusion

const LINEA = 'pedidos';

@Roles('dueno')
@Controller('responde-app')
export class RespondeAppController {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly bot: BotService,
  ) {}

  // ---------------- GET ?data=1 ----------------
  @Get()
  async datos(@Query('data') data?: string) {
    if (data !== '1') return { ok: true, servicio: 'responde-odb' };

    const [{ data: convs }, { data: contactos }, { data: clientes }, { data: progs }] = await Promise.all([
      this.db.from('bot_conversaciones').select('linea, telefono, mensajes, actualizado_en, bot_activo, derivada_en, derivada_motivo, resuelta_en').eq('linea', LINEA).order('actualizado_en', { ascending: false }).limit(300),
      this.db.from('bot_contactos').select('telefono, tipo, nombre, notas, notas_equipo, etiquetas'),
      this.db.from('clientes').select('telefono, nombre, tipo').not('telefono', 'is', null),
      this.db.from('mensajes_programados').select('id, telefono, texto, enviar_en').is('enviado_en', null).is('cancelado_en', null).order('enviar_en'),
    ]);

    const porTel = new Map<string, any>();
    for (const c of (contactos ?? []) as any[]) porTel.set(String(c.telefono), c);
    const cliPorTel = new Map<string, any>();
    for (const c of (clientes ?? []) as any[]) cliPorTel.set(String(c.telefono).replace(/\D/g, ''), c);

    const contacts: any[] = [];
    const messages: any[] = [];
    for (const cv of (convs ?? []) as any[]) {
      const tel = String(cv.telefono);
      const ct = porTel.get(tel);
      const cli = cliPorTel.get(tel);
      const msjs: any[] = Array.isArray(cv.mensajes) ? cv.mensajes : [];
      // el id del contacto ES el teléfono: es estable y la app solo lo usa como clave
      contacts.push({
        id: tel,
        nombre: ct?.nombre ?? cli?.nombre ?? null,
        // un @lid (número oculto por privacidad) va tal cual; un teléfono, como chat id
        whatsapp_id: tel.includes('@') ? tel : /^549\d{10}$/.test(tel) ? `${tel}@c.us` : `${tel}@lid`,
        // etapa: lo que la app pinta como tag arriba del nombre
        etapa: ct?.tipo === 'proveedor' ? 'proveedor' : cli ? 'cliente' : 'nuevo',
        fase_descubrimiento: cli?.tipo ?? '',
        modo_humano: cv.bot_activo === false,
        bloqueado: false,
        origen: 'whatsapp',
        nota_interna: ct?.notas_equipo ?? '',
        info_extraida: ct?.notas ? { negocio: { nombre_empresa: ct?.nombre ?? '' }, contacto: { resumen: ct.notas } } : null,
        created_at: cv.actualizado_en,
      });
      // el hilo se guarda sin timestamps por mensaje: se distribuyen hacia atrás
      // desde la última actualización, un segundo por mensaje, para que la app
      // los ordene y marque no leídos de forma estable
      const base = new Date(cv.actualizado_en).getTime();
      msjs.forEach((m, i) => {
        const texto = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? (m.content.find((b: any) => b.type === 'text')?.text ?? '') : '';
        messages.push({
          contact_id: tel,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: texto,
          created_at: new Date(base - (msjs.length - 1 - i) * 1000).toISOString(),
          message_type: 'text',
          metadata: {},
        });
      });
    }

    return {
      rol: 'operador',
      tenants: [],
      contacts,
      messages,
      programados: ((progs ?? []) as any[]).map((p) => ({ id: p.id, contact_id: p.telefono, texto: p.texto, enviar_at: p.enviar_en })),
      analisis: {},
    };
  }

  // ---------------- POST {accion} ----------------
  @Post()
  async accion(@Body() b: any, @Req() req: any) {
    const usuarioId = req.usuario?.sub;
    // La app embebida manda el whatsapp_id del contacto (los @lid van ENTEROS:
    // triturarlos a dígitos rompe el envío). Si no viene, se cae al contrato
    // viejo, donde contact_id era el teléfono.
    const crudo = String(b?.whatsapp_id ?? b?.contact_id ?? '');
    const tel = crudo.includes('@') ? crudo : crudo.replace(/\D/g, '');
    switch (b?.accion) {
      case 'enviar': {
        if (!tel) throw new BadRequestException('Falta el contacto');
        return this.bot.responderComoHumano(LINEA, tel, String(b.texto ?? ''), usuarioId);
      }
      case 'enviar_media': {
        // la app manda el archivo en base64; se despacha por WAHA como imagen o archivo
        if (!tel) throw new BadRequestException('Falta el contacto');
        const mime = String(b.mime ?? 'application/octet-stream');
        if (!/^image\//.test(mime)) throw new BadRequestException('Por ahora solo se envían imágenes desde acá');
        // WAHA baja el archivo de una URL: se sube al bucket público y se manda el link
        const ruta = `responde/${tel}/${Date.now()}-${String(b.filename ?? 'foto').replace(/[^\w.\-]/g, '_')}`;
        const { error: eUp } = await this.db.storage.from('publico').upload(ruta, Buffer.from(String(b.data_b64 ?? ''), 'base64'), { contentType: mime, upsert: true });
        if (eUp) throw new BadRequestException(`No pude subir la imagen: ${eUp.message}`);
        const { data: pub } = this.db.storage.from('publico').getPublicUrl(ruta);
        const r = await this.bot.enviarPorWhatsapp({ to: tel, text: b.caption ?? '', imagenUrl: pub.publicUrl, referencia: `responde-app/${tel}` });
        return { ok: r.enviado, ...r };
      }
      case 'bot': {
        // activar=true → vuelve el bot; activar=false → atendés vos
        if (!tel) throw new BadRequestException('Falta el contacto');
        return b.activar ? this.bot.devolverAlBot(LINEA, tel, usuarioId) : this.bot.pausarBot(LINEA, tel, usuarioId);
      }
      case 'nota':
        if (!tel) throw new BadRequestException('Falta el contacto');
        return this.bot.guardarNota(tel, String(b.nota ?? ''));
      case 'analizar':
        // el análisis por IA de la app: acá se resuelve con la ficha (compras, tipo)
        return { ok: true, analisis: await this.bot.fichaContacto(tel) };
      case 'programar':
        return this.bot.programarMensaje({ linea: LINEA, telefono: tel, texto: String(b.texto ?? ''), enviarEn: String(b.enviar_at ?? ''), usuarioId });
      case 'cancelar_programado':
        return this.bot.cancelarProgramado(String(b.id ?? ''));
      case 'importar': {
        // contactos importados: quedan como clientes con permiso (los cargó el equipo)
        const xs: any[] = Array.isArray(b.contactos) ? b.contactos : [];
        let n = 0;
        for (const c of xs) {
          const t = String(c.telefono ?? c.whatsapp_id ?? '').replace(/\D/g, '');
          if (t.length < 10) continue;
          await this.db.from('bot_contactos').upsert({ telefono: t, tipo: 'cliente', nombre: c.nombre ?? null, actualizado_en: new Date().toISOString() }, { onConflict: 'telefono' });
          n++;
        }
        return { ok: true, importados: n };
      }
      case 'difusion': {
        if (!['gerente', 'dueno'].includes(req.usuario?.rol)) throw new BadRequestException('Las difusiones las manda gerencia');
        const ids: string[] = Array.isArray(b.contact_ids) ? b.contact_ids : [];
        return this.bot.crearDifusion({ linea: LINEA, titulo: b.titulo, texto: String(b.texto ?? ''), imagenUrl: b.imagen_url, telefonos: ids, usuarioId });
      }
      case 'logout':
        return { ok: true };
      default:
        throw new BadRequestException(`Acción desconocida: ${b?.accion}`);
    }
  }
}
